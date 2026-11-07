# End-to-end test of pricing plans (lib/plans.ts): the free plan's 30-order limit, the warning near it,
# the block at it (buyers can't order, seller app asks to upgrade, orders stay reachable), upgrading by
# UPI claim (shop opens at once), the admin's "Not received" undoing it, paying an upgrade online-style
# (admin marks paid) with credit for what's already paid this month, and the admin activating a plan.
# Needs the app running locally on a fresh database with:
#   --var OPEN_SIGNUP:1 --var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code
# Set KK_PERSIST to the --persist-to folder if the app uses one.
import http.cookiejar, json, os, random, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
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
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        if multipart: body, h['Content-Type'] = multipart
        try: r = op.open(urllib.request.Request(B + path, data=body, headers=h)); return r.status, r.headers, r.read().decode(errors='replace')
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode(errors='replace')
    return go
PERSIST = ['--persist-to', os.environ['KK_PERSIST']] if os.environ.get('KK_PERSIST') else []
def sql(q):
    return json.loads(subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *PERSIST, '--json', '--command', q], capture_output=True, text=True).stdout)[0]['results']
def sale(sel, fields):
    bd = '----kk' + str(random.randint(1, 10**9))
    body = ''.join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields) + f'--{bd}--\r\n'
    s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
    return re.search(r'/drops/([a-z0-9]+)', h.get('Location', '')).group(1)
n_ip = [0]
def cod_order(drop, variant):
    n_ip[0] += 1
    b = client(f'10.9.{n_ip[0] // 200}.{n_ip[0] % 200 + 1}')
    ph = '98' + str(10**7 + n_ip[0])
    # Cash on delivery is gone: place a normal order and mark it paid (that's what counts against the plan).
    res = b(f'/d/{drop}', {'variant': variant, 'qty': '1', 'name': 'Asha Rao', 'phone': ph, 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038'})
    sql(f"UPDATE orders SET status = 'paid', paid_at = {int(time.time() * 1000)} WHERE buyer_phone = '91{ph}' AND status = 'pending'")
    return res

phone = '93' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.8.0.1')
sel('/signup', {'name': 'Plan Seller', 'shop': 'Plan Shop', 'phone': phone, 'vpa': 'planshop@ybl', 'paywant': 'manual', 'pin': '4321'})
sid = sql(f"SELECT id, plan FROM sellers WHERE phone = '91{phone}'")[0]
check(sid['plan'] == 'free', 'new shop starts on the free plan (Shuruaat)')
sid = sid['id']
drop = sale(sel, [('title', 'Steel bottle'), ('price', '300'), ('stock', '200'), ('max', '2'), ('description', 'x'), ('cod', '1')])
variant = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
s, h, home = sel('/app')
check('0 of 30 orders used this month' in home and 'Shuruaat plan' in home, 'home shows the plan meter: 0 of 30')

for _ in range(24):
    s, h, _ = cod_order(drop, variant)
    if s != 303: break
check(s == 303, '24 paid orders')
s, h, home = sel('/app')
check('24 of 30 orders used' in home and 'Only 6 of your 30 orders left' in home, 'at 80%: meter 24/30 and an upgrade warning')

for _ in range(6): cod_order(drop, variant)
s, h, home = sel('/app')
check('used all 30 orders this month' in home and 'Upgrade to Dukaan' in home, 'at 30: the app shows the limit screen with upgrade options')
s, h, page = cod_order(drop, variant)
check(not h.get('Location', '').startswith('/o/'), f"order 31 is refused (→ {h.get('Location')})")
check(sql(f"SELECT COUNT(*) n FROM orders WHERE seller_id = '{sid}'")[0]['n'] == 30, 'no 31st order was created')
s, h, page = client('10.8.9.9')(f'/d/{drop}')
check('isn’t taking new orders' in page, 'buyers see the shop isn’t taking orders')
s, h, orders = sel('/app/orders?tab=send')
check(s == 200 and 'Steel bottle' in orders, 'orders already placed stay reachable')
s, h, _ = sel('/app/drops/new', multipart=(b'--x--\r\n', 'multipart/form-data; boundary=x'))
check(s == 303 and 'billing' in h.get('Location', ''), 'starting a new sale goes to the plan page')

# ---- upgrade by UPI claim ----
s, h, _ = sel('/app/billing/upgrade', {'plan': 'dukaan'})
inv = sql(f"SELECT id, amount_paise, plan, plan_from, status FROM invoices WHERE seller_id = '{sid}' AND plan IS NOT NULL")[0]
check(inv['plan'] == 'dukaan' and inv['plan_from'] == 'free' and 99901 <= inv['amount_paise'] <= 99999 and inv['status'] == 'due', 'upgrade invoice: Dukaan, ₹999 + unique paise')
s, h, bill = sel('/app/billing')
check('Upgrade to Dukaan: pay ₹999.' in bill and 'Cancel upgrade' in bill, 'plan page shows the upgrade to pay and a cancel button')
s, h, _ = sel('/app')
check('used all 30 orders' in _, 'still blocked until it is paid')
sel(f"/app/billing/claim/{inv['id']}", {})
check(sql(f"SELECT plan, plan_fee_paise FROM sellers WHERE id = '{sid}'")[0] == {'plan': 'dukaan', 'plan_fee_paise': 99900}, '"I have paid" switches to Dukaan at once')
s, h, home = sel('/app')
m = re.search(r'[^<>]{0,40}of 300[^<>]{0,60}', home)
check('30 of 300 orders used' in home, f'shop open again: 30 of 300 ({s}, {m.group(0) if m else re.findall(r"<h1[^>]*>([^<]*)", home)})')
s, h, _ = cod_order(drop, variant)
check(h.get('Location', '').startswith('/o/'), 'buyers can order again')

# ---- admin ----
adm = client('10.8.0.9')
s, h, _ = adm('/admin/setup', {'phone': '9999999999', 'code': 'setup-code', 'pin': '135790'})
if s != 303 or '/admin?' not in h.get('Location', ''): adm('/admin/login', {'phone': '9999999999', 'pin': '135790'})
s, h, det = adm(f'/admin/sellers/{sid}')
check('31/300' in det and 'name="plan" value="badi"' in det, 'admin seller page shows the plan picker and usage 31/300')
adm(f"/admin/invoices/{inv['id']}/not-received", {})
check(sql(f"SELECT plan FROM sellers WHERE id = '{sid}'")[0]['plan'] == 'free', '"Not received" puts the seller back on the free plan')
s, h, home = sel('/app')
check('used all 30 orders' in home, '…and the shop is at its limit again')
adm(f"/admin/invoices/{inv['id']}/paid", {})
check(sql(f"SELECT plan FROM sellers WHERE id = '{sid}'")[0]['plan'] == 'dukaan', 'admin marks the upgrade paid → Dukaan')

# ---- credit: Dukaan already paid this month → Badi costs the difference ----
sel('/app/billing/upgrade', {'plan': 'badi'})
up = sql(f"SELECT amount_paise FROM invoices WHERE seller_id = '{sid}' AND plan = 'badi' AND status = 'due'")[0]
check(100001 <= up['amount_paise'] <= 100099, 'upgrade to Badi Dukaan charges the ₹1,000 difference')
s, h, _ = sel(f'/app/billing/cancel/{0}'.replace('0', sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND plan = 'badi'")[0]['id']), {})
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND plan = 'badi'"), 'seller can cancel an upgrade they have not paid')

adm(f'/admin/sellers/{sid}/billing', {'plan': 'badi', 'fee': '', 'trial': ''})
check(sql(f"SELECT plan, plan_fee_paise FROM sellers WHERE id = '{sid}'")[0] == {'plan': 'badi', 'plan_fee_paise': 199900}, 'admin activates Badi Dukaan (fee ₹1,999)')
s, h, home = sel('/app')
check('of 30' not in home and 'of 300' not in home, 'no meter on the unlimited plan')
s, h, bill = sel('/app/billing')
check('Unlimited orders' in bill, 'plan page: unlimited orders')
inv_m = sql(f"SELECT amount_paise FROM invoices WHERE seller_id = '{sid}' AND status = 'due' AND plan IS NULL")
check(len(inv_m) == 1 and 100001 <= inv_m[0]['amount_paise'] <= 100099, 'admin moves them up: billed only the ₹1,000 difference to what they paid this month')

# ---- Hindi ----
sel('/lang?to=hi&back=/app/billing')
adm(f'/admin/sellers/{sid}/billing', {'plan': 'free', 'fee': '', 'trial': ''})
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{sid}' AND status = 'due'"), 'back on the free plan: no fee left to pay')
s, h, home = sel('/app')
check('इस महीने के सारे 30 ऑर्डर पूरे हो गए' in home, 'limit screen in Hindi')
print(f'\nall {ok} checks passed')
