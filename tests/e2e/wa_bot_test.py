# End-to-end test of the WhatsApp ordering bot against mock_meta.py.
# Start mock_meta.py, then the app with the WA_* vars pointing at it (see tests/e2e/README.md).
import hashlib, hmac, http.cookiejar, json, re, subprocess, sys, time, urllib.parse, urllib.request

def sql(q):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', '--json', '--command', q], capture_output=True, text=True, cwd='/home/vrishankgupta/CommSeller').stdout
    return json.loads(out)[0]['results']

APP, META, SECRET = 'http://localhost:8787', 'http://localhost:8791', b'app-secret'
jar = http.cookiejar.CookieJar()
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), type('NoRedirect', (urllib.request.HTTPRedirectHandler,), {'redirect_request': lambda *a: None})())
fails = 0

def check(ok, msg):
    global fails
    print(('  ✓ ' if ok else '  ✗ ') + msg)
    fails += 0 if ok else 1

def req(url, data=None, headers=None, method=None):
    r = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        resp = web.open(r)
    except urllib.error.HTTPError as e:
        resp = e
    return resp.status, resp.headers, resp.read()

def form(path, fields):
    return req(APP + path, urllib.parse.urlencode(fields).encode(), {'Origin': APP, 'Content-Type': 'application/x-www-form-urlencoded'})

def sent():
    return json.loads(urllib.request.urlopen(META + '/_sent').read())

msg_no = 0
def inbound(frm, name, message, sign=True):
    """Deliver a signed webhook as Meta would and return the bot's replies."""
    global msg_no
    msg_no += 1
    before = len(sent())
    message = {'from': frm, 'id': f'wamid.in.{msg_no}', 'timestamp': str(int(time.time())), **message}
    body = json.dumps({'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {
        'messaging_product': 'whatsapp', 'contacts': [{'wa_id': frm, 'profile': {'name': name}}], 'messages': [message]}}]}]}).encode()
    sig = 'sha256=' + hmac.new(SECRET if sign else b'wrong', body, hashlib.sha256).hexdigest()
    status, _, _ = req(APP + '/webhooks/whatsapp', body, {'Content-Type': 'application/json', 'X-Hub-Signature-256': sig})
    for _ in range(50):
        time.sleep(0.15)
        out = sent()[before:]
        if out and (len(out) >= 2 or out[-1].get('type') == 'text' or out[-1].get('interactive', {}).get('type') in ('button', 'list')):
            time.sleep(0.4)
            return status, sent()[before:]
    return status, sent()[before:]

text = lambda body: {'type': 'text', 'text': {'body': body}}
tap = lambda bid: {'type': 'interactive', 'interactive': {'type': 'button_reply', 'button_reply': {'id': bid, 'title': bid}}}
def buttons(m): return [b['reply']['id'] for b in m.get('interactive', {}).get('action', {}).get('buttons', [])]
def body(m): return m.get('text', {}).get('body') or m.get('interactive', {}).get('body', {}).get('text', '')

print('webhook setup')
s, _, b = req(APP + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42')
check(s == 200 and b == b'42', 'Meta verification handshake')
s, _, _ = req(APP + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42')
check(s == 403, 'wrong verify token refused')

print('seller sets up a sale')
form('/signup', {'name': 'Meera Shah', 'shop': 'Meera Boutique', 'phone': '9876543210', 'vpa': 'meera@ybl', 'pin': '4321'})
boundary = 'XyZ'
parts = [('title', 'Chanderi silk kurta'), ('price', '799'), ('has_sizes', '1'), ('size_label', 'S'), ('size_qty', '2'), ('size_label', 'M'), ('size_qty', '3'), ('max', '2')]
mp = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in parts) + f'--{boundary}--\r\n'
s, h, _ = req(APP + '/app/drops/new', mp.encode(), {'Origin': APP, 'Content-Type': f'multipart/form-data; boundary={boundary}'})
drop = re.search(r'/drops/([a-z0-9]+)', h['Location']).group(1)
_, _, page = req(APP + f'/app/drops/{drop}')
check(f'/w/{drop}'.encode() in page, 'share message uses the WhatsApp order link')
s, h, wpage = req(APP + f'/w/{drop}')
check(b'og:image' in wpage or b'og:title' in wpage, '/w link carries the product preview card')
check(b'wa.me/919000000000?text=' in wpage, '/w link opens the bot chat with the order message')

print('buyer orders inside WhatsApp (English)')
P = '919811122233'
s, out = inbound(P, 'Priya Nair', text('x'), sign=False)
check(s == 401 and not out, 'unsigned webhook rejected')
s, out = inbound(P, 'Priya Nair', text(f'Order #{drop} – Chanderi silk kurta'))
check(s == 200 and out and out[0]['type'] == 'interactive', 'bot replies to the order message')
sizes = buttons(out[0])
check(len(sizes) == 2 and all(x.startswith('size:') for x in sizes), f'size buttons shown ({len(sizes)})')
_, out = inbound(P, 'Priya Nair', tap(sizes[1]))
check([x.split(':')[0] for x in buttons(out[0])] == ['qty', 'qty'], 'quantity buttons (max 2 per order)')
_, out = inbound(P, 'Priya Nair', tap('qty:1'))
check('address' in body(out[0]).lower(), 'asks for address (first-time buyer)')
_, out = inbound(P, 'Priya Nair', text('Flat 402 Lotus Residency Baner Road Pune'))
check('pincode' in body(out[0]).lower(), 'asks again when pincode is missing')
_, out = inbound(P, 'Priya Nair', text('Flat 402 Lotus Residency Baner Road Pune 411045'))
cta = next((m for m in out if m.get('interactive', {}).get('type') == 'cta_url'), None)
check(cta is not None, 'pay button sent')
amt = re.search(r'₹[\d,]+\.\d\d', body(cta)).group(0) if cta else ''
check(bool(amt), f'unique amount shown ({amt})')
order = re.search(r'/o/([a-z0-9]+)', cta['interactive']['action']['parameters']['url']).group(1) if cta else ''
check(any(b.startswith('paid:') for m in out for b in buttons(m)), '“I have paid” and “Cancel” buttons')
_, _, opage = req(APP + f'/o/{order}')
check(b'wa.me/919000000000' in opage, 'pay page offers “Back to WhatsApp”')
_, out = inbound(P, 'Priya Nair', tap(f'paid:{order}'))
check('thank' in body(out[0]).lower(), 'buyer thanked after “I have paid” – no UTR asked')
_, _, check_page = req(APP + '/app/orders?tab=check')
check(amt.encode() in check_page and '· WhatsApp'.encode() in check_page, 'seller sees the amount to check, marked as a WhatsApp order')

print('seller confirms and ships → buyer told in chat')
before = len(sent())
req(APP + f'/app/orders/{order}/received', b'', {'Origin': APP}, 'POST')
time.sleep(1.2)
out = sent()[before:]
check(any('payment received' in body(m).lower() for m in out), 'buyer gets “✅ Payment received” in WhatsApp')
before = len(sent())
req(APP + f'/app/orders/{order}/ship', b'', {'Origin': APP}, 'POST')
time.sleep(1.2)
check(any('packed' in body(m).lower() for m in sent()[before:]), 'buyer gets the shipping update')

print('returning buyer: saved address, screenshot instead of UTR')
_, out = inbound(P, 'Priya Nair', text(f'Order #{drop}'))
_, out = inbound(P, 'Priya Nair', tap(buttons(out[0])[0]))
_, out = inbound(P, 'Priya Nair', tap('qty:1'))
check(buttons(out[0]) == ['addr:yes', 'addr:new'] and '411045' in body(out[0]), 'saved address offered with one tap')
_, out = inbound(P, 'Priya Nair', tap('addr:yes'))
cta = next((m for m in out if m.get('interactive', {}).get('type') == 'cta_url'), None)
order2 = re.search(r'/o/([a-z0-9]+)', cta['interactive']['action']['parameters']['url']).group(1)
_, out = inbound(P, 'Priya Nair', {'type': 'image', 'image': {'id': 'media123', 'mime_type': 'image/png'}})
check('screenshot' in body(out[0]).lower(), 'screenshot accepted as “I have paid”')
s, h, img = req(APP + f'/app/proof/{order2}')
check(s == 200 and img[:4] == b'\x89PNG', 'seller can view the screenshot')
_, _, check_page = req(APP + '/app/orders?tab=check')
check(b'Screenshots can be fake' in check_page, 'seller warned that screenshots can be fake')
s, _, _ = req(APP + '/img/p/anything')
check(s == 404, 'screenshots are not public')

print('Hindi buyer, cancel, status')
H = '919822233344'
_, out = inbound(H, 'Anjali', text(f'ऑर्डर #{drop}'))
check('साइज़' in body(out[0]), 'bot answers in Hindi')
_, out = inbound(H, 'Anjali', tap(buttons(out[0])[0]))
_, out = inbound(H, 'Anjali', tap('qty:1'))
_, out = inbound(H, 'Anjali', text('12 सिविल लाइन्स जयपुर 302006'))
cta = next((m for m in out if m.get('interactive', {}).get('type') == 'cta_url'), None)
order3 = re.search(r'/o/([a-z0-9]+)', cta['interactive']['action']['parameters']['url']).group(1)
# The public stock feed no longer reveals numbers, so read the database directly.
avail = lambda: sum(r['available'] for r in sql(f"SELECT available FROM variants WHERE drop_id = '{drop}'"))
before = avail()
_, out = inbound(H, 'Anjali', tap(f'cancel:{order3}'))
check(avail() == before + 1, 'cancel puts the piece back on sale')
_, _, feed = req(APP + f'/d/{drop}/stock.json')
check(not re.search(rb'"(available|stock|sold)"', feed), 'public stock feed has no numbers')
_, out = inbound(P, 'Priya Nair', text('status'))
check('#' in body(out[0]) and ('Packed' in body(out[0]) or 'Check' in body(out[0])), 'status command lists orders')
s, out = inbound(P, 'Priya Nair', text('Do you have musk kashmir as well?'))
check('wa.me/919876543210' in body(out[0]), 'a question is pointed to the seller’s own WhatsApp')

print('two products in one chat → one payment')
boundary2 = 'XyZ2'
mp2 = ''.join(f'--{boundary2}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in [('title', 'Hawas Kobra'), ('price', '2600'), ('stock', '3'), ('max', '1')]) + f'--{boundary2}--\r\n'
s, h, _ = req(APP + '/app/drops/new', mp2.encode(), {'Origin': APP, 'Content-Type': f'multipart/form-data; boundary={boundary2}'})
drop2 = re.search(r'/drops/([a-z0-9]+)', h['Location']).group(1)
C = '919833300099'
_, out = inbound(C, 'Rahul', text(f'Order #{drop}'))
check('wa.me/919876543210' in body(out[0]), 'product card has “Questions? Message the seller”')
_, out = inbound(C, 'Rahul', tap(buttons(out[0])[0]))
_, out = inbound(C, 'Rahul', tap('qty:1'))
_, out = inbound(C, 'Rahul', text('B-12 Sector 15 Noida 201301'))
_, out = inbound(C, 'Rahul', text(f'Order #{drop2}'))
_, out = inbound(C, 'Rahul', tap(buttons(out[0])[0]))
cta = next((m for m in out if m.get('interactive', {}).get('type') == 'cta_url'), None)
check(cta is not None and 'Chanderi' in body(cta) and 'Hawas Kobra' in body(cta), 'second product joins: one summary with both items (no address asked again)')
check(bool(re.search(r'₹3,398\.\d\d', body(cta) if cta else '')), 'one total for both, unique paise taken off the price')
_, out = inbound(C, 'Rahul', text('more'))
rows = [r['id'] for m in out for sec in m.get('interactive', {}).get('action', {}).get('sections', []) for r in sec['rows']]
check(m_ok := (out and out[0].get('interactive', {}).get('type') == 'list'), '“more” shows the shop’s other items as a list')
_, out = inbound(C, 'Rahul', {'type': 'interactive', 'interactive': {'type': 'list_reply', 'list_reply': {'id': rows[0], 'title': 'x'}}}) if rows else (0, [])
check(bool(out) and any(m.get('interactive', {}).get('type') == 'button' for m in out), 'tapping an item opens its product card')

print('seller forgot PIN: reset over WhatsApp, no template')
s, _, rp = req(APP + '/reset')
check(s == 200 and b'wa.me/919000000000?text=RESET' in rp, 'reset page sends the seller to WhatsApp with "RESET PIN"')
_, out = inbound('919811111111', 'Stranger', text('RESET PIN'))
check(bool(out) and 'doesn’t have a NukkadSale shop' in body(out[-1]), 'a number without a shop gets no code')
_, out = inbound('919876543210', 'Meera', text('reset pin'))
m = re.search(r'\*(\d{6})\*', body(out[-1])) if out else None
check(bool(m) and out[-1].get('type') == 'text', 'seller gets a 6-digit code as a normal reply (no template)')
_, out2 = inbound('919876543210', 'Meera', text('RESET PIN'))
check(bool(out2) and 'just sent you a code' in body(out2[-1]), 'asking again within a minute: told to use the code already sent')
s, h, _ = form('/reset/verify', {'phone': '9876543210', 'code': '000000', 'pin': '5678'})
check('err=' in (h['Location'] or ''), 'wrong code refused')
s, h, _ = form('/reset/verify', {'phone': '9876543210', 'code': m.group(1) if m else '', 'pin': '5678'})
check('ok=' in (h['Location'] or ''), 'right code sets the new PIN')
s, h, _ = form('/login', {'phone': '9876543210', 'pin': '5678'})
check(h['Location'] and h['Location'].startswith('/app'), 'seller logs in with the new PIN')

print('ALL PASSED' if not fails else f'{fails} FAILED')
sys.exit(1 if fails else 0)
