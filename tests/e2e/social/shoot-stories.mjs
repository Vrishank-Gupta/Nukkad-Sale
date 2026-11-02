// Renders stories.html frames at 1080×1920 → out/stories/<series>-<n>.png
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('out/stories', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 })
await p.goto(`file://${process.cwd()}/stories.html#how-1`); await p.waitForLoadState('networkidle')
for (const id of await p.evaluate(() => window.IDS)) {
  await p.goto(`file://${process.cwd()}/stories.html#${id}`); await p.reload(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(120)
  await p.locator('.f').screenshot({ path: `out/stories/${id}.png` })
}
await b.close(); console.log('ok')
