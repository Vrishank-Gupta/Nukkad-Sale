import { chromium } from 'playwright'
import fs from 'node:fs'
const b = await chromium.launch(); const out = {}
for (const size of [180, 192, 512]) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  // Full-bleed square: iOS and Android apply their own rounded mask.
  await p.setContent(`<body style="margin:0;width:${size}px;height:${size}px;background:linear-gradient(145deg,#f76707,#d9480f);display:flex;align-items:center;justify-content:center">
  <svg viewBox="0 0 24 24" width="${size * 0.6}" height="${size * 0.6}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 3h13.6L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="#fff" stroke-width="1.4"/><path d="M5 12.6V21h14v-8.4M10 21v-5h4v5"/></svg></body>`)
  out[size] = (await p.screenshot({ type: 'png' })).toString('base64'); await p.close()
}
await b.close()
const icons = `export const ICONS: Record<string, string> = ${JSON.stringify({ 'apple-touch-icon.png': out[180], 'icon-192.png': out[192], 'icon-512.png': out[512] }, null, 1)}\n`
// Replace only the ICONS block, so the SCREENSHOTS that follow it in the same file are kept.
const prev = fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : ''
const rest = prev.includes('export const SCREENSHOTS') ? '\n' + prev.slice(prev.indexOf('export const SCREENSHOTS')) : ''
fs.writeFileSync(process.argv[2], `// Generated app icons (PNG, base64) for the home-screen install. Regenerate rather than edit.\n${icons}${rest}`)
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])))
