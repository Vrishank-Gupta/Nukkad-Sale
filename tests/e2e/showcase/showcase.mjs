// Records the full product showcase (small seller → buyer → running the shop → big seller)
// as one continuous phone session, logging scene + section start times for captioning.
// Needs the app running with the WA_* and RAZORPAY_API_BASE test vars and mock_razorpay.py
// (see tests/e2e/README.md), on an empty database with default_modes = direct,razorpay.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const B = process.env.BASE || 'http://localhost:8787', OUT = process.env.OUT
const HERE = path.dirname(new URL(import.meta.url).pathname)
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN' }

async function makePhoto(file, emoji, bg, size = 520) {
  const p = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await p.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${bg}"><div style="font-size:${size}px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.25))">${emoji}</div></body>`)
  await p.screenshot({ path: file, type: 'jpeg', quality: 85 }); await p.close()
}
await makePhoto(OUT + '/kurta1.jpg', '👗', 'radial-gradient(circle at 30% 30%,#ffe8a3,#f4a259)')
await makePhoto(OUT + '/kurta2.jpg', '👗', 'radial-gradient(circle at 70% 30%,#ffd6e0,#e76f8a)', 440)
await makePhoto(OUT + '/kurta3.jpg', '👗', 'radial-gradient(circle at 50% 70%,#d3f0e0,#4fa37a)', 380)
await makePhoto(OUT + '/dupatta.jpg', '🧣', 'radial-gradient(circle at 30% 30%,#e3dcff,#7a64d8)')
await makePhoto(OUT + '/perfume.jpg', '🧴', 'radial-gradient(circle at 30% 30%,#d7ecff,#2f5fa8)')
const CHAT_TEMPLATE = fs.readFileSync(path.join(HERE, 'chat-template.html'), 'utf8')

// ---- Real WhatsApp bot conversation (through the real webhook, replies captured from the Meta mock) ----
const META = process.env.META || 'http://localhost:8791'
const APP_SECRET = process.env.WA_APP_SECRET || 'app-secret'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const metaSent = async () => (await fetch(META + '/_sent')).json()
let waNo = 0
async function waSay(from, name, message) {
  const before = (await metaSent()).length
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messaging_product: 'whatsapp', contacts: [{ wa_id: from, profile: { name } }],
    messages: [{ from, id: 'wamid.showcase.' + ++waNo, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] })
  const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')
  await fetch(B + '/webhooks/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body })
  let last = -1, stable = 0
  for (let i = 0; i < 80; i++) { await sleep(150); const n = (await metaSent()).length; if (n > before && n === last) { if (++stable >= 4) break } else stable = 0; last = n }
  return (await metaSent()).slice(before).filter((m) => m.to === from)
}
const buttonsOf = (m) => m?.interactive?.action?.buttons?.map((b) => b.reply) ?? []
const rowsOf = (m) => m?.interactive?.action?.sections?.flatMap((x) => x.rows) ?? []
// Writes a chat page that plays these events; events with at < 0 show instantly as context.
function chatPage(file, events, group = null) {
  // With the group intro, the chat starts after it; the first buyer message is the pre-typed order, sent with one tap.
  let t = group ? group.dur + 2.6 : 0.6
  if (group && events[0]?.who === 'me') events[0].clearTyped = true
  for (const ev of events) {
    if (ev.at !== undefined) continue
    ev.at = t
    const len = ev.who === 'me' ? 0 : JSON.stringify(ev.msg).length
    t += ev.who === 'me' ? 1.3 : ev.msg.type === 'image' ? 0.6 : Math.min(3.2, 1.1 + len / 260)
  }
  fs.writeFileSync(file, CHAT_TEMPLATE.replace('/*EVENTS*/[]', JSON.stringify(events)).replace('/*GROUP*/null', JSON.stringify(group)))
  return t + 2.2
}

const local = B.includes('localhost')
const ctx = await browser.newContext({ ...phone, recordVideo: { dir: OUT + '/raw', size: { width: 390, height: 844 } }, extraHTTPHeaders: local ? { 'cf-connecting-ip': '10.5.0.1' } : {} })
// Show a touch ripple wherever the demo "taps", so viewers can follow along.
await ctx.addInitScript(() => {
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(217,72,15,.35);border:2px solid rgba(217,72,15,.8);pointer-events:none;z-index:99999;transition:transform .5s,opacity .5s`
    document.documentElement.appendChild(d)
    requestAnimationFrame(() => { d.style.transform = 'scale(1.8)'; d.style.opacity = '0' })
    setTimeout(() => d.remove(), 600)
  }, true)
})
// Behave like a real phone browser that can share photos (Android Chrome / iPhone Safari), so the app
// itself decides to show its "Share on WhatsApp with photo" button. The app UI is never modified.
await ctx.addInitScript(() => {
  if (!navigator.canShare) Object.defineProperty(navigator, 'canShare', { value: () => true })
  if (!navigator.share) Object.defineProperty(navigator, 'share', { value: () => Promise.resolve() })
})
const s = await ctx.newPage()
const t0 = Date.now()
const scenes = []
const scene = (key, section) => scenes.push({ key, section, t: (Date.now() - t0) / 1000 })
const pause = (ms) => s.waitForTimeout(ms)
async function show(loc) { await loc.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' })); await pause(650) }
async function type(sel, text) { const l = s.locator(sel); await show(l); await l.click(); await l.pressSequentially(text, { delay: 45 }) }
async function tap(loc) { await show(loc); await loc.click() }
async function scrollTo(y) { await s.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y); await pause(1000) }
const photo = (f) => ({ name: path.basename(f), mimeType: 'image/jpeg', buffer: fs.readFileSync(f) })
// Off-camera helper: create a sale through the real form endpoint with the current seller's session.
async function createSale(fields, photos) {
  const r = await s.request.post(B + '/app/drops/new', { headers: { Origin: B }, multipart: { ...fields, image: photo(photos[0]) }, maxRedirects: 0 })
  return r.headers()['location'].match(/drops\/([a-z0-9]+)/)[1]
}
// Off-camera buyers on their own "phones".
let ipN = 20
async function offBuyer(dropIds, who, size, claim) {
  const c = await browser.newContext({ ...phone, extraHTTPHeaders: local ? { 'cf-connecting-ip': '10.5.0.' + ipN++ } : {} })
  const b = await c.newPage()
  for (const id of dropIds) {
    await b.goto(`${B}/d/${id}`)
    if (size && (await b.locator(`.pills label:text-is("${size}")`).count())) await b.locator(`.pills label:text-is("${size}")`).click()
    if (await b.locator('#details').isVisible()) { await b.fill('#name', who.name); await b.fill('#phone', who.phone); await b.fill('#address', who.address); await b.fill('#pincode', who.pin) }
    await b.locator('#paybtn').click(); await b.waitForURL(/\/o\//)
  }
  if (claim) await b.locator('#ipaid').click()
  await b.waitForTimeout(300); await c.close()
}

// ================= SMALL SELLER =================
scene('s-signup', 'small')
await s.goto(B + '/signup'); await pause(1500)
await type('#name', 'Meera Shah'); await type('#shop', 'Meera Boutique'); await type('#phone', '9876543210'); await type('#vpa', 'meeraboutique@ybl')
await show(s.locator('input[name=paywant][value=manual]')); await pause(1600)
await type('#pin', '4321'); await pause(400)
await tap(s.getByRole('button', { name: /Create my shop/ })); await s.waitForURL(/\/app/)

scene('s-home', 'small')
await pause(3000)

scene('s-upi', 'small')
await s.goto(B + '/app/settings'); await pause(1200)
await tap(s.locator('summary', { hasText: 'Add UPI ID' })); await pause(500)
await type('form[action="/app/upi/add"] input[name=vpa]', 'meera.personal@okhdfcbank'); await type('form[action="/app/upi/add"] input[name=label]', 'Personal GPay')
await tap(s.locator('form[action="/app/upi/add"] button[type=submit]')); await pause(1200)
await show(s.locator('h2', { hasText: 'Your UPI IDs' })); await pause(2200)

scene('s-newsale', 'small')
await s.goto(B + '/app/drops/new'); await pause(900)
await s.setInputFiles('#image', [OUT + '/kurta1.jpg', OUT + '/kurta2.jpg', OUT + '/kurta3.jpg']); await pause(1800)
await type('#title', 'Chanderi silk kurta – mustard'); await type('#description', 'Pure Chanderi silk, hand block print.')
await type('#price', '799')
await tap(s.locator('label[for=hs1]')); await pause(900)
const rows = s.locator('#sizelist .sizerow')
for (const [i, q] of [[0, 2], [1, 3], [2, 2]]) { const plus = rows.nth(i).locator('[data-step="1"]'); for (let k = 1; k < q; k++) { await tap(plus); await pause(220) } }
await show(s.locator('select[name=upi]')); await pause(1600)
await tap(s.getByRole('button', { name: /Publish/ })); await s.waitForURL(/drops\/.+new=1/)
const kurta = s.url().match(/drops\/([a-z0-9]+)/)[1]

scene('s-share', 'small')
await pause(1600)
await show(s.locator('#sharetext')); await pause(2200)
await show(s.locator('[data-share-photos]')); await pause(1600)
await tap(s.getByRole('button', { name: 'Copy message' })); await pause(1600)
// The exact caption and cover photo the app generated – reused for the group post in the buyer chapter.
const shareCaption = await s.locator('#sharetext').innerText()
const shareImage = B + (await s.locator('[data-share-photos]').getAttribute('data-share-photos').then((v) => JSON.parse(v)[0]))
const dupatta = await createSale({ title: 'Block print dupatta', price: '499', stock: '4', max: '2', description: 'Soft mulmul, hand block print.' }, [OUT + '/dupatta.jpg'])

// Off camera: Priya orders through the REAL bot – two products, one payment.
const P = '919811122233', PN = 'Priya Nair'
const chat = []
const me = (text) => chat.push({ who: 'me', text })
const bot = (ms) => { for (const m of ms) chat.push({ who: 'bot', msg: m }) }
let r
me(`Order #${kurta} – Chanderi silk kurta – mustard`); r = await waSay(P, PN, { type: 'text', text: { body: `Order #${kurta} – Chanderi silk kurta – mustard` } }); bot(r)
const card = r.findLast((m) => buttonsOf(m).length)
const sizeM = buttonsOf(card).find((b) => b.title === 'M')
me('M'); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'button_reply', button_reply: sizeM } }); bot(r)
const q1 = buttonsOf(r.at(-1)).find((b) => b.id === 'qty:1')
if (q1) { me(q1.title); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'button_reply', button_reply: q1 } }); bot(r) }
const addr = 'Flat 402, Lotus Residency, Baner Road, Pune 411045'
me(addr); r = await waSay(P, PN, { type: 'text', text: { body: addr } }); bot(r)
me('more'); r = await waSay(P, PN, { type: 'text', text: { body: 'more' } }); bot(r)
const row = rowsOf(r.at(-1)).find((x) => x.title.startsWith('Block print'))
me(row.title); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: row.id, title: row.title } } }); bot(r)
const buyNow = buttonsOf(r.findLast((m) => buttonsOf(m).length)).find((b) => b.id.startsWith('size:'))
me(buyNow.title); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'button_reply', button_reply: buyNow } }); bot(r)
const q2 = buttonsOf(r.at(-1)).find((b) => b.id === 'qty:1')
if (q2) { me(q2.title); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'button_reply', button_reply: q2 } }); bot(r) }
const paid = buttonsOf(r.at(-1)).find((b) => b.id.startsWith('paid:'))
me(paid.title); r = await waSay(P, PN, { type: 'interactive', interactive: { type: 'button_reply', button_reply: paid } }); bot(r)
const GROUP_DUR = 6.5
const prefill = chat[0].text
const chat1Len = chatPage(OUT + '/chat-1.html', chat, { shop: 'Meera Boutique', caption: shareCaption, image: shareImage, prefill, dur: GROUP_DUR })
fs.writeFileSync(OUT + '/chat-1.json', JSON.stringify(chat, null, 1))

// ================= BUYER =================
scene('b-group', 'buyer')
await s.goto('file://' + OUT + '/chat-1.html'); await pause(GROUP_DUR * 1000 + 300)
scene('b-chat', 'buyer')
await pause(chat1Len * 1000 - GROUP_DUR * 1000 - 300)

scene('b-web', 'buyer')
await s.goto(`${B}/d/${kurta}`); await pause(1800)
await s.locator('[data-gallery]').evaluate((g) => g.scrollTo({ left: g.clientWidth, behavior: 'smooth' })); await pause(1100)
await s.locator('[data-gallery]').evaluate((g) => g.scrollTo({ left: g.clientWidth * 2, behavior: 'smooth' })); await pause(1300)
await scrollTo(520); await tap(s.locator('.pills label:text-is("S")')); await pause(500)
await type('#name', 'Anjali Verma'); await type('#phone', '9822233344'); await type('#address', '12 Civil Lines, Jaipur'); await type('#pincode', '302006'); await pause(500)
await tap(s.locator('#paybtn')); await s.waitForURL(/\/o\//); await pause(2400)

scene('b-browse', 'buyer')
await tap(s.locator('a[href^="/s/"]').first()); await pause(2400)
await tap(s.locator('.shopgrid a', { hasText: 'Block print dupatta' })); await pause(2000)
await scrollTo(600); await pause(900)
await tap(s.locator('#paybtn')); await s.waitForURL(/\/o\//); await pause(2800)
await show(s.locator('[data-os=android] a')); await pause(1400)
await tap(s.locator('#ipaid')); await pause(2400)

// Off camera: a buyer still paying.
await offBuyer([kurta], { name: 'Kavya Rao', phone: '9833344455', address: '7 Indiranagar 2nd Stage, Bengaluru', pin: '560038' }, 'L', false)

// ================= RUNNING THE SHOP =================
scene('m-home', 'manage')
await s.goto(B + '/app'); await pause(2600); await scrollTo(560); await pause(1800); await scrollTo(0)

scene('m-check', 'manage')
await tap(s.locator('.task').first()); await pause(2600)
const sentBeforeConfirm = (await metaSent()).length
await tap(s.locator('.card.order', { hasText: 'Priya Nair' }).getByRole('button', { name: /Yes, I got it/ })); await pause(2200)
await tap(s.locator('.card.order', { hasText: 'Anjali Verma' }).getByRole('button', { name: /Yes, I got it/ })); await pause(1800)

scene('m-send', 'manage')
await s.goto(B + '/app/orders?tab=send'); await pause(1800)
await tap(s.locator('.card.order', { hasText: 'Priya Nair' }).getByRole('button', { name: /Mark as packed/ })); await pause(1800)
await tap(s.locator('summary', { hasText: 'Address' }).first()); await pause(1200)
await tap(s.getByRole('button', { name: 'Copy address' }).first()); await pause(1500)

// What Priya received in WhatsApp after the seller's two taps – the bot's real messages.
await sleep(1500)
const followUps = (await metaSent()).slice(sentBeforeConfirm).filter((m) => m.to === P)
const chat2Len = chatPage(OUT + '/chat-2.html', [...chat.slice(-2).map((e) => ({ ...e, at: -1 })), ...followUps.map((m) => ({ who: 'bot', msg: m }))])
scene('m-chat2', 'manage')
await s.goto('file://' + OUT + '/chat-2.html'); await pause(chat2Len * 1000)

scene('m-quick', 'manage')
await s.goto(B + '/app/quick-order'); await pause(1300)
await type('#phone', '9822200777'); await type('#name', 'Neha')
const steppers = s.locator('form .stepper')
await tap(steppers.nth(0).locator('[data-step="1"]')); await pause(400)
await tap(steppers.nth(2).locator('[data-step="1"]')); await pause(600)
await tap(s.getByRole('button', { name: /Make order/ })); await s.waitForURL(/quick-order\/done/); await pause(1400)
await show(s.locator('#qomsg')); await pause(2600)
await show(s.getByText('Send on WhatsApp')); await pause(1400)

scene('m-khata', 'manage')
await s.goto(B + '/app/khata'); await pause(1600)
await tap(s.getByText('You gave')); await pause(700)
await type('[name=amount]', '120'); await type('[name=note]', 'Delhivery courier')
await tap(s.getByRole('button', { name: 'Save' })); await pause(2200)

scene('m-buyers', 'manage')
await s.goto(B + '/app/buyers'); await pause(2800)

scene('m-again', 'manage')
await s.goto(`${B}/app/drops/${kurta}`); await pause(1200)
await tap(s.getByText('Sell again')); await pause(1600); await scrollTo(700); await pause(1400)

scene('m-hindi', 'manage')
await s.goto(B + '/app'); await pause(800)
await tap(s.locator('a.lang[href^="/lang"]')); await pause(2800)
await s.goto(B + '/app/orders?tab=send'); await pause(2200)
await tap(s.locator('a.lang[href^="/lang"]')); await pause(700)

scene('m-install', 'manage')
await s.goto(B + '/app'); await pause(600)
await s.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e) })
await pause(600); await show(s.locator('[data-install]').first()); await pause(2600)

// ================= BIG SELLER =================
scene('g-signup', 'big')
await s.goto(B + '/app/settings'); await tap(s.getByRole('button', { name: 'Log out' })); await s.waitForURL(/login/)
await s.goto(B + '/signup'); await pause(500)
await type('#name', 'Riya Kapoor'); await type('#shop', 'Riya Fragrances'); await type('#phone', '9700000123'); await type('#vpa', 'riyafragrances@ybl')
await tap(s.locator('input[name=paywant][value=auto]')); await pause(1300)
await type('#pin', '2468')
await tap(s.getByRole('button', { name: /Create my shop/ })); await s.waitForURL(/settings/); await pause(1800)

scene('g-connect', 'big')
await tap(s.locator('input[value=razorpay]')); await pause(900)
await type('[name=rzp_key]', 'rzp_test_2468ABCD'); await type('[name=rzp_secret]', 'rzp_test_secret_2468'); await pause(500)
await tap(s.locator('form[data-mode] button.big[type=submit]')); await pause(2200)
const perfume = await createSale({ title: 'Oud Intense EDP 100ml', price: '3100', stock: '5', max: '1', description: 'Long-lasting oud, sealed box.' }, [OUT + '/perfume.jpg'])

scene('g-buyer', 'big')
await s.goto(`${B}/d/${perfume}`); await pause(2000)
await scrollTo(600); await pause(1200)
await tap(s.locator('#paybtn')); await s.waitForURL(/localhost:8792|pay/); await pause(2600)
await tap(s.locator('#pay')); await s.waitForURL(/\/o\//); await pause(3600)

scene('g-seller', 'big')
await s.goto(B + '/app/orders'); await pause(2600)
await s.goto(B + '/app/orders?tab=check'); await pause(2000)
await s.goto(B + '/app'); await pause(2400)

scene('end', 'end')
await ctx.close()
const video = fs.readdirSync(OUT + '/raw').find((f) => f.endsWith('.webm'))
fs.writeFileSync(OUT + '/scenes.json', JSON.stringify({ video: OUT + '/raw/' + video, scenes }, null, 1))
await browser.close()
console.log(JSON.stringify(scenes.map((x) => [x.key, Math.round(x.t)])))
