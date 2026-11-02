# Copies the social-posting credentials from ~/.khatakhat into the GitHub Actions secrets used by
# .github/workflows/social.yml. Prints secret names only, never values.
# Usage: python3 -m venv /tmp/ghs && /tmp/ghs/bin/pip install pynacl && /tmp/ghs/bin/python scripts/social/set-github-secrets.py
# Uses the GitHub token from ~/.git-credentials (or GITHUB_TOKEN); it needs access to the repo's Actions secrets.
import base64, json, os, re, urllib.request
from nacl import encoding, public

REPO = 'Vrishank-Gupta/Nukkad-Sale'

def github_token():
    if os.environ.get('GITHUB_TOKEN'): return os.environ['GITHUB_TOKEN']
    for line in open(os.path.expanduser('~/.git-credentials')):
        m = re.match(r'https://[^:]+:([^@]+)@github\.com', line.strip())
        if m: return m.group(1)
    raise SystemExit('No GitHub token in ~/.git-credentials – set GITHUB_TOKEN')

def read_env(f):
    out = {}
    p = os.path.expanduser(f)
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
            if m: out[m.group(1)] = m.group(2).strip('\'"')
    return out

meta, yt = read_env('~/.khatakhat/meta.env'), read_env('~/.khatakhat/youtube.env')
vals = {k: v for k, v in {**meta, **yt}.items() if k in ('META_TOKEN', 'FB_PAGE_ID', 'FB_PAGE_TOKEN', 'YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN') and v}
tok = github_token()

def gh(method, path, body=None):
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}{path}', method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {tok}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')

_, key = gh('GET', '/actions/secrets/public-key')
box = public.SealedBox(public.PublicKey(key['key'].encode(), encoding.Base64Encoder()))
for name, value in vals.items():
    status, _ = gh('PUT', f'/actions/secrets/{name}', {'encrypted_value': base64.b64encode(box.encrypt(value.encode())).decode(), 'key_id': key['key_id']})
    print(f'{name}: {"set" if status in (201, 204) else status}')
missing = [k for k in ('META_TOKEN', 'YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN') if k not in vals]
if missing: print('Missing locally (not set):', ', '.join(missing))
