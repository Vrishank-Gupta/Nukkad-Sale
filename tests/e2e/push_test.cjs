// End-to-end test of order alerts (Web Push). Acts as the seller's browser: makes its own push
// keys, subscribes, then checks that what reaches the push service (mock_push.py on :8794)
// decrypts with an independent library (http_ece) and carries a valid VAPID signature – for the
// test alert, a new order, "I have paid" and a cash-on-delivery order, in English and Hindi.
// Also: invalid keys are refused, and a subscription the push service says is gone is removed.
// Needs: npm i http_ece (run with NODE_PATH pointing at it), mock_push.py, and the app running
// with OPEN_SIGNUP=1 and the test VAPID keys + PUSH_ALLOW_ANY=1 (see tests/e2e/README.md).
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ece = require('http_ece')
const B = process.argv[2] || 'http://localhost:8787', PUSH = 'http://localhost:8794'
let ok = 0
const check = (cond, what) => { if (!cond) { console.log('FAIL:', what); process.exit(1) } ok++; console.log('ok  ', what) }
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'khatakhat', '--local', '--json', '--command', q], { cwd: __dirname + '/../..' }).toString())[0].results
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client(ip) {
  let cookie = ''
  return async (path, opts = {}) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 khatakhat-e2e', Origin: B, 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) }
    const r = await fetch(B + path, { ...opts, headers, redirect: 'manual' })
    const sc = r.headers.getSetCookie?.() || []
    if (sc.length) cookie = [cookie, ...sc.map((c) => c.split(';')[0])].filter(Boolean).join('; ')
    return r
  }
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() })
const pushes = async () => (await fetch(PUSH + '/_pushes')).json()
function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  const auth = crypto.randomBytes(16)
  return { ecdh, auth, p256dh: ecdh.getPublicKey().toString('base64url'), authB64: auth.toString('base64url') }
}
function open(p, keys) {
  const plain = ece.decrypt(Buffer.from(p.body, 'base64'), { version: 'aes128gcm', privateKey: keys.ecdh, authSecret: keys.auth })
  return JSON.parse(plain.toString())
}
function vapidValid(p) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(p.headers.authorization || '')
  if (!m) return false
  const [h, b, s] = m[1].split('.')
  const pub = Buffer.from(m[2], 'base64url')
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  const claims = JSON.parse(Buffer.from(b, 'base64url'))
  return crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')) && claims.aud === PUSH && claims.exp > Date.now() / 1000
}
async function waitFor(n) { for (let i = 0; i < 40; i++) { const g = await pushes(); if (g.length >= n) return g; await sleep(250) } return pushes() }

;(async () => {
  const phone = '93' + String(Math.floor(1e7 + Math.random() * 9e7))
  const sel = client('10.1.0.1')
  await sel('/signup', form({ name: 'Push Seller', shop: 'Push Shop', phone, vpa: 'pushshop@ybl', paywant: 'manual', pin: '4321' }))
  const settings = await (await sel('/app/settings')).text()
  check(settings.includes('id="alerts"') && settings.includes('data-vapid='), 'Settings shows the order alerts card')

  const en = browserKeys()
  const sub = (keys, endpoint, lang = 'en') => sel('/app/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.authB64 } }, lang }) })
  check((await sub({ p256dh: 'short', authB64: 'x' }, PUSH + '/push/bad')).status === 400, 'invalid browser keys are refused')
  check((await sub(en, PUSH + '/push/en')).status === 200, 'subscription saved')

  const before = (await pushes()).length
  await sel('/app/push/test', form({}))
  let got = await waitFor(before + 1)
  const t1 = got[got.length - 1]
  check(t1.headers['content-encoding'] === 'aes128gcm' && t1.headers.ttl, 'push request uses aes128gcm with a TTL')
  check(vapidValid(t1), 'VAPID signature verifies, audience is the push service')
  const m1 = open(t1, en)
  check(m1.title === 'Order alerts are on' && m1.url === '/app/orders', 'test alert decrypts with an independent library')

  // A Hindi phone gets Hindi.
  const hi = browserKeys()
  await sub(hi, PUSH + '/push/hi', 'hi')

  // New order → alert on both phones
  const bd = '----kk' + Math.random().toString(36).slice(2)
  const parts = [['title', 'Silver anklet'], ['price', '650'], ['stock', '4'], ['max', '2'], ['description', 'x'], ['cod', '1']]
  const body = parts.map(([k, v]) => `--${bd}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${bd}--\r\n`
  const r = await sel('/app/drops/new', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${bd}` }, body })
  const drop = r.headers.get('location').match(/drops\/([a-z0-9]+)/)[1]
  const variant = sql(`SELECT id FROM variants WHERE drop_id = '${drop}'`)[0].id
  const buyer = client('10.1.0.2')
  let n0 = (await pushes()).length
  const or = await buyer(`/d/${drop}`, form({ variant, qty: '1', name: 'Meena Iyer', phone: '9812345678', address: '4 Anna Salai, Chennai', pincode: '600002' }))
  const oid = or.headers.get('location').slice(3)
  got = await waitFor(n0 + 2)
  const fresh = got.slice(n0)
  const enMsg = open(fresh.find((p) => p.path === '/push/en'), en), hiMsg = open(fresh.find((p) => p.path === '/push/hi'), hi)
  check(/^New order: Meena Iyer – Silver anklet ×1, ₹6\d\d\.\d\d$/.test(enMsg.body) && enMsg.url === '/app/orders?tab=check', `new order alert: "${enMsg.body}"`)
  check(hiMsg.body.startsWith('नया ऑर्डर: Meena Iyer'), `Hindi phone gets Hindi: "${hiMsg.body}"`)

  // "I have paid" → alert
  n0 = (await pushes()).length
  await buyer(`/o/${oid}/utr`, form({}))
  got = await waitFor(n0 + 2)
  const claim = open(got.slice(n0).find((p) => p.path === '/push/en'), en)
  check(/Meena Iyer says they paid ₹6\d\d\.\d\d – check your UPI app/.test(claim.body), `"I have paid" alert: "${claim.body}"`)

  // Cash on delivery → alert
  n0 = (await pushes()).length
  await client('10.1.0.3')(`/d/${drop}`, form({ variant, qty: '1', name: 'Ravi K', phone: '9812345699', address: '9 Park Road, Pune 411001', pincode: '411001', pay: 'cod' }))
  got = await waitFor(n0 + 2)
  const cod = open(got.slice(n0).find((p) => p.path === '/push/en'), en)
  check(cod.body === 'Cash-on-delivery order: Ravi K – Silver anklet ×1, ₹650' && cod.url === '/app/orders?tab=send', `COD alert: "${cod.body}"`)

  // A subscription the push service says is gone is removed
  const gone = browserKeys()
  await sub(gone, PUSH + '/gone/x')
  await sel('/app/push/test', form({}))
  await sleep(1500)
  check(sql(`SELECT COUNT(*) n FROM push_subs WHERE endpoint = '${PUSH}/gone/x'`)[0].n === 0, 'expired subscription (410) is deleted')
  console.log(`\nall ${ok} checks passed`)
})().catch((e) => { console.log('FAIL:', e.message); process.exit(1) })
