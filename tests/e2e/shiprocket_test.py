# End-to-end test of Shiprocket shipping (optional per seller): not connected = nothing shows; connect (wrong / right
# login), pickup address, parcel size, rate check before booking, book (courier choice, COD), label, pickup, tracking by
# refresh and by webhook (wrong secret ignored), buyer's tracking page, failed delivery → re-attempt / return,
# returned → restock, cancel before pickup, disconnect. Needs: python3 tests/e2e/mock_shiprocket.py, and the app with
# --var OPEN_SIGNUP:1 --var SHIPROCKET_API_BASE:http://localhost:8795 on a database with all migrations applied.
import http.cookiejar, json, random, re, subprocess, sys, urllib.error, urllib.parse, urllib.request
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
SR = 'http://localhost:8795'
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
    def go(path, data=None, multipart=None, raw=None, ctype=None):
        h = {'User-Agent': 'Mozilla/5.0 khatakhat-e2e', 'Origin': B, 'cf-connecting-ip': ip}
        body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else raw
        if ctype: h['Content-Type'] = ctype
        if multipart: body, h['Content-Type'] = multipart
        try: r = op.open(urllib.request.Request(B + path, data=body, headers=h)); return r.status, r.headers, r.read().decode(errors='replace')
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode(errors='replace')
    return go
def sr(path, body):
    return json.loads(urllib.request.urlopen(urllib.request.Request(SR + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})).read())
def sql(q):
    return json.loads(subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', *(['--persist-to', __import__('os').environ['KK_PERSIST']] if __import__('os').environ.get('KK_PERSIST') else []), '--json', '--command', q], capture_output=True, text=True).stdout)[0]['results']
def sale(sel, fields):
    bd = '----kk' + str(random.randint(1, 10**9))
    body = ''.join(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields) + f'--{bd}--\r\n'
    s, h, _ = sel('/app/drops/new', multipart=(body.encode(), f'multipart/form-data; boundary={bd}'))
    return re.search(r'/drops/([a-z0-9]+)', h.get('Location', '')).group(1)
loc = lambda h: h.get('Location', '')
def order(drop, phone, cod=False, ip='10.7.9.1'):
    v = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}'")[0]['id']
    s, h, _ = client(ip)(f'/d/{drop}', {'variant': v, 'qty': '1', 'name': 'Asha Rao', 'phone': phone, 'address': '12 MG Road, Indiranagar, Bengaluru', 'pincode': '560038', **({'pay': 'cod'} if cod else {})})
    return loc(h)[3:]

phone = '94' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.7.0.1')
sel('/signup', {'name': 'Ship Seller', 'shop': 'Ship Shop', 'phone': phone, 'vpa': 'ship@ybl', 'paywant': 'manual', 'pin': '4321'})
drop = sale(sel, [('title', 'Linen shirt'), ('price', '1000'), ('stock', '6'), ('max', '2'), ('cod', '1')])

# ---------- not connected: nothing about Shiprocket for seller orders or buyers ----------
o1 = order(drop, '9811400001')
sel(f'/app/orders/{o1}/received', {})
s, h, send = sel('/app/orders?tab=send')
check('Ship with Shiprocket' not in send, 'not connected: no Shiprocket button on orders')
check('Track your parcel' not in client('10.7.9.2')(f'/o/{o1}')[2], 'not connected: buyer sees no tracking section')
s, h, st = sel('/app/settings')
check('Shipping with Shiprocket' in st and '/app/ship' in st, 'Settings offers Shipping with Shiprocket (optional)')

# ---------- connect ----------
s, h, _ = sel('/app/ship/connect', {'email': 'seller@test.in', 'password': 'wrong'})
check('err=' in loc(h) and sql(f"SELECT sr_email FROM sellers WHERE phone = '91{phone}'")[0]['sr_email'] is None, 'wrong Shiprocket login is refused')
s, h, _ = sel('/app/ship/connect', {'email': 'seller@test.in', 'password': 'secret123'})
row = sql(f"SELECT sr_email, sr_password_enc, sr_pickup, sr_pickup_pin, sr_hook FROM sellers WHERE phone = '91{phone}'")[0]
check(row['sr_email'] == 'seller@test.in' and row['sr_pickup'] == 'Home' and row['sr_pickup_pin'] == '411045', 'connected; first pickup address chosen')
check(row['sr_password_enc'] and 'secret123' not in row['sr_password_enc'], 'password stored encrypted')
s, h, sp = sel('/app/ship')
check('Connected · seller@test.in' in sp and 'Shop – 12 MG Road' in sp and f'/webhooks/shiprocket/{row["sr_hook"]}' in sp, 'shipping page: connected, pickup choices, webhook URL')
sel('/app/ship/settings', {'pickup': 'Shop', 'box': '30x25x8'})
check(sql(f"SELECT sr_pickup, sr_pickup_pin, sr_box FROM sellers WHERE phone = '91{phone}'")[0] == {'sr_pickup': 'Shop', 'sr_pickup_pin': '411001', 'sr_box': '30x25x8'}, 'pickup address and parcel size saved')

# ---------- rate check before any booking ----------
s, h, rp = sel('/app/ship?pin=560038&g=700')
check('Xpressbees' in rp and '₹65.50' in rp and 'Cheapest' in rp and 'Fastest' in rp, 'rate checker: couriers with prices, cheapest and fastest marked')
s, h, rp = sel('/app/ship?pin=999999&g=700')
check('No courier delivers' in rp, 'rate checker: unserviceable pincode explained')

# ---------- book (prepaid) ----------
s, h, send = sel('/app/orders?tab=send')
check('Ship with Shiprocket' in send, 'connected: paid order offers Ship with Shiprocket')
s, h, bp = sel(f'/app/ship/book/{o1}')
check('Book a courier' in bp and 'Asha Rao' in bp and 'Delhivery Surface' in bp and 'value="Bengaluru"' in bp and 'value="Karnataka"' in bp, 'booking page: buyer address, couriers, city/state filled from pincode')
check('₹72' in bp and '₹140' in bp, 'booking page shows each courier’s price before booking')
s, h, bp2 = sel(f'/app/ship/book/{o1}?pin=560038&g=1500')
check('value="1500"' in bp2, 'seller can change the weight and re-check prices')
s, h, _ = sel(f'/app/ship/book/{o1}', {'courier': '20', 'pin': '560038', 'g': '700', 'box': '30x25x8', 'city': 'Bengaluru', 'state': 'Karnataka'})
check('ok=' in loc(h), 'booked')
sh = sql(f"SELECT * FROM shipments WHERE order_key = '{o1}'")[0]
check(sh['awb'] and sh['courier'] == 'Xpressbees' and sh['charge_paise'] == 6550 and sh['status'] == 'pickup' and sh['label_url'], 'shipment saved: AWB, courier, ₹65.50 charge, label, pickup scheduled')
check(sql(f"SELECT ship_status FROM orders WHERE id = '{o1}'")[0]['ship_status'] == 'packed', 'order moves to Packed')
calls = json.loads(urllib.request.urlopen(SR + '/_calls').read())
created = [c for c in calls if c[0] == 'POST' and c[1] == '/orders/create/adhoc'][-1][2]
check(created['payment_method'] == 'Prepaid' and created['billing_pincode'] == '560038' and created['pickup_location'] == 'Shop' and created['length'] == 30 and created['weight'] == 0.7, 'Shiprocket got the right order: prepaid, pincode, pickup, size, weight')
s, h, _ = sel(f'/app/ship/book/{o1}', {'courier': '20', 'pin': '560038', 'g': '700', 'city': 'B', 'state': 'K'})
check(len(sql(f"SELECT id FROM shipments WHERE order_key = '{o1}'")) == 1, 'can’t book the same order twice')
s, h, send = sel('/app/orders?tab=send')
check(f"AWB {sh['awb']}" in send and 'Pickup scheduled' in send and 'Print label' in send and 'Send tracking on WhatsApp' in send, 'order card: AWB, status, label, WhatsApp tracking')
s, h, _ = sel(f"/app/ship/{sh['id']}/label", {})
check(loc(h).startswith('https://') and 'label' in loc(h), 'Print label opens the label PDF')

# ---------- tracking: refresh, then webhook ----------
sr('/_track', {'awb': sh['awb'], 'status': 'PICKED UP', 'activity': 'Shipment picked up', 'location': 'Pune'})
sel(f"/app/ship/{sh['id']}/refresh", {})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh['id']}'")[0]['status'] == 'picked' and sql(f"SELECT ship_status FROM orders WHERE id = '{o1}'")[0]['ship_status'] == 'shipped', 'refresh: picked up → order Sent')
b = client('10.7.9.3')
s, h, op = b(f'/o/{o1}')
check('Track your parcel' in op and f"AWB {sh['awb']}" in op and 'Shipment picked up' in op, 'buyer sees courier, AWB and the scan timeline')
s, h, _ = client('10.7.9.4')('/webhooks/shiprocket/wrongsecret', raw=json.dumps({'awb': sh['awb'], 'current_status': 'DELIVERED'}).encode(), ctype='application/json')
check(sql(f"SELECT status FROM shipments WHERE id = '{sh['id']}'")[0]['status'] == 'picked', 'webhook with the wrong secret is ignored')
hook = {'awb': sh['awb'], 'current_status': 'DELIVERED', 'etd': '2026-11-08', 'scans': [{'date': '2026-11-05 09:00:00', 'activity': 'In transit', 'location': 'Hyderabad'}, {'date': '2026-11-06 12:30:00', 'activity': 'Delivered', 'location': 'Bengaluru'}]}
client('10.7.9.4')(f"/webhooks/shiprocket/{row['sr_hook']}", raw=json.dumps(hook).encode(), ctype='application/json')
check(sql(f"SELECT status FROM shipments WHERE id = '{sh['id']}'")[0]['status'] == 'delivered' and sql(f"SELECT ship_status FROM orders WHERE id = '{o1}'")[0]['ship_status'] == 'delivered', 'webhook: delivered → order Delivered')
check('Delivered' in b(f'/o/{o1}')[2], 'buyer page shows Delivered')

# ---------- second parcel (cash on delivery is switched off: a forged pay=cod is a normal UPI order) ----------
o2 = order(drop, '9811400002', cod=True, ip='10.7.9.5')
check(sql(f"SELECT pay_mode FROM orders WHERE id = '{o2}'")[0]['pay_mode'] == 'direct', 'pay=cod ignored: UPI order')
sel(f'/app/orders/{o2}/received', {})
s, h, bp = sel(f'/app/ship/book/{o2}')
check('Courier collects' not in bp and 'Blue Dart Air' in bp, 'prepaid parcel: every courier offered, nothing to collect')
sel(f'/app/ship/book/{o2}', {'courier': '10', 'pin': '560038', 'g': '500', 'city': 'Bengaluru', 'state': 'Karnataka'})
sh2 = sql(f"SELECT * FROM shipments WHERE order_key = '{o2}'")[0]
created = [c for c in json.loads(urllib.request.urlopen(SR + '/_calls').read()) if c[0] == 'POST' and c[1] == '/orders/create/adhoc'][-1][2]
check(created['payment_method'] == 'Prepaid' and sh2['cod_paise'] == 0, 'booked as Prepaid, nothing for the courier to collect')

# ---------- failed delivery → re-attempt, then return → restock ----------
sr('/_track', {'awb': sh2['awb'], 'status': 'UNDELIVERED', 'activity': 'Customer not available'})
sel(f"/app/ship/{sh2['id']}/refresh", {})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh2['id']}'")[0]['status'] == 'failed', 'failed delivery detected')
s, h, home = sel('/app')
check('1 delivery needs you' in home, 'home asks the seller to act')
s, h, done = sel('/app/orders?tab=all')
check('Try delivery again' in done and 'Return it to me' in done, 'order card offers re-attempt or return')
sel(f"/app/ship/{sh2['id']}/ndr", {'action': 're-attempt'})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh2['id']}'")[0]['status'] == 'transit', 're-attempt requested')
sr('/_track', {'awb': sh2['awb'], 'status': 'UNDELIVERED', 'activity': 'Address not found'}); sel(f"/app/ship/{sh2['id']}/refresh", {})
sel(f"/app/ship/{sh2['id']}/ndr", {'action': 'return'})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh2['id']}'")[0]['status'] == 'rto', 'return requested')
avail = sql(f"SELECT available FROM variants WHERE drop_id = '{drop}'")[0]['available']
sr('/_track', {'awb': sh2['awb'], 'status': 'RTO DELIVERED', 'activity': 'Returned to seller'}); sel(f"/app/ship/{sh2['id']}/refresh", {})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh2['id']}'")[0]['status'] == 'returned', 'parcel back with the seller')
sel(f"/app/ship/{sh2['id']}/restock", {}); sel(f"/app/ship/{sh2['id']}/restock", {})
check(sql(f"SELECT available FROM variants WHERE drop_id = '{drop}'")[0]['available'] == avail + 1, 'restock puts the piece back once (not twice)')
check('delivery needs you' not in sel('/app')[2], 'home task clears')
check(sql(f"SELECT status FROM orders WHERE id = '{o2}'")[0]['status'] == 'paid' and f'#{o2[:6].upper()}' not in sel('/app/orders?tab=send')[2], 'returned prepaid order: payment kept (seller refunds), leaves To send')

# ---------- prepaid parcel comes back: send again, or restock and refund ----------
o6 = order(drop, '9811400006', ip='10.7.9.10'); sel(f'/app/orders/{o6}/received', {})
def book_and_return(key):
    sel(f'/app/ship/book/{key}', {'courier': '20', 'pin': '560038', 'g': '500', 'city': 'Bengaluru', 'state': 'Karnataka'})
    x = sql(f"SELECT * FROM shipments WHERE order_key = '{key}' ORDER BY created_at DESC LIMIT 1")[0]
    sr('/_track', {'awb': x['awb'], 'status': 'RTO DELIVERED', 'activity': 'Returned to seller'}); sel(f"/app/ship/{x['id']}/refresh", {})
    return x
r1 = book_and_return(o6)
s, h, send = sel('/app/orders?tab=send')
check('Send it again' in send and 'Put the pieces back in stock' in send, 'prepaid return: Send it again or restock')
r2 = book_and_return(o6)
check(r2['id'] != r1['id'] and len(sql(f"SELECT id FROM shipments WHERE order_key = '{o6}'")) == 2, 'sent again with a new booking')
avail = sql(f"SELECT available FROM variants WHERE drop_id = '{drop}'")[0]['available']
sel(f"/app/ship/{r2['id']}/restock", {})
check(sql(f"SELECT available FROM variants WHERE drop_id = '{drop}'")[0]['available'] == avail + 1 and sql(f"SELECT status FROM orders WHERE id = '{o6}'")[0]['status'] == 'paid', 'prepaid restock: stock back, payment kept on record')
s, h, send = sel('/app/orders?tab=send')
check(f'#{o6[:6].upper()}' not in send, 'restocked parcel leaves To send')
s, h, allo = sel('/app/orders?tab=all')
check('Tell the buyer about the refund' in allo, 'seller is prompted to refund the buyer')
s, h, _ = sel(f'/app/ship/book/{o6}', {'courier': '20', 'pin': '560038', 'g': '500', 'city': 'B', 'state': 'K'})
check(len(sql(f"SELECT id FROM shipments WHERE order_key = '{o6}'")) == 2, 'no new booking after restock')

# ---------- cancel before pickup ----------
o3 = order(drop, '9811400003', ip='10.7.9.6'); sel(f'/app/orders/{o3}/received', {})
sel(f'/app/ship/book/{o3}', {'courier': '20', 'pin': '560038', 'g': '500', 'city': 'Bengaluru', 'state': 'Karnataka'})
sh3 = sql(f"SELECT * FROM shipments WHERE order_key = '{o3}'")[0]
sel(f"/app/ship/{sh3['id']}/cancel", {})
check(sql(f"SELECT status FROM shipments WHERE id = '{sh3['id']}'")[0]['status'] == 'cancelled' and sql(f"SELECT ship_status FROM orders WHERE id = '{o3}'")[0]['ship_status'] == 'new', 'cancelled before pickup: order back to To send')
check('Ship with Shiprocket' in sel('/app/orders?tab=send')[2], 'a cancelled order can be booked again')
check('Track your parcel' not in client('10.7.9.7')(f'/o/{o3}')[2], 'buyer of a cancelled shipment sees no tracking')

import os
if os.environ.get('KEEP'):   # leave everything connected and write the session for screenshot tools
    o4 = order(drop, '9811400004', ip='10.7.9.8'); sel(f'/app/orders/{o4}/received', {})
    sel(f'/app/ship/book/{o4}', {'courier': '10', 'pin': '560038', 'g': '500', 'city': 'Bengaluru', 'state': 'Karnataka'})
    o5 = order(drop, '9811400005', ip='10.7.9.9'); sel(f'/app/orders/{o5}/received', {})
    json.dump({'o4': o4, 'o5': o5, 'phone': phone, 'o1': o1, 'o2': o2, 'o3': o3, 'drop': drop}, open(os.environ['KEEP'], 'w'))
    print(f'\n{ok} checks passed'); sys.exit(0)
# ---------- disconnect ----------
sel('/app/ship/disconnect', {})
check('Ship with Shiprocket' not in sel('/app/orders?tab=send')[2] and sql(f"SELECT sr_password_enc FROM sellers WHERE phone = '91{phone}'")[0]['sr_password_enc'] is None, 'disconnect removes the login and the buttons')
print(f'\n{ok} checks passed')
