// Captures the newer screens for the website (storefront, cart offer, scheduled drop, discount, courier booking,
// buyer tracking) from the real app on a fresh database. App running locally with
//   --var OPEN_SIGNUP:1 --var SHIPROCKET_API_BASE:http://localhost:8795   and tests/e2e/mock_shiprocket.py
//   node tests/e2e/social/capture-site.mjs <out-dir>
// Then: for f in <out-dir>/*.png; do cwebp -quiet -resize 540 0 -q 80 "$f" -o public/site/$(basename "$f" .png).webp; done
import { chromium } from 'playwright'
import fs from 'node:fs'
const B = process.env.BASE || 'http://localhost:8787', SR = 'http://localhost:8795', OUT = process.argv[2]
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN' }
let ip = 30
const ctx = () => b.newContext({ ...phone, extraHTTPHeaders: { 'cf-connecting-ip': '10.9.0.' + ip++ } })
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` })
const top = async (p, sel, off = 70) => { await p.locator(sel).first().evaluate((e, off) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - off), off); await p.waitForTimeout(250) }

// Product photos, same illustrated style as the rest of the site.
async function photo(name, emoji, bg) {
  const p = await b.newPage({ viewport: { width: 900, height: 900 } })
  await p.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${bg}"><div style="font-size:500px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.25))">${emoji}</div></body>`)
  const f = `${OUT}/_${name}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 85 }); await p.close(); return f
}
const P = {
  kurta: await photo('kurta', '👗', 'radial-gradient(circle at 30% 30%,#ffe8a3,#f4a259)'),
  kurta2: await photo('kurta2', '👚', 'radial-gradient(circle at 70% 30%,#ffd6e0,#e76f8a)'),
  saree: await photo('saree', '🥻', 'radial-gradient(circle at 30% 30%,#e3dcff,#7a64d8)'),
  saree2: await photo('saree2', '🥻', 'radial-gradient(circle at 60% 40%,#d3f0e0,#4fa37a)'),
  dupatta: await photo('dupatta', '🧣', 'radial-gradient(circle at 30% 30%,#ffe3cf,#e2560c)'),
  ring: await photo('ring', '💍', 'radial-gradient(circle at 30% 30%,#fff3d1,#d9a441)'),
  bag: await photo('bag', '👜', 'radial-gradient(circle at 30% 30%,#f5e6da,#a0673f)'),
  lehenga: await photo('lehenga', '🥻', 'radial-gradient(circle at 30% 30%,#ffe9b0,#c2255c)'),
}

// ---- Seller sets up the shop (through the real endpoints)
const sc = await ctx(), s = await sc.newPage()
const post = (path, form) => s.request.post(B + path, { headers: { Origin: B }, form, maxRedirects: 0 })
const file = (f) => ({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(f) })
await post('/signup', { name: 'Asha Mehta', shop: 'Asha Collections', phone: '9876500011', vpa: 'asha@ybl', paywant: 'manual', pin: '4321' })
await post('/app/shoplink', { slug: 'asha-collections' })
async function sale(fields, img) {
  const r = await s.request.post(B + '/app/drops/new', { headers: { Origin: B }, multipart: { ...fields, image: file(img) }, maxRedirects: 0 })
  return r.headers()['location'].match(/drops\/([a-z0-9]+)/)[1]
}
const sized = { has_sizes: '1', max: '3' }
const later = new Date(Date.now() + 5.5 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10) + 'T19:00'   // 7 pm, day after tomorrow (IST)
// Created oldest first: the storefront lists the newest first.
await sale({ title: 'Oxidised silver ring', price: '349', category: 'Jewellery', stock: '12', max: '3' }, P.ring)
await sale({ title: 'Jute tote bag', price: '499', category: 'Bags', stock: '8', max: '2' }, P.bag)
const dup = await sale({ title: 'Bandhani dupatta', price: '599', category: 'Dupattas', stock: '10', max: '2' }, P.dupatta)
await sale({ title: 'Kanjivaram silk saree', price: '2499', category: 'Sarees', stock: '3', max: '1' }, P.saree2)
const saree = await sale({ title: 'Chanderi cotton saree', price: '1299', category: 'Sarees', stock: '5', max: '2' }, P.saree)
await s.request.post(B + '/app/drops/new', { headers: { Origin: B }, multipart: { title: 'Rayon printed kurti', price: '649', category: 'Kurtis', ...sized, size_label: 'M', size_qty: '4', image: file(P.kurta2) }, maxRedirects: 0 })
const kurta = await sale({ title: 'Mul cotton kurta set', price: '999', category: 'Kurtis', ...sized, size_label: 'M', size_qty: '5', image: file(P.kurta) }, P.kurta)
const soon = await sale({ title: 'Banarasi silk saree – Diwali drop', price: '3499', category: 'Sarees', stock: '4', max: '1', live_at: later }, P.lehenga)
await post(`/app/drops/${kurta}/discount`, { price: '799' })
await post('/app/cartoffer', { min: '1500', off: '150' })
await post('/app/ship/connect', { email: 'seller@test.in', password: 'secret123' })

// ---- Buyer: storefront, then a cart that crosses the offer
const bc = await ctx(), p = await bc.newPage()
await p.goto(`${B}/asha-collections`); await p.waitForTimeout(400); await shot(p, 'storefront')
await p.goto(`${B}/d/${kurta}`); await p.waitForTimeout(300); await shot(p, 'discount')
await p.goto(`${B}/asha-collections`)
await p.locator('.sfcard', { hasText: 'Mul cotton kurta set' }).locator('[data-add]').click()
await p.locator('#sizesheet [data-sz] button', { hasText: 'M' }).click()
await p.locator('.sfcard', { hasText: 'Chanderi cotton saree' }).locator('[data-add]').click()
await p.waitForTimeout(300); await p.locator('#cartbar').click(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(300)
await shot(p, 'cart')
const dp = await (await ctx()).newPage(); await dp.goto(`${B}/d/${soon}`); await dp.waitForTimeout(1200); await shot(dp, 'drop-soon')

// ---- A paid order, booked with a courier, on its way
const v = (await (await s.request.get(`${B}/app/drops/${dup}`)).text()).match(/name="variant" value="(\d+)"/)
const oc = await ctx(), o = await oc.newPage()
await o.goto(`${B}/d/${dup}`)
if (await o.locator('#details').isVisible()) { await o.fill('#name', 'Priya Nair'); await o.fill('#phone', '9822001122'); await o.fill('#address', '14 MG Road, Indiranagar, Bengaluru'); await o.fill('#pincode', '560038') }
await o.locator('#paybtn').click(); await o.waitForURL(/\/o\//)
const key = new URL(o.url()).pathname.slice(3)
await post(`/app/orders/${key}/received`, {})
await s.goto(`${B}/app/ship/book/${key}`); await s.waitForTimeout(300); await top(s, 'h2:has-text("courier")', 230); await shot(s, 'ship-book')
await post(`/app/ship/book/${key}`, { courier: '20', pin: '560038', g: '400', city: 'Bengaluru', state: 'Karnataka' })
const awb = (await (await s.request.get(`${B}/app/orders?tab=send`)).text()).match(/AWB (\d{6,})/)?.[1]
const day = (n, hm) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10) + ' ' + hm + ':00'
for (const [st, act, loc, at] of [['PICKED UP', 'Picked up from seller', 'Pune', day(-2, '17:40')], ['IN TRANSIT', 'Reached Hyderabad hub', 'Hyderabad', day(-1, '06:15')], ['OUT FOR DELIVERY', 'Out for delivery', 'Bengaluru', day(0, '09:05')]])
  await fetch(SR + '/_track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ awb, status: st, activity: act, location: loc, date: at }) })
const sid = (await (await s.request.get(`${B}/app/orders?tab=all`)).text()).match(/\/app\/ship\/([a-z0-9-]+)\/refresh/)?.[1]
await post(`/app/ship/${sid}/refresh`, {})
await o.goto(`${B}/o/${key}`); await o.waitForTimeout(300); await top(o, '.card:has-text("Track your parcel")', 150); await shot(o, 'track')
await b.close()
for (const f of fs.readdirSync(OUT)) if (f.startsWith('_')) fs.unlinkSync(`${OUT}/${f}`)
console.log('site shots done', { awb, v: Boolean(v) })
