// Cross-platform checks: Android phone, iPhone profile, small phone (320px) and desktop.
import { chromium, devices } from 'playwright'
const B = process.env.BASE || 'http://localhost:8787', DROP = process.argv[2], OUT = process.argv[3]
const b = await chromium.launch()
const profiles = {
  android: devices['Pixel 7'],
  iphone: devices['iPhone 13'],
  small: { ...devices['iPhone SE'], viewport: { width: 320, height: 568 } },
  desktop: { viewport: { width: 1280, height: 800 } },
}
let fails = 0
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++ }
let ip = 50
for (const [name, dev] of Object.entries(profiles)) {
  console.log(name)
  const ctx = await b.newContext({ ...dev, extraHTTPHeaders: B.includes('localhost') ? { 'cf-connecting-ip': '10.9.0.' + ip++ } : {} })
  const p = await ctx.newPage()
  // Buyer: sale page → order page
  await p.goto(`${B}/d/${DROP}`)
  const sizes = p.locator('.pills input:not([disabled]) + label')
  if (await sizes.count()) await sizes.first().click()
  await p.fill('#name', 'Test ' + name); await p.fill('#phone', '98765' + String(10000 + ip).slice(-5)); await p.fill('#address', '1 Test Street, Pune'); await p.fill('#pincode', '411001')
  await p.locator('#paybtn').click(); await p.waitForURL(/\/o\//)
  const androidBtn = await p.locator('[data-os=android]').isVisible()
  const iosBtns = await p.locator('[data-os=ios] .appgrid a').evaluateAll((as) => as.filter((a) => a.offsetParent).map((a) => a.getAttribute('href').split(':')[0]))
  const qrOpen = await p.locator('#qr').evaluate((d) => d.open)
  if (name === 'iphone' || name === 'small') check(!androidBtn && iosBtns.join() === 'gpay,phonepe,paytmmp,upi', `iOS shows per-app buttons (${iosBtns.join(', ')})`)
  else check(androidBtn && iosBtns.length === 0, 'single UPI button (Android chooser)')
  check(qrOpen === (name === 'desktop'), `QR ${qrOpen ? 'open' : 'collapsed'}`)
  await p.screenshot({ path: `${OUT}/plat-${name}-pay.png`, fullPage: true })
  // Every buyer + public page: no sideways scrolling, no input under 16px (iOS zoom)
  for (const url of [`/d/${DROP}`, p.url().replace(B, ''), '/', '/login', '/signup']) {
    await p.goto(B + url)
    const r = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select')].filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.name),
      tapSmall: [...document.querySelectorAll('a.btn,button.btn,.pills label')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).length,
    }))
    check(r.overflow <= 0 && r.small.length === 0 && r.tapSmall === 0, `${url.slice(0, 22).padEnd(22)} overflow=${r.overflow} smallInputs=[${r.small}] smallTaps=${r.tapSmall}`)
  }
  await ctx.close()
}
// Seller pages on the smallest phone
const ctx = await b.newContext({ ...profiles.small })
const p = await ctx.newPage()
await p.goto(B + '/login'); await p.fill('#phone', '9876543210'); await p.fill('#pin', '4321'); await p.click('button[type=submit]'); await p.waitForURL(/\/app$/)
console.log('seller @320px')
for (const url of ['/app', '/app/drops/new', `/app/drops/${DROP}`, '/app/orders?tab=all', '/app/khata', '/app/khata?add=debit', '/app/settings', '/app/help']) {
  await p.goto(B + url)
  const r = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select')].filter((e) => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.name),
  }))
  check(r.overflow <= 0 && r.small.length === 0, `${url.padEnd(22)} overflow=${r.overflow} smallInputs=[${r.small}]`)
}
await p.screenshot({ path: `${OUT}/plat-small-help.png` })
await p.goto(B + '/app'); await p.screenshot({ path: `${OUT}/plat-small-home.png`, fullPage: true })
for (const u of ['/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']) {
  const r = await p.request.get(B + u); check(r.ok(), `${u} ${r.status()} ${r.headers()['content-type']}`)
}
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
