# End-to-end test of Live drops and "Ask your buyers".
# Live drop: countdown + "remind me" before it starts, live panel after (pieces left, recent buyers with first
# names only, recent count), the seller's reminder list and home task, sold-out time, and normal sales still
# never revealing stock counts. Ask: create (validation), buyers pick (with a reserve paid by exact amount),
# seller confirms, turns the most-wanted design into a sale, reserve becomes a personal price link, closing.
# Needs the app running locally with --var OPEN_SIGNUP:1 (any database). KK_PERSIST if it uses --persist-to.
import http.cookiejar, json, os, random, re, struct, subprocess, sys, urllib.error, urllib.parse, urllib.request, zlib
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
PERSIST = ['--persist-to', os.environ['KK_PERSIST']] if os.environ.get('KK_PERSIST') else []
def sql(q):
    return json.loads(subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *PERSIST, '--json', '--command', q], capture_output=True, text=True).stdout)[0]['results']
def png(rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * 16 for _ in range(16))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
def multipart(fields, files=()):
    bd = '----kk' + str(random.randint(1, 10**9)); out = b''
    for k, v in fields: out += f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, name, data in files: out += f'--{bd}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode() + data + b'\r\n'
    return out + f'--{bd}--\r\n'.encode(), f'multipart/form-data; boundary={bd}'
buyer = lambda v, name, ph: {'variant': v, 'qty': '1', 'name': name, 'phone': ph, 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038'}

phone = '94' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.7.0.1')
sel('/signup', {'name': 'Live Seller', 'shop': 'Live Shop', 'phone': phone, 'vpa': 'liveshop@ybl', 'paywant': 'manual', 'pin': '4321'})
sid = sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']

# ================= Live drop =================
soon = __import__('datetime').datetime.utcfromtimestamp(__import__('time').time() + 5.5 * 3600 + 600).strftime('%Y-%m-%dT%H:%M')
s, h, _ = sel('/app/drops/new', multipart=multipart([('title', 'Festive lehenga'), ('price', '2500'), ('has_sizes', '1'), ('size_label', 'M'), ('size_qty', '2'), ('size_label', 'L'), ('size_qty', '1'), ('max', '1'), ('live_drop', '1'), ('live_at', soon)]))
drop = re.search(r'/drops/([a-z0-9]+)', h['Location']).group(1)
check(sql(f"SELECT live_drop FROM drops WHERE id = '{drop}'")[0]['live_drop'] == 1, 'seller makes a live drop with a start time')
s, h, pg = sel(f'/app/drops/{drop}')
check('LIVE DROP' in pg and 'tap to set a reminder' in pg, 'share message says LIVE DROP and to set a reminder')
anon = client('10.7.0.9')
s, h, pg = anon(f'/d/{drop}')
check('LIVE DROP' in pg and 'id="soon"' in pg and 'Remind me when it starts' in pg, 'before it starts: LIVE DROP badge, countdown, remind form')
s, h, _ = anon(f'/d/{drop}/remind', {'name': 'Meena Iyer', 'phone': '9811000111'})
check(s == 303 and 'message you when it starts' in urllib.parse.unquote(h['Location']), 'buyer asks to be reminded')
check(sql(f"SELECT kind FROM waitlist WHERE drop_id = '{drop}'")[0]['kind'] == 'start', 'stored as a start reminder')
s, h, pg = anon(f'/d/{drop}')
check('1 buyer is waiting' in pg, 'buyers see how many are waiting')
s, h, home = sel('/app')
check('waiting for your drop' not in home, 'no seller task before the drop starts')

sql(f"UPDATE drops SET live_at = {int(__import__('time').time() * 1000) - 60_000} WHERE id = '{drop}'")
vm = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}' AND label = 'M'")[0]['id']
vl = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}' AND label = 'L'")[0]['id']
s, h, pg = anon(f'/d/{drop}')
check('id="live"' in pg and 'class="livedot"' in pg, 'once live: the live panel is on the sale page')
client('10.7.1.1')(f'/d/{drop}', buyer(vm, 'Priya Sharma', '9811000221'))
client('10.7.1.2')(f'/d/{drop}', buyer(vl, 'Sana Qureshi', '9811000222'))
s, h, js = anon(f'/d/{drop}/stock.json')
live = json.loads(js)['live']
check(live['left'] == 1 and live['total'] == 3 and live['recent'] == 2, 'live numbers: 1 of 3 left, 2 bought in the last 10 minutes')
check([f['n'] for f in live['feed']] == ['Sana', 'Priya'] and live['feed'][0]['l'] == 'L', 'feed: newest first, first name and size')
check('Sharma' not in js and '9811000221' not in js and 'Qureshi' not in js, 'feed never shows surnames or numbers')
s, h, home = sel('/app')
check('1 buyer waiting for your drop' in home, 'seller home: the reminder task once it is live')
s, h, pg = sel(f'/app/drops/{drop}')
check('1 buyer asked to be reminded' in pg and 'wa.me/919811000111' in pg and 'is+LIVE+now' in pg.replace('%20', '+'), 'seller drop page: reminder list with a ready WhatsApp message')
check('waiting' not in sql(f"SELECT 'x' AS w")[0] and sql(f"SELECT COUNT(*) n FROM waitlist WHERE drop_id = '{drop}' AND kind = 'restock'")[0]['n'] == 0, 'start reminders are not mixed into the restock list')
client('10.7.1.3')(f'/d/{drop}', buyer(vm, 'Ritu Jain', '9811000223'))
s, h, pg = anon(f'/d/{drop}')
check(s == 200 and 'id="live"' not in pg, 'all reserved: buy form and live panel go')
sql(f"UPDATE orders SET status = 'paid', paid_at = created_at WHERE drop_id = '{drop}'")
s, h, pg = anon(f'/d/{drop}')
check(re.search(r'Sold out in \d+ minute', pg), 'sold out: "Sold out in N minutes"')

plain_s, plain_h, _ = sel('/app/drops/new', multipart=multipart([('title', 'Plain bag'), ('price', '600'), ('stock', '4'), ('max', '2')]))
plain = re.search(r'/drops/([a-z0-9]+)', plain_h['Location']).group(1)
check('"live"' not in anon(f'/d/{plain}/stock.json')[2] and 'id="live"' not in anon(f'/d/{plain}')[2], 'normal sales still never show stock numbers')
sel(f'/app/drops/{plain}/live', {'on': '1'})
check(sql(f"SELECT live_drop FROM drops WHERE id = '{plain}'")[0]['live_drop'] == 1, 'seller can turn live drop on from the sale page')
sel(f'/app/drops/{plain}/live', {'on': ''})
check(sql(f"SELECT live_drop FROM drops WHERE id = '{plain}'")[0]['live_drop'] == 0, '…and off again')

# ================= Ask your buyers =================
s, h, _ = sel('/app/asks/new', multipart=multipart([('title', 'Which kurti?'), ('name0', 'Only one'), ('price0', '799')], [('image0', 'a.png', png((200, 30, 30)))]))
check('err=' in h['Location'], 'ask needs at least 2 designs')
s, h, _ = sel('/app/asks/new', multipart=multipart(
    [('title', 'Which of these for Diwali?'), ('note', 'Pure cotton.'), ('name0', 'Blue floral'), ('price0', '799'), ('name1', 'Red bandhani'), ('price1', '999'), ('name2', 'Green chikan'), ('price2', '1199'), ('reserve', '50'), ('days', '3')],
    [('image0', 'a.png', png((30, 30, 200))), ('image1', 'b.png', png((200, 30, 30))), ('image2', 'c.png', png((30, 200, 30)))]))
ask = re.search(r'/asks/([a-z0-9]+)', h['Location']).group(1)
items = sql(f"SELECT id, title FROM ask_items WHERE ask_id = '{ask}' ORDER BY position")
check(len(items) == 3, 'seller creates an ask with 3 designs and a ₹50 reserve')
s, h, pg = sel(f'/app/asks/{ask}')
check(f'/a/{ask}' in pg and 'Help me choose' in pg, 'ask page: share message with the link')
b1 = client('10.7.2.1')
s, h, pg = b1(f'/a/{ask}')
check(s == 200 and 'Blue floral' in pg and 'reserve for ₹50' in pg, 'buyer sees the designs and the reserve button')
s, h, _ = b1(f'/a/{ask}', {'name': 'Asha Rao', 'phone': '9811000331'})
check('err=' in h['Location'], 'buyer must pick at least one design')
s, h, _ = b1(f'/a/{ask}', {'item': [str(items[0]['id']), str(items[1]['id'])], 'name': 'Asha Rao', 'phone': '9811000331', 'size': 'M'})
check(re.match(rf'/a/{ask}/r/[a-z0-9]+', h['Location']), 'picks saved → reserve payment page')
rpath = h['Location']
r = sql(f"SELECT amount_paise, status FROM ask_reserves WHERE ask_id = '{ask}'")[0]
check(4901 <= r['amount_paise'] <= 4999 and r['status'] == 'due', 'reserve: its own amount a few paise under ₹50')
s, h, pg = b1(rpath)
check(f"am={r['amount_paise'] / 100:.2f}" in pg and 'Blue floral' in pg, 'pay page: UPI link for the exact amount, picks listed')
b1(rpath, {})
check(sql(f"SELECT status FROM ask_reserves WHERE ask_id = '{ask}'")[0]['status'] == 'claimed', '"I have paid" → seller to check')
s, h, home = sel('/app')
check('1 reserve payment to check' in home, 'seller home: reserve to check')
rid = sql(f"SELECT id FROM ask_reserves WHERE ask_id = '{ask}'")[0]['id']
sel(f'/app/asks/{ask}/reserve/{rid}/yes', {})
check(sql(f"SELECT status FROM ask_reserves WHERE id = {rid}")[0]['status'] == 'paid', 'seller confirms the reserve')
client('10.7.2.2')(f'/a/{ask}', {'item': str(items[0]['id']), 'name': 'Kavya Nair', 'phone': '9811000332'})
s, h, pg = client('10.7.2.3')(f'/a/{ask}')
check('2 want this' in pg, 'public page shows how many want each design')
s, h, pg = sel(f'/app/asks/{ask}')
check(pg.index('Blue floral') < pg.index('Red bandhani') and '2 want this' in pg and '1 reserved' in pg and f'ask_item={items[0]["id"]}' in pg, 'results: most wanted first, reserved count, Make it a sale')
s, h, pg = sel(f'/app/drops/new?ask_item={items[0]["id"]}')
key = sql(f"SELECT image_key FROM ask_items WHERE id = {items[0]['id']}")[0]['image_key']
check('value="Blue floral"' in pg and 'value="799"' in pg and f'value="{key}"' in pg, 'new sale filled from the design (name, price, photo)')
s, h, _ = sel('/app/drops/new', multipart=multipart([('title', 'Blue floral'), ('price', '799'), ('stock', '5'), ('max', '2'), ('ask_item', str(items[0]['id'])), ('reuse_image', key)]))
check(h['Location'].startswith(f'/app/asks/{ask}'), 'publishing goes back to the ask')
d2 = sql(f"SELECT drop_id FROM ask_items WHERE id = {items[0]['id']}")[0]['drop_id']
off = sql(f"SELECT id, price_paise, buyer_phone FROM offers WHERE drop_id = '{d2}'")
check(len(off) == 1 and off[0]['price_paise'] == 74900 and off[0]['buyer_phone'] == '919811000331', 'reserve holder gets a ₹749 personal link (₹50 off)')
check(sql(f"SELECT status FROM ask_reserves WHERE id = {rid}")[0]['status'] == 'used', 'reserve marked used')
s, h, pg = sel(f'/app/asks/{ask}')
check('2 buyers want this' in pg and f'o%3D{off[0]["id"]}' in pg and 'wa.me/919811000332' in pg, 'tell list: both buyers, reserve holder gets their own link')
s, h, pg = b1(f'/d/{d2}?o={off[0]["id"]}')
check('₹749' in pg, 'buyer opens their link: ₹749')
check(sql(f"SELECT image_key FROM drops WHERE id = '{d2}'")[0]['image_key'] == key, 'sale uses the ask photo')
vid = sql(f"SELECT id FROM ask_votes WHERE ask_id = '{ask}' AND phone = '919811000332' AND item_id = {items[0]['id']}")[0]['id']
sel(f'/app/asks/{ask}/told/{vid}', {})
s, h, pg = sel(f'/app/asks/{ask}')
check('1 buyer wants this' in pg, 'marking one told leaves one in the list')
sel(f'/app/asks/{ask}/close', {})
s, h, pg = client('10.7.2.4')(f'/a/{ask}')
check('Voting has closed' in pg and 'name="item"' not in pg, 'closed ask: no more picks')
s, h, _ = client('10.7.2.4')(f'/a/{ask}', {'item': str(items[2]['id']), 'name': 'Late', 'phone': '9811000339'})
check('err=' in h['Location'], 'votes after closing are refused')
other = client('10.7.3.1')
other('/signup', {'name': 'Other', 'shop': 'Other Shop', 'phone': '93' + str(random.randint(10**7, 10**8 - 1)), 'vpa': 'other@ybl', 'paywant': 'manual', 'pin': '4321'})
check(other(f'/app/asks/{ask}')[0] == 404 and 'Blue floral' not in other(f'/app/drops/new?ask_item={items[1]["id"]}')[2], "another seller can't see or use this ask")
hi = client('10.7.2.5'); hi('/lang?to=hi&back=/')
check('आपकी राय चाहते हैं' in hi(f'/a/{ask}')[2], 'ask page in Hindi')
print(f'\nall {ok} checks passed')
