# End-to-end test of the buyer-trust features: size chart + "ask my size" + remembered size, cash on
# delivery with an advance, the order timeline (with the packed-parcel photo), the payment receipt, and
# reviews (after delivery only, first name only, seller can hide one or switch them all off).
# Needs the app running locally with --var OPEN_SIGNUP:1 (any database). KK_PERSIST if it uses --persist-to.
import json, random, re, sys, time, urllib.parse
sys.argv = sys.argv[:2] if len(sys.argv) > 1 else sys.argv
exec(open('tests/e2e/live_ask_test.py').read().split('phone = ')[0])

phone = '91' + str(random.randint(10**7, 10**8 - 1))
sel = client('10.5.0.1')
sel('/signup', {'name': 'Trust Seller', 'shop': 'Trust Shop', 'phone': phone, 'vpa': 'trust@ybl', 'paywant': 'manual', 'pin': '4321'})
sid = sql(f"SELECT id FROM sellers WHERE phone = '91{phone}'")[0]['id']

# ---------- size help ----------
s, h, pg = sel('/app/drops/new')
check('Add a size chart in Settings' in pg, 'no chart yet: the sale form points to Settings')
sel('/app/settings/size-chart', multipart=multipart([], [('chart', 'chart.png', png((10, 10, 10)))]))
chart = sql(f"SELECT size_chart_key FROM sellers WHERE id = '{sid}'")[0]['size_chart_key']
check(chart and chart.startswith('c/'), 'seller uploads a size chart in Settings')
s, h, pg = sel('/app/drops/new')
check('Show my size chart on this sale' in pg, 'sale form now offers "Show my size chart"')
s, h, _ = sel('/app/drops/new', multipart=multipart([('title', 'Cotton kurta'), ('price', '800'), ('has_sizes', '1'), ('size_label', 'M'), ('size_qty', '5'), ('size_label', 'L'), ('size_qty', '5'),
    ('max', '2'), ('size_chart', '1'), ('cod', '1'), ('cod_advance', '100')]))
drop = re.search(r'/drops/([a-z0-9]+)', h['Location']).group(1)
d = sql(f"SELECT size_chart, cod_advance_paise FROM drops WHERE id = '{drop}'")[0]
check(d == {'size_chart': 1, 'cod_advance_paise': 10000}, 'sale saved with size chart on and a ₹100 COD advance')
s, h, pg = sel(f'/app/drops/{drop}')
check('₹100 advance' in urllib.parse.unquote(pg), 'share message mentions the COD advance')
b1 = client('10.5.1.1')
s, h, pg = b1(f'/d/{drop}')
check(f'/img/{chart}' in pg and 'Size chart' in pg, 'buyer sees the size chart')
check('Ask Trust Shop' in pg and 'Which+size' in pg.replace('%20', '+'), 'buyer can ask their size on WhatsApp')
check('pay ₹100 advance now' in pg, 'COD button says the advance')
_, h2, _ = sel('/app/drops/new', multipart=multipart([('title', 'Plain shawl'), ('price', '500'), ('has_sizes', '1'), ('size_label', 'Free'), ('size_qty', '9'), ('max', '2')]))
plain = re.search(r'/drops/([a-z0-9]+)', h2['Location']).group(1)
check(f'/img/{chart}' not in b1(f'/d/{plain}')[2], 'no chart on a sale where the seller did not tick it')
sel(f'/app/drops/{plain}/size-chart', {'on': '1'})
check(f'/img/{chart}' in b1(f'/d/{plain}')[2], 'seller can switch the chart on from the sale page')

# ---------- cash on delivery with an advance ----------
vm = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}' AND label = 'M'")[0]['id']
s, h, _ = b1(f'/d/{drop}', {**buyer(vm, 'Priya Sharma', '9811000441'), 'pay': 'cod'})
oid = h['Location'][3:].split('?')[0]
o = sql(f"SELECT status, pay_mode, adv_status, adv_paise, amount_paise, hold_until FROM orders WHERE id = '{oid}'")[0]
check(o['pay_mode'] == 'cod' and o['adv_status'] == 'due' and 9901 <= o['adv_paise'] <= 9999, 'COD order asks for an advance a few paise under ₹100')
check(o['hold_until'] < time.time() * 1000 + 20 * 60_000, 'piece is held only for the usual time until the advance is paid')
s, h, pg = b1(f'/o/{oid}')
check(f"am={o['adv_paise'] / 100:.2f}" in pg and 'I have paid the advance' in pg, 'order page: pay the exact advance by UPI')
s, h, pg = sel('/app/orders?tab=send')
check('Priya Sharma' not in pg, 'not in "To send" before the advance is paid')
s, h, pg = sel('/app/orders?tab=check')
check('Waiting for the ₹' in pg, 'seller sees it waiting for the advance')
b1(f'/o/{oid}/advance', {})
check(sql(f"SELECT adv_status FROM orders WHERE id = '{oid}'")[0]['adv_status'] == 'claimed', 'buyer says the advance is paid')
check('Trust Shop is checking your advance' in b1(f'/o/{oid}')[2], 'buyer sees the shop is checking')
s, h, home = sel('/app')
check('1 payment to check' in home or '1 payments to check' in home, 'seller home: a payment to check')
sel(f'/app/orders/{oid}/advance', {})
check(sql(f"SELECT adv_status FROM orders WHERE id = '{oid}'")[0]['adv_status'] == 'paid', 'seller confirms the advance')
s, h, pg = sel('/app/orders?tab=send')
rest = f"₹{(o['amount_paise'] - o['adv_paise']) / 100:,.2f}"
check('Priya Sharma' in pg and 'paid in advance' in pg and rest in pg, f'now in "To send": collect {rest} in cash')
s, h, pg = b1(f'/o/{oid}')
check('Advance of ₹' in pg and rest in pg, 'buyer order page: advance received, the rest in cash')

# ---------- timeline + packed photo + receipt ----------
b2 = client('10.5.2.1')
vl = sql(f"SELECT id FROM variants WHERE drop_id = '{drop}' AND label = 'L'")[0]['id']
s, h, _ = b2(f'/d/{drop}', buyer(vl, 'Sana Qureshi', '9811000442'))
o2 = h['Location'][3:].split('?')[0]
check(b2(f'/o/{o2}/receipt')[0] == 404, 'no receipt before the shop confirms the payment')
b2(f'/o/{o2}/utr', multipart=multipart([]))
check(sql(f"SELECT claimed_at FROM orders WHERE id = '{o2}'")[0]['claimed_at'], 'timeline: time of "I have paid" recorded')
sel(f'/app/orders/{o2}/received', {})
s, h, pg = b2(f'/o/{o2}')
check('Your order' in pg and 'Payment confirmed by the shop' in pg and 'You said you paid' in pg, 'order page shows the timeline')
sel(f'/app/orders/{o2}/ship', multipart=multipart([], [('photo', 'parcel.png', png((120, 90, 40)))]))
r = sql(f"SELECT ship_status, packed_at, pack_photo_key FROM orders WHERE id = '{o2}'")[0]
check(r['ship_status'] == 'packed' and r['packed_at'] and r['pack_photo_key'].startswith('k/'), 'packed with a parcel photo; time recorded')
s, h, pg = b2(f'/o/{o2}')
check(f"/img/{r['pack_photo_key']}" in pg, 'buyer sees the packed-parcel photo')
check(b2(f"/img/{r['pack_photo_key']}")[0] == 200, 'photo is served')
sel(f'/app/orders/{o2}/ship', {}); sel(f'/app/orders/{o2}/ship', {})
r = sql(f"SELECT ship_status, shipped_at, delivered_at FROM orders WHERE id = '{o2}'")[0]
check(r['ship_status'] == 'delivered' and r['shipped_at'] and r['delivered_at'], 'sent and delivered times recorded')
s, h, rc = b2(f'/o/{o2}/receipt')
check(s == 200 and 'Trust Shop' in rc and 'Payment receipt' in rc and '₹799' in rc.replace('₹798', '₹799') and 'trust@ybl' in rc and 'Sana Qureshi' in rc, 'receipt: shop, items, total, paid by UPI to the seller, buyer')
check('Print or save as PDF' in rc and 'wa.me/?text=' in rc, 'receipt can be printed or shared on WhatsApp')

# ---------- reviews ----------
s, h, pg = b2(f'/o/{o2}')
check('How was it?' in pg, 'after delivery the buyer is asked for a review')
check('How was it?' not in b1(f'/o/{oid}')[2], 'not asked before delivery')
check(b1(f'/o/{oid}/review', {'stars': '5'})[0] == 404, 'reviews before delivery are refused')
s, h, _ = b2(f'/o/{o2}/review', multipart=multipart([('stars', '0')]))
check('err=' in h['Location'], 'a rating is required')
b2(f'/o/{o2}/review', multipart=multipart([('stars', '5'), ('text', 'Lovely fabric, fast delivery')], [('photo', 'me.png', png((200, 150, 150)))]))
rv = sql(f"SELECT name, stars, text, photo_key FROM reviews WHERE seller_id = '{sid}'")
check(len(rv) == 1 and rv[0]['name'] == 'Sana' and rv[0]['stars'] == 5 and rv[0]['photo_key'], 'review saved: first name only, 5 stars, with a photo')
b2(f'/o/{o2}/review', multipart=multipart([('stars', '1')]))
check(sql(f"SELECT COUNT(*) n FROM reviews WHERE seller_id = '{sid}'")[0]['n'] == 1, 'one review per order')
check('Thank you for your review' in b2(f'/o/{o2}')[2], 'buyer sees thanks instead of the form')
s, h, pg = client('10.5.3.1')(f'/d/{plain}')
check('What buyers say' in pg and '5.0 ★ · 1 review' in pg and 'Lovely fabric' in pg and 'Qureshi' not in pg, 'reviews show on sale pages (first name only)')
check('What buyers say' in client('10.5.3.1')(f'/s/{sid}')[2], '…and on the shop page')
s, h, home = sel('/app')
check('1 new review' in home, 'seller home: new review')
s, h, pg = sel('/app/reviews')
check('Lovely fabric' in pg and '1 new review' not in sel('/app')[2], 'seller sees the review; the task clears')
rid = sql(f"SELECT id FROM reviews WHERE seller_id = '{sid}'")[0]['id']
sel(f'/app/reviews/{rid}/hide', {})
check('What buyers say' not in client('10.5.3.2')(f'/d/{plain}')[2], 'hidden review no longer shows')
sel(f'/app/reviews/{rid}/show', {}); sel('/app/reviews/toggle', {'on': ''})
check('What buyers say' not in client('10.5.3.3')(f'/d/{plain}')[2], 'seller switches reviews off: none shown')
sel('/app/reviews/toggle', {'on': '1'})
check('What buyers say' in client('10.5.3.4')(f'/d/{plain}')[2], '…and back on')

# ---------- Hindi ----------
hi = client('10.5.2.1'); hi('/lang?to=hi&back=/')
check('आपका ऑर्डर' in hi(f'/o/{o2}')[2] and 'पेमेंट रसीद' in hi(f'/o/{o2}/receipt')[2], 'timeline and receipt in Hindi')
print(f'\nall {ok} checks passed')
