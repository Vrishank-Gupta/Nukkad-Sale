# Minimal stand-in for Meta's WhatsApp Cloud API (Graph), for local bot tests only.
import json, struct, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
SENT = []
def png():
    raw = b''.join(b'\x00' + b'\x20\xa0\x50' * 8 for _ in range(8))
    c = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + c(b'IHDR', struct.pack('>IIBBBBB', 8, 8, 8, 2, 0, 0, 0)) + c(b'IDAT', zlib.compress(raw)) + c(b'IEND', b'')
class H(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/_clear': SENT.clear(); return self._json({})
        if self.path.endswith('/messages'):
            if not self.headers.get('Authorization', '').startswith('Bearer '): return self._json({'error': 'auth'}, 401)
            SENT.append(json.loads(body)); return self._json({'messages': [{'id': f'wamid.{len(SENT)}'}]})
        self._json({}, 404)
    def do_GET(self):
        if self.path == '/_sent': return self._json(SENT)
        if self.path.startswith('/media/'):
            b = png(); self.send_response(200); self.send_header('Content-Type', 'image/png'); self.end_headers(); self.wfile.write(b); return
        mid = self.path.rsplit('/', 1)[-1]
        self._json({'url': f'http://localhost:8791/media/{mid}', 'mime_type': 'image/png'})
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8791), H).serve_forever()
