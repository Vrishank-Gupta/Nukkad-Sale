# End-to-end test of the marketing site → "Get started" request → admin creates the shop →
# seller logs in with the temporary PIN → changes it → admin resets it.
# Needs the app running locally WITHOUT OPEN_SIGNUP, with
#   --var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code
# Usage: python3 tests/e2e/leads_test.py [base_url]
import http.cookiejar, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
B = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8787'
UA = 'Mozilla/5.0 khatakhat-e2e'
ok = 0
def check(cond, what):
    global ok
    if not cond: print('FAIL:', what); sys.exit(1)
    ok += 1; print('ok  ', what)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def client():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)
    def go(path, data=None, ip='10.9.0.1'):
        h = {'User-Agent': UA, 'Origin': B}
        if B.startswith('http://localhost'): h['cf-connecting-ip'] = ip
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        req = urllib.request.Request(B + path, data=body, headers=h)
        try: r = op.open(req); return r.status, r.headers, r.read().decode(errors="replace")
        except urllib.error.HTTPError as e: return e.code, e.headers, e.read().decode(errors="replace")
    return go

phone = '98' + str(int(time.time()))[-8:]
anon = client()

# --- marketing site ---
s, h, body = anon('/')
check(s == 200 and 'Your online shop,' in body and 'id="get-started"' in body, 'landing page renders with the form')
check('/signup' not in body, 'landing page has no self-signup link')
s, h, _ = anon('/site/home.webp')
check(s == 200 and h['Content-Type'] == 'image/webp', 'site images are served as static files')
s, h, _ = anon('/signup')
check(s == 302 and h['Location'].endswith('/#get-started'), 'self-signup redirects to the request form')
s, h, body = anon('/login')
check('/#get-started' in body and 'href="/signup"' not in body, 'login page points new sellers to the form')

# --- the request form ---
s, h, _ = anon('/get-started', {'name': '', 'business': 'X', 'phone': ''})
check(s == 303 and 'err=' in h['Location'], 'missing fields are refused')
s, h, _ = anon('/get-started', {'name': 'A', 'business': 'B', 'phone': '12345'})
check(s == 303 and 'err=' in h['Location'], 'bad phone is refused')
s, h, _ = anon('/get-started', {'name': 'Bot', 'business': 'Spam', 'phone': phone, 'website': 'http://spam'})
check(s == 303 and h['Location'] == '/thanks', 'honeypot submissions are dropped quietly')
form = {'name': 'Neha Sharma', 'business': 'Neha Kurtis', 'phone': phone, 'city': 'Jaipur', 'sells': 'Kurtis', 'channel': 'wa_groups', 'volume': '50_200', 'payments': 'upi', 'message': 'Call after 6 pm'}
s, h, _ = anon('/get-started', form)
check(s == 303 and h['Location'] == f'/thanks?p={phone}', 'request accepted → thank-you page')
s, h, body = anon(h['Location'])
check(s == 200 and phone[:5] in body.replace(' ', ''), 'thank-you page shows their number')
s, h, _ = anon('/get-started', form)
q = lambda sql: subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'khatakhat', '--local', '--json', '--command', sql], capture_output=True, text=True).stdout
check(q(f"SELECT COUNT(*) AS n FROM leads WHERE phone = '91{phone}'").count('"n": 1') == 1, 'a repeat submission does not create a duplicate')
for i in range(6): last = anon('/get-started', {'name': 'R', 'business': 'R', 'phone': f'97{i:08d}'}, ip='10.9.9.9')
check('err=' in last[1]['Location'], 'more than 5 requests a day from one device are refused')

# --- admin: inbox → create shop ---
adm = client()
s, h, _ = adm('/admin/setup', {'phone': '9999999999', 'code': 'setup-code', 'pin': '135790'})
if s != 303 or '/admin?' not in h['Location']:
    s, h, _ = adm('/admin/login', {'phone': '9999999999', 'pin': '135790'})
check(s == 303, 'admin logged in')
s, h, body = adm('/admin')
check('new request' in body, 'dashboard shows new requests')
s, h, body = adm('/admin/leads')
lid = re.search(r'href="/admin/leads/(\d+)"[^>]*>\s*<div class="row between"><b>Neha Kurtis', body)
check(lid, 'request is listed in Admin → Requests')
lid = lid.group(1)
s, h, body = adm(f'/admin/leads/{lid}')
check('Kurtis' in body and 'wa.me/91' + phone in body and 'Create shop' in body, 'request page has details, WhatsApp link and create form')
s, h, _ = adm(f'/admin/leads/{lid}', {'note': 'Spoke, wants UPI', 'status': 'contacted'})
check(s == 303 and 'Contacted' in adm(f'/admin/leads/{lid}')[2], 'notes saved and marked contacted')
s, h, _ = adm('/admin/shops', {'lead': lid, 'name': 'Neha Sharma', 'shop': 'Neha Kurtis', 'phone': phone, 'vpa': 'bad'})
check(s == 303 and 'err=' in h['Location'], 'a bad UPI ID is refused')
s, h, body = adm('/admin/shops', {'lead': lid, 'name': 'Neha Sharma', 'shop': 'Neha Kurtis', 'phone': phone, 'vpa': 'nehakurtis@ybl'})
pin = re.search(r'letter-spacing:\.2em">(\d{4})<', body)
check(s == 200 and pin and 'Send login on WhatsApp' in body, 'shop created; PIN and WhatsApp message shown once')
pin = pin.group(1)
check(urllib.parse.quote(f'PIN: {pin}') in body or f'PIN%3A%20{pin}' in body, 'WhatsApp message contains the login details')
check('Shop created' in adm(f'/admin/leads/{lid}')[2], 'request marked "Shop created"')
s, h, body = adm('/admin/shops', {'name': 'X', 'shop': 'Y', 'phone': phone, 'vpa': 'other.shop@ybl'})
check(s == 303 and 'already has a shop' in urllib.parse.unquote(h['Location']), 'same number can’t get a second shop')

# --- seller: temporary PIN → change it ---
sel = client()
s, h, _ = sel('/login', {'phone': phone, 'pin': pin})
check(s == 303 and h['Location'] == '/app', 'seller logs in with the temporary PIN')
s, h, body = sel('/app')
# New sellers get the getting-started checklist, whose next step is "Set your own PIN" (linked to Settings).
check('Set your own PIN' in body and '/app/settings#pin' in body, 'home asks to change the temporary PIN (getting-started checklist)')
s, h, _ = sel('/app/pin', {'current': '0000', 'pin': '4826'})
check('err=' in h['Location'], 'wrong current PIN is refused')
s, h, _ = sel('/app/pin', {'current': pin, 'pin': pin})
check('err=' in h['Location'], 'same PIN is refused')
s, h, _ = sel('/app/pin', {'current': pin, 'pin': '482615'})
check('ok=' in h['Location'], 'PIN changed')
check('using the PIN we gave you' not in sel('/app')[2], 'reminder gone after changing the PIN')
check(client()('/login', {'phone': phone, 'pin': '482615'})[0] == 303, 'new PIN works')

# --- admin: reset PIN ---
sid = re.search(r'/admin/sellers/([a-z0-9]+)', adm(f'/admin/leads/{lid}')[2]).group(1)
s, h, body = adm(f'/admin/sellers/{sid}/pin', {})
new = re.search(r'letter-spacing:\.2em">(\d{4})<', body).group(1)
check(s == 200 and new, 'admin reset shows a new PIN')
check(sel('/app')[0] == 302, 'reset logs the seller out everywhere')
check('err=' in client()('/login', {'phone': phone, 'pin': '482615'})[1].get('Location', ''), 'old PIN no longer works')
c2 = client(); s, h, _ = c2('/login', {'phone': phone, 'pin': new})
home = c2('/app')[2]
check(s == 303 and ('using the PIN we gave you' in home or 'Set your own PIN' in home), 'new temporary PIN works and asks for a new PIN again')
print(f'\nall {ok} checks passed')
