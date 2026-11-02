// Renders brand.html items at real pixel size → out/brand-<id>.png, plus round-crop previews.
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1640, height: 1920 } })
await p.goto(`file://${process.cwd()}/brand.html#profile`); await p.waitForLoadState('networkidle')
for (const id of await p.evaluate(() => window.IDS)) {
  await p.goto(`file://${process.cwd()}/brand.html#${id}`); await p.reload(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(150)
  await p.locator('.f').screenshot({ path: `out/brand-${id}.png` })
}
// how the profile picture looks in the round crop, at feed size
await p.setViewportSize({ width: 420, height: 160 })
await p.setContent(`<body style="margin:0;background:#fff;display:flex;gap:24px;align-items:center;padding:20px;font-family:system-ui">
  ${[110, 56, 32].map((s) => `<img src="file://${process.cwd()}/out/brand-profile.png" style="width:${s}px;height:${s}px;border-radius:50%">`).join('')}
  <img src="file://${process.cwd()}/out/brand-hl-pay.png" style="width:64px;height:64px;border-radius:50%;object-fit:cover"></body>`)
await p.waitForTimeout(200); await p.screenshot({ path: 'out/brand-preview-round.png' })
await b.close(); console.log('ok')
