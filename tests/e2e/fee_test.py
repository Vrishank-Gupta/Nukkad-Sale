# End-to-end test of the monthly-fee journey: reminder popup → shop pauses after the due date
# (seller blocker + buyers can't order, existing orders still workable) → "I have paid" reopens
# → admin "Not received" pauses again → admin marks paid → open. Also the Razorpay keys guide.
# Needs the app running locally with --var OPEN_SIGNUP:1 --var ADMIN_PHONES:919999999999
# --var ADMIN_SETUP_CODE:setup-code (any database).
import http.cookiejar, json, random, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
ok = 0
def check(cond, what):
    global ok
    if not cond: print('FAIL:', what); sys.exit(1)
    ok += 1; print('ok  ', what)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
def client(ip):
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
    def go(path, data=None, multipart=None):
        h = {'User-Agent': 'Mozilla/5.0 khatakhat-e2e', 'Origin': B, 'cf-connecting-ip': ip}
        body = None
        if data is not None: body = urllib.parse.urlencode(data, doseq=True).encode()
        if multipart is not None: body, h['Content-Type'] = multipart
        try: r = op.open(urllib.request.Request(B + path, data=body, headers=h)); return r.status, r.headers, r.read().decode(errors='replace')
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode(errors='replace')
    return go
def sql(q):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *(['--persist-to', __import__('os').environ['KK_PERSIST']] if __import__('os').environ.get('KK_PERSIST') else []), '--json', '--command', q], capture_output=True, text=True).stdout
    return json.loads(out)[0]['results']

phone = '97' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.6.0.1')
s, h, _ = sel('/signup', {'name': 'Fee Tester', 'shop': 'Fee Test Shop', 'phone': phone, 'vpa': 'feetest@ybl', 'paywant': 'manual', 'pin': '4321'})
check(s == 303, 'seller signed up')
sid = sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']
bd = '----kk' + str(random.randint(1, 10**9))
parts = [('title', 'Fee test kurta'), ('price', '499'), ('stock', '5'), ('max', '2'), ('description', 'x')]
body = ''.join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in parts) + f'--{bd}--\r\n'
s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
drop = re.search(r'/drops/([a-z0-9]+)', h.get('Location', '')).group(1)
check(drop, 'sale created')

adm = client('10.6.0.2')
s, h, _ = adm('/admin/setup', {'phone': '9999999999', 'code': 'setup-code', 'pin': '135790'})
if s != 303 or '/admin?' not in h.get('Location', ''): s, h, _ = adm('/admin/login', {'phone': '9999999999', 'pin': '135790'})
check(s == 303, 'admin logged in')
# A monthly bill made automatically (no trial) gets the usual days to pay.
sql(f"UPDATE sellers SET plan = 'dukaan', plan_fee_paise = 29900, trial_until = created_at WHERE id = '{sid}'")
sel('/app/billing')
inv = sql(f"SELECT id, amount_paise, due_at, created_at FROM invoices WHERE seller_id = '{sid}' AND status = 'due'")
check(len(inv) == 1, 'invoice created')
inv = inv[0]
check(abs((inv['due_at'] - inv['created_at']) - 2 * 86400000) < 120000, 'due 2 days after the invoice (default)')

# --- before the due date: reminders, shop open ---
s, h, home = sel('/app')
check('id="feepop"' in home and 'Pay now so your shop doesn' in home, 'daily popup shown before the due date')
check('Pay before then so your shop keeps running' in home, 'banner warns the shop will pause')
check('Your shop is paused' not in home, 'shop not paused yet')
buyer = client('10.6.0.3')
s, h, dpage = buyer(f'/d/{drop}')
check('id="buy"' in dpage, 'buyers can order before the due date')

# --- past the due date, but the platform has no way to take payment: never pause ---
sql("DELETE FROM platform_settings WHERE key IN ('upi_vpa', 'rzp_key_id', 'rzp_secret_enc')")
sql(f"UPDATE invoices SET due_at = {int(time.time() * 1000) - 60000} WHERE id = '{inv['id']}'")
check('Your shop is paused' not in sel('/app')[2], 'no UPI ID / Razorpay set up → shop is not paused')
check('can’t pay their fee yet' in adm('/admin')[2], 'admin dashboard warns that sellers can’t pay')

# --- admin adds a UPI ID for fees → past due → paused ---
adm('/admin/settings', {'upi_vpa': 'khatakhat@ybl', 'payee_name': 'NukkadSale', 'default_fee': '0', 'trial_days': '30', 'grace_days': '2', 'default_modes': ['direct', 'razorpay']})
s, h, home = sel('/app')
check('Your shop is paused' in home and '/app/billing' in home, 'seller home shows the pause screen with Pay')
check('Your shop is paused' in sel('/app/drops/new')[2], 'new sale screen blocked')
check('Your shop is paused' in sel('/app/khata')[2], 'other screens blocked')
s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
check(s == 303 and h['Location'] == '/app/billing', 'creating a sale is refused (sent to pay)')
s, h, orders = sel('/app/orders')
check(s == 200 and 'Your shop is paused' not in orders and 'overdue' in orders, 'orders stay open (with an overdue banner)')
s, h, bill = sel('/app/billing')
check(s == 200 and 'khatakhat@ybl' in bill and '/billing/claim/' in bill, 'plan page open, with UPI to pay and "I have paid"')
s, h, dpage = buyer(f'/d/{drop}')
check('isn’t taking new orders' in dpage and 'id="buy"' not in dpage, 'buyers see the shop is paused')
variant = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
s, h, _ = buyer(f'/d/{drop}', {'variant': variant, 'qty': '1', 'name': 'Asha', 'phone': '9811100009', 'address': '5 Park Street, Kolkata', 'pincode': '700016'})
check(s == 303 and 'err=' in h['Location'], 'a buyer order is refused while paused')
check('isn’t taking new orders' in urllib.parse.unquote(h['Location']), 'with a clear message')

# --- "I have paid" reopens at once ---
s, h, _ = sel(f"/app/billing/claim/{inv['id']}", {})
check('Your shop is paused' not in sel('/app')[2], '"I have paid" reopens the shop straight away')
check('id="buy"' in buyer(f'/d/{drop}')[2], 'buyers can order again')

# --- admin: not received → paused again; then paid → open ---
s, h, b = adm('/admin/billing?f=claimed')
check('Not received' in b, 'admin sees "Not received" on a claimed invoice')
adm(f"/admin/invoices/{inv['id']}/not-received", {})
check('Your shop is paused' in sel('/app')[2], 'not received → shop paused again')
adm(f"/admin/invoices/{inv['id']}/paid", {})
home = sel('/app')[2]
check('Your shop is paused' not in home and 'id="feepop"' not in home, 'marked paid → open, no popup')

# --- Razorpay keys guide ---
s, h, g = client('10.6.0.4')('/help/razorpay')
check(s == 200 and 'Generate Key' in g and 'rzp_live_' in g, 'Razorpay keys guide is public and complete')
# --- admin plan changes: a paid plan is billed now and pauses at once; a trial doesn't; free removes the bill ---
sql(f"DELETE FROM invoices WHERE seller_id = '{sid}'")
adm(f'/admin/sellers/{sid}/billing', {'plan': 'dukaan', 'fee': '', 'trial': ''})
b = sql(f"SELECT amount_paise, due_at, status FROM invoices WHERE seller_id = '{sid}'")
check(len(b) == 1 and 99901 <= b[0]['amount_paise'] <= 99999 and b[0]['due_at'] < time.time() * 1000, 'admin sets Dukaan: billed ₹999 now, due at once')
check('Your shop is paused' in sel('/app')[2] and 'isn’t taking new orders' in buyer(f'/d/{drop}')[2], '…and the shop pauses straight away')
_, _, bp = sel('/app/billing')
check('You’re on Dukaan' in bp or 'Dukaan' in bp, 'seller billing page shows the new plan')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'badi', 'fee': '', 'trial': ''})
b = sql(f"SELECT amount_paise, status FROM invoices WHERE seller_id = '{sid}' AND status = 'due'")
check(len(b) == 1 and 199901 <= b[0]['amount_paise'] <= 199999, 'upgrade while unpaid: one bill, now ₹1,999')
bid = sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'")[0]['id']
adm(f'/admin/invoices/{bid}/paid', {})
check('Your shop is paused' not in sel('/app')[2], 'paid → open')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'dukaan', 'fee': '', 'trial': ''})
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'") and 'Your shop is paused' not in sel('/app')[2], 'downgrade after paying this month: nothing to pay, stays open')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'badi', 'fee': '', 'trial': ''})
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'"), 'back up to Badi Dukaan: already paid ₹1,999 this month, nothing to pay')
sql(f"DELETE FROM invoices WHERE seller_id = '{sid}'")
adm(f'/admin/sellers/{sid}/billing', {'plan': 'dukaan', 'fee': '', 'trial': ''})
adm(f"/admin/invoices/{sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'")[0]['id']}/paid", {})
adm(f'/admin/sellers/{sid}/billing', {'plan': 'badi', 'fee': '', 'trial': ''})
b = sql(f"SELECT amount_paise, period FROM invoices WHERE seller_id = '{sid}' AND status = 'due'")
check(len(b) == 1 and 100001 <= b[0]['amount_paise'] <= 100099 and '-a' in b[0]['period'], 'upgrade after paying ₹999 this month: billed only the ₹1,000 difference')
check('Your shop is paused' in sel('/app')[2], '…and paused until the difference is paid')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'free', 'fee': '', 'trial': ''})
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'") and 'Your shop is paused' not in sel('/app')[2], 'free: unpaid bill removed, shop open')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'dukaan', 'fee': '', 'trial': '2030-01-31'})
_, _, bp = sel('/app/billing')
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'") and 'Free trial till 31/01/2030' in bp and 'first bill on 01/02/2030' in bp, 'paid plan with a trial: no bill; seller sees trial end and first bill date')

# --- seller moves to a smaller plan from next month, and can undo ---
_, _, bp = sel('/app/billing')
check('Move to a smaller plan' in bp, 'seller can choose a smaller plan')
sel('/app/billing/downgrade', {'plan': 'free'})
r = sql(f"SELECT plan, plan_next, plan_next_from FROM sellers WHERE id = '{sid}'")[0]
check(r['plan'] == 'dukaan' and r['plan_next'] == 'free' and r['plan_next_from'] > time.strftime('%Y-%m'), 'scheduled for next month; still Dukaan now')
check('You move to Shuruaat from' in sel('/app/billing')[2], 'seller sees the scheduled change')
sel('/app/billing/downgrade', {})
check(sql(f"SELECT plan_next FROM sellers WHERE id = '{sid}'")[0]['plan_next'] is None, 'undo keeps the plan')
print(f'\nall {ok} checks passed')
