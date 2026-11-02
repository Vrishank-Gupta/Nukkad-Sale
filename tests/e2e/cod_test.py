# End-to-end test of cash on delivery: seller turns COD on for a sale (with a COD charge) →
# buyer picks "Cash on delivery" → stock reserved, order page explains → seller confirms, sends,
# marks cash received → paid + khata. Also: cancelling puts stock back; COD can't be forced
# on a sale that doesn't allow it.
# Needs the app running locally with --var OPEN_SIGNUP:1 (any database).
import http.cookiejar, json, random, re, subprocess, sys, urllib.error, urllib.parse, urllib.request
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
def sql(q):
    return json.loads(subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', '--json', '--command', q], capture_output=True, text=True).stdout)[0]['results']
def sale(sel, fields):
    bd = '----kk' + str(random.randint(1, 10**9))
    body = ''.join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields) + f'--{bd}--\r\n'
    s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
    return re.search(r'/drops/([a-z0-9]+)', h.get('Location', '')).group(1)
buyer_form = lambda v, ph: {'variant': v, 'qty': '1', 'name': 'Asha Rao', 'phone': ph, 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038'}

phone = '95' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.3.0.1')
sel('/signup', {'name': 'Cod Seller', 'shop': 'Cod Shop', 'phone': phone, 'vpa': 'codshop@ybl', 'paywant': 'manual', 'pin': '4321'})
drop = sale(sel, [('title', 'Brass lamp'), ('price', '1200'), ('stock', '3'), ('max', '2'), ('description', 'x'), ('cod', '1'), ('cod_fee', '50')])
d = sql(f"SELECT cod_enabled, cod_fee_paise FROM drops WHERE id = '{drop}'")[0]
check(d == {'cod_enabled': 1, 'cod_fee_paise': 5000}, 'seller turned on COD with a ₹50 charge')
plain = sale(sel, [('title', 'Plain lamp'), ('price', '900'), ('stock', '2'), ('max', '2'), ('description', 'x')])
variant = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']

# --- buyer ---
b1 = client('10.3.0.2')
s, h, page = b1(f'/d/{drop}')
check('name="pay" value="cod"' in page and 'Cash on delivery (+₹50)' in page, 'sale page offers cash on delivery with its charge')
check('name="pay" value="cod"' not in b1(f'/d/{plain}')[2], 'no COD button when the sale doesn’t allow it')
s, h, _ = b1(f'/d/{drop}', {**buyer_form(variant, '9811122233'), 'pay': 'cod'})
check(s == 303 and h['Location'].startswith('/o/'), 'COD order placed straight away (no payment step)')
oid = h['Location'][3:]
o = sql(f"SELECT status, pay_mode, amount_paise FROM orders WHERE id = '{oid}'")[0]
check(o == {'status': 'pending', 'pay_mode': 'cod', 'amount_paise': 125000}, 'order is COD for price + charge (₹1,250)')
check(sql(f"SELECT available FROM variants WHERE id = {variant}")[0]['available'] == 2, 'stock reserved')
s, h, op = b1(f'/o/{oid}')
check('Order placed – cash on delivery' in op and '₹1,250' in op, 'order page tells the buyer to keep ₹1,250 ready')
s, h, _ = b1(f'/d/{drop}', {**buyer_form(variant, '9811122233'), 'pay': 'cod'})
check(h['Location'] == f'/o/{oid}', 're-tapping returns the same order, no second reservation')

# --- seller ---
s, h, home = sel('/app')
check('1 order to pack' in home or 'to pack' in home, 'seller home lists it to send')
s, h, send = sel('/app/orders?tab=send')
check('Collect ₹1,250 in cash' in send and 'Confirm on WhatsApp' in send, 'order card: collect ₹1,250, confirm on WhatsApp')
check(sql(f"SELECT COUNT(*) n FROM ledger WHERE order_id = '{oid}'")[0]['n'] == 0, 'not in the khata before the cash is in hand')
for _ in range(3): sel(f'/app/orders/{oid}/ship', {})
check(sql(f"SELECT ship_status FROM orders WHERE id = '{oid}'")[0]['ship_status'] == 'delivered', 'packed → sent → delivered')
s, h, _ = sel(f'/app/orders/{oid}/cash', {})
o = sql(f"SELECT status, paid_at FROM orders WHERE id = '{oid}'")[0]
check(o['status'] == 'paid' and o['paid_at'], 'cash received → order paid')
check(sql(f"SELECT amount_paise FROM ledger WHERE order_id = '{oid}'")[0]['amount_paise'] == 125000, 'khata credited ₹1,250')

# --- cancel puts stock back ---
b2 = client('10.3.0.3')
s, h, _ = b2(f'/d/{drop}', {**buyer_form(variant, '9811144455'), 'pay': 'cod'})
oid2 = h['Location'][3:]
check(sql(f"SELECT available FROM variants WHERE id = {variant}")[0]['available'] == 1, 'second COD order reserves stock')
sel(f'/app/orders/{oid2}/cancel-cod', {})
check(sql(f"SELECT status FROM orders WHERE id = '{oid2}'")[0]['status'] == 'rejected', 'seller cancels the COD order')
check(sql(f"SELECT available FROM variants WHERE id = {variant}")[0]['available'] == 2, 'stock is back on sale')

# --- COD can't be forced on a sale that doesn't allow it ---
pv = sql(f"SELECT id FROM variants WHERE drop_id = '{plain}'")[0]['id']
s, h, _ = client('10.3.0.4')(f'/d/{plain}', {**buyer_form(pv, '9811166677'), 'pay': 'cod'})
oid3 = h['Location'][3:]
check(sql(f"SELECT pay_mode, status FROM orders WHERE id = '{oid3}'")[0] == {'pay_mode': 'direct', 'status': 'pending'}, 'forcing COD on a non-COD sale gives a normal UPI order')
print(f'\nall {ok} checks passed')
