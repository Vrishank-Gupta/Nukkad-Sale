import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 440, height: 952 } })
await p.setContent('<body style="margin:0;background:#000"><div style="width:440px;height:952px;border-radius:44px;background:#fff"></div></body>')
await p.screenshot({ path: process.argv[2] }); await b.close()
