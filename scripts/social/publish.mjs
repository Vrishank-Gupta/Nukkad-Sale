#!/usr/bin/env node
// Publishes NukkadSale's reels, feed posts and stories (docs/social/) to Instagram through the
// Instagram Graph API (content publishing).
//
//   node scripts/social/publish.mjs whoami            # which Instagram account the token posts to
//   node scripts/social/publish.mjs list              # everything that can be posted, and what already was
//   node scripts/social/publish.mjs limit             # posts left in Instagram's 24-hour publishing limit
//   node scripts/social/publish.mjs post reel-6       # publish one item (--dry-run to preview, --again to repost)
//
// Config (never commit it): ~/.khatakhat/meta.env (chmod 600) or environment variables:
//   META_TOKEN    long-lived token. Facebook Login token (EAA…) with instagram_basic, instagram_content_publish,
//                 pages_show_list, pages_read_engagement – or an Instagram Login token (IG…) with
//                 instagram_business_basic, instagram_business_content_publish.
//   IG_USER_ID    optional; found automatically from the token.
//   PUBLIC_BASE   public origin of the app; images are served from its /img/ route (Instagram fetches
//                 images by URL). Default https://nukkadsale.in
//   GRAPH_BASE, RUPLOAD_BASE, R2_LOCAL=1, SOCIAL_LOG   test overrides (see tests/e2e/mock_graph.py).
//
// Captions come from docs/social/CAPTIONS.md (the blockquote under each "### Reel N" / "### Post N").
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { youtubeChannel, youtubeLogin, youtubeUpload, youtubeUploadVideo } from './youtube.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const SOCIAL = path.join(ROOT, 'docs/social')
const LOG = process.env.SOCIAL_LOG || path.join(SOCIAL, 'published.json')
const VERSION = 'v23.0'

// What can be posted. Captions are looked up by `caption` heading in CAPTIONS.md.
const ITEMS = {
  'reel-1': { type: 'reel', file: 'reels/reel-1-paise-trick.mp4', cover: 'reels/reel-1-paise-trick-cover.jpg', caption: 'Reel 1' },
  'reel-2': { type: 'reel', file: 'reels/reel-2-group-is-your-shop.mp4', cover: 'reels/reel-2-group-is-your-shop-cover.jpg', caption: 'Reel 2' },
  'reel-3': { type: 'reel', file: 'reels/reel-3-last-piece.mp4', cover: 'reels/reel-3-last-piece-cover.jpg', caption: 'Reel 3' },
  'reel-4': { type: 'reel', file: 'reels/reel-4-photo-to-sale.mp4', cover: 'reels/reel-4-photo-to-sale-cover.jpg', caption: 'Reel 4' },
  'reel-5': { type: 'reel', file: 'reels/reel-5-khata-hindi.mp4', cover: 'reels/reel-5-khata-hindi-cover.jpg', caption: 'Reel 5' },
  'reel-6': { type: 'reel', file: 'reels/reel-6-dm-flood.mp4', cover: 'reels/reel-6-dm-flood-cover.jpg', caption: 'Reel 6' },
  'reel-7': { type: 'reel', file: 'reels/reel-7-fake-screenshot.mp4', cover: 'reels/reel-7-fake-screenshot-cover.jpg', caption: 'Reel 7' },
  'reel-8': { type: 'reel', file: 'reels/reel-8-chasing-payments.mp4', cover: 'reels/reel-8-chasing-payments-cover.jpg', caption: 'Reel 8' },
  'reel-9': { type: 'reel', file: 'reels/reel-9-month-end.mp4', cover: 'reels/reel-9-month-end-cover.jpg', caption: 'Reel 9' },
  'reel-10': { type: 'reel', file: 'reels/reel-10-promo.mp4', cover: 'reels/reel-10-promo-cover.jpg', caption: 'Reel 10' },
  'reel-11': { type: 'reel', file: 'reels/reel-11-big-sellers.mp4', cover: 'reels/reel-11-big-sellers-cover.jpg', caption: 'Reel 11' },
  'reel-12': { type: 'reel', file: 'reels/reel-12-discount.mp4', cover: 'reels/reel-12-discount-cover.jpg', caption: 'Reel 12' },
  'reel-13': { type: 'reel', file: 'reels/reel-13-special-price.mp4', cover: 'reels/reel-13-special-price-cover.jpg', caption: 'Reel 13' },
  'reel-14': { type: 'reel', file: 'reels/reel-14-waitlist.mp4', cover: 'reels/reel-14-waitlist-cover.jpg', caption: 'Reel 14' },
  'reel-15': { type: 'reel', file: 'reels/reel-15-profit.mp4', cover: 'reels/reel-15-profit-cover.jpg', caption: 'Reel 15' },
  'reel-16': { type: 'reel', file: 'reels/reel-16-labels.mp4', cover: 'reels/reel-16-labels-cover.jpg', caption: 'Reel 16' },
  'post-1': { type: 'image', file: 'posts/post-1-launch.png', caption: 'Post 1' },
  'post-2': { type: 'carousel', files: 'abcdef'.split('').map((x) => `posts/post-2-carousel-${x}.png`), caption: 'Post 2' },
  'post-3': { type: 'image', file: 'posts/post-3-paise.png', caption: 'Post 3' },
  'post-4': { type: 'image', file: 'posts/post-4-khata-hindi.png', caption: 'Post 4' },
  'post-5': { type: 'image', file: 'posts/post-5-two-ways.png', caption: 'Post 5' },
  'post-6': { type: 'image', file: 'posts/post-6-screenshot.png', caption: 'Post 6' },
  'post-7': { type: 'image', file: 'posts/post-7-fake-screenshot.png', caption: 'Post 7' },
  'post-8': { type: 'image', file: 'posts/post-8-chasing-payments.png', caption: 'Post 8' },
  'post-9': { type: 'image', file: 'posts/post-9-month-end.png', caption: 'Post 9' },
  'post-10': { type: 'carousel', files: 'abcdefg'.split('').map((x) => `posts/post-10-outgrown-dms-${x}.png`), caption: 'Post 10' },
  'post-11': { type: 'carousel', files: 'abcdef'.split('').map((x) => `posts/post-11-big-sellers-${x}.png`), caption: 'Post 11' },
  'post-12': { type: 'image', file: 'posts/post-12-discount.png', caption: 'Post 12' },
  'post-13': { type: 'carousel', files: 'abcde'.split('').map((x) => `posts/post-13-special-price-${x}.png`), caption: 'Post 13' },
  'post-14': { type: 'image', file: 'posts/post-14-waitlist.png', caption: 'Post 14' },
  'post-15': { type: 'carousel', files: 'abcde'.split('').map((x) => `posts/post-15-profit-${x}.png`), caption: 'Post 15' },
  'post-16': { type: 'image', file: 'posts/post-16-labels.png', caption: 'Post 16' },
  'post-17': { type: 'carousel', files: 'abcdefg'.split('').map((x) => `posts/post-17-new-things-${x}.png`), caption: 'Post 17' },
  // Stickers (poll, quiz, link) can't be added through the API – those stories are best posted in the app.
  'story-1': { type: 'story', file: 'stories/story-1-poll.png', note: 'needs a Poll sticker – post it in the app' },
  'story-2': { type: 'story', file: 'stories/story-2-quiz.png', note: 'needs a Quiz sticker – post it in the app' },
  'story-3': { type: 'story', file: 'stories/story-3-sneak-peek.png', note: 'meant to carry a Link sticker – post it in the app' },
  'story-4': { type: 'story', file: 'stories/story-4-hindi.png' },
  // Highlight series (docs/social/CONTENT-STRATEGY.md): post all frames of one series the same day, in order.
  'disc-1': { type: 'story', file: 'stories/series/disc-1.png' },
  'disc-2': { type: 'story', file: 'stories/series/disc-2.png' },
  'disc-3': { type: 'story', file: 'stories/series/disc-3.png' },
  'new-1': { type: 'story', file: 'stories/series/new-1.png' },
  'new-2': { type: 'story', file: 'stories/series/new-2.png' },
  'new-3': { type: 'story', file: 'stories/series/new-3.png' },
  'new-4': { type: 'story', file: 'stories/series/new-4.png' },
  'new-5': { type: 'story', file: 'stories/series/new-5.png' },
  'new-6': { type: 'story', file: 'stories/series/new-6.png' },
  'how-1': { type: 'story', file: 'stories/series/how-1.png' },
  'how-2': { type: 'story', file: 'stories/series/how-2.png' },
  'how-3': { type: 'story', file: 'stories/series/how-3.png' },
  'how-4': { type: 'story', file: 'stories/series/how-4.png' },
  'how-5': { type: 'story', file: 'stories/series/how-5.png' },
  'how-6': { type: 'story', file: 'stories/series/how-6.png' },
  'how-7': { type: 'story', file: 'stories/series/how-7.png' },
  'how-8': { type: 'story', file: 'stories/series/how-8.png' },
  'pay-1': { type: 'story', file: 'stories/series/pay-1.png' },
  'pay-2': { type: 'story', file: 'stories/series/pay-2.png' },
  'pay-3': { type: 'story', file: 'stories/series/pay-3.png' },
  'pay-4': { type: 'story', file: 'stories/series/pay-4.png' },
  'pay-5': { type: 'story', file: 'stories/series/pay-5.png' },
  'pay-6': { type: 'story', file: 'stories/series/pay-6.png' },
  'khata-1': { type: 'story', file: 'stories/series/khata-1.png' },
  'khata-2': { type: 'story', file: 'stories/series/khata-2.png' },
  'khata-3': { type: 'story', file: 'stories/series/khata-3.png' },
  'khata-4': { type: 'story', file: 'stories/series/khata-4.png' },
  'khata-5': { type: 'story', file: 'stories/series/khata-5.png' },
  'faq-1': { type: 'story', file: 'stories/series/faq-1.png' },
  'faq-2': { type: 'story', file: 'stories/series/faq-2.png' },
  'faq-3': { type: 'story', file: 'stories/series/faq-3.png' },
  'faq-4': { type: 'story', file: 'stories/series/faq-4.png' },
  'faq-5': { type: 'story', file: 'stories/series/faq-5.png' },
  'faq-6': { type: 'story', file: 'stories/series/faq-6.png' },
}
// Every reel and feed post can also go out as a story the same day: "<id>-story". A reel story is the reel itself;
// a post story is a 9:16 version of the post (first slide for carousels) made by `make-stories`.
for (const [k, it] of Object.entries({ ...ITEMS })) {
  if (it.type === 'reel') ITEMS[`${k}-story`] = { type: 'story', file: it.file }
  else if (it.type === 'image' || it.type === 'carousel') ITEMS[`${k}-story`] = { type: 'story', file: `stories/shared/${k}.jpg`, from: (it.files ?? [it.file])[0] }
  // Each carousel slide as its own story frame too: "<id>-story-a", "-b", … (a story set that walks through the carousel).
  if (it.type === 'carousel') it.files.forEach((f, i) => { const l = 'abcdefghij'[i]; ITEMS[`${k}-story-${l}`] = { type: 'story', file: `stories/shared/${k}-${l}.jpg`, from: f } })
}

// Daily plan for the GitHub Action (.github/workflows/social.yml): { "time": "19:00", "days": { "YYYY-MM-DD": [ids…] } }, IST.
const SCHEDULE = path.join(SOCIAL, 'schedule.json')
// Images uploaded ahead of time (`stage`), so the Action needs no Cloudflare access: { "docs/social path": { sha, url } }.
const HOSTED = path.join(SOCIAL, 'hosted.json')
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {})
const istToday = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)

// ---------- config ----------
function loadConfig() {
  const file = path.join(os.homedir(), '.khatakhat/meta.env')
  const fromFile = {}
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) fromFile[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
  const get = (k, d) => process.env[k] ?? fromFile[k] ?? d
  const token = get('META_TOKEN')
  const igLogin = Boolean(token?.startsWith('IG'))
  return {
    token,
    igLogin,
    igUserId: get('IG_USER_ID'),
    graph: get('GRAPH_BASE', igLogin ? 'https://graph.instagram.com' : 'https://graph.facebook.com') + '/' + VERSION,
    rupload: get('RUPLOAD_BASE', 'https://rupload.facebook.com') + '/ig-api-upload/' + VERSION,
    publicBase: get('PUBLIC_BASE', 'https://nukkadsale.in').replace(/\/$/, ''),
    r2Local: get('R2_LOCAL') === '1',
    // Facebook Page: same Meta token (needs pages_manage_posts), or a Page token of its own. FACEBOOK=0 turns it off.
    facebook: get('FACEBOOK', '1') !== '0',
    fbGraph: get('FB_GRAPH_BASE', 'https://graph.facebook.com') + '/' + VERSION,
    fbPageId: get('FB_PAGE_ID'),
    fbPageToken: get('FB_PAGE_TOKEN'),
  }
}

// ---------- captions ----------
function captionFor(heading) {
  const md = fs.readFileSync(path.join(SOCIAL, 'CAPTIONS.md'), 'utf8').split('\n')
  const start = md.findIndex((l) => l.startsWith(`### ${heading} `) || l === `### ${heading}`)
  if (start < 0) throw new Error(`No "### ${heading}" section in CAPTIONS.md`)
  const out = []
  for (let i = start + 1; i < md.length && !md[i].startsWith('#'); i++) {
    if (md[i].startsWith('>')) out.push(md[i].replace(/^> ?/, ''))
    else if (out.length && md[i].trim() !== '') break
  }
  const caption = out.join('\n').trim()
  if (!caption) throw new Error(`No caption (blockquote) under "### ${heading}" in CAPTIONS.md`)
  if (caption.length > 2200) throw new Error(`Caption for ${heading} is ${caption.length} characters; Instagram allows 2,200`)
  return caption
}

// ---------- Graph API ----------
async function api(cfg, method, p, params = {}) {
  const url = new URL(cfg.graph + p)
  const init = { method, headers: { Authorization: `Bearer ${cfg.token}` } }
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  else init.body = new URLSearchParams(params)
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const e = data.error ?? {}
    throw new Error(`Instagram API ${method} ${p}: ${e.message ?? res.status}${e.error_user_msg ? ` – ${e.error_user_msg}` : ''} (code ${e.code ?? '?'}${e.error_subcode ? '/' + e.error_subcode : ''})`)
  }
  return data
}

async function account(cfg) {
  if (cfg.igUserId) return { id: cfg.igUserId }
  if (cfg.igLogin) {
    const me = await api(cfg, 'GET', '/me', { fields: 'user_id,username' })
    return { id: me.user_id ?? me.id, username: me.username }
  }
  const pages = await api(cfg, 'GET', '/me/accounts', { fields: 'name,instagram_business_account{id,username}' })
  const page = (pages.data ?? []).find((x) => x.instagram_business_account)
  if (!page) throw new Error('This token sees no Facebook Page with a linked Instagram professional account. Link Instagram to the Page (Page settings → Linked accounts) and make sure the token has pages_show_list and instagram_basic.')
  return { id: page.instagram_business_account.id, username: page.instagram_business_account.username, page: page.name }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitReady(cfg, containerId) {
  for (let i = 0; i < 120; i++) {
    const s = await api(cfg, 'GET', `/${containerId}`, { fields: 'status_code,status' })
    if (s.status_code === 'FINISHED') return
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the media: ${s.status ?? s.status_code}`)
    await sleep(i < 5 ? 2000 : 5000)
  }
  throw new Error('Instagram is still processing after 10 minutes; try `post` again later')
}

// Videos go straight from this computer to Instagram (resumable upload) – no public URL needed.
// Instagram's upload server sometimes fails with a transient "ProcessingFailedError", so retry a few times.
async function uploadVideo(cfg, container, file) {
  const bytes = fs.readFileSync(file)
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(container.uri ?? `${cfg.rupload}/${container.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${cfg.token}`, offset: '0', file_size: String(bytes.length) },
      body: bytes,
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.success !== false) return
    if (attempt >= 3) throw new Error(`Video upload failed: ${JSON.stringify(data.debug_info ?? data)}`)
    console.log(`  upload failed (${data.debug_info?.type ?? res.status}), retrying…`)
    await sleep(15000 * attempt)
  }
}

// Images must be public JPEG URLs: convert, put them in the app's R2 bucket, serve via /img/social/….
function hostImage(cfg, file) {
  const rel = path.relative(SOCIAL, file)
  const sha = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
  const hosted = readJson(HOSTED)
  if (!cfg.r2Local && hosted[rel]?.sha === sha) return hosted[rel].url
  if (process.env.SOCIAL_NO_UPLOAD === '1') throw new Error(`${rel} was not uploaded ahead of time – run \`publish.mjs stage\` on a machine with Cloudflare access and push hosted.json`)
  const url = uploadImage(cfg, file)
  if (!cfg.r2Local) { hosted[rel] = { sha, url }; fs.writeFileSync(HOSTED, JSON.stringify(hosted, null, 1) + '\n') }
  return url
}

function uploadImage(cfg, file) {
  const tmp = path.join(os.tmpdir(), `kk-social-${process.pid}-${path.basename(file).replace(/\.\w+$/, '')}.jpg`)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-q:v', '2', tmp])
  const hash = crypto.createHash('sha1').update(fs.readFileSync(tmp)).digest('hex').slice(0, 10)
  const key = `social/${hash}-${path.basename(tmp).replace(/^kk-social-\d+-/, '')}`
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `khatakhat-images/${key}`, '--file', tmp, '--content-type', 'image/jpeg', cfg.r2Local ? '--local' : '--remote'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error' } })
  fs.rmSync(tmp, { force: true })
  return `${cfg.publicBase}/img/${key}`
}

async function checkPublic(url) {
  const r = await fetch(url, { method: 'HEAD' })
  if (!r.ok) throw new Error(`${url} is not reachable (${r.status}). Is PUBLIC_BASE right and the domain live?`)
}

// ---------- Facebook Page ----------
async function fbApi(cfg, page, method, p, params = {}) {
  const url = new URL(cfg.fbGraph + p)
  const init = { method }
  const all = { ...params, access_token: page.token }
  if (method === 'GET') for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v)
  else init.body = new URLSearchParams(all)
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    const e = data.error ?? {}
    throw new Error(`Facebook API ${method} ${p}: ${e.message ?? res.status} (code ${e.code ?? '?'}${e.error_subcode ? '/' + e.error_subcode : ''})`)
  }
  return data
}

let fbPageCache
async function fbPage(cfg) {
  if (fbPageCache) return fbPageCache
  if (cfg.fbPageId && cfg.fbPageToken) return (fbPageCache = { id: cfg.fbPageId, token: cfg.fbPageToken })
  if (!cfg.token || cfg.igLogin) throw new Error('Facebook needs a Facebook Login token (EAA…) with pages_manage_posts, or FB_PAGE_ID + FB_PAGE_TOKEN')
  const r = await fetch(`${cfg.fbGraph}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(cfg.token)}`).then((x) => x.json())
  if (r.error) throw new Error(`Facebook: ${r.error.message}`)
  const page = (r.data ?? []).find((x) => (cfg.fbPageId ? x.id === cfg.fbPageId : x.instagram_business_account))
  if (!page?.access_token) throw new Error('Facebook: this token sees no Page linked to the Instagram account')
  return (fbPageCache = { id: page.id, token: page.access_token, name: page.name })
}

// Videos (reels and video stories) use Facebook's three-step upload: start → send the bytes → finish.
async function fbVideo(cfg, page, edge, file, finish) {
  const start = await fbApi(cfg, page, 'POST', `/${page.id}/${edge}`, { upload_phase: 'start' })
  const bytes = fs.readFileSync(file)
  const up = await fetch(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${page.token}`, offset: '0', file_size: String(bytes.length) }, body: bytes })
  const ud = await up.json().catch(() => ({}))
  if (!up.ok || ud.success === false) throw new Error(`Facebook video upload failed: ${JSON.stringify(ud)}`)
  return { ...(await fbApi(cfg, page, 'POST', `/${page.id}/${edge}`, { upload_phase: 'finish', video_id: start.video_id, ...finish })), video_id: start.video_id }
}

async function fbPublish(cfg, item, caption) {
  const page = await fbPage(cfg)
  const abs = (f) => path.join(SOCIAL, f)
  const photo = async (f, extra) => { const u = hostImage(cfg, abs(f)); await checkPublic(u); return fbApi(cfg, page, 'POST', `/${page.id}/photos`, { url: u, ...extra }) }
  if (item.type === 'reel') {
    const r = await fbVideo(cfg, page, 'video_reels', abs(item.file), { video_state: 'PUBLISHED', description: caption })
    return { fb_id: r.video_id, permalink: `https://www.facebook.com/reel/${r.video_id}` }
  }
  if (item.type === 'story') {
    if (item.file.endsWith('.mp4')) { const r = await fbVideo(cfg, page, 'video_stories', abs(item.file), {}); return { fb_id: r.post_id ?? r.video_id } }
    const ph = await photo(item.file, { published: 'false' })
    const r = await fbApi(cfg, page, 'POST', `/${page.id}/photo_stories`, { photo_id: ph.id })
    return { fb_id: r.post_id ?? ph.id }
  }
  if (item.type === 'carousel') {
    const ids = []
    for (const f of item.files) ids.push((await photo(f, { published: 'false' })).id)
    const params = { message: caption }
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }) })
    const r = await fbApi(cfg, page, 'POST', `/${page.id}/feed`, params)
    return { fb_id: r.id, permalink: `https://www.facebook.com/${r.id}` }
  }
  const r = await photo(item.file, { message: caption, published: 'true' })
  return { fb_id: r.post_id ?? r.id, permalink: `https://www.facebook.com/${r.post_id ?? r.id}` }
}

async function publishItem(cfg, ig, item, caption) {
  const abs = (f) => path.join(SOCIAL, f)
  let container
  if (item.type === 'reel' || (item.type === 'story' && item.file.endsWith('.mp4'))) {
    const params = { media_type: item.type === 'reel' ? 'REELS' : 'STORIES', upload_type: 'resumable' }
    if (item.type === 'reel') { params.caption = caption; params.share_to_feed = 'true' }
    if (item.cover && fs.existsSync(abs(item.cover))) { const u = hostImage(cfg, abs(item.cover)); await checkPublic(u); params.cover_url = u }
    container = await api(cfg, 'POST', `/${ig.id}/media`, params)
    console.log('  uploading video…')
    await uploadVideo(cfg, container, abs(item.file))
  } else if (item.type === 'carousel') {
    const children = []
    for (const f of item.files) {
      const u = hostImage(cfg, abs(f)); await checkPublic(u)
      const c = await api(cfg, 'POST', `/${ig.id}/media`, { image_url: u, is_carousel_item: 'true' })
      await waitReady(cfg, c.id); children.push(c.id)
    }
    container = await api(cfg, 'POST', `/${ig.id}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })
  } else {
    const u = hostImage(cfg, abs(item.file)); await checkPublic(u)
    const params = item.type === 'story' ? { media_type: 'STORIES', image_url: u } : { image_url: u, caption }
    container = await api(cfg, 'POST', `/${ig.id}/media`, params)
  }
  console.log('  waiting for Instagram to process…')
  await waitReady(cfg, container.id)
  const { id } = await api(cfg, 'POST', `/${ig.id}/media_publish`, { creation_id: container.id })
  const info = await api(cfg, 'GET', `/${id}`, { fields: 'permalink' }).catch(() => ({}))
  return { media_id: id, permalink: info.permalink ?? null }
}

// ---------- commands ----------
const readLog = () => (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : {})

async function main() {
  const [cmd, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')))
  const cfg = loadConfig()
  const needToken = () => { if (!cfg.token) throw new Error('No META_TOKEN. Put it in ~/.khatakhat/meta.env (chmod 600) or the environment.') }

  if (cmd === 'list') {
    const log = readLog()
    for (const [k, it] of Object.entries(ITEMS)) console.log(`${k.padEnd(8)} ${it.type.padEnd(8)} ${log[k] ? `posted ${log[k].at.slice(0, 10)} ${log[k].permalink ?? ''}` : '–'}${log['fb:' + k] ? '  · Facebook' : ''}${log['yt:' + k] ? `  · YouTube ${log['yt:' + k].url}` : ''}${it.note ? `   (${it.note})` : ''}`)
    return
  }
  if (cmd === 'whoami') {
    needToken(); const ig = await account(cfg)
    console.log(`Instagram account: ${ig.username ? '@' + ig.username : '(username hidden)'} · id ${ig.id}${ig.page ? ` · Facebook Page "${ig.page}"` : ''}`)
    return
  }
  if (cmd === 'limit') {
    needToken(); const ig = await account(cfg)
    const r = await api(cfg, 'GET', `/${ig.id}/content_publishing_limit`, { fields: 'quota_usage,config' })
    const d = r.data?.[0] ?? {}
    console.log(`Used ${d.quota_usage ?? '?'} of ${d.config?.quota_total ?? '?'} posts in the last 24 hours`)
    return
  }
  // Post one item to Instagram (reels also go to YouTube Shorts). Returns false if anything failed.
  async function postOne(id) {
    const item = ITEMS[id]
    if (!item) throw new Error(`Unknown item "${id}". Run \`list\` to see them.`)
    const caption = item.caption ? captionFor(item.caption) : ''
    const files = item.files ?? [item.file]
    for (const f of files) if (!fs.existsSync(path.join(SOCIAL, f))) throw new Error(`Missing file docs/social/${f}`)
    if (flags.has('--dry-run')) {
      console.log(`Would post ${id} (${item.type}): ${files.join(', ')}${item.note ? `\nNote: ${item.note}` : ''}\n--- caption (${caption.length} chars) ---\n${caption || '(none – stories have no caption)'}`)
      return true
    }
    let ok = true
    const log = readLog()
    if (log[id] && !flags.has('--again')) {
      if (cmd !== 'scheduled') throw new Error(`${id} was already posted on ${log[id].at} (${log[id].permalink ?? log[id].media_id}). Use --again to post it again.`)
      console.log(`${id} already on Instagram (${log[id].at.slice(0, 10)})`)
    } else {
      if (item.note && !flags.has('--anyway')) throw new Error(`${id} ${item.note}. Use --anyway to post it without the sticker.`)
      needToken()
      const ig = await account(cfg)
      console.log(`Posting ${id} (${item.type}) to ${ig.username ? '@' + ig.username : ig.id}…`)
      const r = await publishItem(cfg, ig, item, caption)
      log[id] = { ...r, at: new Date().toISOString() }
      fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
      console.log(`Posted ✓ ${r.permalink ?? 'media ' + r.media_id}`)
    }
    // Everything also goes to the Facebook Page (skip with --no-facebook or FACEBOOK=0).
    if (cfg.facebook && !flags.has('--no-facebook') && !log['fb:' + id]) {
      try {
        const f = await fbPublish(cfg, item, caption)
        log['fb:' + id] = { ...f, at: new Date().toISOString() }
        fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
        console.log(`Facebook ✓ ${f.permalink ?? f.fb_id}`)
      } catch (e) { ok = false; console.log(`✗ Facebook failed (Instagram post is fine): ${e.message}`) }
    }
    // Every reel that goes to Instagram also goes to YouTube Shorts (skip with --no-youtube).
    if (item.type === 'reel' && !flags.has('--no-youtube') && !log['yt:' + id]) {
      try {
        const y = await youtubeUpload(path.join(SOCIAL, item.file), caption)
        log['yt:' + id] = { ...y, at: new Date().toISOString() }
        fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
        console.log(`YouTube ✓ ${y.url} (${y.privacy})`)
      } catch (e) { ok = false; console.log(`✗ YouTube upload failed (Instagram post is fine): ${e.message} – retry with: publish.mjs youtube ${id}`) }
    }
    return ok
  }

  if (cmd === 'post') { await postOne(id); return }

  // 9:16 story versions of feed posts (blurred backdrop, post centred) → docs/social/stories/shared/<id>.jpg
  if (cmd === 'make-stories') {
    fs.mkdirSync(path.join(SOCIAL, 'stories/shared'), { recursive: true })
    for (const [k, it] of Object.entries(ITEMS)) {
      if (!it.from || (id && k !== id && !k.startsWith(`${id}-story`))) continue
      const out = path.join(SOCIAL, it.file)
      if (fs.existsSync(out) && !flags.has('--again')) continue
      if (!fs.existsSync(path.join(SOCIAL, it.from))) continue   // post images already deleted after posting
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(SOCIAL, it.from), '-filter_complex',
        '[0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:4,eq=brightness=-0.12[bg];[0]scale=960:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
        '-frames:v', '1', '-q:v', '2', out])
      console.log(`${k} ← ${it.from}`)
    }
    return
  }

  // Upload the images for every scheduled day from today on (or one day), so the Action can post without Cloudflare access.
  if (cmd === 'stage') {
    const days = Object.entries(readJson(SCHEDULE).days ?? {}).filter(([d]) => (id ? d === id : d >= istToday()))
    for (const [d, ids] of days) for (const k of ids) {
      const it = ITEMS[k]
      if (!it) throw new Error(`${d}: unknown item ${k}`)
      const imgs = [...(it.files ?? [it.file]).filter((f) => !f.endsWith('.mp4')), ...(it.cover ? [it.cover] : [])]
      for (const f of imgs) { const u = hostImage(cfg, path.join(SOCIAL, f)); if (!cfg.r2Local) await checkPublic(u); console.log(`${d} ${k.padEnd(13)} ${f} → ${u}`) }
    }
    return
  }

  // Post today's (or a given day's) items from schedule.json. --wait: hold until the scheduled time (IST) first.
  if (cmd === 'scheduled') {
    const sch = readJson(SCHEDULE), day = id || istToday(), ids = sch.days?.[day]
    if (!ids?.length) { console.log(`Nothing scheduled for ${day}.`); return }
    if (flags.has('--wait') && !flags.has('--dry-run')) {
      const [h, m] = (sch.time ?? '19:00').split(':').map(Number)
      const at = Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`), wait = at - Date.now()
      if (wait > 0 && wait < 3 * 3600_000) { console.log(`Waiting ${Math.round(wait / 60000)} min until ${sch.time ?? '19:00'} IST…`); await sleep(wait) }
    }
    console.log(`${day}: ${ids.join(', ')}`)
    let failed = 0
    for (const k of ids) {
      try { if (!(await postOne(k))) failed++ } catch (e) { failed++; console.log(`✗ ${k}: ${e.message}`) }
    }
    if (failed) { console.log(`${failed} item(s) failed`); process.exitCode = 1 }
    return
  }
  if (cmd === 'youtube-login') return youtubeLogin()
  if (cmd === 'youtube-whoami') { const ch = await youtubeChannel(); console.log(`YouTube channel: ${ch.title} ${ch.handle ?? ''} · id ${ch.id}`); return }
  if (cmd === 'youtube-long') {
    // Long-form explainers from tests/e2e/social/longform.mjs, kept in docs/youtube/long-<n>.mp4 + .meta.json.
    const file = path.join(ROOT, `docs/youtube/long-${id}.mp4`), metaFile = file.replace(/\.mp4$/, '.meta.json')
    if (!fs.existsSync(file) || !fs.existsSync(metaFile)) throw new Error(`Missing docs/youtube/long-${id}.mp4 or its .meta.json`)
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); if (fs.existsSync(file.replace(/\.mp4$/, '.jpg'))) meta.thumbnail = file.replace(/\.mp4$/, '.jpg')
    const log = readLog(), key = 'yt:long-' + id
    if (log[key] && !flags.has('--again')) throw new Error(`long-${id} is already on YouTube (${log[key].url}).`)
    if (flags.has('--dry-run')) { console.log(`Would upload long-${id}: ${meta.title}\n\n${meta.description}\n\ntags: ${meta.tags.join(', ')}`); return }
    const ch = await youtubeChannel(); console.log(`Uploading long-${id} to YouTube "${ch.title}"…`)
    const r = await youtubeUploadVideo(file, meta, { privacy: flags.has('--unlisted') ? 'unlisted' : 'public' })
    log[key] = { ...r, at: new Date().toISOString() }; fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
    console.log(`Uploaded ✓ ${r.url} (${r.privacy})`); return
  }
  if (cmd === 'youtube') {
    // Reels go up as YouTube Shorts (vertical, under 3 minutes). Logged as "yt:<id>".
    const item = ITEMS[id]
    if (!item || item.type !== 'reel') throw new Error(`"${id}" is not a reel. Only reels go to YouTube.`)
    const file = path.join(SOCIAL, item.file)
    if (!fs.existsSync(file)) throw new Error(`Missing file docs/social/${item.file} – re-render it first.`)
    const caption = captionFor(item.caption)
    const log = readLog(), key = 'yt:' + id
    if (log[key] && !flags.has('--again')) throw new Error(`${id} is already on YouTube (${log[key].url}). Use --again to upload it again.`)
    if (flags.has('--dry-run')) { console.log(`Would upload ${item.file} to YouTube as a Short.
--- caption ---
${caption}`); return }
    const ch = await youtubeChannel()
    console.log(`Uploading ${id} to YouTube "${ch.title}"…`)
    const r = await youtubeUpload(file, caption)
    log[key] = { ...r, at: new Date().toISOString() }
    fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n')
    console.log(`Uploaded ✓ ${r.url} (${r.privacy})${r.privacy === 'private' ? ' – YouTube keeps uploads private until the API audit; set it Public in YouTube Studio.' : ''}`)
    return
  }
  console.log('Usage: publish.mjs whoami | list | limit | post <id> [--dry-run] [--again] [--anyway] | stage [YYYY-MM-DD] | scheduled [YYYY-MM-DD] [--wait] [--dry-run] | youtube-login | youtube-whoami | youtube <reel-id> [--dry-run] [--again]')
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
