// Renders promo.html frame by frame into a 1080×1920 MP4 (needs ffmpeg with libx264).
// Usage: node render.mjs <promo-dir-with-img/> <out.mp4> [fps] [seconds]
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const [dir, out, fps = '30', secs = '47.5'] = process.argv.slice(2)
const frames = path.join(dir, 'frames')
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 })
await p.goto('file://' + path.resolve(dir, 'promo.html'))
await p.waitForLoadState('networkidle')
const total = Math.round(Number(secs) * Number(fps))
for (let i = 0; i < total; i++) {
  await p.evaluate((t) => window.seek(t), i / Number(fps))
  await p.screenshot({ path: path.join(frames, String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 })
}
await b.close()
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', fps, '-i', path.join(frames, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', out])
console.log('rendered', total, 'frames →', out)
