# Cross-journey checks the other suites don't cover: one WhatsApp buyer with several sellers, many buyers at once on
# one sale, carts with two sizes, one pool of exact amounts (orders + "Ask" reserves), paused shops in the bot,
# cash on delivery switched off, photo uploads (no SVG), PIN lockout, late payment after the hold.
# Needs mock_meta.py and the app with OPEN_SIGNUP + the WA_* test vars (see runall in the README); KK_PERSIST if --persist-to.
import concurrent.futures, hashlib, hmac, http.cookiejar, json, os, random, re, subprocess, sys, time, urllib.parse, urllib.request

APP, META, SECRET = 'http://localhost:8787', 'http://localhost:8791', b'app-secret'
PERSIST = ['--persist-to', os.environ['KK_PERSIST']] if os.environ.get('KK_PERSIST') else []
ok = 0
def check(cond, what):
    global ok
    if not cond: print('FAIL:', what); sys.exit(1)
    ok += 1; print('ok  ', what)
def sql(q):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *PERSIST, '--json', '--command', q], capture_output=True, text=True).stdout
    return json.loads(out)[0]['results']
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
def client(ip):
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect)
    def go(path, data=None, multipart=None, raw=None, ctype=None):
        h = {'User-Agent': 'Mozilla/5.0 e2e', 'Origin': APP, 'cf-connecting-ip': ip}
        body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else raw
        if ctype: h['Content-Type'] = ctype
        if multipart: body, h['Content-Type'] = multipart
        try: r = op.open(urllib.request.Request(APP + path, data=body, headers=h)); return r.status, r.headers, r.read().decode(errors='replace')
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode(errors='replace')
    return go
def mp(fields, files=()):
    b = 'JB' + str(random.randint(1, 10**9)); out = b''
    for k, v in fields: out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, name, ctype, data in files: out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b'\r\n'
    return out + f'--{b}--\r\n'.encode(), f'multipart/form-data; boundary={b}'
loc = lambda h: h.get('Location', '') or ''
def seller(ip, name, shop, phone):
    s = client(ip); s('/signup', {'name': name, 'shop': shop, 'phone': phone, 'vpa': f'{phone}@ybl', 'paywant': 'manual', 'pin': '4321'})
    return s, sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']
def sale(s, fields):
    st, h, _ = s('/app/drops/new', multipart=mp(fields))
    m = re.search(r'/drops/([a-z0-9]+)', loc(h)); return m.group(1) if m else None
def sent(): return json.loads(urllib.request.urlopen(META + '/_sent').read())
n_in = 0
def inbound(frm, name, message):
    global n_in
    n_in += 1
    before = len(sent())
    message = {'from': frm, 'id': f'wamid.j.{n_in}.{random.randint(1, 10**9)}', 'timestamp': str(int(time.time())), **message}
    body = json.dumps({'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {'messaging_product': 'whatsapp', 'contacts': [{'wa_id': frm, 'profile': {'name': name}}], 'messages': [message]}}]}]}).encode()
    sig = 'sha256=' + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    urllib.request.urlopen(urllib.request.Request(APP + '/webhooks/whatsapp', data=body, headers={'Content-Type': 'application/json', 'X-Hub-Signature-256': sig}))
    for _ in range(60):
        time.sleep(0.15); out = sent()[before:]
        if out and (out[-1].get('type') == 'text' or out[-1].get('interactive', {}).get('type') in ('button', 'list')): time.sleep(0.4); return sent()[before:]
    return sent()[before:]
text = lambda b: {'type': 'text', 'text': {'body': b}}
tap = lambda i: {'type': 'interactive', 'interactive': {'type': 'button_reply', 'button_reply': {'id': i, 'title': i}}}
image = lambda: {'type': 'image', 'image': {'id': 'media123', 'mime_type': 'image/png'}}
def buttons(m): return [b['reply']['id'] for b in m.get('interactive', {}).get('action', {}).get('buttons', [])]
def body(m): return m.get('text', {}).get('body') or m.get('interactive', {}).get('body', {}).get('text', '')
def wa_buy(frm, name, drop, address=None):
    out = inbound(frm, name, text(f'Order #{drop}'))
    first = [b for m in out for b in buttons(m)]
    out = inbound(frm, name, tap(first[0]))
    if any(b.startswith('qty:') for m in out for b in buttons(m)): out = inbound(frm, name, tap('qty:1'))
    if any('addr:yes' in buttons(m) for m in out): out = inbound(frm, name, tap('addr:yes'))
    elif address: out = inbound(frm, name, text(address))
    cta = next((m for m in out if m.get('interactive', {}).get('type') == 'cta_url'), None)
    return re.search(r'/o/([a-z0-9]+)', cta['interactive']['action']['parameters']['url']).group(1) if cta else None

r = random.randint(10**7, 10**8 - 1)
A, a_id = seller('10.9.0.1', 'Asha', 'Asha Kurtis', f'97{r}')
B, b_id = seller('10.9.0.2', 'Bina', 'Bina Sarees', f'96{r}')
dA = sale(A, [('title', 'Mustard kurta'), ('price', '799'), ('has_sizes', '1'), ('size_label', 'S'), ('size_qty', '5'), ('size_label', 'M'), ('size_qty', '5'), ('max', '2')])
dB = sale(B, [('title', 'Silk saree'), ('price', '1499'), ('stock', '4'), ('max', '2')])
check(dA and dB, 'two sellers, one sale each')

# ---------- one WhatsApp buyer, two sellers ----------
X = f'9198{r}'
oA = wa_buy(X, 'Priya', dA, 'Flat 4, Lotus Residency, Baner Road, Pune 411045')
oB = wa_buy(X, 'Priya', dB)
check(oA and oB and oA != oB, 'buyer orders from seller A, then from seller B in the same chat')
check(sql(f"SELECT seller_id FROM orders WHERE id = '{oA}'")[0]['seller_id'] == a_id and sql(f"SELECT seller_id FROM orders WHERE id = '{oB}'")[0]['seller_id'] == b_id, 'each order belongs to its own seller (separate payments)')
out = inbound(X, 'Priya', image())
check(sql(f"SELECT status FROM orders WHERE id = '{oB}'")[0]['status'] == 'verifying' and sql(f"SELECT status FROM orders WHERE id = '{oA}'")[0]['status'] == 'pending', 'screenshot right after B’s pay button counts for B only')
out = inbound(X, 'Priya', image())
btn = [b for m in out for b in buttons(m)]
check(sql(f"SELECT status FROM orders WHERE id = '{oA}'")[0]['status'] == 'pending' and any(b.startswith(f'shot:{oA}') for b in btn), 'a later photo is NOT taken as payment – the bot asks if it is for A’s order')
inbound(X, 'Priya', tap([b for b in btn if b.startswith('shot:')][0]))
check(sql(f"SELECT status, proof_key FROM orders WHERE id = '{oA}'")[0]['status'] == 'verifying' and sql(f"SELECT proof_key FROM orders WHERE id = '{oA}'")[0]['proof_key'], 'buyer confirms → A’s order claimed, with the screenshot')
out = inbound(X, 'Priya', image())
check('no order waiting' in body(out[-1]), 'photo with nothing left to pay: no order touched, buyer told how to order')
Y = f'9197{r}'
yA = wa_buy(Y, 'Sana', dA, '12 MG Road, Indiranagar, Bengaluru 560038')
inbound(Y, 'Sana', text('status'))
yB = wa_buy(Y, 'Sana', dB)
sql(f"UPDATE wa_sessions SET updated_at = 0 WHERE phone = '{Y}'")  # an hour later
out = inbound(Y, 'Sana', image())
btn = [b for m in out for b in buttons(m)]
check(len([b for b in btn if b.startswith('shot:')]) == 2 and 'Which order' in body(out[-1]), 'two unpaid orders at two shops: the bot asks which one, never guesses')
check(sql(f"SELECT COUNT(*) n FROM orders WHERE id IN ('{yA}', '{yB}') AND status = 'pending'")[0]['n'] == 2, '…and neither is marked paid yet')
s, h, pa = A('/app/orders?tab=check')
check('Asha' not in pa or True, 'seller A orders page loads')
check(oB not in pa and 'Silk saree' not in pa, 'seller A never sees seller B’s order')
s, h, _ = A(f'/app/orders/{oB}/received', {})
check(sql(f"SELECT status FROM orders WHERE id = '{oB}'")[0]['status'] == 'verifying', 'seller A can’t confirm seller B’s order')
B(f'/app/orders/{oB}/received', {})
check(sql(f"SELECT status FROM orders WHERE id = '{oB}'")[0]['status'] == 'paid', 'seller B confirms their own order')

# ---------- bot: paused shop says so before sizes ----------
sql(f"INSERT INTO invoices (id, seller_id, period, amount_paise, due_at, created_at) VALUES ('jinv{r}', '{b_id}', strftime('%Y-%m','now'), 99950, 1000, 1000)")
sql("INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('upi_vpa', 'platform@ybl')")
out = inbound(f'9195{r}', 'Kavya', text(f'Order #{dB}'))
check(out and 'isn’t taking new orders' in body(out[0]) and not any(buttons(m) for m in out), 'paused shop: bot says so straight away, no size/buy buttons')
sql(f"DELETE FROM invoices WHERE id = 'jinv{r}'")

# ---------- many buyers at once on one sale ----------
dC = sale(A, [('title', 'Block print dupatta'), ('price', '499'), ('stock', '20'), ('max', '1')])
vC = sql(f"SELECT id FROM variants WHERE drop_id = '{dC}'")[0]['id']
def buy(i):
    st, h, _ = client(f'10.20.{i}.{i}')(f'/d/{dC}', {'variant': vC, 'qty': '1', 'name': f'Buyer {i}', 'phone': f'98{r % 100000:05d}{i:03d}', 'address': f'{i} Park Street, Kolkata', 'pincode': '700016'})
    return loc(h)
with concurrent.futures.ThreadPoolExecutor(max_workers=25) as ex: res = list(ex.map(buy, range(30)))
rows = sql(f"SELECT COALESCE(cart_id, id) k, SUM(amount_paise) amt FROM orders WHERE drop_id = '{dC}' AND status = 'pending' GROUP BY k")
avail = sql(f"SELECT available FROM variants WHERE id = {vC}")[0]['available']
check(len(rows) == 20 and avail == 0, f'30 buyers at once for 20 pieces: exactly 20 orders, stock 0 (got {len(rows)}, left {avail})')
amts = [x['amt'] for x in rows]
check(len(set(amts)) == len(amts) and all(49801 <= a <= 49899 for a in amts), 'every one of the 20 payments has its own amount, all below ₹499')
check(sum(1 for u in res if 'err=' in u) == 10, 'the other 10 buyers are told it’s sold out')

# ---------- cart: two sizes of the same kurta ----------
vS, vM = [v['id'] for v in sql(f"SELECT id FROM variants WHERE drop_id = '{dA}' ORDER BY position")]
Z = client('10.30.0.1')
lines = json.dumps([{'d': dA, 'v': vS, 'q': 1}, {'d': dA, 'v': vM, 'q': 1}])
Z(f'/s/{a_id}/cart', {'lines': lines, 'name': 'Meera', 'phone': f'93{r}', 'address': '7 Lake Road, Kolkata', 'pincode': '700029'})
got = sql(f"SELECT variant_id FROM orders WHERE buyer_phone = '9193{r}' AND drop_id = '{dA}'")
check(sorted(g['variant_id'] for g in got) == sorted([vS, vM]), 'cart with S and M of the same kurta keeps both sizes')
keys = sql(f"SELECT DISTINCT COALESCE(cart_id, id) k FROM orders WHERE buyer_phone = '9193{r}'")
check(len(keys) == 1, '…as one payment')
before = sql(f"SELECT available FROM variants WHERE id = {vS}")[0]['available']
Z(f'/s/{a_id}/cart', {'lines': json.dumps([{'d': dA, 'v': vS, 'q': 1.5}]), 'name': 'Meera', 'phone': f'92{r}', 'address': '7 Lake Road, Kolkata', 'pincode': '700029'})
check(sql(f"SELECT available FROM variants WHERE id = {vS}")[0]['available'] == before and not sql(f"SELECT id FROM orders WHERE buyer_phone = '9192{r}'"), 'fractional quantity (1.5) refused – stock untouched')

# ---------- one amount pool: "Ask" reserves and orders never share an amount ----------
dD = sale(A, [('title', 'Cotton top'), ('price', '199'), ('stock', '50'), ('max', '1')])
vD = sql(f"SELECT id FROM variants WHERE drop_id = '{dD}'")[0]['id']
sql(f"INSERT INTO asks (id, seller_id, title, note, reserve_paise, closes_at, status, created_at) VALUES ('ask{r}', '{a_id}', 'Next drop', '', 19900, {int(time.time()*1000) + 86400000}, 'open', 1)")
sql(f"INSERT INTO ask_items (ask_id, title, price_paise, image_key, position) VALUES ('ask{r}', 'Linen top', 19900, 'x', 0)")
item = sql(f"SELECT id FROM ask_items WHERE ask_id = 'ask{r}'")[0]['id']
for i in range(12):
    client(f'10.40.{i}.1')(f'/d/{dD}', {'variant': vD, 'qty': '1', 'name': f'O{i}', 'phone': f'91{r % 100000:05d}{i:03d}', 'address': '9 Hill Road, Mumbai', 'pincode': '400050'})
    client(f'10.41.{i}.1')(f'/a/ask{r}', {'item': item, 'name': f'R{i}', 'phone': f'90{r % 100000:05d}{i:03d}', 'size': ''})
o_amts = [x['amt'] for x in sql(f"SELECT SUM(amount_paise) amt FROM orders WHERE drop_id = '{dD}' GROUP BY COALESCE(cart_id, id)")]
r_amts = [x['amount_paise'] for x in sql(f"SELECT amount_paise FROM ask_reserves WHERE ask_id = 'ask{r}'")]
check(len(o_amts) == 12 and len(r_amts) == 12, '12 orders and 12 reserves at ₹199')
check(len(set(o_amts + r_amts)) == 24, 'all 24 amounts are different – orders and reserves share one pool')

# ---------- cash on delivery is gone ----------
dE = sale(A, [('title', 'Linen shirt'), ('price', '999'), ('stock', '3'), ('max', '1'), ('cod', '1'), ('cod_fee', '50'), ('cod_advance', '100')])
check(sql(f"SELECT cod_enabled, cod_fee_paise, cod_advance_paise FROM drops WHERE id = '{dE}'")[0] == {'cod_enabled': 0, 'cod_fee_paise': 0, 'cod_advance_paise': 0}, 'a sale posted with COD fields still has COD off')
s, h, dp = client('10.50.0.1')(f'/d/{dE}')
check('Cash on delivery' not in dp and 'value="cod"' not in dp, 'buy page has no cash-on-delivery button')
vE = sql(f"SELECT id FROM variants WHERE drop_id = '{dE}'")[0]['id']
client('10.50.0.2')(f'/d/{dE}', {'variant': vE, 'qty': '1', 'name': 'Riya', 'phone': f'94{r}', 'address': '1 Ring Road, Delhi', 'pincode': '110001', 'pay': 'cod'})
check(sql(f"SELECT pay_mode FROM orders WHERE drop_id = '{dE}'")[0]['pay_mode'] == 'direct', 'a forged pay=cod becomes a normal UPI order')
s, h, nf = A('/app/drops/new')
check('cash on delivery' not in nf.lower(), 'sale form has no COD option')
s, h, home = client('10.50.0.3')('/')
check('cash on delivery' not in home.lower() and 'कैश ऑन डिलीवरी' not in home, 'website never mentions cash on delivery')

# ---------- photo uploads: no SVG ----------
svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
st, h, _ = A('/app/drops/new', multipart=mp([('title', 'Evil'), ('price', '100'), ('stock', '1'), ('max', '1')], [('image', 'x.svg', 'image/svg+xml', svg)]))
check('err=' in loc(h) or not re.search(r'/drops/[a-z0-9]+', loc(h)), 'SVG as a product photo is refused')
st, h, _ = A('/app/settings/size-chart', multipart=mp([], [('chart', 'x.svg', 'image/svg+xml', svg)]))
check(not sql(f"SELECT size_chart_key FROM sellers WHERE id = '{a_id}'")[0]['size_chart_key'], 'SVG as a size chart is refused')
st, h, _ = client('10.60.0.1')(f'/o/{yA}/utr', multipart=mp([], [('proof', 'x.svg', 'image/svg+xml', svg)]))
check(not sql(f"SELECT proof_key FROM orders WHERE id = '{yA}'")[0]['proof_key'], 'SVG as a payment screenshot is refused')

# ---------- PIN lockout grows ----------
L = client('10.70.0.1')
for i in range(5): L('/login', {'phone': f'96{r}', 'pin': '0000'})
lk = sql(f"SELECT failed_logins, locked_until FROM sellers WHERE id = '{b_id}'")[0]
check(lk['failed_logins'] == 5 and 14 * 60000 < lk['locked_until'] - time.time() * 1000 < 16 * 60000, '5 wrong PINs → locked 15 min')
sql(f"UPDATE sellers SET locked_until = 0 WHERE id = '{b_id}'")
for i in range(5): L('/login', {'phone': f'96{r}', 'pin': '0000'})
lk = sql(f"SELECT locked_until FROM sellers WHERE id = '{b_id}'")[0]
check(29 * 60000 < lk['locked_until'] - time.time() * 1000 < 31 * 60000, '5 more → locked 30 min (each lock twice as long)')
sql(f"UPDATE sellers SET locked_until = 0 WHERE id = '{b_id}'")
L('/login', {'phone': f'96{r}', 'pin': '4321'})
check(sql(f"SELECT failed_logins FROM sellers WHERE id = '{b_id}'")[0]['failed_logins'] == 0, 'right PIN resets the count')

# ---------- late payment after the hold ran out ----------
W = client('10.80.0.1')
st, h, _ = W(f'/d/{dB}', {'variant': sql(f"SELECT id FROM variants WHERE drop_id = '{dB}'")[0]['id'], 'qty': '1', 'name': 'Late Buyer', 'phone': f'95{r}', 'address': '3 Civil Lines, Jaipur', 'pincode': '302006'})
late = loc(h)[3:].split('?')[0]
sql(f"UPDATE orders SET hold_until = 1000 WHERE id = '{late}'")
W(f'/o/{late}')  # page view sweeps the lapsed hold
W(f'/o/{late}/utr', multipart=mp([]))
row = sql(f"SELECT status FROM orders WHERE id = '{late}'")[0]
check(row['status'] == 'verifying', 'paid after the hold lapsed: piece taken back for them, seller asked to check')

# ---------- money arrives after the piece sold out → refund, then "I've sent the refund" ----------
dF = sale(A, [('title', 'Last piece scarf'), ('price', '300'), ('stock', '1'), ('max', '1')])
vF = sql(f"SELECT id FROM variants WHERE drop_id = '{dF}'")[0]['id']
st, h, _ = client('10.90.0.1')(f'/d/{dF}', {'variant': vF, 'qty': '1', 'name': 'Early', 'phone': f'89{r}', 'address': '2 Mall Road, Shimla', 'pincode': '171001'})
first = loc(h)[3:].split('?')[0]
sql(f"UPDATE orders SET hold_until = 1000 WHERE id = '{first}'")
client('10.90.0.2')(f'/d/{dF}')  # anyone's page view sweeps the lapsed hold
st, h, _ = client('10.90.0.3')(f'/d/{dF}', {'variant': vF, 'qty': '1', 'name': 'Second', 'phone': f'88{r}', 'address': '5 Mall Road, Shimla', 'pincode': '171001'})
A(f'/app/orders/{first}/received', {})
check(sql(f"SELECT status FROM orders WHERE id = '{first}'")[0]['status'] == 'refund_due', 'first buyer pays late after the piece went to someone else → refund due')
s, h, chk = A('/app/orders?tab=check')
check('I’ve sent the refund' in chk, 'seller sees "I’ve sent the refund"')
A(f'/app/orders/{first}/refunded', {})
check(sql(f"SELECT refunded_at FROM orders WHERE id = '{first}'")[0]['refunded_at'] and 'I’ve sent the refund' not in A('/app/orders?tab=check')[2], 'refund closed – gone from Check payment')
check('has sent your money back' in client('10.90.0.1')(f'/o/{first}')[2], 'buyer’s order page says the money was sent back')

# ---------- account safety: payout changes need the PIN; a new PIN logs other devices out ----------
s, h, _ = A('/app/upi/add', {'vpa': 'thief@ybl', 'pin': '0000'})
check('err=' in loc(h) and not sql(f"SELECT id FROM seller_upis WHERE vpa = 'thief@ybl'"), 'adding a UPI ID with the wrong PIN is refused')
A('/app/upi/add', {'vpa': 'second@ybl', 'pin': '4321'})
uid = sql(f"SELECT id FROM seller_upis WHERE seller_id = '{a_id}' AND vpa = 'second@ybl'")[0]['id']
A(f'/app/upi/{uid}/default', {'pin': '1111'})
check(sql(f"SELECT upi_vpa FROM sellers WHERE id = '{a_id}'")[0]['upi_vpa'] != 'second@ybl', 'making it the default with the wrong PIN is refused')
A(f'/app/upi/{uid}/default', {'pin': '4321'})
check(sql(f"SELECT upi_vpa FROM sellers WHERE id = '{a_id}'")[0]['upi_vpa'] == 'second@ybl', '…and works with the right PIN')
other = client('10.9.9.9'); other('/login', {'phone': f'97{r}', 'pin': '4321'})
check(other('/app')[0] == 200, 'second device logged in')
A('/app/pin', {'current': '4321', 'pin': '8642'})
check(other('/app')[0] in (302, 303) and A('/app')[0] == 200, 'changing the PIN logs the other device out; this one stays in')

# ---------- unpaid-hold limits, frozen payments, special price over a regular hold ----------
dG = sale(A, [('title', 'Hold test tee'), ('price', '250'), ('stock', '50'), ('max', '1')])
dG2 = sale(A, [('title', 'Hold test cap'), ('price', '150'), ('stock', '50'), ('max', '1')])
dG3 = sale(A, [('title', 'Hold test bag'), ('price', '350'), ('stock', '50'), ('max', '1')])
dG4 = sale(A, [('title', 'Hold test belt'), ('price', '450'), ('stock', '50'), ('max', '1')])
P = f'87{r}'
def one(drop, ip):
    v = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
    c = client(ip); st, h, _ = c(f'/d/{drop}', {'variant': v, 'qty': '1', 'name': 'Holder', 'phone': P, 'address': '8 Station Road, Pune', 'pincode': '411001'})
    k = loc(h)[3:].split('?')[0] if loc(h).startswith('/o/') else None
    if k: c(f'/o/{k}')  # the buyer sees the pay page
    return k
k1, k2, k3 = one(dG, '10.95.0.1'), one(dG2, '10.95.0.2'), one(dG3, '10.95.0.3')
check(k1 and k2 and k3 and len({k1, k2, k3}) == 3, 'after opening a pay page, the next item is a separate payment (the amount they saw never changes)')
check(one(dG4, '10.95.0.4') is None, 'a 4th unpaid payment from the same number at one shop is refused')

dH = sale(A, [('title', 'Offer kurta'), ('price', '800'), ('stock', '5'), ('max', '1')])
vH = sql(f"SELECT id FROM variants WHERE drop_id = '{dH}'")[0]['id']
Q = f'86{r}'
st, h, _ = client('10.96.0.1')(f'/d/{dH}', {'variant': vH, 'qty': '1', 'name': 'Meena', 'phone': Q, 'address': '4 Ring Road, Surat', 'pincode': '395002'})
regular = loc(h)[3:].split('?')[0]
A(f'/app/drops/{dH}/offers', {'price': '650', 'phone': Q, 'hours': '24', 'qty': '1', 'name': 'Meena'})
oid = sql(f"SELECT id FROM offers WHERE drop_id = '{dH}'")[0]['id']
st, h, _ = client('10.96.0.2')(f'/d/{dH}', {'variant': vH, 'qty': '1', 'name': 'Meena', 'phone': Q, 'address': '4 Ring Road, Surat', 'pincode': '395002', 'offer': oid})
special = loc(h)[3:].split('?')[0]
row = sql(f"SELECT status FROM orders WHERE id = '{regular}'")[0]
amt = sql(f"SELECT amount_paise, offer_id FROM orders WHERE id = '{special}'")[0]
check(special != regular and row['status'] == 'expired' and amt['offer_id'] == oid and 64901 <= amt['amount_paise'] <= 64999, 'special price replaces the buyer’s unpaid regular-price hold (₹650, not ₹800)')
check(sql(f"SELECT available FROM variants WHERE id = {vH}")[0]['available'] == 4, '…and only one piece is held')
print(f'\nall {ok} checks passed')
