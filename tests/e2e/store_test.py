# End-to-end test of the storefront and checkout: shop link (slug), categories, scheduled drops, the buyer's cart
# (several items, one payment), and the "spend more, save more" cart offer – including the paise rule.
# Needs the app running locally with --var OPEN_SIGNUP:1 on a database with all migrations applied.
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
        body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
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
loc = lambda h: h.get('Location', '')
details = {'name': 'Asha Rao', 'phone': '9811200001', 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038'}

phone = '92' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.5.0.1')
sel('/signup', {'name': 'Store Seller', 'shop': 'Asha Collections', 'phone': phone, 'vpa': 'asha@ybl', 'paywant': 'manual', 'pin': '4321'})
sid = sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']

# ---------- shop link ----------
s, h, st = sel('/app/settings')
check('nukkadsale.in/' in st and 'value="asha-collections"' in st, 'Settings suggests a shop link from the shop name')
s, h, _ = sel('/app/shoplink', {'slug': 'admin'})
check('err=' in loc(h), 'reserved words are refused')
s, h, _ = sel('/app/shoplink', {'slug': 'A b'})
check('err=' in loc(h), 'bad characters are refused')
slug = 'asha-' + str(random.randint(1000, 9999))
s, h, _ = sel('/app/shoplink', {'slug': slug})
check('ok=' in loc(h) and sql(f"SELECT slug FROM sellers WHERE id = '{sid}'")[0]['slug'] == slug, 'shop link saved')
other = client('10.5.0.2'); op = '93' + str(random.randint(10**7, 10**8 - 1))
other('/signup', {'name': 'Other', 'shop': 'Other Shop', 'phone': op, 'vpa': 'other@ybl', 'paywant': 'manual', 'pin': '4321'})
s, h, _ = other('/app/shoplink', {'slug': slug})
check('err=' in loc(h) and 'taken' in urllib.parse.unquote(loc(h)), 'another shop can’t take the same link')

# ---------- sales: categories, a scheduled drop ----------
kurta = sale(sel, [('title', 'Cotton kurta'), ('price', '800'), ('category', 'Kurtis'), ('has_sizes', '1'), ('size_label', 'M'), ('size_qty', '3'), ('size_label', 'L'), ('size_qty', '3'), ('max', '3')])
saree = sale(sel, [('title', 'Silk saree'), ('price', '1200'), ('category', 'Sarees'), ('stock', '4'), ('max', '2')])
check(sql(f"SELECT category FROM drops WHERE id = '{kurta}'")[0]['category'] == 'Kurtis', 'category saved with the sale')
later = time.strftime('%Y-%m-%dT%H:%M', time.gmtime(time.time() + 5.5 * 3600 + 7200))   # 2 h from now, India time
soon = sale(sel, [('title', 'Festive lehenga'), ('price', '2500'), ('stock', '2'), ('max', '1'), ('live_at', later)])
la = sql(f"SELECT live_at FROM drops WHERE id = '{soon}'")[0]['live_at']
check(la > time.time() * 1000 + 6_000_000, 'scheduled drop stores its go-live time')
s, h, sp = sel(f'/app/drops/{soon}')
check('Goes live' in sp and '⏰' in sp, 'seller sees “Goes live …” and the share message says when')
b = client('10.5.0.3')
s, h, page = b(f'/d/{soon}')
check('id="soon"' in page and 'id="paybtn"' not in page, 'buyer sees a countdown, no Pay button')
vs = sql(f"SELECT id FROM variants WHERE drop_id = '{soon}'")[0]['id']
s, h, _ = b(f'/d/{soon}', {**details, 'variant': vs, 'qty': '1'})
check('err=' in loc(h) and sql(f"SELECT COUNT(*) n FROM orders WHERE drop_id = '{soon}'")[0]['n'] == 0, 'ordering before go-live is refused')

# ---------- storefront ----------
s, h, sf = client('10.5.0.4')(f'/{slug}')
check(s == 200 and 'Asha Collections' in sf and 'Cotton kurta' in sf and 'Silk saree' in sf, f'storefront opens at /{slug}')
check('data-cat="Kurtis"' in sf and 'data-cat="Sarees"' in sf, 'category filters on the storefront')
check('Coming soon' in sf and 'Add to cart' in sf, 'scheduled item shows “Coming soon”; others have Add to cart')
check(client('10.5.0.4')(f'/s/{sid}')[0] == 200, 'old /s/<id> link still works')
check(client('10.5.0.4')('/no-such-shop-x')[0] == 404, 'unknown shop link is a 404')
check(client('10.5.0.4')('/privacy')[0] == 200, 'real pages are not shadowed by shop links')

# ---------- cart offer settings ----------
s, h, _ = sel('/app/cartoffer', {'min': '1500', 'off': '150', 'pct': '10'})
check('err=' in loc(h), 'offer with both ₹ and % is refused')
s, h, _ = sel('/app/cartoffer', {'min': '1500', 'off': '150'})
check(sql(f"SELECT offer_min_paise, offer_off_paise, offer_pct FROM sellers WHERE id = '{sid}'")[0] == {'offer_min_paise': 150000, 'offer_off_paise': 15000, 'offer_pct': 0}, 'offer saved: spend ₹1,500, get ₹150 off')
check('Spend ₹1,500, get ₹150 off' in client('10.5.0.5')(f'/{slug}')[2], 'storefront shows the offer')

# ---------- cart checkout: below the threshold ----------
vM = sql(f"SELECT id FROM variants WHERE drop_id = '{kurta}' AND label = 'M'")[0]['id']
vS = sql(f"SELECT id FROM variants WHERE drop_id = '{saree}'")[0]['id']
c1 = client('10.5.0.6')
s, h, cp = c1(f'/s/{sid}/cart')
check(s == 200 and 'Your cart' in cp, 'cart page opens')
s, h, _ = c1(f'/s/{sid}/cart', {**details, 'lines': json.dumps([{'d': kurta, 'v': vM, 'q': 1}])})
key = loc(h)[3:].split('?')[0]
o = sql(f"SELECT amount_paise, disc_paise FROM orders WHERE id = '{key}'")[0]
check(79900 < o['amount_paise'] < 80000 and o['disc_paise'] == 0, 'one ₹800 item: no offer, paise below the price')

# ---------- cart checkout: two items, one payment, offer applies ----------
c2 = client('10.5.0.7')
lines = [{'d': kurta, 'v': vM, 'q': 1}, {'d': saree, 'v': vS, 'q': 1}]
s, h, _ = c2(f'/s/{sid}/cart', {**details, 'phone': '9811200002', 'lines': json.dumps(lines)})
check(loc(h).startswith('/o/') and 'cart=done' in loc(h), 'cart checkout goes to one order page')
key = loc(h)[3:].split('?')[0]
rows = sql(f"SELECT amount_paise, disc_paise FROM orders WHERE id = '{key}' OR cart_id = '{key}'")
total = sum(r['amount_paise'] for r in rows)
check(len(rows) == 2, 'both items are in the same payment')
check(184900 < total < 185000 and sum(r['disc_paise'] for r in rows) == 15000, f'₹2,000 of items − ₹150 offer = ₹1,850, paise below (got {total})')
s, h, opg = c2(f'/o/{key}')
check('Cart offer' in opg and '−₹150' in opg and 'Cotton kurta' in opg and 'Silk saree' in opg, 'order page lists both items and the −₹150 offer')

# ---------- offer kicks in when an item joins by link (no cart page) ----------
c3 = client('10.5.0.8'); p3 = '9811200003'
s, h, _ = c3(f'/d/{kurta}', {**details, 'phone': p3, 'variant': vM, 'qty': '1'})
k3 = loc(h)[3:]
check(sql(f"SELECT disc_paise FROM orders WHERE id = '{k3}'")[0]['disc_paise'] == 0, 'first item alone: no offer yet')
s, h, _ = c3(f'/d/{saree}', {**details, 'phone': p3, 'variant': vS, 'qty': '1'})
rows = sql(f"SELECT amount_paise, disc_paise FROM orders WHERE id = '{k3}' OR cart_id = '{k3}'")
check(len(rows) == 2 and sum(r['disc_paise'] for r in rows) == 15000 and 184900 < sum(r['amount_paise'] for r in rows) < 185000, 'second item joins → whole payment gets the offer')

# ---------- seller confirms; khata gets the discounted amount ----------
sel(f'/app/orders/{key}/received', {})
cr = sql(f"SELECT SUM(amount_paise) s FROM ledger WHERE order_id IN (SELECT id FROM orders WHERE id = '{key}' OR cart_id = '{key}')")[0]['s']
check(cr == total, 'khata credited with what the buyer actually paid')

# ---------- percent offer + clearing ----------
sel('/app/cartoffer', {'min': '1000', 'pct': '10'})
c4 = client('10.5.0.9')
s, h, _ = c4(f'/s/{sid}/cart', {**details, 'phone': '9811200004', 'lines': json.dumps([{'d': saree, 'v': vS, 'q': 1}])})
k4 = loc(h)[3:].split('?')[0]
o = sql(f"SELECT amount_paise, disc_paise FROM orders WHERE id = '{k4}'")[0]
check(o['disc_paise'] == 12000 and 107900 < o['amount_paise'] < 108000, '10% off a ₹1,200 order = ₹1,080, paise below')
sel('/app/cartoffer', {'clear': '1'})
check(sql(f"SELECT offer_min_paise FROM sellers WHERE id = '{sid}'")[0]['offer_min_paise'] == 0, 'offer switched off')

# ---------- cart: bad lines are ignored, empty is refused ----------
s, h, _ = client('10.5.0.10')(f'/s/{sid}/cart', {**details, 'phone': '9811200005', 'lines': json.dumps([{'d': 'zzzzzzz', 'v': 1, 'q': 1}])})
check('err=' in loc(h), 'a cart with nothing valid is refused')
otherDrop = sale(other, [('title', 'Not hers'), ('price', '300'), ('stock', '2')])
ov = sql(f"SELECT id FROM variants WHERE drop_id = '{otherDrop}'")[0]['id']
s, h, _ = client('10.5.0.11')(f'/s/{sid}/cart', {**details, 'phone': '9811200006', 'lines': json.dumps([{'d': otherDrop, 'v': ov, 'q': 1}])})
check('err=' in loc(h), 'another shop’s item can’t be checked out through this shop')
print(f'\n{ok} checks passed')
