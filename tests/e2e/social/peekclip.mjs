import { chromium } from 'playwright'
const [id, out, ...ts] = process.argv.slice(2)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 432, height: 935 } })
await p.goto(`file://${process.cwd()}/site-clips.html#${id}`); await p.waitForLoadState('networkidle')
const shots = []
for (const t of ts) { await p.evaluate((x) => window.seek(x), Number(t)); shots.push(await p.screenshot()) }
await p.setViewportSize({ width: 216 * ts.length, height: 468 })
await p.setContent(`<body style="margin:0;display:flex">${shots.map((s) => `<img src="data:image/png;base64,${s.toString('base64')}" style="width:216px">`).join('')}</body>`)
await p.waitForTimeout(200); await p.screenshot({ path: out }); await b.close()
