// Quick look at reel frames without a full render: node peek.mjs <n> <out.png> t1 t2 …
import { chromium } from 'playwright'
const [n, out, ...ts] = process.argv.slice(2)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 720, height: 1280 } })
await p.goto(`file://${process.cwd()}/reels.html#${n}`); await p.waitForLoadState('networkidle')
const shots = []
for (const t of ts) { await p.evaluate((x) => window.seek(x), Number(t)); shots.push(await p.screenshot({ type: 'png' })) }
await p.setViewportSize({ width: 240 * ts.length, height: 427 })
await p.setContent(`<body style="margin:0;display:flex">${shots.map((s) => `<img src="data:image/png;base64,${s.toString('base64')}" style="width:240px">`).join('')}</body>`)
await p.waitForTimeout(200); await p.screenshot({ path: out }); await b.close()
