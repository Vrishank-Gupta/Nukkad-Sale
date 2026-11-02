// Buyer-experience checks: first purchase, coming back from the UPI app, returning buyer, tracking.
import { chromium, devices } from 'playwright'
const B = process.env.BASE || 'http://localhost:8787', DROP = process.argv[2], OUT = process.argv[3]
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['Pixel 7'], extraHTTPHeaders: B.includes('localhost') ? { 'cf-connecting-ip': '10.7.7.7' } : {} })
const p = await ctx.newPage()
let fails = 0
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++ }

await p.goto(`${B}/d/${DROP}`)
await p.waitForTimeout(400)
// Scroll to the top (photo + title) – the Pay button is off screen, so the sticky bar shows.
await p.evaluate(() => window.scrollTo(0, 0)); await p.locator('#paybtn').evaluate((b) => { b.closest('.sticky-pay').style.position = 'static' }); await p.waitForTimeout(500)
const barShown = !(await p.locator('#buybar').evaluate((e) => e.hidden || e.classList.contains('gone')))
await p.screenshot({ path: `${OUT}/b1-arrive.png` })
await p.locator('#paybtn').scrollIntoViewIfNeeded(); await p.waitForTimeout(700)
check((await p.locator('#buybar').evaluate((e) => e.classList.contains('gone'))) && (barShown || (await p.evaluate(() => document.body.scrollHeight <= innerHeight + 200))), 'sticky Buy bar shows while Pay is off screen, hides once it is visible')
check(!/\d+\s*(left|sold|बचे)/i.test(await p.locator('main').innerText()), 'no stock numbers shown to the buyer')
// pincode validation
await p.locator('.pills input:not([disabled]) + label').first().click()
await p.fill('#name', 'Rohit Sharma'); await p.fill('#phone', '9876500001'); await p.fill('#address', 'B-12 Sector 15, Noida')
const invalid = await p.locator('#pincode').evaluate((e) => (e.value = '12', !e.checkValidity()))
check(invalid, 'short pincode is blocked on the phone (no lost typing)')
await p.fill('#pincode', '201301')
await p.locator('#paybtn').click(); await p.waitForURL(/\/o\//)
const orderUrl = p.url()
// Simulate leaving for the UPI app and coming back
await p.locator('[data-os=android] [data-paylink]').evaluate((a) => { a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click() })
await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
await p.waitForTimeout(1200)
check(await p.locator('#ipaid').evaluate((e) => e.classList.contains('nudge')), '“I have paid” is highlighted after returning from the UPI app')
check(await p.locator('.toast').count() > 0, 'reminder toast shown')
await p.screenshot({ path: `${OUT}/b2-returned.png` })
await p.locator('#ipaid').click(); await p.waitForTimeout(800)
// Back to the sale page: banner + saved details
await p.goto(`${B}/d/${DROP}`); await p.waitForTimeout(400)
check(await p.locator('#myorder').isVisible(), '“You have an order here” banner on the sale page')
check((await p.locator('#myorder').getAttribute('href')) === new URL(orderUrl).pathname, 'banner links to the right order')
check(await p.locator('#saved').isVisible() && !(await p.locator('#details').isVisible()), 'returning buyer sees “Delivering to … Change” instead of the form')
await p.screenshot({ path: `${OUT}/b3-returning.png`, fullPage: true })
await p.locator('#saved button').click()
check(await p.locator('#details').isVisible(), '“Change” reopens the details')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
