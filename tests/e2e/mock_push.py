# Stand-in for a browser push service (FCM/Mozilla/Apple), for local tests only.
# Records every push request; GET /_pushes returns them (body base64, headers). POST to /gone/* returns 410.
import base64, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
GOT = []
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path.startswith('/gone/'):
            self.send_response(410); self.end_headers(); return
        GOT.append({'path': self.path, 'headers': {k.lower(): v for k, v in self.headers.items()}, 'body': base64.b64encode(body).decode()})
        self.send_response(201); self.end_headers()
    def do_GET(self):
        b = json.dumps(GOT).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8794), H).serve_forever()
