# Minimal stand-in for Razorpay's Payment Links API, for local end-to-end tests only.
# Usage: python3 mock_razorpay.py [signed|unsigned]   (unsigned = redirect without signature,
# to test that payments are still confirmed by asking the API)
import base64, hashlib, hmac, json, sys, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LINKS = {}
SIGNED = (sys.argv[1] if len(sys.argv) > 1 else 'signed') == 'signed'
class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _secret(self):
        a = self.headers.get('Authorization', '')
        if not a.startswith('Basic '): return None
        return base64.b64decode(a[6:]).decode().split(':', 1)[1]
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/v1/payment_links':
            secret = self._secret()
            if not secret: return self._json(401, {'error': {'description': 'auth'}})
            r = json.loads(body); lid = f'plink_{len(LINKS) + 1:04d}{int(time.time()) % 10000}'
            LINKS[lid] = {'id': lid, 'short_url': f'http://localhost:8792/pay/{lid}', 'status': 'created', 'amount': r['amount'], 'amount_paid': 0, 'payments': None,
                          'reference_id': r['reference_id'], '_cb': r.get('callback_url'), '_secret': secret}
            return self._json(200, {k: v for k, v in LINKS[lid].items() if not k.startswith('_')})
        if self.path.startswith('/pay/'):
            l = LINKS[self.path[5:]]; pid = 'pay_' + l['id'][6:]
            l.update(status='paid', amount_paid=l['amount'], payments=[{'payment_id': pid, 'status': 'captured'}])
            q = {'razorpay_payment_id': pid, 'razorpay_payment_link_id': l['id'], 'razorpay_payment_link_reference_id': l['reference_id'], 'razorpay_payment_link_status': 'paid'}
            if SIGNED:
                msg = f"{l['id']}|{l['reference_id']}|paid|{pid}"
                q['razorpay_signature'] = hmac.new(l['_secret'].encode(), msg.encode(), hashlib.sha256).hexdigest()
            self.send_response(303); self.send_header('Location', l['_cb'] + '?' + urllib.parse.urlencode(q)); self.end_headers()
    def do_GET(self):
        if self.path.startswith('/v1/payment_links?'):
            # Key check on save: the mock rejects secrets containing "wrong".
            secret = self._secret()
            if not secret or 'wrong' in secret: return self._json(401, {'error': {'code': 'BAD_REQUEST_ERROR', 'description': 'Authentication failed'}})
            return self._json(200, {'count': 0, 'payment_links': []})
        if self.path.startswith('/v1/payment_links/'):
            l = LINKS.get(self.path.rsplit('/', 1)[1])
            return self._json(200, {k: v for k, v in l.items() if not k.startswith('_')}) if l else self._json(404, {})
        if self.path.startswith('/pay/'):
            l = LINKS[self.path[5:]]; amt = f"{l['amount'] / 100:,.2f}".replace('.00', '')
            b = f'''<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1"><title>Secure checkout</title>
<style>body{{margin:0;font-family:system-ui,sans-serif;background:#f4f6fb;color:#1b2333}}header{{background:#0c2451;color:#fff;padding:18px 20px}}header small{{opacity:.75}}
main{{padding:18px}}.card{{background:#fff;border-radius:14px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)}}.amt{{font-size:30px;font-weight:800}}
label{{display:flex;gap:12px;align-items:center;padding:14px;border:2px solid #e3e8f2;border-radius:12px;margin:8px 0;font-weight:600}}label.on{{border-color:#3395ff;background:#eef6ff}}
button{{width:100%;padding:16px;font-size:18px;font-weight:800;color:#fff;background:#3395ff;border:0;border-radius:12px}}.test{{display:inline-block;background:#ffe8a3;color:#7a5200;font-size:12px;font-weight:800;padding:2px 8px;border-radius:99px}}</style></head>
<body><header><b>🔒 Secure checkout</b> <span class=test>TEST MODE</span><br><small>Payment gateway</small></header><main>
<div class=card><small>Amount to pay</small><div class=amt>₹{amt}</div></div>
<div class=card><b>Pay using</b><label class=on>📱 UPI – GPay, PhonePe, Paytm</label><label>💳 Debit / Credit card</label><label>🏦 Net banking</label></div>
<form method=post><button id=pay>Pay ₹{amt}</button></form></main></body></html>'''.encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8792), H).serve_forever()
