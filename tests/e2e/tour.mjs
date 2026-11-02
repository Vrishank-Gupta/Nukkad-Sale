// Walks the whole NukkadSale flow on a phone viewport. MODE=shots saves screenshots; MODE=video records a paced walkthrough.
import { chromium } from 'playwright'
import fs from 'node:fs'
const B = process.env.BASE || 'http://localhost:8787', OUT = process.env.OUT, VIDEO = process.env.MODE === 'video'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: VIDEO ? 1 : 2, isMobile: true, hasTouch: true, locale: 'en-IN' }

// Product photos rendered from HTML so the demo has real-looking images.
async function makePhoto(file, emoji, bg) {
  const p = await browser.newPage({ viewport: { width: 900, height: 900 } })
  await p.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${bg}"><div style="font-size:520px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.25))">${emoji}</div></body>`)
  await p.screenshot({ path: file, type: 'jpeg', quality: 85 }); await p.close()
}
await makePhoto(OUT + '/kurta.jpg', '👗', 'radial-gradient(circle at 30% 30%,#ffe8a3,#f4a259)')

let n = 0
const pause = (ms) => new Promise((r) => setTimeout(r, VIDEO ? ms : 150))
async function shot(page, name, full = false) { if (!VIDEO) await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full }) }
async function type(page, sel, text) { await page.locator(sel).click(); await page.locator(sel).pressSequentially(text, { delay: VIDEO ? 45 : 0 }) }
async function scroll(page, y) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y); await pause(900) }
const ctxOpts = (name) => ({ ...phone, ...(VIDEO ? { recordVideo: { dir: OUT + '/raw-' + name, size: { width: 390, height: 844 } } } : {}) })

// ---- Seller signs up ----
const sctx = await browser.newContext(ctxOpts('seller'))
const s = await sctx.newPage()
await s.goto(B + '/'); await pause(2500); await shot(s, 'landing')
// The website's "Get started" form is for production; with OPEN_SIGNUP the signup page is open directly.
await s.goto(B + '/signup'); await pause(800)
await type(s, '#name', 'Meera Shah'); await type(s, '#shop', 'Meera Boutique'); await type(s, '#phone', '9876543210')
await type(s, '#vpa', 'meeraboutique@ybl'); await s.locator('summary', { hasText: 'Where do I find' }).click(); await pause(1500)
await type(s, '#pin', '4321'); await shot(s, 'signup', true); await pause(600)
await s.getByRole('button', { name: /Create my shop/ }).click(); await s.waitForURL(/\/app$/); await pause(2500); await shot(s, 'home-empty')

// ---- Seller creates a sale ----
await s.locator('a.btn', { hasText: 'Create your first sale' }).click(); await pause(800)
await s.setInputFiles('#image', OUT + '/kurta.jpg'); await pause(1500)
await scroll(s, 380)
await type(s, '#title', 'Chanderi silk kurta – mustard'); await type(s, '#description', 'Pure Chanderi silk, hand block print. Ships in 2 days.')
await type(s, '#price', '799'); await scroll(s, 800)
await s.locator('label[for=hs1]').click(); await pause(900)
const rows = s.locator('#sizelist .sizerow')
// Enough stock for the tour's buyers + platforms.mjs + buyer.mjs.
for (const [i, q] of [[0, 5], [1, 5], [2, 4]]) { const plus = rows.nth(i).locator('[data-step="1"]'); for (let k = 1; k < q; k++) { await plus.click(); await pause(250) } }
await pause(800); await shot(s, 'new-sale', true)
await s.getByRole('button', { name: /Publish/ }).click(); await s.waitForURL(/drops\/.+new=1/); await pause(2500); await shot(s, 'sale-live', true)
await scroll(s, 300); await s.getByRole('button', { name: 'Copy message' }).click(); await pause(1800)
const dropUrl = (await s.locator('#link').inputValue()).replace('/w/', '/d/')

// ---- Buyers ----
async function buyer(name, ph, addr, size, ip, utr, record) {
  const ctx = await browser.newContext({ ...(record ? ctxOpts('buyer') : phone), extraHTTPHeaders: B.includes('localhost') ? { 'cf-connecting-ip': ip } : {} })
  const b = await ctx.newPage()
  await b.goto(dropUrl); await pause(2500); if (record) await shot(b, 'buyer-sale')
  await scroll(b, 500); await b.locator(`.pills label:text-is("${size}")`).click(); await pause(600)
  await type(b, '#name', name); await type(b, '#phone', ph); await type(b, '#address', addr); await type(b, '#pincode', addr.match(/\d{6}/)[0]); await pause(500)
  if (record) await shot(b, 'buyer-form', true)
  await b.locator('#paybtn').click(); await b.waitForURL(/\/o\//); await pause(2500); if (record) await shot(b, 'buyer-pay', true)
  if (utr !== null) {
    if (record) { await b.locator('summary', { hasText: 'Show QR' }).click(); await pause(2000); await scroll(b, 700) }
    await pause(600); await b.getByRole('button', { name: /I have paid/ }).click(); await pause(2500); if (record) await shot(b, 'buyer-verifying')
  }
  return { ctx, b }
}
const b1 = await buyer('Priya Nair', '9811122233', 'Flat 402, Lotus Residency, Baner Road, Pune 411045', 'M', '10.0.0.1', '412345678901', true)
const b2 = await buyer('Anjali Verma', '9822233344', '12 Civil Lines, Jaipur 302006', 'S', '10.0.0.2', '', false)
const b3 = await buyer('Kavya Rao', '9833344455', '7 Indiranagar 2nd Stage, Bengaluru 560038', 'L', '10.0.0.3', null, false)

// ---- Seller handles orders ----
await s.goto(B + '/app'); await pause(3000); await shot(s, 'home-tasks')
await s.locator('.task').first().click(); await pause(2500); await shot(s, 'orders-check', true)
await s.getByRole('button', { name: /Yes, I got it/ }).first().click(); await pause(2500); await shot(s, 'orders-after-yes')
// buyer 1 sees confirmation without refreshing
await b1.b.bringToFront?.(); await b1.b.waitForTimeout(VIDEO ? 0 : 6500)
await s.getByRole('button', { name: /Yes, I got it/ }).first().click(); await pause(2000)
await s.goto(B + '/app/orders?tab=send'); await pause(2000); await shot(s, 'orders-send', true)
await s.getByRole('button', { name: /Mark as packed/ }).first().click(); await pause(2500)
await s.locator('summary', { hasText: 'Address' }).first().click(); await pause(1800); await shot(s, 'orders-packed', true)
await s.goto(B + '/app/orders?tab=paying'); await pause(2500); await shot(s, 'orders-paying')
await s.goto(B + '/app/khata'); await pause(2000)
await s.getByText('You gave').click(); await pause(800)
await type(s, '[name=amount]', '120'); await type(s, '[name=note]', 'Delhivery courier'); await pause(500)
await s.getByRole('button', { name: 'Save' }).click(); await pause(2500); await shot(s, 'khata', true)
await s.goto(B + '/app'); await pause(1500); await shot(s, 'home-after', true)
await s.locator('a.lang[href^="/lang"]').click(); await pause(3000); await shot(s, 'home-hindi', true)
await s.goto(B + '/app/orders?tab=send'); await pause(2500); await shot(s, 'orders-hindi')
await s.locator('a.lang[href^="/lang"]').click(); await pause(1000)
await s.goto(B + '/app/settings'); await pause(2000); await shot(s, 'settings', true); await scroll(s, 900)
await s.goto(B + '/app/help'); await pause(1000); await s.locator('details summary').nth(1).click(); await pause(2500); await shot(s, 'help', true)
await s.goto(B + '/login'); await pause(300); if (!VIDEO) { await sctx.clearCookies(); await s.goto(B + '/login'); await shot(s, 'login') }

// buyer 1's page after confirmation
await b1.b.goto(b1.b.url()); await pause(2500); await shot(b1.b, 'buyer-paid')
for (const x of [sctx, b1.ctx, b2.ctx, b3.ctx]) await x.close()
await browser.close()
console.log('done', dropUrl)
