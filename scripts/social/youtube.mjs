// YouTube (Data API v3, free quota) for publish.mjs: one-time login, channel check, Shorts upload.
// Credentials live in ~/.khatakhat/youtube.env (chmod 600): YT_CLIENT_ID, YT_CLIENT_SECRET (OAuth "Desktop app"
// client from Google Cloud) and YT_REFRESH_TOKEN (written by `publish.mjs youtube-login`).
// Uploads from a project that hasn't passed Google's API audit are kept Private by YouTube until the audit –
// switch them to Public in YouTube Studio meanwhile.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const FILE = path.join(os.homedir(), '.khatakhat/youtube.env')
// upload: post videos · force-ssl: edit titles/descriptions and set thumbnails · readonly: check the channel
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.readonly']
export const LINK_LINE = '👉 Start selling: https://nukkadsale.in'

function readEnv() {
  const out = {}
  if (fs.existsSync(FILE)) for (const l of fs.readFileSync(FILE, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2] }
  return out
}
function saveEnv(key, value) {
  const lines = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').split('\n').filter((l) => !l.startsWith(key + '=')) : []
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  fs.writeFileSync(FILE, [...lines, `${key}=${value}`, ''].join('\n'), { mode: 0o600 }); fs.chmodSync(FILE, 0o600)
}
const creds = () => {
  const e = readEnv()
  if (!e.YT_CLIENT_ID || !e.YT_CLIENT_SECRET) throw new Error(`No YouTube client. Put YT_CLIENT_ID and YT_CLIENT_SECRET in ${FILE}.`)
  return e
}

/** One-time: opens a local page, prints the Google sign-in link, stores the refresh token. */
export async function youtubeLogin() {
  const e = creds()
  const server = http.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const redirect = `http://127.0.0.1:${server.address().port}`
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: e.YT_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
  })
  console.log('Open this link in your browser, sign in with the account that owns the channel, and allow access:\n\n' + url + '\n')
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No sign-in within 10 minutes')), 600_000)
    server.on('request', (req, res) => {
      const q = new URL(req.url, redirect).searchParams
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(q.get('code') ? '<h2>NukkadSale is connected to YouTube. You can close this tab.</h2>' : `<h2>Sign-in failed: ${q.get('error') ?? 'unknown'}</h2>`)
      clearTimeout(timer); q.get('code') ? resolve(q.get('code')) : reject(new Error('Google said: ' + (q.get('error') ?? 'no code')))
    })
  }).finally(() => server.close())
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, client_id: e.YT_CLIENT_ID, client_secret: e.YT_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) })
  const d = await r.json()
  if (!d.refresh_token) throw new Error('Google returned no refresh token: ' + (d.error_description ?? d.error ?? JSON.stringify(d)))
  saveEnv('YT_REFRESH_TOKEN', d.refresh_token)
  console.log(`Saved ✓ (${FILE})`)
}

async function accessToken() {
  const e = creds()
  if (!e.YT_REFRESH_TOKEN) throw new Error('Not connected to YouTube yet. Run: node scripts/social/publish.mjs youtube-login')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: e.YT_CLIENT_ID, client_secret: e.YT_CLIENT_SECRET, refresh_token: e.YT_REFRESH_TOKEN, grant_type: 'refresh_token' }) })
  const d = await r.json()
  if (!d.access_token) throw new Error('YouTube token refresh failed: ' + (d.error_description ?? d.error))
  return d.access_token
}

export async function youtubeChannel() {
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + (await accessToken()) } })
  const d = await r.json()
  if (d.error) throw new Error('YouTube: ' + d.error.message)
  const c = d.items?.[0]
  if (!c) throw new Error('This Google account has no YouTube channel.')
  return { id: c.id, title: c.snippet.title, handle: c.snippet.customUrl }
}

/** Uploads a vertical reel as a Short. Title = first caption line (≤100 chars, #Shorts added); description = caption. */
export async function youtubeUpload(file, caption, { privacy = 'public' } = {}) {
  const token = await accessToken()
  const first = caption.split('\n').find((l) => l.trim()) ?? 'NukkadSale'
  const clean = (s) => s.replace(/[<>]/g, '').trim()
  let title = clean(first).replace(/\s*#\S+/g, '').trim()
  if (title.length > 90) title = title.slice(0, 89).replace(/\s+\S*$/, '') + '…'
  title += ' #Shorts'
  const tags = [...new Set((caption.match(/#([A-Za-z0-9]+)/g) ?? []).map((x) => x.slice(1)))].slice(0, 15)
  const meta = {
    snippet: { title, description: (LINK_LINE + '\n\n' + clean(caption)).slice(0, 4900), tags: ['NukkadSale', ...tags], categoryId: '26', defaultLanguage: 'en' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  }
  const bytes = fs.readFileSync(file)
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(meta),
  })
  if (!start.ok) throw new Error('YouTube upload start failed: ' + (await start.text()).slice(0, 300))
  const put = await fetch(start.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: bytes })
  const v = await put.json()
  if (!v.id) throw new Error('YouTube upload failed: ' + JSON.stringify(v.error ?? v).slice(0, 300))
  return { video_id: v.id, url: `https://youtube.com/shorts/${v.id}`, privacy: v.status?.privacyStatus, title }
}

/** Uploads a long-form video with its own title, description (chapters included) and tags. */
export async function youtubeUploadVideo(file, meta, { privacy = 'public' } = {}) {
  const token = await accessToken()
  const body = {
    snippet: { title: meta.title.slice(0, 100), description: (meta.description.startsWith(LINK_LINE) ? meta.description : LINK_LINE + '\n\n' + meta.description).slice(0, 4900), tags: ['NukkadSale', ...(meta.tags ?? [])].slice(0, 20), categoryId: '26', defaultLanguage: 'en', defaultAudioLanguage: 'en' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  }
  const bytes = fs.readFileSync(file)
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(body),
  })
  if (!start.ok) throw new Error('YouTube upload start failed: ' + (await start.text()).slice(0, 300))
  const put = await fetch(start.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: bytes })
  const v = await put.json()
  if (!v.id) throw new Error('YouTube upload failed: ' + JSON.stringify(v.error ?? v).slice(0, 300))
  // Custom thumbnail (needs a phone-verified channel – skipped quietly if not allowed yet).
  if (meta.thumbnail && fs.existsSync(meta.thumbnail)) {
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${v.id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(meta.thumbnail) })
    if (!r.ok) console.log('  (custom thumbnail not set: ' + ((await r.json()).error?.message ?? r.status) + ')')
  }
  return { video_id: v.id, url: `https://youtu.be/${v.id}`, privacy: v.status?.privacyStatus, title: body.snippet.title }
}

/** Puts the website link on the first line of an existing video's description (and can update thumbnails). */
export async function youtubeAddLink(videoId) {
  const token = await accessToken()
  const d = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, { headers: { Authorization: 'Bearer ' + token } })).json()
  const v = d.items?.[0]; if (!v) throw new Error('No video ' + videoId)
  if (v.snippet.description.startsWith(LINK_LINE)) return 'already'
  const { title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage } = v.snippet
  const snippet = { title, categoryId, tags, defaultLanguage, defaultAudioLanguage, description: (LINK_LINE + '\n\n' + description.replace(/\n\nnukkadsale\.in\s*$/, '\n\nhttps://nukkadsale.in')).slice(0, 4990) }
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: videoId, snippet }) })
  if (!r.ok) throw new Error((await r.json()).error?.message ?? r.status)
  return 'updated'
}
export async function youtubeThumbnail(videoId, jpg) {
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, { method: 'POST', headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(jpg) })
  if (!r.ok) throw new Error((await r.json()).error?.message ?? r.status)
}
