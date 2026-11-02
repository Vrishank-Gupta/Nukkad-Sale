// Captures real app screens (local app, showcase data) for social content.
import { chromium } from 'playwright'
import fs from 'node:fs'
const B = 'http://localhost:8787', OUT = process.argv[2], SC = process.argv[3]
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-IN' }
const shot = (p, n, full = false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full })
// Sale ids from the showcase run (they change with every fresh database): KURTA=… DUP=… node capture.mjs …
const KURTA = process.env.KURTA || 'zv3hfzk', DUP = process.env.DUP || 'fc286vd', OUD = process.env.OUD || 'g659npa'

// fresh buyers on their own phones
let ip = 60
async function buyer(drop, who, size, claim) {
  const c = await browser.newContext({ ...phone, extraHTTPHeaders: { 'cf-connecting-ip': '10.7.0.' + ip++ } })
  const b = await c.newPage()
  await b.goto(`${B}/d/${drop}`)
  if (size && (await b.locator(`.pills label:text-is("${size}")`).count())) await b.locator(`.pills label:text-is("${size}")`).click()
  if (await b.locator('#details').isVisible()) { await b.fill('#name', who[0]); await b.fill('#phone', who[1]); await b.fill('#address', who[2]); await b.fill('#pincode', who[3]) }
  await b.locator('#paybtn').click(); await b.waitForURL(/\/o\//)
  if (claim) await b.locator('#ipaid').click()
  await b.waitForTimeout(400)
  return { c, b }
}
const b1 = await buyer(KURTA, ['Priya Nair', '9822001122', '14 MG Road, Kochi', '682016'], 'L', true)
await shot(b1.b, 'buyer-order')
await b1.b.evaluate(() => window.scrollTo(0, 0)); await shot(b1.b, 'buyer-order-top')
const b2 = await buyer(DUP, ['Sana Qureshi', '9822003344', '7 Park Street, Kolkata', '700016'], null, true)
const b3 = await buyer(KURTA, ['Kavya Rao', '9822005566', '22 Jayanagar, Bengaluru', '560041'], 'S', false)
await shot(b3.b, 'buyer-pay')   // pay page before paying: exact amount + piece kept for 10:00
await b3.b.goto(`${B}/d/${KURTA}`); await b3.b.waitForTimeout(500); await shot(b3.b, 'buyer-sale')
await shot(b3.b, 'buyer-sale-full', true)

// seller
const ctx = await browser.newContext({ ...phone, extraHTTPHeaders: { 'cf-connecting-ip': '10.7.1.1' } })
await ctx.addInitScript(() => {
  if (!navigator.canShare) Object.defineProperty(navigator, 'canShare', { value: () => true })
  if (!navigator.share) Object.defineProperty(navigator, 'share', { value: () => Promise.resolve() })
})
const s = await ctx.newPage()
async function login(phoneNo, pin) {
  await s.goto(B + '/login'); await s.fill('#phone', phoneNo); await s.fill('#pin', pin)
  await s.locator('form button[type=submit]').first().click(); await s.waitForURL(/\/app/)
}
await login('9876543210', '4321')
await s.goto(B + '/app'); await s.waitForTimeout(600); await shot(s, 'home')
await s.goto(B + '/app/orders?tab=check'); await s.waitForTimeout(600); await shot(s, 'orders-check')
await s.goto(B + '/app/orders'); await s.waitForTimeout(600); await shot(s, 'orders-send')
await s.goto(B + '/app/khata'); await s.waitForTimeout(600); await shot(s, 'khata')
await s.goto(B + '/app/buyers'); await s.waitForTimeout(600); await shot(s, 'buyers')
await s.goto(`${B}/app/drops/${KURTA}?new=1`); await s.waitForTimeout(800); await shot(s, 'sale-live')
await s.goto(B + '/app/drops/new'); await s.waitForTimeout(400)
await s.setInputFiles('#image', [SC + '/kurta1.jpg', SC + '/kurta2.jpg', SC + '/kurta3.jpg']); await s.waitForTimeout(1200)
await s.fill('#title', 'Chanderi silk kurta – mustard'); await s.fill('#description', 'Pure Chanderi silk, hand block print.'); await s.fill('#price', '799')
await shot(s, 'newsale'); await s.locator('label[for=hs1]').click(); await s.waitForTimeout(500)
await s.locator('#sizelist').scrollIntoViewIfNeeded(); await shot(s, 'newsale-sizes')
// Hindi
await s.goto(B + '/app'); await s.locator('a.lang[href^="/lang"]').first().click(); await s.waitForTimeout(800)
await s.goto(B + '/app'); await s.waitForTimeout(600); await shot(s, 'home-hi')
await s.goto(B + '/app/khata'); await s.waitForTimeout(600); await shot(s, 'khata-hi')
await s.goto(B + '/app/orders?tab=check'); await s.waitForTimeout(600); await shot(s, 'orders-check-hi')
await s.goto(B + '/app'); await s.locator('a.lang[href^="/lang"]').first().click(); await s.waitForTimeout(600)
// big seller
await s.goto(B + '/app/settings'); await s.locator('form[action="/logout"] button, button:has-text("Log out")').first().click(); await s.waitForURL(/login/)
await login('9700000123', '2468')
await s.goto(B + '/app/orders'); await s.waitForTimeout(600); await shot(s, 'big-orders')
await s.goto(B + '/app'); await s.waitForTimeout(600); await shot(s, 'big-home')

// WhatsApp chat (re-created from the bot's real messages)
const c = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
await c.goto('file://' + SC + '/chat-1.html')
for (const [t, n] of [[5, 'chat-group'], [13.5, 'chat-product'], [20.5, 'chat-address'], [28, 'chat-pay'], [33, 'chat-more']]) {
  await c.waitForTimeout(t * 1000 - (Date.now() - (c._t ??= Date.now())))
  await c.screenshot({ path: `${OUT}/${n}.png` })
}
for (const x of [b1.c, b2.c, b3.c, ctx]) await x.close()
await browser.close()
console.log('ok')
