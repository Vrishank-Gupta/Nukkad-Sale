// Renders site-clips.html#<clip>-<lang> → public/site/clips/<clip>-<lang>.mp4 (+ .webp poster). Silent, loops on the site.
// node render-clips.mjs [flow orders payments delivery accounts]
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
const clips = process.argv.slice(2).length ? process.argv.slice(2) : ['flow', 'orders', 'payments', 'delivery', 'accounts']
const OUT = '../../../public/site/clips', fps = 24
fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 432, height: 936 } })
for (const clip of clips) for (const lang of ['en', 'hi']) {
  const name = `${clip}-${lang}`, dir = `${process.cwd()}/frames-${name}`
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir)
  await p.goto(`file://${process.cwd()}/site-clips.html#${name}`); await p.reload(); await p.waitForLoadState('networkidle')
  const d = await p.evaluate(() => window.DURATION)
  for (let i = 0; i < Math.round(d * fps); i++) {
    await p.evaluate((x) => window.seek(x), i / fps + 0.0001)
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 })
  }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '29', '-vf', 'scale=360:-2', '-movflags', '+faststart', '-an', `${OUT}/${name}.mp4`])
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${dir}/00012.jpg`, '-q:v', '80', `${OUT}/${name}.webp`])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(name, d.toFixed(1) + 's', Math.round(fs.statSync(`${OUT}/${name}.mp4`).size / 1024) + ' KB')
}
await b.close()
