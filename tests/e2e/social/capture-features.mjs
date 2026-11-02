// Captures the seller-tools screens (discount, special price, waitlist, profit, labels) from the real app,
// for the feature campaigns. Run after capture.mjs, on the same showcase data, app running locally:
//   KURTA=<sale id> node capture-features.mjs ./img
import { chromium } from 'playwright'
const B = 'http://localhost:8787', OUT = process.argv[2], KURTA = process.env.KURTA
const b = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-IN' }
let ip = 120
const ctx = async () => b.newContext({ ...phone, extraHTTPHeaders: { 'cf-connecting-ip': '10.8.0.' + ip++ } })
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` })
// Scroll so an element sits near the top of the screen, like a person scrolled to it.
const focus = async (p, sel, top = 90) => { await p.locator(sel).first().evaluate((e, top) => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - top), top); await p.waitForTimeout(250) }

const sc = await ctx(), s = await sc.newPage(); s.on('dialog', (d) => d.accept())
await s.goto(B + '/login'); await s.fill('#phone', '9876543210'); await s.fill('#pin', '4321'); await s.locator('form button[type=submit]').first().click(); await s.waitForURL(/\/app/)
const sale = `${B}/app/drops/${KURTA}`

// ---- Profit: cost on a new sale, profit line, khata card
await s.goto(B + '/app/drops/new'); await s.locator('details.quiet summary').click(); await s.fill('#price', '799'); await s.fill('#cost', '450')
await focus(s, '.sec:has-text("Price")', 120); await shot(s, 'feat-newsale-cost')
await s.goto(sale); await s.locator('#cost summary').click(); await s.fill('#costin', '450'); await s.getByRole('button', { name: 'Save cost' }).click(); await s.waitForLoadState('networkidle')
await s.goto(sale); await shot(s, 'feat-sale-profit')
await s.goto(B + '/app/khata'); await shot(s, 'feat-khata-profit')

// ---- Discount: the panel with 20% picked, then what buyers see
await s.goto(sale); await s.locator('details.tool summary', { hasText: 'Discount' }).click(); await s.getByRole('button', { name: '20% off' }).click()
await focus(s, 'details.tool'); await shot(s, 'feat-discount-panel')
await s.getByRole('button', { name: 'Start discount' }).click(); await s.waitForLoadState('networkidle')
await focus(s, '#share', 70); await shot(s, 'feat-discount-share')
const bc = await ctx(), bp = await bc.newPage(); await bp.goto(`${B}/d/${KURTA}`); await bp.evaluate(() => window.scrollTo(0, 250)); await bp.waitForTimeout(200); await shot(bp, 'feat-buyer-discount'); await bc.close()
await s.goto(sale); await s.locator('details.tool summary', { hasText: 'Discount' }).click(); await s.getByRole('button', { name: /End discount/ }).click(); await s.waitForLoadState('networkidle')

// ---- Special price for one buyer: link ready, then her page
await s.goto(sale); await s.locator('details.tool summary', { hasText: 'Special price' }).click()
await s.fill('#oprice', '650'); await s.fill('#ophone', '9822012345'); await s.fill('#oname', 'Meena')
await focus(s, 'details.tool >> nth=1'); await shot(s, 'feat-offer-form')
await s.getByRole('button', { name: 'Create link' }).click(); await s.waitForLoadState('networkidle')
const link = await s.inputValue('#offerlink'); await focus(s, '#offers'); await shot(s, 'feat-offer-ready')
const mc = await ctx(), mp = await mc.newPage(); await mp.goto(link); await mp.evaluate(() => window.scrollTo(0, 200)); await mp.waitForTimeout(200); await shot(mp, 'feat-buyer-offer'); await mc.close()

// ---- Waitlist: a one-piece sale sells out, six buyers ask, stock comes back
const r = await s.request.post(B + '/app/drops/new', { headers: { Origin: B }, multipart: { title: 'Hand-painted jhumkas – teal', price: '549', stock: '1', max: '1', description: 'One-of-a-kind.' }, maxRedirects: 0 })
const one = r.headers()['location'].match(/drops\/([a-z0-9]+)/)[1]
const v = await s.request.get(`${B}/d/${one}`); const vid = (await v.text()).match(/name="variant" value="(\d+)"/)[1]
const first = await ctx(); await first.request.post(`${B}/d/${one}`, { headers: { Origin: B }, form: { variant: vid, qty: '1', name: 'Pooja Iyer', phone: '9822100001', address: '5 Lake View Road, Chennai', pincode: '600028' }, maxRedirects: 0 }); await first.close()
const wc = await ctx(), wp = await wc.newPage(); await wp.goto(`${B}/d/${one}`); await focus(wp, '#notify', 300); await shot(wp, 'feat-notify'); await wc.close()
for (const [n, p] of [['Ritu Jain', '9822100002'], ['Sana Qureshi', '9822100003'], ['Kavya Rao', '9822100004'], ['Neha Gupta', '9822100005'], ['Divya Menon', '9822100006'], ['Anjali Verma', '9822100007']]) {
  const c = await ctx(); await c.request.post(`${B}/d/${one}/waitlist`, { headers: { Origin: B }, form: { name: n, phone: p }, maxRedirects: 0 }); await c.close()
}
await s.goto(`${B}/app/drops/${one}`); await s.locator('details:not(.tool):not(.quiet) > summary').filter({ hasText: /close sale|stock/i }).first().click()
await s.locator('form[action$="/stock"] input[type=number]').first().fill('6'); await s.getByRole('button', { name: /Save stock/i }).click(); await s.waitForLoadState('networkidle')
await s.goto(B + '/app'); await shot(s, 'feat-home-waiting')
await s.goto(`${B}/app/drops/${one}`); await focus(s, '#waiting'); await shot(s, 'feat-waitlist')

// ---- Labels: the button on "To send", and the sheet (A4 width)
await s.goto(B + '/app/orders?tab=send'); await shot(s, 'feat-labels-btn')
const dc = await b.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2, extraHTTPHeaders: { 'cf-connecting-ip': '10.8.1.1' } })
await dc.addCookies(await sc.cookies()); const dp = await dc.newPage(); await dp.goto(B + '/app/orders/labels'); await dp.emulateMedia({ media: 'print' }); await dp.screenshot({ path: `${OUT}/feat-labels-sheet.png` })
await b.close(); console.log('ok')
