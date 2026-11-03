// Renders only the given post ids: node shoot-only.mjs p18 p19a …  → out/post-<id>.png
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 })
for (const id of process.argv.slice(2)) {
  await p.goto(`file://${process.cwd()}/posts.html#${id}`); await p.reload(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(150)
  await p.locator('.f').screenshot({ path: `out/${id.startsWith('s') ? 'story' : 'post'}-${id}.png` })
}
await b.close(); console.log('ok')
