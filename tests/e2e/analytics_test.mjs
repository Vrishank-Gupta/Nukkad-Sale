// End-to-end test of first-party analytics: real browsers visit the website (scroll, tap Get started, fill and send
// the form), a phone visitor arrives from Instagram, a bot is ignored, and the admin dashboard adds it all up.
// App running locally WITHOUT OPEN_SIGNUP, with --var ADMIN_PHONES:919999999999 --var ADMIN_SETUP_CODE:setup-code
import { chromium, devices } from 'playwright'
const B = process.env.BASE || 'http://localhost:8787'
let ok = 0
const check = (c, m) => { if (!c) { console.log('FAIL:', m); process.exit(1) } ok++; console.log('ok  ', m) }
const b = await chromium.launch()
const wait = (p, ms = 400) => p.waitForTimeout(ms)

// Visitor 1 – desktop, from Google: reads the home page, taps Get started, fills and sends the form
// A normal desktop browser (the tracker ignores "HeadlessChrome", like any crawler).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const c1 = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.6.0.1' } })
const p1 = await c1.newPage()
await p1.goto(B + '/', { referer: 'https://www.google.com/' }); await wait(p1, 1200)
await p1.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.7)); await wait(p1)
await p1.locator('a[href="/#get-started"]').first().click(); await wait(p1)
const f = p1.locator('form#getstarted')
await f.locator('[name=name]').fill('Nisha Verma'); await f.locator('[name=business]').fill('Nisha Sarees'); await f.locator('[name=phone]').fill('9811300001')
for (const [n, v] of [['city', 'Jaipur'], ['sells', 'sarees']]) { const i = f.locator(`[name=${n}]`); if (await i.count()) await i.fill(v) }
for (const r of await f.locator('input[type=radio]').all()) { const nm = await r.getAttribute('name'); if (!(await f.locator(`input[name=${nm}]:checked`).count())) await r.check().catch(() => {}) }
for (const sel of await f.locator('select').all()) { const v = await sel.locator('option').nth(1).getAttribute('value').catch(() => null); if (v) await sel.selectOption(v) }
await f.locator('button[type=submit]').click(); await p1.waitForURL(/thanks/); await wait(p1, 600)
const p1b = await c1.newPage(); await p1.close(); await wait(p1b, 600)   // closes the tab → time on page is sent

// Visitor 2 – phone, from an Instagram link with utm_source, reads and leaves
const c2 = await b.newContext({ ...devices['Pixel 7'], extraHTTPHeaders: { 'cf-connecting-ip': '10.6.0.2' } })
const p2 = await c2.newPage()
await p2.goto(B + '/?utm_source=instagram&utm_medium=bio'); await wait(p2, 900)
await p2.evaluate(() => window.scrollTo(0, 400)); await wait(p2)
await p2.locator('a[href="/privacy"]').first().click(); await wait(p2, 600)
const p2b = await c2.newPage(); await p2.close(); await wait(p2b, 600)

// A crawler – must not be counted
const c3 = await b.newContext({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)', extraHTTPHeaders: { 'cf-connecting-ip': '10.6.0.3' } })
await (await c3.newPage()).goto(B + '/'); await wait(await c3.newPage(), 600)

// Admin reads the dashboard
const ac = await b.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'cf-connecting-ip': '10.6.0.9' } }); const a = await ac.newPage()
await a.goto(B + '/admin/setup'); await a.fill('[name=phone]', '9999999999'); await a.fill('[name=code]', 'setup-code'); await a.fill('[name=pin]', '135790')
await a.locator('form button[type=submit]').first().click(); await a.waitForLoadState('networkidle')
if (/setup|login/.test(a.url())) { await a.goto(B + '/admin/login'); await a.fill('[name=phone]', '9999999999'); await a.fill('[name=pin]', '135790'); await a.locator('form button[type=submit]').first().click(); await a.waitForLoadState('networkidle') }
await a.goto(B + '/admin/analytics?d=7&area=site'); const t = await a.innerText('.content')
const kpi = async (label) => Number((await a.locator('.kpi', { hasText: label }).locator('b').innerText()).replace(/\D/g, ''))
check((await a.locator('nav a', { hasText: 'Analytics' }).count()) === 1, 'Analytics is in the admin sidebar')
check(await kpi('Visitors') === 2, 'two visitors counted, the crawler ignored')
check(await kpi('Page views') >= 4, 'page views counted (home, thanks, home, privacy)')
check(await kpi('Get-started requests') === 1 && await kpi('Started a form') >= 1, 'one form started and sent, one request')
check(/Visitor → request\s*50%/.test(t), 'conversion: 1 request from 2 visitors = 50%')
check(t.includes('instagram') && t.includes('google.com'), 'sources: instagram (utm) and google.com (referrer)')
check(/Get started/.test(t) && /\/privacy/.test(t), 'clicked buttons/links listed')
check(/Sent the form\s*\d*\s*1\b/.test(t.replace(/\n/g, ' ')) || t.includes('Sent the form'), 'funnel down to “Sent the form”')
check(/Phone/.test(t) && /Computer/.test(t), 'devices split into phone and computer')
check(!/Avg time per visit\s*0s/.test(t), 'time on page recorded')
await a.goto(B + '/admin/analytics?d=7&area=shop'); check((await a.locator('h1', { hasText: 'Analytics' }).count()) === 1, 'shop view opens')
await a.screenshot({ path: (process.env.OUT || '/tmp') + '/analytics.png', fullPage: true })
await b.close(); console.log(`\n${ok} checks passed`)
