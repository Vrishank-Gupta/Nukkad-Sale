// Installable-app checks against a running deployment: node pwa.mjs <base-url> <tmp-dir>
import { chromium, devices } from 'playwright'
import fs from 'node:fs'
const [B, TMP] = process.argv.slice(2)
let fails = 0
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) fails++ }
fs.rmSync(TMP + '/profile', { recursive: true, force: true })
// A persistent (non-incognito) profile, like a real phone browser – Chrome refuses installs in incognito.
const ctx = await chromium.launchPersistentContext(TMP + '/profile', { ...devices['Pixel 7'], channel: 'chromium' })
ctx.setDefaultTimeout(15000)
const p = await ctx.newPage()
// The marketing site (/) is a plain page; the installable app (manifest + service worker) starts at /login.
await p.goto(B + '/login')
const m = await (await p.request.get(B + '/manifest.webmanifest')).json()
check(m.display === 'standalone' && m.icons.some((i) => i.sizes === '512x512') && m.shortcuts.length === 3 && m.screenshots.length === 2, 'manifest: standalone, icons, 3 shortcuts, 2 screenshots')
for (const u of [...m.icons.map((i) => i.src), ...m.screenshots.map((s) => s.src)]) {
  const r = await p.request.get(B + u); if (!r.ok()) check(false, `${u} ${r.status()}`)
}
console.log('  … waiting for service worker'); await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, r) => setTimeout(() => r(new Error('sw not ready')), 10000))]))
await p.reload()
check(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'service worker installed and controlling the page')
const cdp = await ctx.newCDPSession(p)
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
check(installabilityErrors.length === 0, `Chrome says the app is installable${installabilityErrors.length ? ': ' + JSON.stringify(installabilityErrors) : ''}`)
// Install card appears once Chrome offers installation
await p.goto(B + '/signup')
await p.fill('#name', 'PWA Test'); await p.fill('#shop', 'PWA Test Shop'); await p.fill('#phone', '9000000088'); await p.fill('#vpa', 'pwatest@ybl'); await p.fill('#pin', '1234')
await p.click('button[type=submit]'); await p.waitForURL(/\/app/)
await p.goto(B + '/app')
await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e) })
check(await p.locator('[data-install] [data-install-go]').isVisible(), 'Android/Chrome: “📲 Install app” button appears')
await p.screenshot({ path: TMP + '/pwa-card.png' })
await p.locator('[data-install] [data-install-go]').first().waitFor()
await p.locator('[data-install-hide]').first().click()
await p.locator('[data-install]').first().waitFor({ state: 'hidden' })
await p.waitForFunction(() => localStorage.getItem('kk_install_hide') === '1')
await p.reload(); await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e) })
check(!(await p.locator('[data-install]').first().isVisible()), '“✕” dismiss is remembered on Home')
await p.goto(B + '/app/settings'); await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({}); dispatchEvent(e) })
check(await p.locator('[data-install="always"] [data-install-go]').isVisible(), 'Settings always offers Install')
// Offline
await ctx.setOffline(true)
await p.goto(B + '/app/khata').catch(() => {})
check((await p.content()).includes('You’re offline') && (await p.content()).includes('इंटरनेट नहीं है'), 'offline: friendly English + Hindi page instead of the browser error')
await ctx.setOffline(false)
await ctx.close()
// iPhone gets instructions instead (Safari has no install prompt)
const b = await chromium.launch({ channel: 'chromium' }); const ip = await (await b.newContext({ ...devices['iPhone 13'] })).newPage()
await ip.goto(B + '/login'); await ip.fill('#phone', '9000000088'); await ip.fill('#pin', '1234'); await ip.click('button[type=submit]'); await ip.waitForURL(/\/app/)
await ip.goto(B + '/app')
check(await ip.locator('[data-install] [data-for="ios"]').isVisible() && !(await ip.locator('[data-install] [data-install-go]').isVisible()), 'iPhone: “Share → Add to Home Screen” instructions shown')
await ip.screenshot({ path: TMP + '/pwa-ios.png' })
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
