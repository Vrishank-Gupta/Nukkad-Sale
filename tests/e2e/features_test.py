# Multiple UPI IDs, per-sale UPI, several photos per sale, sell-again reuse, signup payment choice.
import http.cookiejar, re, struct, sys, urllib.parse, urllib.request, zlib
import os
APP = os.environ.get('BASE', 'http://localhost:8787')
fails = 0
# Cloudflare's edge rejects Python's default user agent, so look like a browser.
UA = 'Mozilla/5.0 (Linux; Android 14) khatakhat-e2e'
def check(ok, msg):
    global fails
    print(('  ✓ ' if ok else '  ✗ ') + msg); fails += 0 if ok else 1
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a): return None
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect())
def go(path, data=None, ctype=None):
    r = urllib.request.Request(APP + path, data=data, headers={'Origin': APP, 'User-Agent': UA, **({'Content-Type': ctype} if ctype else {})})
    try: resp = op.open(r)
    except urllib.error.HTTPError as e: resp = e
    return resp.status, resp.headers.get('Location', ''), resp.read().decode('utf-8', 'replace')
post = lambda path, f: go(path, urllib.parse.urlencode(f).encode(), 'application/x-www-form-urlencoded')
def png(rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * 16 for _ in range(16))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', 16, 16, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
def multipart(fields, files):
    b = 'FB'; out = b''
    for k, v in fields: out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, name, data in files: out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode() + data + b'\r\n'
    return out + f'--{b}--\r\n'.encode(), f'multipart/form-data; boundary={b}'

print('signup with a payment choice')
s, loc, _ = post('/signup', {'name': 'Pranav', 'shop': 'Second Theory', 'phone': '9800000001', 'vpa': 'Shop@YBL', 'pin': '1234', 'paywant': 'auto'})
check('/app' in loc, 'signup works with “automatic payments” chosen')
_, _, st = go('/app/settings')
check('Request automatic payments' in st or 'Requested' in st, 'Option 2 is visible in Settings (with request status)')
check('shop@ybl' in st, 'signup UPI ID is in the UPI list (lower-cased)')

print('several UPI IDs')
post('/app/upi/add', {'vpa': 'personal@okhdfcbank', 'label': 'Personal GPay'})
s, loc, _ = post('/app/upi/add', {'vpa': 'personal@okhdfcbank'})
check('err=' in loc, 'duplicate UPI ID refused')
_, _, st = go('/app/settings')
check('personal@okhdfcbank' in st and 'Personal GPay' in st and 'Default' in st, 'both UPI IDs listed, one marked Default')
body, ct = multipart([('title', 'Kohl Opulence Tester 100ml'), ('price', '3100'), ('stock', '2'), ('max', '1'), ('upi', 'personal@okhdfcbank')],
                     [('image', 'a.png', png((200, 30, 30))), ('image', 'b.png', png((30, 200, 30))), ('image', 'c.png', png((30, 30, 200)))])
_, loc, _ = go('/app/drops/new', body, ct)
drop = re.search(r'/drops/([a-z0-9]+)', loc).group(1)
_, _, sale = go(f'/app/drops/{drop}')
check('personal@okhdfcbank' in sale, 'sale page shows where the money goes')
check(sale.count('class="photos"') == 1 and len(re.findall(r'<div class="photos">(.*?)</div>', sale)[0].split('<img')) - 1 == 3, 'sale page shows all 3 photos')

print('buyer sees a gallery, pays the chosen UPI ID')
pub = urllib.request.build_opener(NoRedirect())
dp = pub.open(urllib.request.Request(APP + f'/d/{drop}', headers={'User-Agent': UA})).read().decode()
check(dp.count('<img src="/img/d/') == 3 and '1 / 3' in dp, 'buyer page: swipeable gallery with 3 photos and a counter')
check(not re.search(r'\d+\s*(left|sold)', re.sub(r'<[^>]+>', ' ', dp)), 'buyer page shows no stock numbers')
variant = re.search(r'name="variant" value="(\d+)"', dp).group(1)
req = urllib.request.Request(APP + f'/d/{drop}', data=urllib.parse.urlencode({'variant': variant, 'qty': 1, 'name': 'Asha', 'phone': '9811100077', 'address': '5 Park Street, Kolkata', 'pincode': '700016'}).encode(), headers={'Origin': APP, 'User-Agent': UA})
try: loc = pub.open(req).headers['Location']
except urllib.error.HTTPError as e: loc = e.headers['Location']
op_page = pub.open(urllib.request.Request(loc if loc.startswith('http') else APP + loc, headers={'User-Agent': UA})).read().decode()
check('pa=personal%40okhdfcbank' in op_page, 'UPI pay link goes to the UPI ID chosen for this sale')

print('sell again reuses all photos; removing a UPI ID')
_, _, again = go(f'/app/drops/new?from={drop}')
check(again.count('name="reuse_image"') == 3, '“Sell again” keeps all 3 photos')
_, _, s = go('/app/settings')
ids = re.findall(r'/app/upi/(\d+)/remove', s)
check(len(ids) == 1, 'default UPI ID has no remove button (only the other one does)')
post(f'/app/upi/{ids[0]}/remove', {})
_, _, sale = go(f'/app/drops/{drop}')
check('shop@ybl' in sale, 'sale falls back to the default UPI ID after its UPI ID is removed')
print('several products, one payment (website)')
body, ct = multipart([('title', 'Hawas Verde'), ('price', '2600'), ('stock', '3'), ('max', '1')], [('image', 'v.png', png((10, 150, 90)))])
_, loc, _ = go('/app/drops/new', body, ct); d1 = re.search(r'/drops/([a-z0-9]+)', loc).group(1)
body, ct = multipart([('title', 'Hawas Kobra'), ('price', '2600'), ('stock', '3'), ('max', '1')], [('image', 'k.png', png((90, 90, 10)))])
_, loc, _ = go('/app/drops/new', body, ct); d2 = re.search(r'/drops/([a-z0-9]+)', loc).group(1)
_, _, sale = go(f'/app/drops/{d1}')
check('data-share-photos' in sale and 'download=' in sale, 'sale page: “Share on WhatsApp with photo” + download photos')
check('*Hawas Verde*' in sale and '⚡ *FLASH SALE*' not in sale, 'share caption in their post style (title first, no banner)')
def buy(drop):
    page = pub.open(urllib.request.Request(APP + f'/d/{drop}', headers={'User-Agent': UA})).read().decode()
    v = re.search(r'name="variant" value="(\d+)"', page).group(1)
    r = urllib.request.Request(APP + f'/d/{drop}', data=urllib.parse.urlencode({'variant': v, 'qty': 1, 'name': 'Ravi', 'phone': '9811100555', 'address': '22 MG Road, Nagpur', 'pincode': '440001'}).encode(), headers={'Origin': APP, 'User-Agent': UA})
    try: return pub.open(r).headers['Location']
    except urllib.error.HTTPError as e: return e.headers['Location']
buy(d1); loc2 = buy(d2)
page = pub.open(urllib.request.Request(loc2 if loc2.startswith('http') else APP + loc2, headers={'User-Agent': UA})).read().decode()
check('Hawas Verde' in page and 'Hawas Kobra' in page and 'Total' in page, 'second product joins the same payment: both items on one order page')
total = re.findall(r'₹5,199\.\d\d', page)
check(bool(total), f'one total with unique paise ({total[0] if total else "missing"})')
_, _, chk = go('/app/orders?tab=check')
cards = re.findall(r'<div class="card order[^"]*">(.*?)</form>', chk, re.S)
check(any('Hawas Verde' in c and 'Hawas Kobra' in c for c in cards) and (total[0] if total else 'x') in chk, 'seller sees ONE card with both items and the total')
oid = re.search(r'/app/orders/([a-z0-9]+)/received', [c for c in cards if 'Hawas Kobra' in c][0]).group(1)
go(f'/app/orders/{oid}/received', b'', 'application/x-www-form-urlencoded')
_, _, done = go('/app/orders?tab=send')
check(done.count('Hawas Verde') >= 1 and done.count('Hawas Kobra') >= 1 and done.count('Mark as packed') == 1, 'one tap “Yes” marks both paid → one card to pack')
_, _, khata = go('/app/khata')
check(khata.count('Hawas') == 2, 'both items written in the khata')

print('buyers can browse the shop from any sale link')
dp = pub.open(urllib.request.Request(APP + f'/d/{d1}', headers={'User-Agent': UA})).read().decode()
check('More from Second Theory' in dp and 'Hawas Kobra' in dp, 'sale page shows “More from {shop}” with other items')
shop = re.search(r'href="(/s/[a-z0-9]+)"', dp)
check(shop is not None, '“See all items” links to the shop page')
sp = pub.open(urllib.request.Request(APP + shop.group(1), headers={'User-Agent': UA})).read().decode()
check(all(x in sp for x in ['Hawas Verde', 'Hawas Kobra', 'Kohl Opulence']) and not re.search(r'\d+\s*(left|sold)', re.sub(r'<[^>]+>', ' ', sp)), 'shop page lists all items, no stock numbers')

print('quick order from a chat')
_, _, qo = go('/app/quick-order')
vids = re.findall(r'name="q_(\d+)"', qo)
check(len(vids) >= 2, 'quick order lists live products with steppers')
s2, loc, _ = post('/app/quick-order', {'phone': '9822200777', 'name': 'Neha', f'q_{vids[0]}': '1', f'q_{vids[1]}': '1'})
check('/app/quick-order/done/' in loc, 'seller makes a quick order for a buyer who DMed')
_, _, qd = go(loc.replace(APP, ''))
link = re.search(r'(https?://[^\s<]+/o/[a-z0-9]+)', qd)
check(link is not None and 'Total' in qd and 'wa.me/919822200777' in qd, 'ready message with total + pay link, “Send on WhatsApp” to the buyer')
bp = pub.open(urllib.request.Request(APP + '/o/' + link.group(1).rsplit('/', 1)[1], headers={'User-Agent': UA})).read().decode()
check(f'/o/{link.group(1).rsplit("/", 1)[1]}/details"' in bp, 'buyer page asks for the address the seller did not have')
key = link.group(1).rsplit('/', 1)[1]
r = urllib.request.Request(APP + f'/o/{key}/details', data=urllib.parse.urlencode({'name': 'Neha Gupta', 'address': '7 Lake Road, Bhopal', 'pincode': '462001'}).encode(), headers={'Origin': APP, 'User-Agent': UA})
try: pub.open(r)
except urllib.error.HTTPError: pass
bp = pub.open(urllib.request.Request(APP + '/o/' + key, headers={'User-Agent': UA})).read().decode()
check(f'/o/{key}/details"' not in bp and 'I have paid' in bp, 'after the address, the buyer just pays and taps “I have paid”')
print('ALL PASSED' if not fails else f'{fails} FAILED')
sys.exit(1 if fails else 0)
