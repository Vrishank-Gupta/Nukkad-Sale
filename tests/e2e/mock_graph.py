# Minimal stand-in for the Instagram Graph API content-publishing flow, for local tests only.
# Usage: python3 mock_graph.py   (listens on :8793; serves both graph and rupload paths)
# It checks what Instagram checks: bearer token, image_url reachable and JPEG, video uploaded before
# publishing, carousel children ready. GET /_published lists what was "posted".
import json, re, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
TOKEN = 'test-meta-token'; IG = '17841400000000001'
C = {}; PUBLISHED = []; N = [0]
PAGE = '555'; PAGE_TOKEN = 'test-page-token'; FB = []; FBV = {}; PHOTOS = {}
def nid():
    N[0] += 1; return f'1790000000{N[0]:04d}'
class H(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _err(self, msg, code=100): return self._json(400, {'error': {'message': msg, 'type': 'OAuthException', 'code': code}})
    def _auth(self, scheme='Bearer'):
        return self.headers.get('Authorization', '') == f'{scheme} {TOKEN}'
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
        if p == '/_published': return self._json(200, PUBLISHED)
        if p == '/_fb': return self._json(200, FB)
        if p == '/v23.0/me/accounts' and q.get('access_token') == TOKEN:   # Facebook Page lookup (token as a parameter)
            return self._json(200, {'data': [{'id': PAGE, 'name': 'NukkadSale', 'access_token': PAGE_TOKEN, 'instagram_business_account': {'id': IG}}]})
        if not self._auth(): return self._err('Invalid OAuth access token.', 190)
        if p == '/v23.0/me/accounts':
            return self._json(200, {'data': [{'id': '555', 'name': 'NukkadSale', 'instagram_business_account': {'id': IG, 'username': 'nukkadsale'}}]})
        if p == f'/v23.0/{IG}/content_publishing_limit':
            return self._json(200, {'data': [{'quota_usage': len(PUBLISHED), 'config': {'quota_total': 100, 'quota_duration': 86400}}]})
        m = re.fullmatch(r'/v23.0/(\d+)', p)
        if m and m.group(1) in C:
            c = C[m.group(1)]
            done = c['ready'] or (c.get('resumable') and c.get('uploaded'))
            return self._json(200, {'id': m.group(1), 'status_code': 'FINISHED' if done else 'IN_PROGRESS', 'status': 'Finished' if done else 'In progress'})
        if m and any(x['media_id'] == m.group(1) for x in PUBLISHED):
            return self._json(200, {'id': m.group(1), 'permalink': f'https://www.instagram.com/p/MOCK{m.group(1)[-4:]}/'})
        return self._err('Unsupported get request.', 100)
    def do_HEAD(self): self.send_response(404); self.end_headers()
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        p = urllib.parse.urlparse(self.path).path
        fm = re.fullmatch(r'/fb-video-upload/(\d+)', p)
        if fm:
            v = FBV.get(fm.group(1))
            if self.headers.get('Authorization') != f'OAuth {PAGE_TOKEN}' or not v: return self._json(401, {'success': False})
            if int(self.headers.get('file_size', -1)) != len(body) or body[4:8] != b'ftyp': return self._json(400, {'success': False})
            v['uploaded'] = True; return self._json(200, {'success': True})
        if p.startswith(f'/v23.0/{PAGE}/'):
            f = dict(urllib.parse.parse_qsl(body.decode()))
            if f.get('access_token') != PAGE_TOKEN: return self._err('Page token required', 190)
            edge = p.split('/')[-1]
            if edge == 'photos':
                try:
                    with urllib.request.urlopen(f['url'], timeout=10) as r:
                        if r.read()[:2] != b'\xff\xd8': return self._err('not a JPEG', 324)
                except Exception as e: return self._err(f'Could not fetch url: {e}', 324)
                i = nid(); PHOTOS[i] = f.get('published') != 'false'
                if PHOTOS[i]: FB.append({'kind': 'photo', 'id': i, 'message': f.get('message')})
                return self._json(200, {'id': i, 'post_id': f'{PAGE}_{i}'} if PHOTOS[i] else {'id': i})
            if edge == 'feed':
                kids = [json.loads(v)['media_fbid'] for k, v in f.items() if k.startswith('attached_media')]
                if len(kids) < 2 or not all(k in PHOTOS and not PHOTOS[k] for k in kids): return self._err('bad attached_media', 100)
                i = f'{PAGE}_{nid()}'; FB.append({'kind': 'album', 'id': i, 'photos': len(kids), 'message': f.get('message')}); return self._json(200, {'id': i})
            if edge == 'photo_stories':
                if f.get('photo_id') not in PHOTOS: return self._err('bad photo_id', 100)
                i = nid(); FB.append({'kind': 'photo_story', 'id': i}); return self._json(200, {'success': True, 'post_id': i})
            if edge in ('video_reels', 'video_stories'):
                if f.get('upload_phase') == 'start':
                    v = nid(); FBV[v] = {'edge': edge}; return self._json(200, {'video_id': v, 'upload_url': f'http://localhost:8793/fb-video-upload/{v}'})
                v = FBV.get(f.get('video_id'))
                if f.get('upload_phase') != 'finish' or not v or not v.get('uploaded') or v['edge'] != edge: return self._err('upload not finished', 100)
                FB.append({'kind': 'reel' if edge == 'video_reels' else 'video_story', 'id': f['video_id'], 'message': f.get('description')})
                return self._json(200, {'success': True, 'post_id': f['video_id']})
            return self._err('Unsupported page edge', 100)
        m = re.fullmatch(r'/ig-api-upload/v23.0/(\d+)', p)
        if m:
            if not self._auth('OAuth'): return self._json(401, {'debug_info': {'message': 'bad auth'}})
            c = C.get(m.group(1))
            if not c or not c.get('resumable'): return self._json(400, {'debug_info': {'message': 'no such container'}})
            if int(self.headers.get('file_size', -1)) != len(body) or self.headers.get('offset') != '0': return self._json(400, {'debug_info': {'message': 'bad size/offset'}})
            if body[4:8] != b'ftyp': return self._json(400, {'debug_info': {'message': 'not an MP4'}})
            c['uploaded'] = len(body); return self._json(200, {'success': True})
        if not self._auth(): return self._err('Invalid OAuth access token.', 190)
        f = dict(urllib.parse.parse_qsl(body.decode()))
        if p == f'/v23.0/{IG}/media':
            kind = f.get('media_type', 'IMAGE')
            for key in ('image_url', 'cover_url'):
                if key in f:
                    try:
                        with urllib.request.urlopen(f[key], timeout=10) as r:
                            data = r.read()
                            if r.headers.get('Content-Type') != 'image/jpeg' or data[:2] != b'\xff\xd8': return self._err(f'{key} is not a JPEG', 9004)
                    except Exception as e: return self._err(f'Could not fetch {key}: {e}', 9004)
            if kind == 'CAROUSEL':
                kids = f.get('children', '').split(',')
                if not (2 <= len(kids) <= 10) or not all(k in C and C[k].get('carousel_item') and C[k]['ready'] for k in kids): return self._err('Invalid carousel children', 100)
            if kind in ('REELS', 'STORIES') and f.get('upload_type') != 'resumable' and 'image_url' not in f: return self._err('video needs upload_type=resumable or video_url', 100)
            if len(f.get('caption', '')) > 2200: return self._err('Caption too long', 100)
            i = nid(); resumable = f.get('upload_type') == 'resumable'
            C[i] = {'kind': kind, 'caption': f.get('caption'), 'resumable': resumable, 'ready': not resumable, 'carousel_item': f.get('is_carousel_item') == 'true', 'cover': 'cover_url' in f}
            out = {'id': i}
            if resumable: out['uri'] = f'http://localhost:8793/ig-api-upload/v23.0/{i}'
            return self._json(200, out)
        if p == f'/v23.0/{IG}/media_publish':
            c = C.get(f.get('creation_id'))
            if not c: return self._err('Invalid creation_id', 100)
            if c['carousel_item']: return self._err('Carousel items cannot be published alone', 100)
            if c['resumable'] and not c.get('uploaded'): return self._err('Media not ready', 9007)
            mid = nid(); PUBLISHED.append({'media_id': mid, 'kind': c['kind'], 'caption': c['caption'], 'cover': c['cover']})
            return self._json(200, {'id': mid})
        return self._err('Unsupported post request.', 100)
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', 8793), H).serve_forever()
