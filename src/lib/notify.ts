import type { Bindings, Order } from '../env'
import { dictFor, type Lang } from '../i18n'
import { inWindow, meteredFor, sendOrderConfirmation, sendText, waBotEnabled, waEnabled } from './whatsapp'

/*
 * Tell the buyer what happened, in their WhatsApp chat.
 * - Inside the 24-hour window after the buyer's last message: a normal reply (free).
 * - Outside it: only the approved order-confirmation template, if configured.
 * - Otherwise nothing – the seller still has the free tap-to-send 💬 button.
 */
export async function notifyBuyer(env: Bindings, orderId: string, kind: 'paid' | 'rejected' | 'ship') {
  if (!waEnabled(env)) return
  const row = await env.DB
    .prepare(
      `SELECT o.*, d.title, s.shop_name, v.label, b.last_inbound_at, b.lang FROM orders o
       JOIN drops d ON d.id = o.drop_id JOIN sellers s ON s.id = o.seller_id JOIN variants v ON v.id = o.variant_id
       LEFT JOIN buyers b ON b.phone = o.buyer_phone WHERE o.id = ?`,
    )
    .bind(orderId)
    .first<Order & { title: string; shop_name: string; label: string; last_inbound_at: number | null; lang: Lang | null }>()
  if (!row) return
  const t = dictFor(row.lang ?? 'en')
  // Several items paid together get one message that lists them all.
  const { results: lines } = await env.DB
    .prepare(`SELECT d.title, v.label, o.qty, o.amount_paise FROM orders o JOIN drops d ON d.id = o.drop_id JOIN variants v ON v.id = o.variant_id
              WHERE o.id = ?1 OR o.cart_id = ?1 ORDER BY o.created_at`)
    .bind(row.cart_id ?? row.id)
    .all<{ title: string; label: string; qty: number; amount_paise: number }>()
  const item = lines.length > 1
    ? lines.map((l) => `${l.title}${l.label ? ` (${l.label})` : ''} ×${l.qty}`).join(', ')
    : row.title + (row.label ? ` (${row.label})` : '')
  row.amount_paise = lines.reduce((n, l) => n + l.amount_paise, 0) || row.amount_paise
  const no = row.id.slice(0, 6).toUpperCase()
  try {
    if (waBotEnabled(env) && inWindow(row.last_inbound_at)) {
      env = meteredFor(env, row.seller_id, 'notify')
      const text =
        kind === 'paid' ? t.botPaidConfirm(item, no, row.shop_name)
        : kind === 'rejected' ? t.botRejected(item, no)
        : t.botShip(no, t.ship[row.ship_status], row.shop_name)
      await sendText(env, row.buyer_phone, text)
    } else if (kind === 'paid' && env.WA_ORDER_TEMPLATE) {
      await sendOrderConfirmation(meteredFor(env, row.seller_id, 'template'), row, item, row.shop_name)
    } else return
    if (kind === 'paid') await env.DB.prepare(`UPDATE orders SET wa_sent = 1 WHERE id = ?`).bind(orderId).run()
  } catch (e) {
    console.error('WhatsApp notify failed', orderId, kind, e)
  }
}
