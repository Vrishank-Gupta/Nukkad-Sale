// Extra real screens for the long-form YouTube videos (run after capture.mjs + capture-features.mjs, same data):
//   node capture-long.mjs ./img
import { chromium } from 'playwright'
const B = 'http://localhost:8787', OUT = process.argv[2]
const b = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-IN' }
let ip = 160
const ctx = async (o = phone) => b.newContext({ ...o, extraHTTPHeaders: { 'cf-connecting-ip': '10.8.2.' + ip++ } })
const shot = (p, n, full = false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full })

// Visitor: website + login
const vc = await ctx(), v = await vc.newPage()
await v.goto(B + '/'); await shot(v, 'long-site-home')
await v.goto(B + '/#get-started'); await v.waitForTimeout(300); await shot(v, 'long-site-form')
await v.goto(B + '/seller?p=9876543210'); await shot(v, 'long-login')

// Seller (Meera)
const sc = await ctx(), s = await sc.newPage(); s.on('dialog', (d) => d.accept())
await s.goto(B + '/seller?p=9876543210'); await s.fill('#pin', '4321'); await s.locator('form button[type=submit]').first().click(); await s.waitForURL(/\/app/)
await s.goto(B + '/app/settings'); await shot(s, 'long-settings')
await s.goto(B + '/app/settings'); await s.locator('#tools').scrollIntoViewIfNeeded(); await s.evaluate(() => scrollBy(0, -80)); await shot(s, 'long-tools')
await s.goto(B + '/app/quick-order'); await shot(s, 'long-quick')
await s.goto(B + '/app/buyers'); await shot(s, 'long-buyers')
await s.goto(B + '/app/help'); await shot(s, 'long-help')
const shopId = (await s.locator('a[href^="/s/"]').first().getAttribute('href').catch(() => null)) ?? null
// Buyer: the shop catalogue page and order tracking
const bc = await ctx(), bp = await bc.newPage()
const drop = await s.locator('a[href^="/app/drops/"]:not([href$="/new"])').first().getAttribute('href').catch(() => null)
await bp.goto(B + (drop ? drop.replace('/app/drops/', '/d/').split('#')[0] : '/'))
const shopLink = await bp.locator('a[href^="/s/"]').first().getAttribute('href').catch(() => shopId)
if (shopLink) { await bp.goto(B + shopLink); await shot(bp, 'long-catalog') }

// Computer: seller home and orders at 1440×900
const dc = await ctx({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }); const d = await dc.newPage()
await d.goto(B + '/seller?p=9876543210'); await d.fill('#pin', '4321'); await d.locator('form button[type=submit]').first().click(); await d.waitForURL(/\/app/)
await d.goto(B + '/app'); await shot(d, 'long-desk-home')
await d.goto(B + '/app/orders?tab=check'); await shot(d, 'long-desk-orders')
await b.close(); console.log('ok')
