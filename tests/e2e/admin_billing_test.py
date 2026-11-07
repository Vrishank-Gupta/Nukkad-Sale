# End-to-end test of the admin portal, per-seller payment methods and monthly billing.
# Needs: app started with --var ADMIN_PHONES:919999999999 --var OPEN_SIGNUP:1 and RAZORPAY_API_BASE pointing at
# mock_razorpay.py (see tests/e2e/README.md), on an empty database.
import http.cookiejar, json, re, subprocess, sys, urllib.parse, urllib.request

APP = 'http://localhost:8787'
fails = 0

def check(ok, msg):
    global fails
    print(('  ✓ ' if ok else '  ✗ ') + msg)
    fails += 0 if ok else 1

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a): return None

class Browser:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect())
    def go(self, url, data=None, headers=None):
        r = urllib.request.Request(url if url.startswith('http') else APP + url, data=data, headers={'Origin': APP, **(headers or {})})
        try: resp = self.op.open(r)
        except urllib.error.HTTPError as e: resp = e
        return resp.status, resp.headers.get('Location', ''), resp.read().decode('utf-8', 'replace')
    def post(self, url, fields=None):
        pairs = []
        for k, v in (fields or {}).items():
            for x in (v if isinstance(v, list) else [v]): pairs.append((k, x))
        return self.go(url, urllib.parse.urlencode(pairs).encode(), {'Content-Type': 'application/x-www-form-urlencoded'})

def sql(q):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', '--json', '--command', q], capture_output=True, text=True, cwd='/home/vrishankgupta/CommSeller').stdout
    return json.loads(out)[0]['results']

def signup(b, name, shop, phone):
    return b.post('/signup', {'name': name, 'shop': shop, 'phone': phone, 'vpa': phone + '@ybl', 'pin': '1234'})

print('admin access')
adm = Browser()
s, loc, _ = adm.go('/admin')
check(loc.endswith('/admin/login'), 'admin portal needs its own login')
s, loc, _ = adm.post('/admin/setup', {'phone': '9999999999', 'code': 'wrong', 'pin': '123456'})
check('err=' in loc, 'admin PIN setup refused without the setup code')
s, loc, _ = adm.post('/admin/setup', {'phone': '9888888888', 'code': 'setup-code', 'pin': '123456'})
check('err=' in loc, 'numbers not in ADMIN_PHONES cannot become admin')
s, loc, _ = adm.post('/admin/setup', {'phone': '9999999999', 'code': 'setup-code', 'pin': '123456'})
s, _, html = adm.go('/admin')
check(s == 200 and 'Dashboard' in html, 'admin sets a PIN with the setup code and opens the dashboard')

print('platform settings')
s, loc, _ = adm.post('/admin/settings', {'upi_vpa': 'khatakhat@ybl', 'payee_name': 'NukkadSale', 'rzp_key_id': 'rzp_test_PLATFORM', 'rzp_secret': 'platform_secret',
                                         'default_fee': '299', 'trial_days': '0', 'grace_days': '7', 'default_modes': ['direct', 'razorpay']})
check('ok=' in loc, 'platform settings saved (manual + Razorpay on by default)')

print('new seller starts free; the admin sets a paid fee and bills now')
sel = Browser(); signup(sel, 'Meera Shah', 'Meera Boutique', '9876543210')
_, _, st = sel.go('/app/settings')
check('/admin' not in st and 'Admin portal' not in st, 'sellers never see an admin portal link')
s, _, _ = sel.go('/admin')
check(s in (302, 303) or s == 404, 'seller session does not open /admin')
s, _, html = adm.go('/admin/sellers')
check('Meera Boutique' in html, 'seller listed in admin')
seller_id = sql("SELECT id FROM sellers WHERE phone = '919876543210'")[0]['id']
_, _, st = sel.go('/app/settings')
check('value="direct"' in st and 'value="razorpay"' in st and 'cashfree' not in st.lower(), 'seller sees manual UPI and Razorpay only (no Cashfree anywhere)')
s, loc, _ = sel.post('/app/settings', {'shop': 'Meera Boutique', 'vpa': 'meera@ybl', 'mode': 'cashfree'})
check(sql("SELECT pay_mode FROM sellers WHERE phone = '919876543210'")[0]['pay_mode'] == 'direct', 'an unknown method (old Cashfree) falls back to manual UPI')
check(sql(f"SELECT plan, plan_fee_paise FROM sellers WHERE id = '{seller_id}'")[0] == {'plan': 'free', 'plan_fee_paise': 0}, 'new shop starts on Shuruaat with no fee')
check(not sql(f"SELECT id FROM invoices WHERE seller_id = '{seller_id}'"), 'no invoice for a free shop')
s, loc, _ = adm.post(f'/admin/sellers/{seller_id}/billing', {'plan': 'dukaan', 'fee': '299', 'trial': '2026-12-31', 'invoice_now': '1'})
check(len(sql(f"SELECT id FROM invoices WHERE seller_id = '{seller_id}'")) == 1, '"Save & bill now" bills straight away, even with a trial date set')
_, _, bill = sel.go('/app/billing')
check('299.' in bill and 'Pay ₹299.' in bill, 'invoice created with a unique amount and Pay online button')
_, _, home = sel.go('/app')
check('NukkadSale fee' in home, 'fee-due banner on the seller home')

print('seller pays the fee online (platform Razorpay, auto-confirmed)')
inv = sql(f"SELECT id, amount_paise FROM invoices WHERE seller_id = '{seller_id}'")[0]
s, pay_url, _ = sel.post(f"/app/billing/pay/{inv['id']}")
check(pay_url.startswith('http://localhost:8792/pay/plink_'), 'redirected to the platform payment link')
r = urllib.request.Request(pay_url, data=b'', method='POST')
try: resp = urllib.request.build_opener(NoRedirect()).open(r); ret = resp.headers['Location']
except urllib.error.HTTPError as e: ret = e.headers['Location']
sel.go(ret)
check(sql(f"SELECT status, paid_via FROM invoices WHERE id = '{inv['id']}'")[0] == {'status': 'paid', 'paid_via': 'razorpay'}, 'invoice marked paid automatically (checked with Razorpay on return)')
_, _, home = sel.go('/app')
check('NukkadSale fee' not in home, 'banner gone once paid')

print('second seller pays by UPI → admin confirms')
s2 = Browser(); signup(s2, 'Ravi Kumar', 'Ravi Organics', '9700000001')
s2.go('/app/billing')
inv2 = sql("SELECT i.id FROM invoices i JOIN sellers s ON s.id = i.seller_id WHERE s.phone = '919700000001'")[0]['id']
s2.post(f'/app/billing/claim/{inv2}')
_, _, dash = adm.go('/admin')
check('say they paid' in dash, 'admin dashboard flags “seller says paid”')
adm.go(f'/admin/billing?f=claimed')
adm.post(f'/admin/invoices/{inv2}/paid')
check(sql(f"SELECT status FROM invoices WHERE id = '{inv2}'")[0]['status'] == 'paid', 'admin marks the UPI payment as paid')

print('admin forces a payment gateway for a big seller')
s, loc, _ = adm.post(f'/admin/sellers/{seller_id}/payments', {'allowed': ['razorpay'], 'active': 'direct'})
check('err=' in loc, 'cannot activate Razorpay before keys exist')
s, loc, _ = adm.post(f'/admin/sellers/{seller_id}/payments', {'allowed': ['razorpay'], 'active': 'razorpay', 'rzp_key': 'rzp_test_MEERA', 'rzp_secret': 'meera_secret'})
check('ok=' in loc, 'admin enters Key ID + Key secret (no webhook) and switches the seller to Razorpay only')
_, _, st = sel.go('/app/settings')
check('Set by NukkadSale' in st and 'value="direct"' not in st, 'seller sees it as fixed by NukkadSale')
boundary = 'B0'
mp = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in [('title', 'Silk saree'), ('price', '2499'), ('stock', '5'), ('max', '1')]) + f'--{boundary}--\r\n'
_, loc, _ = sel.go('/app/drops/new', mp.encode(), {'Content-Type': f'multipart/form-data; boundary={boundary}'})
drop = re.search(r'/drops/([a-z0-9]+)', loc).group(1)
_, _, dpage = Browser().go(f'/d/{drop}')
variant = re.search(r'name="variant" value="(\d+)"', dpage).group(1)
buyer = Browser()
_, loc, _ = buyer.post(f'/d/{drop}', {'variant': variant, 'qty': '1', 'name': 'Asha', 'phone': '9811100009', 'address': '5 Park Street, Kolkata', 'pincode': '700016'})
check(loc.startswith('http://localhost:8792/pay/'), 'buyer goes straight to the gateway – exact amount, no manual step')
r = urllib.request.Request(loc, data=b'', method='POST')
try: back = urllib.request.build_opener(NoRedirect()).open(r).headers['Location']
except urllib.error.HTTPError as e: back = e.headers['Location']
buyer.go(back)
oid = re.search(r'/o/([a-z0-9]+)/paid', back).group(1)
check(sql(f"SELECT status FROM orders WHERE id = '{oid}'")[0]['status'] == 'paid', 'buyer pays on the gateway → order paid automatically')
_, _, orders = sel.go('/app/orders?tab=all')
check('/received"' not in orders and 'Oud' not in orders or '/received"' not in orders, 'no manual “Yes, I got it” buttons for gateway orders')

print('overdue fee pauses NEW sales only; suspension stops orders')
sql(f"UPDATE invoices SET status = 'due', due_at = 1 WHERE id = '{inv2}'")
s2.go('/app')
_, _, newpage = s2.go('/app/drops/new')
check('paused' in newpage and 'Publish' not in newpage, 'overdue seller cannot start a new sale (with Pay now)')
_, _, still = buyer.go(f'/d/{drop}')
check('Pay ₹2,499' in still, "other sellers' buyers unaffected")
adm.post(f'/admin/sellers/{seller_id}/status')
_, _, closed = Browser().go(f'/d/{drop}')
check('paybtn' not in closed, 'suspended seller’s sale page stops taking orders')
_, loc, _ = Browser().post(f'/d/{drop}', {'variant': variant, 'qty': '1', 'name': 'X', 'phone': '9811100010', 'address': '5 Park Street, Kolkata', 'pincode': '700016'})
check('err=' in loc, 'and a direct order POST is refused')
adm.post(f'/admin/sellers/{seller_id}/status')
_, _, reopened = Browser().go(f'/d/{drop}')
check('paybtn' in reopened, 're-activated seller takes orders again')

print('seller asks for automatic payments → admin sees it')
s3 = Browser(); s3.post('/signup', {'name': 'Big Seller', 'shop': 'Big Shop', 'phone': '9700000002', 'vpa': 'big@ybl', 'pin': '1234', 'paywant': 'auto'})
_, _, dash = adm.go('/admin')
check('want automatic payments' in dash, 'admin dashboard shows the request')

print('ALL PASSED' if not fails else f'{fails} FAILED')
sys.exit(1 if fails else 0)
