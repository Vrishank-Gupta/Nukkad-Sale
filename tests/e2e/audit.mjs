// Whole-site audit, every persona, production-like (no open signup: shops come from "Get started" → admin).
// Visitor → admin → small seller (UPI) → buyers → seller runs the shop → big seller (Razorpay mock) → buyer pays.
// Every page is checked for: console/page errors, failed requests, horizontal overflow, emoji used in the UI,
// the old brand name, images without alt, unlabeled inputs, small tap targets, missing title/h1 – and
// screenshotted (phone light + dark; admin and the website also on desktop). Internal links are crawled.
//
// Start the app on an EMPTY local database with:
//   --var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code --var ALLOW_TEST_KEYS:1
//   --var RAZORPAY_API_BASE:http://localhost:8792/v1      (and python3 tests/e2e/mock_razorpay.py signed)
// then: OUT=/tmp/audit node tests/e2e/audit.mjs   → OUT/report.json, OUT/report.md, OUT/shots/*.png
import { chromium } from 'playwright'
import fs from 'node:fs'
const B = process.env.BASE || 'http://localhost:8787', OUT = process.env.OUT || '/tmp/audit'
fs.mkdirSync(OUT + '/shots', { recursive: true })
const browser = await chromium.launch()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN' }
const DESK = { viewport: { width: 1440, height: 900 }, locale: 'en-IN' }
const findings = [], pages = [], flows = [], links = new Set()
const add = (sev, where, what, detail = '') => findings.push({ sev, where, what, detail: String(detail).slice(0, 400) })
let ipN = 10, shotN = 0

async function ctx(kind = 'phone', ip) {
  const c = await browser.newContext({ ...(kind === 'desk' ? DESK : PHONE), extraHTTPHeaders: { 'cf-connecting-ip': ip || `10.66.0.${ipN++}` } })
  await c.addInitScript(() => {
    if (!navigator.share) Object.defineProperty(navigator, 'share', { value: () => Promise.resolve() })
    if (!navigator.canShare) Object.defineProperty(navigator, 'canShare', { value: () => true })
  })
  return c
}
function watch(page, persona) {
  page.on('dialog', (d) => d.accept())   // "Are you sure?" confirms – the persona says yes
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text()) && !(page.__expect4xx && /404/.test(m.text()))) add('high', `${persona} ${page.url().replace(B, '')}`, 'console error', m.text()) })
  page.on('pageerror', (e) => add('high', `${persona} ${page.url().replace(B, '')}`, 'JavaScript error', e.message))
  page.on('response', (r) => {
    const u = r.url()
    if (u.startsWith(B) && r.status() >= 400 && !/\/(nope|zzz)/.test(u) && !page.__expect4xx) add('high', `${persona} ${page.url().replace(B, '')}`, `HTTP ${r.status()}`, u.replace(B, ''))
  })
  return page
}
const step = async (name, fn) => {
  try { await fn(); flows.push({ name, ok: true }) } catch (e) { flows.push({ name, ok: false, err: e.message.split('\n')[0] }); add('high', name, 'flow failed', e.message.split('\n')[0]) }
}

// ---------- per-page checks ----------
async function check(page, persona, label, { dark = true, full = true } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {})
  const url = page.url().replace(B, '') || '/'
  const r = await page.evaluate(() => {
    const vis = (el) => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0 }
    const emoji = /\p{Extended_Pictographic}/u
    const out = { title: document.title, lang: document.documentElement.lang, h1: document.querySelectorAll('h1').length,
      overflow: document.documentElement.scrollWidth - innerWidth, wide: [], emoji: [], brand: /khatakhat/i.test(document.body.innerText),
      noalt: [], unlabeled: [], small: [], links: [] }
    if (out.overflow > 1) for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.right > innerWidth + 1 && vis(el) && out.wide.length < 4) out.wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(b.right)}`) }
    // Emoji used as UI (buttons, links, headings, labels, tabs, chips) – WhatsApp message text (textarea/pre/.msg) is allowed.
    for (const el of document.querySelectorAll('button, a, h1, h2, h3, label, summary, .chip, .tab, nav, th')) {
      if (!vis(el) || el.closest('textarea, pre, .msg, .wa, .preview, [data-wa]')) continue
      const t = (el.innerText || '').trim(); if (emoji.test(t) && out.emoji.length < 6) out.emoji.push(t.slice(0, 60))
    }
    for (const img of document.images) if (vis(img) && !img.hasAttribute('alt')) out.noalt.push(img.src.slice(-50))
    for (const i of document.querySelectorAll('input, select, textarea')) {
      if (['hidden', 'submit', 'button'].includes(i.type) || !vis(i)) continue
      const ok = (i.id && document.querySelector(`label[for="${i.id}"]`)) || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('placeholder') || i.getAttribute('title')
      if (!ok) out.unlabeled.push(i.name || i.id || i.type)
    }
    for (const el of document.querySelectorAll('a, button, summary, input[type=checkbox], input[type=radio], select')) {
      if (!vis(el) || getComputedStyle(el).display === 'inline' && el.closest('p, li, small, td')) continue
      const tgt = el.type === 'checkbox' || el.type === 'radio' ? (el.closest('label') || el) : el
      const b = tgt.getBoundingClientRect(); if (b.height < 40 || b.width < 40) out.small.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(b.width)}×${Math.round(b.height)}`)
    }
    for (const a of document.querySelectorAll('a[href]')) out.links.push(a.href)
    return out
  })
  const where = `${persona} ${url}`
  if (!r.title) add('med', where, 'page has no <title>')
  if (!r.lang) add('low', where, '<html> has no lang')
  if (r.h1 === 0) add('low', where, 'no <h1> on the page')
  if (r.overflow > 1) add('high', where, `sideways scroll: page is ${r.overflow}px wider than the screen`, r.wide.join(' · '))
  if (r.emoji.length) add('med', where, 'emoji used in the UI (should be line icons)', r.emoji.join(' | '))
  if (r.brand) add('high', where, 'old brand name "Khatakhat" visible')
  if (r.noalt.length) add('low', where, `${r.noalt.length} image(s) without alt`, r.noalt.join(' '))
  if (r.unlabeled.length) add('med', where, 'input(s) without a label', r.unlabeled.join(', '))
  if (r.small.length) add('low', where, `${r.small.length} tap target(s) under 40px`, r.small.slice(0, 5).join(' · '))
  for (const l of r.links) if (l.startsWith(B)) links.add(l.split('#')[0])
  const f = `${String(++shotN).padStart(3, '0')}-${persona}-${label}`.replace(/[^a-z0-9-]+/gi, '_')
  await page.screenshot({ path: `${OUT}/shots/${f}.png`, fullPage: full })
  if (dark) { await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(150); await page.screenshot({ path: `${OUT}/shots/${f}-dark.png`, fullPage: full }); await page.emulateMedia({ colorScheme: 'light' }) }
  pages.push({ persona, label, url, shot: f, title: r.title })
}
const go = async (page, path, persona, label, o) => { await page.goto(B + path); await check(page, persona, label, o) }
async function photo(page, emoji, bg) {
  const p = await browser.newPage({ viewport: { width: 800, height: 800 } })
  await p.setContent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:${bg}"><div style="font-size:460px">${emoji}</div></body>`)
  const f = `${OUT}/${emoji.codePointAt(0)}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 80 }); await p.close(); return f
}
const KURTA = await photo(null, '👗', '#f4c27a'), SAREE = await photo(null, '🥻', '#f2a7b8'), PERF = await photo(null, '🧴', '#9ec5f0')

// ================= 1. VISITOR =================
const vc = await ctx(), v = watch(await vc.newPage(), 'visitor')
const vd = await ctx('desk'), vD = watch(await vd.newPage(), 'visitor-desktop')
await step('visitor: website pages', async () => {
  await go(v, '/', 'visitor', 'home')
  await go(vD, '/', 'visitor-desktop', 'home', { dark: false })
  for (const p of ['/privacy', '/terms', '/refunds', '/contact', '/data-request', '/help/razorpay', '/login', '/offline']) await go(v, p, 'visitor', p.slice(1).replace('/', '-'))
  await v.goto(B + '/lang?to=hi&back=/'); await check(v, 'visitor', 'home-hindi')
  await v.goto(B + '/lang?to=en&back=/')
})
await step('visitor: signup is closed and points to Get started', async () => {
  await v.goto(B + '/signup'); if (!/get-started/.test(v.url())) throw new Error('/signup did not lead to Get started: ' + v.url())
})
await step('visitor: 404s are friendly', async () => {
  v.__expect4xx = true
  for (const p of ['/d/zzzzzzz', '/o/zzzzzzz', '/nope']) { const r = await v.goto(B + p); await check(v, 'visitor', '404' + p.replace(/\//g, '-'), { dark: false }); if (r.status() !== 404) add('med', 'visitor ' + p, `missing page returns ${r.status()} instead of 404`) }
  v.__expect4xx = false
})
await step('visitor: Get started form (validation + submit)', async () => {
  await v.goto(B + '/#get-started')
  const form = v.locator('form[action="/get-started"]')
  await form.locator('button[type=submit]').click()
  await v.waitForTimeout(400)
  if (!/\/$|#get-started/.test(v.url()) && /thanks/.test(v.url())) add('high', 'visitor /get-started', 'empty form was accepted')
  await v.goto(B + '/#get-started')
  // City, channel, volume and payments sit in the optional "Tell us more" panel – open it first.
  await form.locator('details.more summary').click()
  for (const [n, val] of [['name', 'Neha Sharma'], ['business', 'Neha Kurtis'], ['phone', '9811100001'], ['city', 'Jaipur'], ['sells', 'kurtis']]) { const i = form.locator(`[name=${n}]`); if (await i.count()) await i.fill(val) }
  for (const sel of await form.locator('select').all()) { const o = await sel.locator('option').nth(1).getAttribute('value').catch(() => null); if (o) await sel.selectOption(o) }
  await form.locator('button[type=submit]').click(); await v.waitForURL(/thanks/)
  await check(v, 'visitor', 'thanks')
})
await step('visitor: data request form', async () => {
  await v.goto(B + '/data-request'); const f = v.locator('form').last()
  for (const i of await f.locator('input:visible, textarea:visible').all()) { const t = await i.getAttribute('type'); if (t === 'radio' || t === 'checkbox') { await i.check().catch(() => {}); continue } const n = (await i.getAttribute('name')) || ''; await i.fill(/phone/.test(n) ? '9811100001' : /mail/.test(n) ? 'neha@example.com' : 'Please send a copy of my data') }
  await f.locator('button[type=submit]').click(); await v.waitForLoadState('networkidle'); await check(v, 'visitor', 'data-request-sent', { dark: false })
})

// ================= 2. ADMIN =================
const ac = await ctx('desk', '10.66.9.1'), a = watch(await ac.newPage(), 'admin')
let tempPin, tempPin2
await step('admin: first-time setup', async () => {
  await go(a, '/admin/login', 'admin', 'login', { dark: false })
  await a.goto(B + '/admin/setup'); await check(a, 'admin', 'setup', { dark: false })
  await a.fill('[name=phone]', '9999999999'); await a.fill('[name=code]', 'setup-code'); await a.fill('[name=pin]', '135790')
  await a.locator('form button[type=submit]').first().click(); await a.waitForURL(/\/admin(\?|$|\/)/)
})
await step('admin: pages', async () => {
  for (const [p, l] of [['/admin', 'dashboard'], ['/admin/leads', 'leads'], ['/admin/sellers', 'sellers'], ['/admin/billing', 'billing'], ['/admin/settings', 'settings'], ['/admin/privacy', 'privacy'], ['/admin/sellers/new', 'new-shop']]) await go(a, p, 'admin', l, { dark: false })
})
await step('admin: request → create shop (UPI seller)', async () => {
  await a.goto(B + '/admin/leads'); await a.locator('a[href^="/admin/leads/"]').first().click(); await check(a, 'admin', 'lead', { dark: false })
  const f = a.locator('form[action="/admin/shops"]')
  await f.locator('[name=vpa]').fill('nehakurtis@ybl')
  await f.locator('button[type=submit]').click(); await a.waitForLoadState('networkidle'); await check(a, 'admin', 'shop-created', { dark: false })
  tempPin = (await a.content()).match(/letter-spacing:\.2em">(\d{4,6})</)?.[1]; if (!tempPin) throw new Error('temporary PIN not shown')
})
await step('admin: create a second shop directly (big seller)', async () => {
  await a.goto(B + '/admin/sellers/new'); const f = a.locator('form[action="/admin/shops"]')
  await f.locator('[name=name]').fill('Riya Kapoor'); await f.locator('[name=shop]').fill('Riya Fragrances'); await f.locator('[name=phone]').fill('9700000123'); await f.locator('[name=vpa]').fill('riyafragrances@ybl')
  await f.locator('button[type=submit]').click(); await a.waitForLoadState('networkidle')
  tempPin2 = (await a.content()).match(/letter-spacing:\.2em">(\d{4,6})</)?.[1]; if (!tempPin2) throw new Error('temporary PIN not shown')
  await a.goto(B + '/admin/sellers'); await check(a, 'admin', 'sellers-2', { dark: false })
  await a.locator('a[href^="/admin/sellers/"]', { hasText: 'Riya Fragrances' }).first().click(); await check(a, 'admin', 'seller-detail', { dark: false })
  // Big sellers: the admin switches on Razorpay for the shop and can paste its keys (test keys via the mock).
  const pf = a.locator('form[action$="/payments"]')
  await pf.locator('input[name=allowed][value=razorpay]').check()
  await pf.locator('[name=rzp_key]').fill('rzp_test_2468ABCD'); await pf.locator('[name=rzp_secret]').fill('rzp_test_secret_2468')
  await pf.locator('button[type=submit]').first().click(); await a.waitForLoadState('networkidle')
  if (/err=/.test(a.url())) throw new Error('admin could not save payment methods: ' + decodeURIComponent(a.url().split('err=')[1]))
  await check(a, 'admin', 'seller-razorpay-on', { dark: false })
})
const am = await ctx('phone', '10.66.9.2'), aM = watch(await am.newPage(), 'admin-phone')
await step('admin on a phone (should still be usable)', async () => {
  await aM.goto(B + '/admin/login'); await aM.fill('[name=phone]', '9999999999'); await aM.fill('[name=pin]', '135790'); await aM.locator('form button[type=submit]').first().click(); await aM.waitForLoadState('networkidle')
  await check(aM, 'admin-phone', 'dashboard', { dark: false }); await go(aM, '/admin/sellers', 'admin-phone', 'sellers', { dark: false })
})

// ================= 3. SMALL SELLER =================
const sc = await ctx('phone', '10.66.1.1'), s = watch(await sc.newPage(), 'seller')
let drop, drop2
await step('seller: first login with the temporary PIN', async () => {
  await go(s, '/login', 'seller', 'login')
  await s.fill('#phone', '9811100001'); await s.fill('#pin', tempPin); await s.locator('form button[type=submit]').first().click(); await s.waitForURL(/\/app/)
  await check(s, 'seller', 'first-home')
})
await step('seller: change PIN', async () => {
  await s.goto(B + '/app/settings'); const f = s.locator('form[action="/app/pin"]')
  await f.locator('[name=current]').fill(tempPin); await f.locator('[name=pin]').fill('482615'); await f.locator('button[type=submit]').click(); await s.waitForLoadState('networkidle')
  if (/err=/.test(s.url())) throw new Error('PIN change failed: ' + s.url())
})
await step('seller: create a sale with sizes', async () => {
  await s.goto(B + '/app/drops/new'); await check(s, 'seller', 'new-sale-empty')
  await s.setInputFiles('#image', KURTA); await s.waitForTimeout(800)
  await s.fill('#title', 'Chanderi silk kurta – mustard'); await s.fill('#description', 'Pure Chanderi silk, hand block print.'); await s.fill('#price', '799')
  await s.locator('label[for=hs1]').click(); await s.waitForTimeout(300)
  const rows = s.locator('#sizelist .sizerow'); for (let i = 0; i < Math.min(3, await rows.count()); i++) { const plus = rows.nth(i).locator('[data-step="1"]'); await plus.click() }
  await check(s, 'seller', 'new-sale-filled', { dark: false })
  await s.getByRole('button', { name: /Publish/ }).click(); await s.waitForURL(/drops\/.+new=1/); drop = s.url().match(/drops\/([a-z0-9]+)/)[1]
  await check(s, 'seller', 'sale-live')
  await s.getByRole('button', { name: /Copy message/ }).click().catch(() => add('med', 'seller sale page', '"Copy message" button not found'))
})
await step('seller: second sale (one size, for carts)', async () => {
  await s.goto(B + '/app/drops/new'); await s.setInputFiles('#image', SAREE); await s.waitForTimeout(600)
  await s.fill('#title', 'Mulmul saree – rose'); await s.fill('#price', '1299')
  const st = s.locator('#stock'); if (await st.count()) await st.fill('2')
  await s.getByRole('button', { name: /Publish/ }).click(); await s.waitForURL(/drops\/.+new=1/); drop2 = s.url().match(/drops\/([a-z0-9]+)/)[1]
})

// ================= 4. BUYERS =================
const buyers = []
async function buyer(name, phone, addr, pin, size, { claim = false, drops = [drop], label } = {}) {
  const c = await ctx(), b = watch(await c.newPage(), 'buyer')
  for (const [i, d] of drops.entries()) {
    await b.goto(`${B}/d/${d}`); if (label && i === 0) await check(b, 'buyer', label + '-sale')
    if (size && (await b.locator(`.pills label:text-is("${size}")`).count())) await b.locator(`.pills label:text-is("${size}")`).click()
    if (await b.locator('#details').isVisible()) { await b.fill('#name', name); await b.fill('#phone', phone); await b.fill('#address', addr); await b.fill('#pincode', pin) }
    if (label && i === 0) await check(b, 'buyer', label + '-form', { dark: false })
    await b.locator('#paybtn').click(); await b.waitForURL(/\/o\//)
  }
  if (label) await check(b, 'buyer', label + '-pay')
  if (claim) { await b.locator('#ipaid').click(); await b.waitForTimeout(600); if (label) await check(b, 'buyer', label + '-claimed', { dark: false }) }
  buyers.push({ c, b }); return b
}
let b1
await step('buyer: first purchase, pays, taps "I have paid"', async () => { b1 = await buyer('Priya Nair', '9822001122', '14 MG Road, Kochi', '682016', 'M', { claim: true, label: 'priya' }) })
await step('buyer: validation – wrong pincode / phone', async () => {
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(`${B}/d/${drop}`)
  await b.locator('.pills label:text-is("S")').click().catch(() => {})
  await b.fill('#name', 'X'); await b.fill('#phone', '123'); await b.fill('#address', 'a'); await b.fill('#pincode', '12')
  await b.locator('#paybtn').click(); await b.waitForTimeout(800)
  if (/\/o\//.test(b.url())) add('high', 'buyer /d/', 'order accepted with a 3-digit phone and 2-digit pincode')
  await check(b, 'buyer', 'invalid-form', { dark: false }); await c.close()
})
await step('buyer: cart – two products, one payment', async () => { await buyer('Sana Qureshi', '9822003344', '7 Park Street, Kolkata', '700016', 'L', { drops: [drop, drop2], claim: true, label: 'sana-cart' }) })
await step('buyer: leaves without paying (hold)', async () => { await buyer('Kavya Rao', '9822005566', '22 Jayanagar, Bengaluru', '560041', 'S', { label: 'kavya-unpaid' }) })
await step('buyer: returning buyer – details remembered', async () => {
  await b1.goto(`${B}/d/${drop2}`); await check(b1, 'buyer', 'returning-sale', { dark: false })
  if (await b1.locator('#details').isVisible() && !(await b1.locator('#name').inputValue())) add('med', 'buyer returning', 'returning buyer has to type details again')
})
await step('buyer: sold-out sale', async () => {
  await buyer('Isha Jain', '9822007788', '3 FC Road, Pune', '411004', null, { drops: [drop2], claim: true })
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(`${B}/d/${drop2}`); await check(b, 'buyer', 'sold-out', { dark: false })
  if (await b.locator('#paybtn:enabled').count()) add('high', 'buyer sold-out', 'Pay button still enabled on a sold-out sale'); await c.close()
})

// ================= 4b. NEW SELLER TOOLS (by tapping, like a seller would) =================
await step('seller: add cost → profit line on the sale page', async () => {
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('#cost summary').click()
  await s.fill('#costin', '450'); await s.getByRole('button', { name: 'Save cost' }).click(); await s.waitForLoadState('networkidle')
  if (!/Profit ₹349 per piece/.test(await s.innerText('main'))) throw new Error('profit line not shown: ' + (await s.locator('#cost summary').innerText()))
  await check(s, 'seller', 'sale-with-profit', { dark: false })
})
await step('seller: start a discount with the 20% shortcut', async () => {
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('details.tool summary', { hasText: 'Discount' }).click()
  await check(s, 'seller', 'discount-panel')
  await s.getByRole('button', { name: '20% off' }).click()
  if ((await s.inputValue('#dprice')) !== '639') throw new Error('20% shortcut filled ' + (await s.inputValue('#dprice')))
  await s.getByRole('button', { name: 'Start discount' }).click(); await s.waitForLoadState('networkidle')
  const t = await s.innerText('main'); if (!/₹639/.test(t) || !/20% off/.test(t)) throw new Error('discount not shown on the seller sale page')
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(`${B}/d/${drop}`); await check(b, 'buyer', 'discounted-sale')
  const bt = await b.innerText('main'); if (!/₹639/.test(bt) || !/₹799/.test(bt) || !/20% off/.test(bt)) throw new Error('buyer page missing discount')
  if (!/₹639/.test(await b.locator('#paybtn').innerText())) throw new Error('pay button not at the discounted price'); await c.close()
})
let offerUrl
await step('seller: special price link for one buyer', async () => {
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('details.tool summary', { hasText: 'Special price' }).click()
  await s.fill('#oprice', '550'); await s.fill('#ophone', '9822012345'); await s.fill('#oname', 'Meena')
  await s.getByRole('button', { name: 'Create link' }).click(); await s.waitForLoadState('networkidle')
  await check(s, 'seller', 'special-price-ready')
  offerUrl = await s.inputValue('#offerlink'); if (!/\?o=/.test(offerUrl)) throw new Error('no link')
  const wa = await s.locator('a.btn.wa', { hasText: 'Send on WhatsApp' }).getAttribute('href'); if (!/wa\.me\/919822012345/.test(wa)) throw new Error('WhatsApp button not to the buyer: ' + wa)
})
await step('buyer: opens the special link and orders at ₹550', async () => {
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(offerUrl); await check(b, 'buyer', 'special-price-page')
  if (!/Special price for Meena/.test(await b.innerText('main'))) throw new Error('no special-price banner')
  await b.locator('.pills label:text-is("L")').click().catch(() => {})
  await b.fill('#name', 'Meena Shah'); await b.fill('#phone', '9822012345'); await b.fill('#address', '4 Ring Road, Surat'); await b.fill('#pincode', '395002')
  await b.locator('#paybtn').click(); await b.waitForURL(/\/o\//); await check(b, 'buyer', 'special-price-order', { dark: false })
  const amt = Number((await b.innerText('main')).match(/₹(5\d\d\.\d\d)/)?.[1] ?? 0); if (!(amt > 549 && amt <= 550)) throw new Error('order amount ' + amt)
  // Someone else can't use her link
  const c2 = await ctx(), x = watch(await c2.newPage(), 'buyer'); await x.goto(offerUrl)
  await x.locator('.pills label:text-is("S")').click().catch(() => {})
  await x.fill('#name', 'Not Meena'); await x.fill('#phone', '9822099999'); await x.fill('#address', '1 Other Street, Surat'); await x.fill('#pincode', '395002')
  x.__expect4xx = true; await x.locator('#paybtn').click(); await x.waitForLoadState('networkidle')
  // Her link is used now, so a second phone must only ever get the regular price (an order at ₹799.xx is fine).
  if (/\/o\//.test(x.url()) && /₹5\d\d\.\d\d/.test(await x.innerText('main'))) add('high', 'buyer special link', 'a different number got the special price')
  await c.close(); await c2.close()
})
await step('buyer: sold-out sale → Notify me; seller sees the list', async () => {
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(`${B}/d/${drop2}`)
  await b.fill('#wname', 'Ritu Jain'); await b.fill('#wphone', '9822033344'); await b.getByRole('button', { name: 'Notify me' }).click(); await b.waitForLoadState('networkidle')
  await check(b, 'buyer', 'notify-me-done', { dark: false }); if (!/on the list/.test(await b.content())) throw new Error('no confirmation'); await c.close()
  await s.goto(`${B}/app/drops/${drop2}`); await check(s, 'seller', 'waitlist')
  if (!/Waiting for restock \(1\)/.test(await s.innerText('main'))) throw new Error('seller does not see the waiting buyer')
})
await step('seller: end the discount', async () => {
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('details.tool summary', { hasText: 'Discount' }).click()
  await s.getByRole('button', { name: /End discount/ }).click(); await s.waitForLoadState('networkidle')
  if (/20% off/.test(await s.innerText('main'))) throw new Error('discount still shown')
})

// ================= 5. SELLER RUNS THE SHOP =================
await step('seller: every app page (English + dark)', async () => {
  for (const [p, l] of [['/app', 'home'], ['/app/orders?tab=check', 'orders-check'], ['/app/orders?tab=send', 'orders-send'], ['/app/orders?tab=paying', 'orders-paying'], ['/app/orders?tab=all', 'orders-all'],
    [`/app/drops/${drop}`, 'sale'], ['/app/khata', 'khata'], ['/app/buyers', 'buyers'], ['/app/settings', 'settings'], ['/app/help', 'help'], ['/app/billing', 'billing'], ['/app/quick-order', 'quick-order']]) await go(s, p, 'seller', l)
})
await step('seller: confirms a payment', async () => {
  await s.goto(B + '/app/orders?tab=check'); await s.getByRole('button', { name: /Yes, I got it/ }).first().click(); await s.waitForLoadState('networkidle')
  await check(s, 'seller', 'after-yes', { dark: false })
})
await step('seller: rejects a payment ("No")', async () => {
  await s.goto(B + '/app/orders?tab=check'); const no = s.getByRole('button', { name: /^✗? ?No$/ }).first()
  if (await no.count()) { await no.click(); await s.waitForLoadState('networkidle'); await check(s, 'seller', 'after-no', { dark: false }) } else add('low', 'seller orders', '"No" button not found')
})
await step('seller: packs and sends', async () => {
  await s.goto(B + '/app/orders?tab=send'); const b = s.getByRole('button', { name: /packed|Mark as/i }).first()
  if (await b.count()) { await b.click(); await s.waitForLoadState('networkidle') } ; await check(s, 'seller', 'after-packed', { dark: false })
})
await step('seller: khata shows profit this month', async () => {
  await s.goto(B + '/app/khata'); if (!/Profit this month/.test(await s.innerText('main'))) throw new Error('no profit card'); await check(s, 'seller', 'khata-profit')
})
await step('seller: print shipping labels from "To send"', async () => {
  await s.goto(B + '/app/orders?tab=send'); const btn = s.locator('a', { hasText: 'Print shipping labels' })
  if (!(await btn.count())) throw new Error('no labels button on To send')
  await btn.click(); await s.waitForURL(/labels/); await check(s, 'seller', 'labels', { dark: false })
  if ((await s.locator('.lbl').count()) < 1) throw new Error('no labels printed')
})
await step('seller: khata entry + CSV downloads', async () => {
  await s.goto(B + '/app/khata'); await s.getByText(/You gave/).first().click(); await s.fill('[name=amount]', '120'); await s.fill('[name=note]', 'Delhivery courier')
  await s.getByRole('button', { name: 'Save' }).click(); await s.waitForLoadState('networkidle'); await check(s, 'seller', 'khata-after', { dark: false })
  for (const p of ['/app/khata.csv', '/app/buyers.csv']) { const r = await s.request.get(B + p); if (r.status() !== 200 || !/csv|excel|text/.test(r.headers()['content-type'] || '')) add('high', 'seller ' + p, `CSV download returned ${r.status()} ${r.headers()['content-type']}`) }
})
await step('seller: quick order from a chat', async () => {
  await s.goto(B + '/app/quick-order'); const f = s.locator('form').filter({ has: s.locator('button[type=submit]') }).last()
  const plus = f.locator('[data-step="1"]').first(); if (await plus.count()) await plus.click()
  for (const i of await f.locator('input[type=text]:visible, input[type=tel]:visible, input:not([type]):visible').all()) { const n = (await i.getAttribute('name')) || ''; if (!(await i.inputValue())) await i.fill(/phone/.test(n) ? '9822009900' : 'Ritu') }
  await f.locator('button[type=submit]').click(); await s.waitForLoadState('networkidle'); await check(s, 'seller', 'quick-order-done', { dark: false })
  if (!/quick-order\/done/.test(s.url())) throw new Error('quick order not created: ' + s.url())
})
await step('seller: Hindi everywhere', async () => {
  await s.goto(B + '/lang?to=hi&back=/app')
  for (const [p, l] of [['/app', 'home'], ['/app/orders', 'orders'], ['/app/khata', 'khata'], ['/app/settings', 'settings'], ['/app/drops/new', 'new-sale'], ['/app/help', 'help']]) await go(s, p, 'seller-hi', l, { dark: false })
  const en = await s.evaluate(() => (document.body.innerText.match(/\b(Orders|Settings|Payment|Yes, I got it|Start a new sale)\b/g) || []).slice(0, 5))
  if (en.length) add('low', 'seller-hi', 'English words left on Hindi screens', en.join(', '))
  await s.goto(B + '/lang?to=en&back=/app')
})
await step('seller: drop actions (pause / stock)', async () => {
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('details:not(.tool):not(.quiet) > summary').filter({ hasText: /close sale|stock/i }).first().click()   // Stop/stock live under "Change stock or close sale"
  const pause = s.getByRole('button', { name: /Stop this sale/ }).first()
  if (await pause.count()) { await pause.click(); await s.waitForLoadState('networkidle'); await check(s, 'seller', 'sale-paused', { dark: false }) }
  const c = await ctx(), b = watch(await c.newPage(), 'buyer'); await b.goto(`${B}/d/${drop}`); await check(b, 'buyer', 'paused-sale', { dark: false })
  if (await b.locator('#paybtn:enabled').isVisible().catch(() => false)) add('high', 'buyer stopped sale', 'buyers can still pay on a sale the seller stopped'); await c.close()
  await s.goto(`${B}/app/drops/${drop}`); await s.locator('details:not(.tool):not(.quiet) > summary').filter({ hasText: /close sale|stock/i }).first().click().catch(() => {}); await s.getByRole('button', { name: /Start selling again/ }).click(); await s.waitForLoadState('networkidle')
})
await step('buyer: sees "paid" after seller confirmed', async () => { await b1.reload(); await check(b1, 'buyer', 'priya-after-confirm') })
await step('seller: log out', async () => {
  await s.goto(B + '/app/settings'); await s.getByRole('button', { name: /Log out/ }).click(); await s.waitForURL(/login/)
  await s.goto(B + '/app'); if (!/login/.test(s.url())) add('high', 'seller logout', 'still logged in after Log out')
})

// ================= 6. BIG SELLER (Razorpay) =================
const gc = await ctx('phone', '10.66.2.1'), g = watch(await gc.newPage(), 'big-seller')
let perf
await step('big seller: login, connect Razorpay (test keys via mock)', async () => {
  await g.goto(B + '/login'); await g.fill('#phone', '9700000123'); await g.fill('#pin', tempPin2); await g.locator('form button[type=submit]').first().click(); await g.waitForURL(/\/app/)
  await g.goto(B + '/app/settings'); const rz = g.locator('input[name=mode][value=razorpay]'); if (await rz.count()) await rz.check().catch(() => rz.click())
  const key = g.locator('[name=rzp_key]'); if (await key.isVisible().catch(() => false) && !(await key.inputValue())) { await key.fill('rzp_test_2468ABCD'); await g.fill('[name=rzp_secret]', 'rzp_test_secret_2468') }
  await g.locator('form[data-mode] [name=pin]').fill(tempPin2).catch(() => {})
  const save = g.locator('form[data-mode] button[type=submit]').first(); if (await save.count()) { await save.click(); await g.waitForLoadState('networkidle') }
  await check(g, 'big-seller', 'settings-razorpay')
})
await step('big seller: sale + buyer pays through the gateway', async () => {
  await g.goto(B + '/app/drops/new'); await g.setInputFiles('#image', PERF); await g.waitForTimeout(600)
  await g.fill('#title', 'Oud Intense EDP 100ml'); await g.fill('#price', '3100'); const st = g.locator('#stock'); if (await st.count()) await st.fill('5')
  await g.getByRole('button', { name: /Publish/ }).click(); await g.waitForURL(/drops\/.+new=1/); perf = g.url().match(/drops\/([a-z0-9]+)/)[1]
  const c = await ctx(), b = watch(await c.newPage(), 'buyer-gateway'); await b.goto(`${B}/d/${perf}`)
  if (await b.locator('#details').isVisible()) { await b.fill('#name', 'Aarti Menon'); await b.fill('#phone', '9822011223'); await b.fill('#address', '9 Linking Road, Mumbai'); await b.fill('#pincode', '400050') }
  await check(b, 'buyer-gateway', 'sale', { dark: false })
  await b.locator('#paybtn').click(); await b.waitForURL(/8792|pay/); await b.locator('#pay').click(); await b.waitForURL(/\/o\//); await b.waitForTimeout(800)
  await check(b, 'buyer-gateway', 'paid'); if (!/paid|received|confirmed/i.test(await b.innerText('body'))) add('high', 'buyer-gateway', 'gateway payment did not show as paid')
  await go(g, '/app', 'big-seller', 'home'); await go(g, '/app/orders', 'big-seller', 'orders'); await c.close()
})

// ================= 7. LINK CRAWL =================
await step('all internal links resolve', async () => {
  const lc = await ctx('phone', '10.66.3.1'), skip = /\/(logout|lang|billing\/pay|o\/[a-z0-9]+\/paid)|\.csv$|\/admin|\/app/
  for (const l of [...links].filter((x) => !skip.test(x))) { const r = await lc.request.get(l, { maxRedirects: 5 }).catch((e) => ({ status: () => 0 })); if (r.status() >= 400 || r.status() === 0) add('high', 'link', `broken link (${r.status()})`, l.replace(B, '')) }
  await lc.close()
})

await browser.close()
const order = { high: 0, med: 1, low: 2 }
findings.sort((x, y) => order[x.sev] - order[y.sev])
fs.writeFileSync(OUT + '/report.json', JSON.stringify({ flows, findings, pages }, null, 1))
const md = [`# Audit ${new Date().toISOString()}`, `Flows: ${flows.filter((f) => f.ok).length}/${flows.length} passed · pages checked: ${pages.length} · findings: ${findings.length}`, '',
  ...flows.map((f) => `- ${f.ok ? 'PASS' : 'FAIL'} ${f.name}${f.err ? ' – ' + f.err : ''}`), '', '| sev | where | what | detail |', '|---|---|---|---|',
  ...findings.map((f) => `| ${f.sev} | ${f.where} | ${f.what} | ${f.detail.replace(/\|/g, '/')} |`)]
fs.writeFileSync(OUT + '/report.md', md.join('\n'))
console.log(md.slice(0, 3).join('\n')); console.log(flows.filter((f) => !f.ok).map((f) => 'FAIL ' + f.name + ' – ' + f.err).join('\n'))
