// Renders build/reels.html#<n> frame by frame → out/reel-<n>-silent.mp4 and out/reel-<n>.json (duration, cuts).
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const n = process.argv[2], fps = 30, dir = `${process.cwd()}/frames-${n}`
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir); fs.mkdirSync('out', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 })
await p.goto(`file://${process.cwd()}/reels.html#${n}`); await p.waitForLoadState('networkidle')
const { d, cuts, cues } = await p.evaluate(() => ({ d: window.DURATION, cuts: window.CUTS, cues: window.CUES || {} }))
const total = Math.round(d * fps)
for (let i = 0; i < total; i++) {
  await p.evaluate((t) => window.seek(t), i / fps)
  await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 })
}
await b.close()
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '19', `out/reel-${n}-silent.mp4`])
fs.writeFileSync(`out/reel-${n}.json`, JSON.stringify({ d, cuts, ...cues }))
fs.rmSync(dir, { recursive: true, force: true })
console.log('reel', n, d.toFixed(2), 's')
