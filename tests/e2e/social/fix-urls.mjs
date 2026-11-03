// Replaces dev-only localhost links (and one stray price) in captured app screens with the real nukkadsale.in links (canvas patch).
// node fix-urls.mjs  → rewrites img/feat-offer-ready.png and img/feat-discount-share.png in place.
import { chromium } from 'playwright'
import fs from 'node:fs'
const jobs = [
  { f: 'img/feat-offer-ready.png', box: [160, 790, 855, 80], bgAt: [170, 830], fgAt: null, color: '#2b8a3e', text: 'https://nukkadsale.in/d/tgwq9e3', x: 186, y: 848, size: 45 },
  // The special-price story is "₹650 for Meena" everywhere else; this capture had 719 typed in.
  { f: 'img/feat-offer-ready.png', box: [215, 1280, 140, 62], bgAt: [400, 1300], color: '#767676', weight: 'bold ', text: '650', x: 223, y: 1331, size: 60 },
  { f: 'img/feat-discount-share.png', box: [125, 1785, 900, 70], bgAt: [128, 1790], color: '#1d1a16', text: 'https://nukkadsale.in/w/tgwq9e3', x: 135, y: 1835, size: 45 },
]
const b = await chromium.launch(); const p = await b.newPage()
for (const j of jobs) {
  const src = 'data:image/png;base64,' + fs.readFileSync(j.f).toString('base64')
  const out = await p.evaluate(async ({ src, j }) => {
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const [r, gg, bb] = g.getImageData(j.bgAt[0], j.bgAt[1], 1, 1).data
    g.fillStyle = `rgb(${r},${gg},${bb})`; g.fillRect(...j.box)
    g.fillStyle = j.color; g.font = `${j.weight || ''}${j.size}px "DejaVu Sans"`; g.textBaseline = 'alphabetic'; g.fillText(j.text, j.x, j.y)
    return c.toDataURL('image/png')
  }, { src, j })
  fs.writeFileSync(j.f, Buffer.from(out.split(',')[1], 'base64')); console.log('fixed', j.f)
}
await b.close()
