import { alertSeller } from './push'
import type { Bindings, Order, Seller } from '../env'
import { decrypt } from './crypto'
import { cartKeyOf, cartOrders, cartTotal, markCartPaid } from './orders'
import { randomId } from './util'
import { createPaymentLink, getPaymentLink } from './razorpay'

/*
 * Razorpay Payment Links for sellers who want automatic confirmation. Direct UPI (manual check)
 * needs none of this. Each seller uses their own Razorpay account and keys.
 */

/** Create the hosted payment page for an order – or for its whole cart. Returns the URL to send the buyer to. */
export async function startGatewayPayment(env: Bindings, seller: Seller, order: Order, description: string, origin: string): Promise<string> {
  const lines = await cartOrders(env.DB, order)
  const total = cartTotal(lines)
  const key = cartKeyOf(order)
  const holdUntil = Math.max(...lines.map((l) => l.hold_until))
  // A fresh link id each time: a cart's total changes when items join, and gateways need unique ids.
  const linkRef = `${key}_${randomId(4)}`
  const link = await createPaymentLink(seller.rzp_key_id!, await decrypt(seller.rzp_secret_enc!, env.SECRET_KEY), {
    amountPaise: total,
    referenceId: linkRef,
    description,
    customerName: order.buyer_name,
    customerPhone: order.buyer_phone,
    callbackUrl: `${origin}/o/${key}/paid`,
    expireAt: holdUntil,
  }, env.RAZORPAY_API_BASE)
  const ref = link.id, url = link.short_url
  await env.DB.prepare(`UPDATE orders SET gateway_ref = ?1, pay_url = ?2 WHERE id = ?3 OR cart_id = ?3`).bind(ref, url, key).run()
  return url
}

/**
 * Ask Razorpay whether this order's link has been paid, and if so mark the whole payment paid.
 * Used by the buyer's return redirect, the webhook, the order-page poll and the cron sweep. No webhook needed.
 */
export async function confirmRazorpay(env: Bindings, orderId: string, waitUntil?: (p: Promise<unknown>) => void): Promise<boolean> {
  const row = await env.DB
    .prepare(`SELECT o.id, o.status, o.gateway_ref, s.rzp_key_id, s.rzp_secret_enc
              FROM orders o JOIN sellers s ON s.id = o.seller_id WHERE o.id = ? AND o.pay_mode = 'razorpay'`)
    .bind(orderId)
    .first<Pick<Order, 'id' | 'status' | 'gateway_ref'> & Pick<Seller, 'rzp_key_id' | 'rzp_secret_enc'>>()
  if (!row?.gateway_ref || !row.rzp_key_id || !row.rzp_secret_enc || !['pending', 'verifying', 'expired'].includes(row.status)) return false
  const due = await env.DB.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS t FROM orders WHERE gateway_ref = ?`).bind(row.gateway_ref).first<{ t: number }>()
  await env.DB.prepare(`UPDATE orders SET gw_checked_at = ? WHERE gateway_ref = ?`).bind(Date.now(), row.gateway_ref).run()
  const link = await getPaymentLink(row.rzp_key_id, await decrypt(row.rzp_secret_enc, env.SECRET_KEY), row.gateway_ref, env.RAZORPAY_API_BASE)
  if (Number(link.amount_paid) < (due?.t ?? Infinity)) return false
  const ref = link.payments?.find((p) => p.status === 'captured')?.payment_id ?? link.id
  await markCartPaid(env, orderId, `razorpay:${ref}`, waitUntil)
  const alert = alertSeller(env, orderId, 'paid')
  waitUntil ? waitUntil(alert) : await alert
  return true
}

export const confirmGateway = (env: Bindings, orderId: string, payMode: string, waitUntil?: (p: Promise<unknown>) => void) =>
  payMode === 'razorpay' ? confirmRazorpay(env, orderId, waitUntil) : Promise.resolve(false)

/** Cron safety net: re-check recent unpaid gateway orders (a buyer may close the page before returning). */
export async function reconcileGateways(env: Bindings) {
  const { results } = await env.DB
    .prepare(`SELECT id, pay_mode FROM orders WHERE pay_mode = 'razorpay' AND status IN ('pending', 'expired') AND gateway_ref IS NOT NULL
              AND created_at > ? AND COALESCE(gw_checked_at, 0) < ? ORDER BY created_at DESC LIMIT 25`)
    .bind(Date.now() - 45 * 60000, Date.now() - 60000)
    .all<{ id: string; pay_mode: string }>()
  for (const r of results) await confirmGateway(env, r.id, r.pay_mode).catch((e) => console.error('gateway reconcile', r.id, e))
}
