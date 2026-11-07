# End-to-end test of delivery charges, unique paise below the price, and the plan page's value line.
# Delivery: flat fee per order, free above a set amount, charged once per payment (carts), included in
# COD totals, shown on the sale page, order page and share text. Paise: amounts are never above the
# listed total. Needs the app running locally with --var OPEN_SIGNUP:1 (any database).
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
    return json.loads(subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *(['--persist-to', __import__('os').environ['KK_PERSIST']] if __import__('os').environ.get('KK_PERSIST') else []), '--json', '--command', q], capture_output=True, text=True).stdout)[0]['results']
def sale(sel, fields):
    bd = '----kk' + str(random.randint(1, 10**9))
    body = ''.join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields) + f'--{bd}--\r\n'
    s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
    return re.search(r'/drops/([a-z0-9]+)', h.get('Location', '')).group(1)
def buy(c, drop, phone, qty='1', **extra):
    v = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
    s, h, _ = c(f'/d/{drop}', {'variant': v, 'qty': qty, 'name': 'Nisha Jain', 'phone': phone, 'address': '7 Lake View Road, Udaipur', 'pincode': '313001', **extra})
    return h['Location'][3:] if h.get('Location', '').startswith('/o/') else None
order = lambda oid: sql(f"SELECT amount_paise, ship_paise, cart_id FROM orders WHERE id = '{oid}'")[0]

sel = client('10.4.0.1')
phone = '94' + str(random.randint(10**7, 10**8 - 1))
sel('/signup', {'name': 'Ship Seller', 'shop': 'Ship Shop', 'phone': phone, 'vpa': 'shipshop@ybl', 'paywant': 'manual', 'pin': '4321'})
d1 = sale(sel, [('title', 'Clay pot'), ('price', '400'), ('stock', '10'), ('max', '5'), ('description', 'x'), ('ship_fee', '60'), ('free_ship_above', '1000'), ('cod', '1'), ('cod_fee', '30')])
d2 = sale(sel, [('title', 'Clay cup'), ('price', '150'), ('stock', '10'), ('max', '5'), ('description', 'x'), ('ship_fee', '50')])
check(sql(f"SELECT ship_fee_paise, free_ship_above_paise FROM drops WHERE id = '{d1}'")[0] == {'ship_fee_paise': 6000, 'free_ship_above_paise': 100000}, 'seller set ₹60 delivery, free from ₹1,000')

s, h, page = client('10.4.0.2')(f'/d/{d1}')
check('+ ₹60 delivery · free on orders of ₹1,000 or more' in page and 'data-ship="6000"' in page, 'sale page shows the delivery charge and free limit')
s, h, live = sel(f'/app/drops/{d1}?new=1')
check('Delivery ₹60 (free on orders of ₹1,000+)' in live, 'share text mentions delivery')

# one item: ₹400 + ₹60, minus unique paise → between ₹459.01 and ₹459.99
o1 = buy(client('10.4.0.3'), d1, '9811000001')
a = order(o1)
check(a['ship_paise'] == 6000 and 45901 <= a['amount_paise'] <= 45999, f"₹400 + ₹60 delivery, paise taken off: ₹{a['amount_paise']/100:.2f}")
s, h, op = client('10.4.0.3')(f'/o/{o1}')
check('Delivery' in op and '₹60' in op, 'order page shows the delivery line')

# three items = ₹1,200 ≥ ₹1,000 → free delivery
o3 = buy(client('10.4.0.4'), d1, '9811000002', qty='3')
a = order(o3)
check(a['ship_paise'] == 0 and 119901 <= a['amount_paise'] <= 119999, f"₹1,200 order gets free delivery: ₹{a['amount_paise']/100:.2f}")

# cart: second item joins the same payment and adds no second delivery charge
cb = client('10.4.0.5')
c1 = buy(cb, d1, '9811000003')
c2 = buy(cb, d2, '9811000003')
k = order(c1)['cart_id'] or c1
lines = sql(f"SELECT amount_paise, ship_paise FROM orders WHERE id = '{k}' OR cart_id = '{k}'")
total = sum(l['amount_paise'] for l in lines)
check(len(lines) == 2 and sum(l['ship_paise'] for l in lines) == 6000, 'cart pays delivery once (₹60, not ₹60 + ₹50)')
check(60901 <= total <= 60999, f'cart total ₹400 + ₹150 + ₹60, paise off: ₹{total/100:.2f}')

# Cash on delivery is switched off: a forged pay=cod is a normal UPI order (no COD charge), a few paise under ₹460
oc = buy(client('10.4.0.6'), d1, '9811000004', pay='cod')
o = order(oc)
check(45901 <= o['amount_paise'] <= 45999 and o['ship_paise'] == 6000, 'pay=cod ignored: ₹400 + ₹60 delivery, paid by UPI, no COD charge')

# no sale ever charges more than its listed total
rows = sql("SELECT o.amount_paise, d.price_paise * o.qty + o.ship_paise AS listed FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.pay_mode = 'direct' AND o.cart_id IS NULL")
check(all(r['amount_paise'] <= r['listed'] for r in rows), f'no UPI order is above its listed total ({len(rows)} checked)')

# plan page: this month's value above the Pay button
sel(f'/app/orders/{oc}/received', {})
s, h, bill = sel('/app/billing')
check(re.search(r'This month: 1 order, ₹459\.\d\d through NukkadSale', bill), 'plan page shows this month’s orders and sales')
print(f'\nall {ok} checks passed')
