// Builds a long-form explainer: voiceover (Kokoro, local) → scene timing → frames → MP4 with voice + soft music.
//   node longform.mjs <n> [--voice af_heart] [--fps 24] [--vo-only]
// Needs: img/ screens (capture*.mjs), the Kokoro venv (KOKORO_PY, KOKORO_MODELS env), ffmpeg.
// Output: out/long-<n>.mp4 and out/long-<n>.meta.json (title, description with chapters, tags).
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { VIDEOS } from './longform-scripts.mjs'

const args = process.argv.slice(2)
const n = args[0], opt = (k, d) => { const i = args.indexOf('--' + k); return i > -1 ? args[i + 1] : d }
const V = VIDEOS[n]; if (!V) throw new Error('No video ' + n)
const voice = opt('voice', V.voice ?? 'af_heart'), fps = Number(opt('fps', 24))
const PY = process.env.KOKORO_PY, MODELS = process.env.KOKORO_MODELS
const dir = path.resolve('out/long-' + n); fs.mkdirSync(dir + '/vo', { recursive: true })

// 1. Voiceover per scene (cached by text)
const jobs = V.scenes.map((sc, i) => ({ text: sc.say, out: `${dir}/vo/${String(i).padStart(2, '0')}.wav`, voice, speed: sc.speed ?? V.speed ?? 1.0, lang: voice.startsWith('b') ? 'en-gb' : 'en-us' }))
fs.writeFileSync(dir + '/jobs.json', JSON.stringify(jobs))
const durs = JSON.parse(execFileSync(PY, ['-I', path.resolve('vo.py'), MODELS, dir + '/jobs.json']).toString().trim().split('\n').pop())
const LEAD = 0.45, TAIL = 1.05
V.scenes.forEach((sc, i) => { sc.vo = durs[jobs[i].out]; sc.d = +(LEAD + sc.vo + (sc.tail ?? TAIL)).toFixed(2) })
fs.writeFileSync(`out/long-${n}.js`, 'window.VIDEO = ' + JSON.stringify(V))
const total = V.scenes.reduce((a, s) => a + s.d, 0)
console.log(`video ${n}: ${V.scenes.length} scenes, ${total.toFixed(1)} s`)

// Chapters for the description (YouTube needs the first at 0:00 and each ≥10 s)
const mmss = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`
let t = 0; const chapters = []
for (const sc of V.scenes) { if (sc.chapter) chapters.push([t, sc.chapter]); t += sc.d }
const desc = [V.description.trim(), '', 'Chapters', ...chapters.map(([at, c]) => `${mmss(at)} ${c}`), '', 'Get started: https://nukkadsale.in', 'Seller login: https://nukkadsale.in/seller', '', V.tags.map((x) => '#' + x.replace(/\s+/g, '')).slice(0, 3).join(' ')].join('\n')
fs.writeFileSync(`out/long-${n}.meta.json`, JSON.stringify({ title: V.title, description: desc, tags: V.tags, duration: total }, null, 1))
if (args.includes('--vo-only')) process.exit(0)

// 2. Frames
const fdir = dir + '/frames'; fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })
await p.goto(`file://${process.cwd()}/longform.html#${n}`); await p.waitForFunction(() => window.READY); await p.waitForLoadState('networkidle')
const frames = Math.round(total * fps)
for (let i = 0; i < frames; i++) {
  await p.evaluate((x) => window.seek(x), i / fps)
  await p.screenshot({ path: `${fdir}/${String(i).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 90 })
  if (i % (fps * 30) === 0) console.log(`  frame ${i}/${frames}`)
}
await b.close()
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', `${fdir}/%06d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', `${dir}/silent.mp4`])
fs.rmSync(fdir, { recursive: true, force: true })

// 3. Audio: each scene's voice at its start (+LEAD), over a soft warm pad that ducks under speech
let at = 0; const inputs = [], delays = []
V.scenes.forEach((sc, i) => { inputs.push('-i', jobs[i].out); delays.push(`[${i + 1}:a]aresample=44100,adelay=${Math.round((at + LEAD) * 1000)}|${Math.round((at + LEAD) * 1000)}[v${i}]`); at += sc.d })
const nV = V.scenes.length
const pad = `aevalsrc='0.05*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.035*sin(2*PI*164.8*t)*(0.6+0.4*sin(2*PI*0.05*t+1))+0.03*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.09*t+2))':s=44100:d=${total.toFixed(2)},lowpass=f=1200,afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[pad]`
const fc = [pad, ...delays, `${Array.from({ length: nV }, (_, i) => `[v${i}]`).join('')}amix=inputs=${nV}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)}[voice]`,
  `[voice]asplit[voice1][voice2]`, `[pad][voice2]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[padd]`,
  `[voice1][padd]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=9[mix]`].join(';')
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${dir}/silent.mp4`, ...inputs, '-filter_complex', fc, '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', `out/long-${n}.mp4`])
console.log(`✓ out/long-${n}.mp4 (${mmss(total)})`)
