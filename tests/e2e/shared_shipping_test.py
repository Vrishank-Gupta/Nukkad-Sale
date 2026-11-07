# End-to-end test of NukkadSale Shipping: sellers ship through the platform's Shiprocket account and pay from a
# prepaid balance. Join with a pickup address (added to the platform account, other sellers' addresses never shown),
# top up by UPI → "I have paid" → admin confirms, booking takes the courier price (not enough balance = refused,
# COD refused), cancel refunds once, admin corrects a balance, the platform webhook updates the parcel.
# Needs: python3 tests/e2e/mock_shiprocket.py, and the app (default local database) with --var OPEN_SIGNUP:1
# --var SHIPROCKET_API_BASE:http://localhost:8795 --var SHIPROCKET_EMAIL:seller@test.in --var SHIPROCKET_PASSWORD:secret123
# --var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code
import sys
exec(open('tests/e2e/shiprocket_test.py').read().split("phone = '94'")[0])

phone = '93' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.8.0.1')
sel('/signup', {'name': 'Share Seller', 'shop': 'Share Shop', 'phone': phone, 'vpa': 'share@ybl', 'paywant': 'manual', 'pin': '4321'})
sid = sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']
bal = lambda: sql(f"SELECT ship_balance_paise b FROM sellers WHERE id = '{sid}'")[0]['b']

# ---------- join ----------
s, h, sp = sel('/app/ship')
check('NukkadSale Shipping' in sp and 'Start NukkadSale Shipping' in sp and 'Have your own Shiprocket account' in sp, 'shipping page offers NukkadSale Shipping first, own account second')
s, h, _ = sel('/app/ship/nukkad', {'address': 'short', 'pin': '560038', 'phone': '9811000000'})
check('err=' in loc(h), 'incomplete pickup address refused')
s, h, _ = sel('/app/ship/nukkad', {'address': '14, 2nd Cross, Indiranagar', 'address2': 'Near metro', 'pin': '560038', 'phone': '9811000000'})
row = sql(f"SELECT sr_email, sr_pickup, sr_pickup_pin, sr_password_enc FROM sellers WHERE id = '{sid}'")[0]
check(row['sr_email'] == 'NukkadSale Shipping' and row['sr_pickup'].startswith('NS-') and row['sr_pickup_pin'] == '560038' and row['sr_password_enc'] is None, 'joined: own pickup location on the platform account')
calls = json.loads(urllib.request.urlopen(SR + '/_calls').read())
added = [c for c in calls if c[0] == 'POST' and c[1] == '/settings/company/addpickup'][-1][2]
check(added['pickup_location'] == row['sr_pickup'] and added['city'] == 'Bengaluru' and added['state'] == 'Karnataka' and added['name'] == 'Share Shop', 'pickup address sent to Shiprocket, city/state from the pincode')
s, h, sp = sel('/app/ship')
check('Connected · NukkadSale Shipping' in sp and 'Shipping balance' in sp and '₹0' in sp, 'shipping page: connected, balance ₹0')
check('Baner Road' not in sp and '12 MG Road' not in sp and '/webhooks/shiprocket/' not in sp, 'other addresses on the platform account and the webhook are never shown to sellers')

# ---------- book without money / COD ----------
drop = sale(sel, [('title', 'Cotton saree'), ('price', '1200'), ('stock', '6'), ('max', '2'), ('cod', '1')])
o1 = order(drop, '9811500001', ip='10.8.9.1')
sel(f'/app/orders/{o1}/received', {})
s, h, bp = sel(f'/app/ship/book/{o1}')
check('Shipping balance' in bp and 'Xpressbees' in bp, 'booking page shows the balance and couriers')
s, h, _ = sel(f'/app/ship/book/{o1}', {'courier': '20', 'pin': '560038', 'g': '700', 'city': 'Bengaluru', 'state': 'Karnataka'})
check('err=' in loc(h) and 'Add%20money' in loc(h) and not sql(f"SELECT id FROM shipments WHERE order_key = '{o1}'"), 'not enough balance: refused, nothing booked')
oc = order(drop, '9811500002', cod=True, ip='10.8.9.2')
s, h, _ = sel(f'/app/ship/book/{oc}')
check('err=' in loc(h) and 'cash-on-delivery' in urllib.parse.unquote(loc(h)), 'cash on delivery can’t use NukkadSale Shipping')

# ---------- top up ----------
s, h, _ = sel('/app/ship/topup', {'amount': '7'})
check(not sql(f"SELECT id FROM ship_ledger WHERE seller_id = '{sid}'"), 'only the offered top-up amounts')
s, h, _ = sel('/app/ship/topup', {'amount': '500'})
tid = int(loc(h).rsplit('/', 1)[1])
t = sql(f"SELECT amount_paise, status FROM ship_ledger WHERE id = {tid}")[0]
check(t['status'] == 'new' and 49900 <= t['amount_paise'] <= 49999, 'top-up of ₹500 asks for a few paise under, to tell payers apart')
adm = client('10.8.5.5')
s, h, _ = adm('/admin/setup', {'phone': '9999999999', 'code': 'setup-code', 'pin': '135790'})
if s != 303 or '/admin?' not in h.get('Location', ''): adm('/admin/login', {'phone': '9999999999', 'pin': '135790'})
adm('/admin/settings', {'upi_vpa': '', 'payee_name': 'NukkadSale', 'default_modes': 'direct'})
s, h, tp = sel(f'/app/ship/topup/{tid}')
check('Message us on WhatsApp' in tp, 'no platform UPI ID yet: seller is told to message us')
adm('/admin/settings', {'upi_vpa': 'nukkad@ybl', 'payee_name': 'NukkadSale', 'default_modes': 'direct'})
s, h, tp = sel(f'/app/ship/topup/{tid}')
check('nukkad@ybl' in tp and f"am={t['amount_paise'] / 100:.2f}" in tp and 'I have paid' in tp, 'pay page: platform UPI ID, exact amount, I have paid')
sel(f'/app/ship/topup/{tid}/paid', {})
check(sql(f"SELECT status FROM ship_ledger WHERE id = {tid}")[0]['status'] == 'claimed' and bal() == 0, 'claimed – not added until the admin sees the money')
s, h, ap = adm('/admin/shipping')
check('Share Shop' in ap and 'Received – add it' in ap and '/webhooks/shiprocket/' in ap, 'admin Shipping: top-up to check, webhook URL for the platform account')
check('shipping top-up' in adm('/admin')[2], 'admin dashboard: top-up to check')
adm(f'/admin/shipping/topups/{tid}/ok', {}); adm(f'/admin/shipping/topups/{tid}/ok', {})
check(bal() == t['amount_paise'], 'admin confirms: balance credited once (double tap safe)')
s, h, _ = sel('/app/ship/topup', {'amount': '500'}); t2 = int(loc(h).rsplit('/', 1)[1])
sel(f'/app/ship/topup/{t2}/paid', {}); adm(f'/admin/shipping/topups/{t2}/no', {})
check(sql(f"SELECT status FROM ship_ledger WHERE id = {t2}")[0]['status'] == 'rejected' and bal() == t['amount_paise'], 'not received: nothing added')

# ---------- book from the balance ----------
before = bal()
s, h, _ = sel(f'/app/ship/book/{o1}', {'courier': '20', 'pin': '560038', 'g': '700', 'city': 'Bengaluru', 'state': 'Karnataka'})
check('ok=' in loc(h), 'booked with enough balance')
sh = sql(f"SELECT * FROM shipments WHERE order_key = '{o1}'")[0]
check(sh['prepaid_paise'] == 6550 and bal() == before - 6550, 'courier price ₹65.50 taken from the balance')
created = [c for c in json.loads(urllib.request.urlopen(SR + '/_calls').read()) if c[0] == 'POST' and c[1] == '/orders/create/adhoc'][-1][2]
check(created['pickup_location'] == row['sr_pickup'] and created['payment_method'] == 'Prepaid', 'Shiprocket order uses this seller’s own pickup location')
s, h, sp = sel('/app/ship')
check('Courier' in sp and '−₹65.50' in sp and 'Added' in sp and 'payment not received' in sp, 'balance history: top-ups and the courier charge')

# ---------- webhook on the platform account, cancel refund, admin correction ----------
hook = re.search(r'/webhooks/shiprocket/([A-Za-z0-9]+)', ap).group(1)
client('10.8.7.7')(f'/webhooks/shiprocket/{hook}', raw=json.dumps({'awb': sh['awb'], 'current_status': 'PICKED UP', 'scans': []}).encode(), ctype='application/json')
check(sql(f"SELECT status FROM shipments WHERE id = '{sh['id']}'")[0]['status'] == 'picked', 'platform webhook finds the parcel by AWB and updates it')
o2 = order(drop, '9811500003', ip='10.8.9.3'); sel(f'/app/orders/{o2}/received', {})
sel(f'/app/ship/book/{o2}', {'courier': '10', 'pin': '560038', 'g': '700', 'city': 'Bengaluru', 'state': 'Karnataka'})
sh2 = sql(f"SELECT * FROM shipments WHERE order_key = '{o2}'")[0]
mid = bal()
sel(f"/app/ship/{sh2['id']}/cancel", {}); sel(f"/app/ship/{sh2['id']}/cancel", {})
check(bal() == mid + 7200 and sql(f"SELECT prepaid_paise FROM shipments WHERE id = '{sh2['id']}'")[0]['prepaid_paise'] == 0, 'cancel before pickup: ₹72 back to the balance, once')
adm(f'/admin/shipping/{sid}/adjust', {'amount': '-120', 'note': 'Return charge #TEST'})
check(bal() == mid + 7200 - 12000 and 'Return charge #TEST' in sel('/app/ship')[2], 'admin correction (e.g. a return charge) shows in the seller’s history')
s, h, own = client('10.8.0.9')('/app/ship/connect', {'email': 'NukkadSale Shipping', 'password': 'x'})
print(f'\nall {ok} checks passed')
