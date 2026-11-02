import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 })
await p.goto(`file://${process.cwd()}/posts.html#p1`); await p.waitForLoadState('networkidle')
for (const id of await p.evaluate(() => window.IDS)) {
  await p.goto(`file://${process.cwd()}/posts.html#${id}`); await p.reload(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(150)
  await p.locator('.f').screenshot({ path: `out/${id.startsWith('s') ? 'story' : 'post'}-${id}.png` })
}
await b.close(); console.log('ok')
