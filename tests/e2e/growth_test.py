# End-to-end test of the seller growth tools: product cost → profit in the khata, discount on a listed
# sale, personal price links (phone lock, piece limit, one use, expiry, free again after a lapse),
# restock waitlist (buyer → seller list → home task → messaged), and shipping labels.
# Needs the app running locally with --var OPEN_SIGNUP:1 on a database with migrations applied.
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
        body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
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
form = lambda v, ph, qty=1, **x: {'variant': v, 'qty': str(qty), 'name': 'Asha Rao', 'phone': ph, 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038', **x}
loc = lambda h: h.get('Location', '')

phone = '93' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.4.0.1')
sel('/signup', {'name': 'Growth Seller', 'shop': 'Growth Shop', 'phone': phone, 'vpa': 'growth@ybl', 'paywant': 'manual', 'pin': '4321'})

# ---------- cost → profit ----------
drop = sale(sel, [('title', 'Silk stole'), ('price', '1000'), ('cost', '600'), ('stock', '6'), ('max', '3'), ('description', 'x')])
v = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
check(sql(f"SELECT cost_paise FROM drops WHERE id = '{drop}'")[0]['cost_paise'] == 60000, 'cost per piece saved with the new sale (₹600)')
s, h, page = sel(f'/app/drops/{drop}')
check('Profit ₹400 per piece' in page, 'sale page shows profit per piece in one quiet line')
check('Discount' in page and 'Special price for one buyer' in page, 'discount and special-price tools are on the sale page')

# ---------- discount ----------
s, h, _ = sel(f'/app/drops/{drop}/discount', {'price': '1200'})
check('err=' in loc(h) and sql(f"SELECT price_paise FROM drops WHERE id = '{drop}'")[0]['price_paise'] == 100000, 'a "discount" above the regular price is refused')
s, h, _ = sel(f'/app/drops/{drop}/discount', {'price': '800'})
d = sql(f"SELECT price_paise, compare_paise FROM drops WHERE id = '{drop}'")[0]
check(d == {'price_paise': 80000, 'compare_paise': 100000}, 'discount on: sale price ₹800, regular ₹1,000 kept')
b = client('10.4.0.2')
s, h, bp = b(f'/d/{drop}')
check('₹800' in bp and '<s' in bp and '₹1,000' in bp and '20% off' in bp, 'buyer sees ₹800 with ₹1,000 struck through and "20% off"')
check('data-price="80000"' in bp, 'pay button total is worked out from the sale price')
s, h, sp = sel(f'/app/drops/{drop}')
check('~₹1,000~' in sp and '20% off' in sp, 'WhatsApp share message shows the discount')
s, h, _ = b(f'/d/{drop}', form(v, '9811000002'))
o1 = loc(h)[3:]
o = sql(f"SELECT amount_paise, unit_paise, cost_paise FROM orders WHERE id = '{o1}'")[0]
check(79900 < o['amount_paise'] <= 80000 and o['unit_paise'] == 80000 and o['cost_paise'] == 60000, 'order at the discounted price, paise below it, cost copied onto the order')
s, h, _ = sel(f'/app/drops/{drop}/discount', {'price': '750'})
check(sql(f"SELECT price_paise, compare_paise FROM drops WHERE id = '{drop}'")[0] == {'price_paise': 75000, 'compare_paise': 100000}, 'discount changed to ₹750, regular price unchanged')
s, h, _ = sel(f'/app/drops/{drop}/discount/end', {})
check(sql(f"SELECT price_paise, compare_paise FROM drops WHERE id = '{drop}'")[0] == {'price_paise': 100000, 'compare_paise': 0}, 'discount ended: back to ₹1,000')
check(sql(f"SELECT amount_paise FROM orders WHERE id = '{o1}'")[0]['amount_paise'] == o['amount_paise'], 'the order placed during the discount keeps its price')
# Cart: the same buyer adds a second item after the discount ended → each line at the price it was ordered at.
drop2 = sale(sel, [('title', 'Cotton scarf'), ('price', '300'), ('stock', '4'), ('max', '2'), ('description', 'x')])
v2 = sql(f"SELECT id FROM variants WHERE drop_id = '{drop2}'")[0]['id']
s, h, _ = b(f'/d/{drop2}', form(v2, '9811000002'))
lines = sql(f"SELECT amount_paise FROM orders WHERE id = '{o1}' OR cart_id = '{o1}'")
total = sum(x['amount_paise'] for x in lines)
check(len(lines) == 2 and 109900 < total <= 110000, 'cart total = ₹800 (ordered during the discount) + ₹300, not re-priced at ₹1,000')

# ---------- personal price links ----------
s, h, _ = sel(f'/app/drops/{drop}/offers', {'price': '1100', 'phone': '9811000003', 'qty': '2', 'hours': '24'})
check('err=' in loc(h), 'a "special price" above the sale price is refused')
s, h, _ = sel(f'/app/drops/{drop}/offers', {'price': '700', 'phone': '9811000003', 'name': 'Meena', 'qty': '2', 'hours': '24'})
tok = re.search(r'offer=([a-z0-9]+)', loc(h)).group(1)
s, h, sp = sel(loc(h).split('#')[0])
check(f'/d/{drop}?o={tok}' in sp and 'wa.me/919811000003' in sp and 'Link ready' in sp, 'seller gets the link and a WhatsApp button to that buyer')
check('Meena' in sp and '₹700' in sp, 'link shows in the list with name and price')
bm = client('10.4.0.3')
s, h, op = bm(f'/d/{drop}?o={tok}')
check('Special price for Meena' in op and 'data-price="70000"' in op and '₹1,000' in op and f'value="{tok}"' in op, 'buyer page: special price ₹700, regular ₹1,000 struck, token in the form')
s, h, _ = client('10.4.0.4')(f'/d/{drop}', form(v, '9811000099', offer=tok))
check('err=' in loc(h) and 'different' in urllib.parse.unquote(loc(h)), 'another number can’t use the link')
s, h, _ = bm(f'/d/{drop}', form(v, '9811000003', qty=3, offer=tok))
check('err=' in loc(h), 'more pieces than the link allows is refused')
s, h, _ = bm(f'/d/{drop}', form(v, '9811000003', qty=2, offer=tok))
o2 = loc(h)[3:]
o = sql(f"SELECT amount_paise, unit_paise, offer_id FROM orders WHERE id = '{o2}'")[0]
check(139900 < o['amount_paise'] <= 140000 and o['unit_paise'] == 70000 and o['offer_id'] == tok, 'order: 2 × ₹700, paise below, link recorded')
check(sql(f"SELECT used_order_id FROM offers WHERE id = '{tok}'")[0]['used_order_id'] == o2, 'link marked as used by that order')
s, h, op = client('10.4.0.5')(f'/d/{drop}?o={tok}')
check('ended or was already used' in op and 'data-price="100000"' in op, 'used link: page says so and shows the regular price')
# The order lapses (not paid in time) → the link works again.
sql(f"UPDATE orders SET status = 'expired' WHERE id = '{o2}'")
s, h, op = client('10.4.0.6')(f'/d/{drop}?o={tok}')
check('Special price for Meena' in op, 'after the order lapsed, the link works again')
# Open link (no phone lock) used by one buyer can't be used by a second.
s, h, _ = sel(f'/app/drops/{drop}/offers', {'price': '900', 'qty': '1', 'hours': '1'})
tok2 = re.search(r'offer=([a-z0-9]+)', loc(h)).group(1)
s, h, _ = client('10.4.0.7')(f'/d/{drop}', form(v, '9811000007', offer=tok2))
check(loc(h).startswith('/o/'), 'open link: first buyer orders at ₹900')
s, h, _ = client('10.4.0.8')(f'/d/{drop}', form(v, '9811000008', offer=tok2))
check('err=' in loc(h) and sql(f"SELECT COUNT(*) n FROM orders WHERE buyer_phone = '919811000008'")[0]['n'] == 0, 'second buyer can’t reuse it')
s, h, _ = client('10.4.0.9')(f'/d/{drop2}', form(v2, '9811000009', offer=tok))
check('err=' in loc(h) and sql(f"SELECT COUNT(*) n FROM orders WHERE buyer_phone = '919811000009'")[0]['n'] == 0, 'a link for another sale is refused – no discount leaks across sales')
sql(f"UPDATE offers SET expires_at = 1 WHERE id = '{tok}'")
s, h, op = client('10.4.0.10')(f'/d/{drop}?o={tok}')
check('ended or was already used' in op, 'expired link: regular price')
s, h, _ = sel(f'/app/drops/{drop}/offers', {'price': '650', 'qty': '1', 'hours': '24'})
tok3 = re.search(r'offer=([a-z0-9]+)', loc(h)).group(1)
sel(f'/app/drops/{drop}/offers/{tok3}/delete', {})
s, h, op = client('10.4.0.11')(f'/d/{drop}?o={tok3}')
check('ended or was already used' in op, 'seller deleted the link → it no longer works')

# ---------- waitlist ----------
one = sale(sel, [('title', 'Last brass bell'), ('price', '500'), ('stock', '1'), ('max', '1'), ('description', 'x')])
v3 = sql(f"SELECT id FROM variants WHERE drop_id = '{one}'")[0]['id']
client('10.4.0.12')(f'/d/{one}', form(v3, '9811000012'))
s, h, wp = client('10.4.0.13')(f'/d/{one}')
check('Notify me' in wp and f'/d/{one}/waitlist' in wp, 'sold-out page offers "Notify me"')
w = client('10.4.0.13')
s, h, _ = w(f'/d/{one}/waitlist', {'name': 'Ritu', 'phone': '9811000013'})
check('ok=' in loc(h) and sql(f"SELECT COUNT(*) n FROM waitlist WHERE drop_id = '{one}'")[0]['n'] == 1, 'buyer joined the waitlist and got a confirmation')
w(f'/d/{one}/waitlist', {'name': 'Ritu K', 'phone': '9811000013'})
check(sql(f"SELECT COUNT(*) n, MAX(name) nm FROM waitlist WHERE drop_id = '{one}'")[0] == {'n': 1, 'nm': 'Ritu K'}, 'joining twice keeps one entry')
s, h, _ = w(f'/d/{one}/waitlist', {'name': 'X', 'phone': '123'})
check('err=' in loc(h), 'bad number refused')
s, h, sp = sel(f'/app/drops/{one}')
check('Waiting for restock (1)' in sp and 'wa.me/919811000013' in sp, 'seller sees the waiting buyer with a WhatsApp button')
check('waiting for a restock' not in sel('/app')[2], 'no home task while it’s still sold out')
sel(f'/app/drops/{one}/stock', {f'v{v3}': '3'})
s, h, home = sel('/app')
check('1 buyer is waiting for a restock' in home, 'stock added → home asks to message the waiting buyer')
wid = sql(f"SELECT id FROM waitlist WHERE drop_id = '{one}'")[0]['id']
sel(f'/app/drops/{one}/waitlist/{wid}/done', {})
check(sql(f"SELECT notified_at FROM waitlist WHERE id = {wid}")[0]['notified_at'], 'marked messaged')
check('waiting for a restock' not in sel('/app')[2] and 'Waiting for restock' not in sel(f'/app/drops/{one}')[2], 'task and list clear once messaged')

# ---------- profit + labels ----------
paid = sql(f"SELECT id, amount_paise, cost_paise FROM orders WHERE id = '{o1}'")[0]
sel(f'/app/orders/{o1}/received', {})
check(sql(f"SELECT status FROM orders WHERE id = '{o1}'")[0]['status'] == 'paid', 'seller confirmed the payment')
sel('/app/khata', {'kind': 'debit', 'amount': '50', 'note': 'courier'})
s, h, kh = sel('/app/khata')
cr = sum(x['amount_paise'] for x in sql(f"SELECT amount_paise FROM ledger WHERE seller_id = (SELECT id FROM sellers WHERE phone = '91{phone}') AND kind = 'credit'"))
cost_sold = sum(x['cost_paise'] for x in sql(f"SELECT cost_paise FROM orders WHERE seller_id = (SELECT id FROM sellers WHERE phone = '91{phone}') AND status = 'paid'"))
expect = cr - cost_sold - 5000
rup = lambda p: '₹' + f'{p/100:,.2f}'.replace('.00', '')
check('Profit this month' in kh and rup(expect) in kh, f'khata shows profit this month = money in − product cost − expenses ({rup(expect)})')
s, h, send = sel('/app/orders?tab=send')
check('Print shipping labels' in send, '“To send” offers printable labels')
s, h, lab = sel('/app/orders/labels')
check(s == 200 and 'Asha Rao' in lab and 'Indiranagar' in lab and 'Growth Shop' in lab and 'Silk stole' in lab and 'Cotton scarf' in lab, 'labels page: one parcel with both items, address and shop')
check(lab.count('class="lbl"') == 1, 'cart printed as one label, not two')

# ---------- Hindi ----------
s, h, _ = sel(f'/app/drops/{drop}/offers', {'price': '850', 'qty': '1', 'hours': '24'})
tok4 = re.search(r'offer=([a-z0-9]+)', loc(h)).group(1)
hi = client('10.4.0.20')
hi('/lang?to=hi&back=/')
s, h, hp = hi(f'/d/{drop}?o={tok4}')
check('आपका ख़ास दाम' in hp and 'सिर्फ़ इस लिंक से' in hp, 'Hindi buyer sees the special price in Hindi')

# ---------- seller switches tools off / on ----------
s, h, st = sel('/app/settings')
check('Selling tools' in st and st.count('class="switch"') == 5 and st.count('checked') >= 5, 'Settings lists 5 selling tools, all on')
# form posts repeated "on" keys
def post_tools(on):
    import http.cookiejar
    return sel('/app/tools', [('on', x) for x in on])
post_tools(['discount', 'profit'])          # waitlist, offers, labels off
check(sql(f"SELECT tools_off FROM sellers WHERE phone = '91{phone}'")[0]['tools_off'] == 'offers,waitlist,labels', 'saved: offers, waitlist, labels switched off')
s, h, sp = sel(f'/app/drops/{drop}')
check('Special price for one buyer' not in sp and 'Discount' in sp and 'per piece' in sp, 'sale page: special-price tool hidden, discount and profit still there')
sold = sale(sel, [('title', 'Gone bangle'), ('price', '400'), ('stock', '1'), ('max', '1'), ('description', 'x')])
vs = sql(f"SELECT id FROM variants WHERE drop_id = '{sold}'")[0]['id']
client('10.4.0.30')(f'/d/{sold}', form(vs, '9811000030'))
s, h, bp = client('10.4.0.31')(f'/d/{sold}')
check('Notify me' not in bp, 'waitlist off: no “Notify me” for buyers')
s, h, _ = client('10.4.0.31')(f'/d/{sold}/waitlist', {'name': 'X', 'phone': '9811000031'})
check(sql(f"SELECT COUNT(*) n FROM waitlist WHERE drop_id = '{sold}'")[0]['n'] == 0, 'waitlist off: joining is refused')
s, h, bp = client('10.4.0.32')(f'/d/{drop}?o={tok4}')
check('ख़ास' not in bp and 'Special price' not in bp and 'ended or was already used' not in bp, 'special prices off: a link shows the normal page')
s, h, _ = client('10.4.0.33')(f'/d/{drop}', form(v, '9811000033', offer=tok4))
check(sql(f"SELECT unit_paise FROM orders WHERE buyer_phone = '919811000033'")[0]['unit_paise'] == 100000, 'special prices off: order at the regular price')
check('Print shipping labels' not in sel('/app/orders?tab=send')[2], 'labels off: no labels button')
post_tools(['discount', 'offers', 'waitlist', 'profit', 'labels'])
check(sql(f"SELECT tools_off FROM sellers WHERE phone = '91{phone}'")[0]['tools_off'] == '', 'all tools switched back on')
check('Notify me' in client('10.4.0.34')(f'/d/{sold}')[2] and 'Special price for one buyer' in sel(f'/app/drops/{drop}')[2], 'back on: waitlist and special price return')
print(f'\n{ok} checks passed')
