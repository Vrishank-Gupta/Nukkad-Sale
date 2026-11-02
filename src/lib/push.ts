import type { Bindings, Order } from '../env'
import { dictFor, type Lang } from '../i18n'
import { rupees } from './util'

/*
 * Order alerts on the seller's phone even when NukkadSale is closed – standard Web Push, free.
 * Payloads are encrypted for the browser (RFC 8291, aes128gcm) and requests are signed with our
 * VAPID key (RFC 8292). Keys: VAPID_PUBLIC (base64url, uncompressed P-256 point) and
 * VAPID_PRIVATE_JWK (the private key as a JWK) – both set as secrets.
 */

const enc = new TextEncoder()
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Push services browsers actually use. Subscriptions come from the browser, so never call anywhere else. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/
export function allowedEndpoint(env: Bindings, endpoint: string) {
  try {
    const u = new URL(endpoint)
    if (env.PUSH_ALLOW_ANY === '1') return u.protocol === 'https:' || u.hostname === 'localhost'
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)
  } catch {
    return false
  }
}

export const pushEnabled = (env: Bindings) => Boolean(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK)

/** Encrypts one message for a subscription (RFC 8291) – the body of the push request. */
export async function encryptPayload(p256dh: string, auth: string, payload: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh)
  const authSecret = unb64u(auth)
  const ephemeral = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ephemeral.publicKey)) as ArrayBuffer)
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  // Standard Web Crypto calls it `public`; Cloudflare's types call it `$public`. Pass both.
  const ecdhAlg = { name: 'ECDH', public: uaKey, $public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlg, ephemeral.privateKey, 256))
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record: the payload, then the 0x02 "last record" padding delimiter.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

/** The VAPID Authorization header for one push service (RFC 8292). */
async function vapidAuth(env: Bindings, endpoint: string) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK!) as JsonWebKey
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: `mailto:${env.LEAD_MAIL_TO || 'hello@vrishankgupta.in'}` })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`
}

type Sub = { endpoint: string; p256dh: string; auth: string; lang: Lang }
type Msg = { title: string; body: string; url: string; tag?: string }

/** Sends a notification to every phone the seller turned alerts on for. Gone subscriptions are removed. */
export async function pushToSeller(env: Bindings, sellerId: string, msgFor: (lang: Lang) => Msg) {
  if (!pushEnabled(env)) return 0
  const { results } = await env.DB.prepare(`SELECT endpoint, p256dh, auth, lang FROM push_subs WHERE seller_id = ?`).bind(sellerId).all<Sub>()
  let sent = 0
  await Promise.all(results.map(async (s) => {
    if (!allowedEndpoint(env, s.endpoint)) return
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapidAuth(env, s.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
        body: await encryptPayload(s.p256dh, s.auth, JSON.stringify(msgFor(s.lang === 'hi' ? 'hi' : 'en'))),
      })
      if (res.status === 404 || res.status === 410) await env.DB.prepare(`DELETE FROM push_subs WHERE endpoint = ?`).bind(s.endpoint).run()
      else if (res.ok) sent++
      else console.error('push failed', res.status, await res.text())
    } catch (e) {
      console.error('push error', e)
    }
  }))
  return sent
}

export type AlertKind = 'order' | 'cod' | 'claimed' | 'paid'

/** An order alert in the seller's language, opening the right screen when tapped. Never throws. */
export async function alertSeller(env: Bindings, orderId: string, kind: AlertKind) {
  try {
    if (!pushEnabled(env)) return
    const o = await env.DB
      .prepare(`SELECT o.seller_id, o.buyer_name, o.qty, o.amount_paise, o.cart_id, o.id, d.title FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.id = ?`)
      .bind(orderId)
      .first<Pick<Order, 'seller_id' | 'buyer_name' | 'qty' | 'amount_paise' | 'cart_id' | 'id'> & { title: string }>()
    if (!o) return
    const total = await env.DB.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS t FROM orders WHERE id = ?1 OR cart_id = ?1`).bind(o.cart_id ?? o.id).first<{ t: number }>()
    const amt = rupees(total?.t || o.amount_paise)
    const item = `${o.title} ×${o.qty}`
    const url = kind === 'claimed' || kind === 'order' ? '/app/orders?tab=check' : '/app/orders?tab=send'
    await pushToSeller(env, o.seller_id, (lang) => {
      const t = dictFor(lang)
      const body = kind === 'cod' ? t.pushCod(o.buyer_name, item, amt) : kind === 'claimed' ? t.pushClaimed(o.buyer_name, amt) : kind === 'paid' ? t.pushPaidOnline(o.buyer_name, amt) : t.pushOrder(o.buyer_name, item, amt)
      return { title: 'NukkadSale', body, url, tag: o.cart_id ?? o.id }
    })
  } catch (e) {
    console.error('alertSeller', e)
  }
}
