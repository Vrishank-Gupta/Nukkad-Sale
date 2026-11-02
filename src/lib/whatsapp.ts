import { istDay } from './util'
import type { Bindings, Order } from '../env'
import { hmacHex, safeEqual } from './crypto'
import { rupees } from './util'

/*
 * Meta WhatsApp Cloud API. Two uses:
 *  1. The ordering bot (see wa-bot.ts): buyers order inside WhatsApp. Every bot message is a
 *     reply within 24 hours of the buyer's own message, which Meta does not charge for.
 *  2. Templates for messages outside that window (order confirmation, PIN reset). Optional.
 * Without any of this configured, the platform falls back to the website + free wa.me buttons.
 */

export const waEnabled = (env: Bindings) => Boolean(env.WA_TOKEN && env.WA_PHONE_ID)
export const waBotEnabled = (env: Bindings) => Boolean(waEnabled(env) && env.WA_APP_SECRET && env.WA_VERIFY_TOKEN && env.WA_BOT_NUMBER)

const graph = (env: Bindings) => env.WA_API_BASE || 'https://graph.facebook.com'

async function send(env: Bindings, to: string, message: Record<string, unknown>) {
  const res = await fetch(`${graph(env)}/${env.WA_API_VERSION}/${env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
  })
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`)
  // Count it against the seller it was sent for (admin → seller usage). Never fail a send over this.
  const m = env.WA_METER
  if (m) {
    await env.DB.prepare(`INSERT INTO wa_usage (seller_id, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT(seller_id, day, kind) DO UPDATE SET count = count + 1`)
      .bind(m.sellerId, istDay(Date.now()), m.kind).run().catch((e) => console.error('wa usage', e))
  }
}

/** The same env, with WhatsApp sends counted against this seller. */
export const meteredFor = (env: Bindings, sellerId: string | null | undefined, kind: 'bot' | 'notify' | 'template'): Bindings =>
  sellerId ? { ...env, WA_METER: { sellerId, kind } } : env

// Meta's limits: button titles ≤ 20 chars, list row titles ≤ 24, body ≤ 1024.
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const sendText = (env: Bindings, to: string, body: string) => send(env, to, { type: 'text', text: { body: cut(body, 4096), preview_url: false } })

export type Btn = { id: string; title: string }

/** A photo message (extra product photos). */
export const sendImage = (env: Bindings, to: string, url: string, caption?: string) => send(env, to, { type: 'image', image: { link: url, ...(caption ? { caption: cut(caption, 1024) } : {}) } })

/** Up to 3 tap-able reply buttons, optionally under a product photo. */
export const sendButtons = (env: Bindings, to: string, body: string, buttons: Btn[], imageUrl?: string, footer?: string) =>
  send(env, to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(imageUrl ? { header: { type: 'image', image: { link: imageUrl } } } : {}),
      body: { text: cut(body, 1024) },
      ...(footer ? { footer: { text: cut(footer, 60) } } : {}),
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) },
    },
  })

/** A "Choose" button that opens a list of up to 10 options. */
export const sendList = (env: Bindings, to: string, body: string, button: string, rows: { id: string; title: string; description?: string }[]) =>
  send(env, to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: cut(body, 1024) },
      action: {
        button: cut(button, 20),
        sections: [{ title: cut(button, 24), rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })) }],
      },
    },
  })

/** A single big button that opens a link (must be https – we use it for the pay page). */
export const sendCta = (env: Bindings, to: string, body: string, label: string, url: string) =>
  send(env, to, { type: 'interactive', interactive: { type: 'cta_url', body: { text: cut(body, 1024) }, action: { name: 'cta_url', parameters: { display_text: cut(label, 20), url } } } })

/** Download a photo the buyer sent (e.g. a payment screenshot). */
export async function downloadMedia(env: Bindings, mediaId: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  const auth = { Authorization: `Bearer ${env.WA_TOKEN}` }
  const meta = await fetch(`${graph(env)}/${env.WA_API_VERSION}/${mediaId}`, { headers: auth })
  if (!meta.ok) return null
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string }
  const file = await fetch(url, { headers: auth })
  return file.ok ? { body: await file.arrayBuffer(), type: mime_type || 'image/jpeg' } : null
}

/** Meta signs every webhook: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). */
export async function verifySignature(env: Bindings, rawBody: string, header: string) {
  if (!env.WA_APP_SECRET || !header.startsWith('sha256=')) return false
  return safeEqual(await hmacHex(env.WA_APP_SECRET, rawBody), header.slice(7))
}

/** Is the buyer's free 24-hour reply window still open? */
export const inWindow = (lastInboundAt: number | null | undefined) => Boolean(lastInboundAt && Date.now() - lastInboundAt < 23.5 * 3600_000)

// ---------- Templates (outside the 24-hour window) ----------

async function sendTemplate(env: Bindings, to: string, name: string, components: unknown[]) {
  await send(env, to, { type: 'template', template: { name, language: { code: env.WA_TEMPLATE_LANG }, components } })
}

const text = (t: string) => ({ type: 'text', text: t })

/**
 * Template body must take 5 parameters, e.g.
 * "Hi {{1}}, your order for {{2}} ({{3}}) from {{4}} is confirmed ✅ Order no. {{5}}"
 */
export const sendOrderConfirmation = (env: Bindings, order: Order, product: string, shop: string) =>
  sendTemplate(env, order.buyer_phone, env.WA_ORDER_TEMPLATE!, [
    {
      type: 'body',
      parameters: [text(order.buyer_name), text(product), text(rupees(order.amount_paise)), text(shop), text(order.id.slice(0, 6).toUpperCase())],
    },
  ])

/** Authentication template with a copy-code button (Meta's standard OTP format). */
export const sendOtp = (env: Bindings, to: string, code: string) =>
  sendTemplate(env, to, env.WA_OTP_TEMPLATE!, [
    { type: 'body', parameters: [text(code)] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [text(code)] },
  ])
