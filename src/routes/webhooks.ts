import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { decrypt } from '../lib/crypto'
import { markCartPaid } from '../lib/orders'
import { verifyWebhook } from '../lib/razorpay'
import { handleInbound, type Inbound } from '../lib/wa-bot'
import { verifySignature, waBotEnabled } from '../lib/whatsapp'

export const hooks = new Hono<AppEnv>()

type PaymentLinkPaid = {
  event: string
  payload: { payment_link?: { entity: { id: string; reference_id: string } }; payment?: { entity: { id: string } } }
}

// Each seller gets their own webhook URL so we know which signing secret to check against.
hooks.post('/razorpay/:sellerId', async (c) => {
  const sellerId = c.req.param('sellerId')
  const body = await c.req.text()
  const seller = await c.env.DB.prepare(`SELECT rzp_webhook_enc FROM sellers WHERE id = ?`).bind(sellerId).first<{ rzp_webhook_enc: string | null }>()
  if (!seller?.rzp_webhook_enc) return c.text('unknown seller', 404)
  const secret = await decrypt(seller.rzp_webhook_enc, c.env.SECRET_KEY)
  if (!(await verifyWebhook(secret, body, c.req.header('x-razorpay-signature') ?? ''))) return c.text('bad signature', 401)

  const eventId = c.req.header('x-razorpay-event-id') ?? ''
  if (eventId && (await c.env.DB.prepare(`SELECT 1 FROM webhook_events WHERE id = ?`).bind(eventId).first())) return c.text('ok (duplicate)')

  const evt = JSON.parse(body) as PaymentLinkPaid
  if (evt.event === 'payment_link.paid') {
    const link = evt.payload.payment_link?.entity
    const paymentId = evt.payload.payment?.entity.id
    if (link && paymentId) {
      const order = await c.env.DB.prepare(`SELECT id FROM orders WHERE seller_id = ? AND gateway_ref = ? LIMIT 1`).bind(sellerId, link.id).first<{ id: string }>()
      if (order) await markCartPaid(c.env, order.id, paymentId, (p) => c.executionCtx.waitUntil(p))
    }
  }
  // Recorded only after processing succeeded, so a failed attempt is retried by Razorpay.
  if (eventId) await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)`).bind(eventId, Date.now()).run()
  return c.text('ok')
})

// ---------- WhatsApp ordering bot ----------

// Meta calls this once when you register the webhook URL in the app dashboard.
hooks.get('/whatsapp', (c) => {
  const q = c.req.query()
  if (q['hub.mode'] === 'subscribe' && c.env.WA_VERIFY_TOKEN && q['hub.verify_token'] === c.env.WA_VERIFY_TOKEN) return c.text(q['hub.challenge'] ?? '')
  return c.text('forbidden', 403)
})

type WaWebhook = {
  entry?: { changes?: { value?: { messages?: Inbound[]; contacts?: { wa_id: string; profile?: { name?: string } }[] } }[] }[]
}

hooks.post('/whatsapp', async (c) => {
  const body = await c.req.text()
  if (!waBotEnabled(c.env) || !(await verifySignature(c.env, body, c.req.header('x-hub-signature-256') ?? ''))) return c.text('bad signature', 401)
  const origin = new URL(c.req.url).origin
  const evt = JSON.parse(body) as WaWebhook
  for (const change of evt.entry?.flatMap((e) => e.changes ?? []) ?? []) {
    const names = new Map((change.value?.contacts ?? []).map((ct) => [ct.wa_id, ct.profile?.name ?? '']))
    for (const msg of change.value?.messages ?? []) {
      // Meta retries deliveries; process each message id once.
      const seen = await c.env.DB.prepare(`INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)`).bind('wa:' + msg.id, Date.now()).run()
      if (seen.meta.changes === 0) continue
      // Reply after acknowledging, so Meta never times out and re-sends.
      c.executionCtx.waitUntil(handleInbound(c.env, origin, msg, names.get(msg.from) ?? '').catch((e) => console.error('wa bot', msg.id, e)))
    }
  }
  return c.text('ok')
})
