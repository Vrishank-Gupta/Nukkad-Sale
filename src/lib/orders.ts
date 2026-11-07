import { alertSeller } from './push'
import type { Bindings, Drop, Order, Seller, Variant } from '../env'
import { randomId } from './util'
import { notifyBuyer } from './notify'

/*
 * Stock model
 * -----------
 * `variants.available` is decremented the moment a buyer taps "Pay", inside a single
 * conditional UPDATE (`... WHERE available >= qty`). D1 runs each statement atomically
 * and the column has CHECK (available >= 0), so two buyers can never both get the last
 * piece. The held stock is released if payment doesn't arrive within the hold window
 * (see expireHolds, run by cron). Payment itself only flips the order to `paid`.
 */

const ACTIVE = `('pending', 'verifying')`
// Row-change checks use `> 0`, not `=== 1`: the order triggers (migration 0018) make D1 count their own updates too.
/** Cash-on-delivery orders are open ('pending') orders whose reservation never lapses. */
export const COD_HOLD = 32503680000000 // year 3000
export const IS_COD = `(status = 'pending' AND pay_mode = 'cod')`
/** Delivery charge for an order of this sale worth `itemsPaise` (0 when the sale has none, or above its free limit). */
export const shipFor = (drop: { ship_fee_paise?: number; free_ship_above_paise?: number }, itemsPaise: number) =>
  drop.ship_fee_paise && !(drop.free_ship_above_paise && itemsPaise >= drop.free_ship_above_paise) ? drop.ship_fee_paise : 0
/** The status to show: an open COD order reads as "Cash on delivery". */
export const shownStatus = (o: { status: Order['status']; pay_mode: string }): Order['status'] => (o.status === 'pending' && o.pay_mode === 'cod' ? 'cod' : o.status)

export type ReserveInput = {
  variantId: number
  qty: number
  name: string
  phone: string
  address: string
  ipHash: string
  channel?: 'web' | 'whatsapp'
  /** Seller created it from a chat ("quick order"): no per-drop/per-device limits, longer hold. */
  assisted?: boolean
  /** Cash on delivery (only if the sale allows it): stock is reserved now, cash collected on delivery. */
  cod?: boolean
  holdMinutes?: number
  /** Price per piece for this order when it isn't the sale price – a personal price link (checked by the caller). */
  unitPaise?: number
  /** The personal price link used, recorded on the order. */
  offerId?: string
}
export type ReserveFailure = 'closed' | 'qty' | 'device' | 'stock' | 'soon'
export type ReserveResult = { ok: true; order: Order } | { ok: false; reason: ReserveFailure }

/** An advance a few paise under the asked amount that no other open advance of this seller uses. */
async function uniqueAdvance(db: D1Database, sellerId: string, base: number) {
  const { results } = await db.prepare(`SELECT adv_paise FROM orders WHERE seller_id = ? AND adv_status IN ('due', 'claimed') AND status = 'pending' AND adv_paise BETWEEN ? AND ?`)
    .bind(sellerId, base - 99, base).all<{ adv_paise: number }>()
  const used = new Set(results.map((r) => base - r.adv_paise))
  const free = Array.from({ length: 99 }, (_, i) => i + 1).filter((k) => !used.has(k))
  return base - (free.length ? free[Math.floor(Math.random() * free.length)] : 0)
}

/** Buyer says the advance is paid: keep the piece until the seller checks. */
export async function claimAdvance(db: D1Database, orderId: string) {
  const r = await db.prepare(`UPDATE orders SET adv_status = 'claimed', hold_until = ? WHERE id = ? AND pay_mode = 'cod' AND status = 'pending' AND adv_status = 'due' AND hold_until > ?`)
    .bind(COD_HOLD, orderId, Date.now()).run()
  return r.meta.changes > 0
}

/** Seller saw the advance in their UPI app: the order is confirmed and goes to "To send". */
export async function confirmAdvance(db: D1Database, orderId: string, sellerId: string) {
  const r = await db.prepare(`UPDATE orders SET adv_status = 'paid', hold_until = ? WHERE id = ? AND seller_id = ? AND pay_mode = 'cod' AND status = 'pending' AND adv_status IN ('due', 'claimed')`)
    .bind(COD_HOLD, orderId, sellerId).run()
  return r.meta.changes > 0
}

/** Atomically take `qty` pieces from a variant. Returns false when not enough is left. */
async function takeStock(db: D1Database, variantId: number, dropId: string, qty: number): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE variants SET available = available - ?1 WHERE id = ?2 AND drop_id = ?3 AND available >= ?1 RETURNING available`)
    .bind(qty, variantId, dropId)
    .first()
  return row !== null
}

const giveBackStock = (db: D1Database, variantId: number, qty: number) =>
  db.prepare(`UPDATE variants SET available = available + ?1 WHERE id = ?2`).bind(qty, variantId).run()

/**
 * For direct UPI, add 1–99 paise so every open *payment* of this seller has a unique amount.
 * The seller can then match "₹499.37 received" in their bank app to exactly one payment –
 * no UTR needed. A payment is one order, or one cart (several orders paid together).
 * Payments that expired in the last day stay reserved too, because a buyer may still pay late.
 */
/** Every amount this seller is waiting to receive: open (or recently expired) order payments and "Ask" reserves. */
async function amountsInUse(db: D1Database, sellerId: string, excludeKey?: string): Promise<number[]> {
  const [{ results: pays }, { results: res }] = await Promise.all([
    db.prepare(`SELECT COALESCE(cart_id, id) AS k, SUM(amount_paise) AS amt FROM orders WHERE seller_id = ?
                AND (status IN ${ACTIVE} OR (status = 'expired' AND created_at > ?)) GROUP BY k`)
      .bind(sellerId, Date.now() - 86_400_000).all<{ k: string; amt: number }>(),
    db.prepare(`SELECT key AS k, amount_paise AS amt FROM ask_reserves WHERE seller_id = ? AND status IN ('due', 'claimed')`).bind(sellerId).all<{ k: string; amt: number }>(),
  ])
  return [...pays, ...res].filter((r) => r.k !== excludeKey).map((r) => r.amt)
}

/** A few paise under `base` that no other open payment of this seller uses (1–99 paise, up to ₹4.99 on a busy day). */
export async function pickUniqueAmount(db: D1Database, sellerId: string, base: number, excludeKey?: string): Promise<number> {
  const inUse = await amountsInUse(db, sellerId, excludeKey)
  // The unique paise come OFF the price (₹798.63 for ₹799), so a buyer never pays more than listed.
  for (const span of [99, 499]) {
    const taken = new Set(inUse.filter((a) => a <= base && a >= base - span).map((a) => base - a))
    const free = Array.from({ length: Math.min(span, base - 1) }, (_, i) => i + 1).filter((k) => !taken.has(k))
    if (free.length) return base - free[Math.floor(Math.random() * free.length)]
  }
  return base
}
const uniqueAmount = pickUniqueAmount

/** True if another open payment of this seller already has exactly this amount (two buyers at the same moment). */
export async function amountClash(db: D1Database, sellerId: string, key: string, total: number) {
  return (await amountsInUse(db, sellerId, key)).includes(total)
}

// ---------- Carts: several orders paid as one ----------

export const cartKeyOf = (o: Pick<Order, 'id' | 'cart_id'>) => o.cart_id ?? o.id

export type CartLine = Order & { title: string; label: string; price_paise: number; image_key: string | null; upi_vpa: string | null }

/** Every order paid together with this one (just itself if it isn't in a cart), oldest first. */
export async function cartOrders(db: D1Database, o: Pick<Order, 'id' | 'cart_id'>): Promise<CartLine[]> {
  const { results } = await db
    .prepare(`SELECT o.*, d.title, d.price_paise, d.image_key, d.upi_vpa, v.label FROM orders o JOIN drops d ON d.id = o.drop_id JOIN variants v ON v.id = o.variant_id
              WHERE o.id = ?1 OR o.cart_id = ?1 ORDER BY o.created_at`)
    .bind(cartKeyOf(o))
    .all<CartLine>()
  return results
}

export const cartTotal = (lines: Pick<Order, 'amount_paise'>[]) => lines.reduce((n, l) => n + l.amount_paise, 0)

/** The seller's "spend more, save more" discount for items worth `items` paise in one payment (0 if none). */
export function cartOffer(seller: Pick<Seller, 'offer_min_paise' | 'offer_off_paise' | 'offer_pct'>, items: number): number {
  const min = seller.offer_min_paise ?? 0
  if (!min || items < min) return 0
  const off = (seller.offer_off_paise ?? 0) > 0 ? seller.offer_off_paise! : Math.floor((items * Math.min(90, seller.offer_pct ?? 0)) / 100)
  return Math.max(0, Math.min(off, items - 100))
}

/**
 * Price a payment (one order, or a cart of them): each line at the price it was ordered at, delivery once,
 * minus the cart offer; direct-UPI payments then get their unique paise taken off the total.
 * Runs whenever an order is created or joins a cart, so the offer kicks in as soon as the cart qualifies.
 */
export async function repriceCart(db: D1Database, seller: Pick<Seller, 'id' | 'pay_mode' | 'offer_min_paise' | 'offer_off_paise' | 'offer_pct'>, key: string, mode: string) {
  const { results } = await db
    .prepare(`SELECT o.id, COALESCE(o.unit_paise, d.price_paise) * o.qty AS items, o.ship_paise AS ship FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.id = ?1 OR o.cart_id = ?1`)
    .bind(key)
    .all<{ id: string; items: number; ship: number }>()
  const items = results.reduce((n, r) => n + r.items, 0)
  const disc = cartOffer(seller, items)
  const base = items + results.reduce((n, r) => n + r.ship, 0) - disc
  const save = (total: number) => db.batch(results.map((r) =>
    db.prepare(`UPDATE orders SET amount_paise = ?, disc_paise = ? WHERE id = ?`)
      // Lines add up to the total: the first line carries the discount and the unique-paise adjustment.
      .bind(r.items + r.ship + (r.id === key ? total - base - disc : 0), r.id === key ? disc : 0, r.id)))
  if (mode !== 'direct') return void (await save(base))
  // Pick, save, then check nobody took the same amount at the same moment; pick again if they did.
  for (let i = 0; i < 4; i++) {
    const total = await uniqueAmount(db, seller.id, base, key)
    await save(total)
    if (!(await amountClash(db, seller.id, key, total))) return
  }
}

export async function reserveOrder(env: Bindings, seller: Seller, drop: Drop, input: ReserveInput): Promise<ReserveResult> {
  // Cash on delivery is switched off everywhere: NukkadSale never handles cash or holds money.
  input = { ...input, cod: false }
  const db = env.DB
  if (drop.status !== 'live') return { ok: false, reason: 'closed' }
  // Scheduled drop: visible, but nobody can order before it goes live.
  if ((drop.live_at ?? 0) > Date.now()) return { ok: false, reason: 'soon' }
  if (input.qty < 1 || (!input.assisted && input.qty > drop.max_per_order)) return { ok: false, reason: 'qty' }

  if (!input.assisted) {
    // One open hold per buyer per size – a re-tap returns the existing order instead of locking more stock.
    // (Per size, not per product: a cart with an M and an L of the same kurta keeps both.)
    const existing = await db
      .prepare(`SELECT * FROM orders WHERE drop_id = ? AND variant_id = ? AND buyer_phone = ? AND status IN ${ACTIVE} LIMIT 1`)
      .bind(drop.id, input.variantId, input.phone)
      .first<Order>()
    if (existing) return { ok: true, order: existing }

    // Basic anti-hoarding: a single device/network can't hold the whole drop hostage.
    const fromIp = await db
      .prepare(`SELECT COUNT(*) AS n FROM orders WHERE drop_id = ? AND ip_hash = ? AND status = 'pending'`)
      .bind(drop.id, input.ipHash)
      .first<{ n: number }>()
    if ((fromIp?.n ?? 0) >= 3) return { ok: false, reason: 'device' }
  }

  let got = await takeStock(db, input.variantId, drop.id, input.qty)
  if (!got) {
    // Lapsed holds may not have been swept yet – release them and try once more.
    await expireHolds(env)
    got = await takeStock(db, input.variantId, drop.id, input.qty)
  }
  if (!got) return { ok: false, reason: 'stock' }

  const now = Date.now()
  const unit = input.unitPaise ?? drop.price_paise
  const base = unit * input.qty
  const cost = (drop.cost_paise || 0) * input.qty
  if (input.cod) {
    const ship = shipFor(drop, base)
    const total = base + ship + (drop.cod_fee_paise || 0) - cartOffer(seller, base)
    // With an advance (seller's choice), the buyer pays a small part by UPI first – its own exact amount –
    // and the piece is held only for the usual payment time until then. Without one there is no payment
    // step: the piece is the buyer's until the seller cancels or marks the cash received.
    const advBase = Math.min(drop.cod_advance_paise || 0, total)
    const adv = advBase >= 100 ? await uniqueAdvance(db, seller.id, advBase) : 0
    const hold = adv ? now + 15 * 60_000 : COD_HOLD
    try {
      const order = await db
        .prepare(
          `INSERT INTO orders (id, drop_id, seller_id, variant_id, qty, amount_paise, buyer_name, buyer_phone, address,
                               pay_mode, ip_hash, hold_until, created_at, channel, assisted, ship_paise, unit_paise, cost_paise, offer_id, disc_paise, adv_paise, adv_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cod', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .bind(randomId(14), drop.id, seller.id, input.variantId, input.qty, total, input.name, input.phone, input.address,
          input.ipHash, hold, now, input.channel ?? 'web', input.assisted ? 1 : 0, ship, unit, cost, input.offerId ?? null, cartOffer(seller, base), adv, adv ? 'due' : '')
        .first<Order>()
      if (!order) throw new Error('insert failed')
      return { ok: true, order }
    } catch (e) {
      await giveBackStock(db, input.variantId, input.qty)
      throw e
    }
  }
  const mode = seller.pay_mode
  // Gateway payment links must live at least 15 minutes, so hold at least that long to
  // avoid a payment landing after its stock was released.
  // WhatsApp buyers hop between chat and UPI app, so give them a little longer.
  const holdMin = input.holdMinutes ?? Math.max(Number(env.HOLD_MINUTES) || 10, mode === 'direct' ? (input.channel === 'whatsapp' ? 15 : 0) : 16)
  try {
    // Already paying for something else here? Join that payment – one amount, one confirmation.
    // Only when the money goes to the same UPI ID, since one payment can't be split.
    const payee = drop.upi_vpa ?? seller.upi_vpa
    const open = await db
      .prepare(
        `SELECT o.* FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.seller_id = ? AND o.buyer_phone = ? AND o.status = 'pending'
         AND o.hold_until > ? AND o.pay_mode = ? AND COALESCE(d.upi_vpa, ?) = ?
         -- A gateway payment whose link already exists is never changed: the buyer may be paying that link right now.
         AND NOT EXISTS (SELECT 1 FROM orders x WHERE (x.id = COALESCE(o.cart_id, o.id) OR x.cart_id = COALESCE(o.cart_id, o.id)) AND x.pay_url IS NOT NULL)
         ORDER BY o.created_at LIMIT 1`,
      )
      .bind(seller.id, input.phone, now, mode, seller.upi_vpa ?? '', payee ?? '')
      .first<Order>()
    const key = open ? cartKeyOf(open) : null
    const holdUntil = Math.max(now + holdMin * 60_000, open?.hold_until ?? 0)
    // Delivery is charged once per payment: an item joining a cart that already pays delivery adds none.
    let ship = shipFor(drop, base)
    if (ship && key) {
      const paid = await db.prepare(`SELECT COALESCE(SUM(ship_paise), 0) AS s FROM orders WHERE id = ?1 OR cart_id = ?1`).bind(key).first<{ s: number }>()
      if ((paid?.s ?? 0) > 0) ship = 0
    }
    const amount = base + ship   // final amount (offer, unique paise) is set by repriceCart below
    const order = await db
      .prepare(
        `INSERT INTO orders (id, drop_id, seller_id, variant_id, qty, amount_paise, buyer_name, buyer_phone, address,
                             pay_mode, ip_hash, hold_until, created_at, channel, cart_id, assisted, ship_paise, unit_paise, cost_paise, offer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(randomId(14), drop.id, seller.id, input.variantId, input.qty, amount, input.name, input.phone, input.address || open?.address || '',
        mode, input.ipHash, holdUntil, now, input.channel ?? 'web', key, input.assisted ? 1 : 0, ship, unit, cost, input.offerId ?? null)
      .first<Order>()
    if (!order) throw new Error('insert failed')
    if (key) {
      // The whole cart now lives as long as its newest item; any old gateway link no longer matches the total.
      await db.prepare(`UPDATE orders SET cart_id = ?1, hold_until = ?2, pay_url = NULL, gateway_ref = NULL WHERE id = ?1 OR cart_id = ?1`).bind(key, holdUntil).run()
      await repriceCart(db, seller, key, mode)
      return { ok: true, order: (await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(order.id).first<Order>())! }
    }
    await repriceCart(db, seller, order.id, mode)
    return { ok: true, order: (await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(order.id).first<Order>())! }
  } catch (e) {
    await giveBackStock(db, input.variantId, input.qty)
    throw e
  }
}

/** Release stock for every pending order whose hold has lapsed. Safe to run concurrently. */
export async function expireHolds(env: Bindings, now = Date.now()) {
  // Both statements run in one D1 transaction with the same cut-off, so stock and order
  // status can never drift apart.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE variants SET available = available + (
         SELECT COALESCE(SUM(qty), 0) FROM orders o WHERE o.variant_id = variants.id AND o.status = 'pending' AND o.hold_until < ?1)
       WHERE id IN (SELECT variant_id FROM orders WHERE status = 'pending' AND hold_until < ?1)`,
    ).bind(now),
    env.DB.prepare(`UPDATE orders SET status = 'expired' WHERE status = 'pending' AND hold_until < ?1`).bind(now),
  ])
}

/** Seller says "I didn't receive this". Releases the held stock and tells a WhatsApp buyer. */
export async function rejectOrder(env: Bindings, orderId: string, sellerId: string, waitUntil?: (p: Promise<unknown>) => void) {
  const match = `FROM orders WHERE id = ?1 AND seller_id = ?2 AND status IN ${ACTIVE}`
  const [, upd] = await env.DB.batch([
    env.DB.prepare(`UPDATE variants SET available = available + (SELECT qty ${match}) WHERE id = (SELECT variant_id ${match})`).bind(orderId, sellerId),
    env.DB.prepare(`UPDATE orders SET status = 'rejected' WHERE id = ?1 AND seller_id = ?2 AND status IN ${ACTIVE}`).bind(orderId, sellerId),
  ])
  if (upd.meta.changes > 0 && waitUntil) waitUntil(notifyBuyer(env, orderId, 'rejected'))
}

/** Buyer taps "Cancel" in WhatsApp while still paying. */
export async function cancelByBuyer(env: Bindings, orderId: string, phone: string): Promise<boolean> {
  const match = `FROM orders WHERE id = ?1 AND buyer_phone = ?2 AND status = 'pending'`
  const [, upd] = await env.DB.batch([
    env.DB.prepare(`UPDATE variants SET available = available + (SELECT qty ${match}) WHERE id = (SELECT variant_id ${match})`).bind(orderId, phone),
    env.DB.prepare(`UPDATE orders SET status = 'expired', hold_until = 0 WHERE id = ?1 AND buyer_phone = ?2 AND status = 'pending'`).bind(orderId, phone),
  ])
  return upd.meta.changes > 0
}

/** Direct-UPI buyer says "I've paid" (UTR optional). Keeps the hold until the seller decides. */
export async function submitUtr(env: Bindings, order: Order, utr: string | null): Promise<boolean> {
  const db = env.DB
  if (order.status === 'pending' || order.status === 'verifying') {
    const r = await db.prepare(`UPDATE orders SET status = 'verifying', utr = COALESCE(?, utr) WHERE id = ? AND status IN ${ACTIVE}`).bind(utr, order.id).run()
    return r.meta.changes > 0
  }
  if (order.status === 'expired' && (await takeStock(db, order.variant_id, order.drop_id, order.qty))) {
    const r = await db.prepare(`UPDATE orders SET status = 'verifying', utr = ? WHERE id = ? AND status = 'expired'`).bind(utr, order.id).run()
    if (r.meta.changes > 0) return true
    await giveBackStock(db, order.variant_id, order.qty)
  }
  return false
}

/**
 * Mark an order paid, credit the khata and notify the buyer. Idempotent: webhooks,
 * gateway redirects and the seller's "received" tap can all race here safely.
 */
/** Seller cancels a cash-on-delivery order (e.g. the buyer didn't confirm): the piece goes back on sale. */
export async function cancelCod(env: Bindings, orderId: string, sellerId: string): Promise<boolean> {
  const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND seller_id = ? AND ${IS_COD}`).bind(orderId, sellerId).first<Order>()
  if (!order) return false
  const r = await env.DB.prepare(`UPDATE orders SET status = 'rejected' WHERE id = ? AND ${IS_COD}`).bind(orderId).run()
  if (r.meta.changes > 0) await giveBackStock(env.DB, order.variant_id, order.qty)
  return r.meta.changes > 0
}

export async function markPaid(env: Bindings, orderId: string, paymentRef: string, waitUntil?: (p: Promise<unknown>) => void, notify = true): Promise<Order | null> {
  const db = env.DB
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<Order>()
    if (!order) return null
    if (order.status === 'paid' || order.status === 'refund_due') return order

    let fromStatuses = ACTIVE
    let tookStock = false
    if (order.status === 'expired' || order.status === 'rejected') {
      // Money arrived after the hold lapsed. Re-take stock if any is left, otherwise flag a refund.
      if (!(await takeStock(db, order.variant_id, order.drop_id, order.qty))) {
        await db.prepare(`UPDATE orders SET status = 'refund_due', payment_ref = ? WHERE id = ? AND status = ?`).bind(paymentRef, orderId, order.status).run()
        continue
      }
      fromStatuses = `('${order.status}')`
      tookStock = true
    }

    const now = Date.now()
    const [upd] = await db.batch([
      db.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, payment_ref = ? WHERE id = ? AND status IN ${fromStatuses}`).bind(now, paymentRef, orderId),
      db.prepare(
        `INSERT OR IGNORE INTO ledger (seller_id, order_id, kind, amount_paise, note, created_at)
         SELECT o.seller_id, o.id, 'credit', o.amount_paise, d.title || ' ×' || o.qty, ?
         FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.id = ? AND o.status = 'paid'`,
      ).bind(now, orderId),
    ])
    if (upd.meta.changes > 0) {
      const paid = { ...order, status: 'paid' as const, paid_at: now, payment_ref: paymentRef }
      if (notify) {
        const job = notifyBuyer(env, orderId, 'paid')
        waitUntil ? waitUntil(job) : await job
      }
      return paid
    }
    if (tookStock) await giveBackStock(db, order.variant_id, order.qty)
    // Someone else changed the order between our read and write – re-read and retry.
  }
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<Order>()
}

/** "Selling fast" when about a fifth or less is left – a nudge for buyers without revealing the number. */
export const sellingFast = (c: { stock: number; available: number }) => c.available > 0 && c.available <= Math.max(2, Math.ceil(c.stock * 0.2))

/** Mark every order in the payment paid, then tell the buyer once. */
export async function markCartPaid(env: Bindings, anyOrderId: string, paymentRef: string, waitUntil?: (p: Promise<unknown>) => void) {
  const first = await env.DB.prepare(`SELECT id, cart_id FROM orders WHERE id = ?`).bind(anyOrderId).first<Pick<Order, 'id' | 'cart_id'>>()
  if (!first) return
  const lines = await cartOrders(env.DB, first)
  let changed = false
  for (const l of lines) {
    if (l.status === 'paid' || l.status === 'refund_due') continue
    const r = await markPaid(env, l.id, paymentRef, undefined, false)
    changed ||= r?.status === 'paid'
  }
  if (changed) {
    const job = notifyBuyer(env, cartKeyOf(first), 'paid')
    waitUntil ? waitUntil(job) : await job
  }
}

/** Seller didn't receive it: release every item in the payment, tell the buyer once. */
export async function rejectCart(env: Bindings, anyOrderId: string, sellerId: string, waitUntil?: (p: Promise<unknown>) => void) {
  const first = await env.DB.prepare(`SELECT id, cart_id FROM orders WHERE id = ? AND seller_id = ?`).bind(anyOrderId, sellerId).first<Pick<Order, 'id' | 'cart_id'>>()
  if (!first) return
  for (const l of await cartOrders(env.DB, first)) await rejectOrder(env, l.id, sellerId)
  if (waitUntil) waitUntil(notifyBuyer(env, cartKeyOf(first), 'rejected'))
}

/** Buyer says "I have paid" for the whole payment. False if an item sold out meanwhile. */
export async function claimCart(env: Bindings, anyOrder: Pick<Order, 'id' | 'cart_id'>, utr: string | null): Promise<boolean> {
  let ok = true
  let claimed = false
  for (const l of await cartOrders(env.DB, anyOrder)) {
    if (l.pay_mode !== 'direct' || l.status === 'paid') continue
    const was = l.status
    const r = await submitUtr(env, l, utr)
    ok = r && ok
    if (r && was !== 'verifying') claimed = true
  }
  // "I have paid" is the moment the seller needs to look at their UPI app.
  if (claimed) await alertSeller(env, anyOrder.id, 'claimed')
  return ok
}

/** Buyer cancels everything still unpaid in the payment. */
export async function cancelCart(env: Bindings, anyOrderId: string, phone: string): Promise<boolean> {
  const first = await env.DB.prepare(`SELECT id, cart_id FROM orders WHERE id = ? AND buyer_phone = ?`).bind(anyOrderId, phone).first<Pick<Order, 'id' | 'cart_id'>>()
  if (!first) return false
  let any = false
  for (const l of await cartOrders(env.DB, first)) any = (await cancelByBuyer(env, l.id, phone)) || any
  return any
}

export const shortNo = (orderId: string) => orderId.slice(0, 6).toUpperCase()

export async function loadDrop(db: D1Database, id: string) {
  const drop = await db.prepare(`SELECT * FROM drops WHERE id = ?`).bind(id).first<Drop>()
  if (!drop) return null
  const [{ results: variants }, { results: imgs }] = await Promise.all([
    db.prepare(`SELECT * FROM variants WHERE drop_id = ? ORDER BY position`).bind(id).all<Variant>(),
    db.prepare(`SELECT image_key FROM drop_images WHERE drop_id = ? ORDER BY position`).bind(id).all<{ image_key: string }>(),
  ])
  // All photos, cover first (older sales may only have the cover in drops.image_key).
  const images = imgs.length ? imgs.map((r) => r.image_key) : drop.image_key ? [drop.image_key] : []
  return { drop, variants, images }
}

/** Sold = stock that is paid for; held = reserved by buyers who are paying right now. */
export async function dropCounts(db: D1Database, dropId: string) {
  const r = await db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(stock), 0) FROM variants WHERE drop_id = ?1) AS stock,
              (SELECT COALESCE(SUM(available), 0) FROM variants WHERE drop_id = ?1) AS available,
              (SELECT COALESCE(SUM(qty), 0) FROM orders WHERE drop_id = ?1 AND (status = 'paid' OR ${IS_COD})) AS sold`,
    )
    .bind(dropId)
    .first<{ stock: number; available: number; sold: number }>()
  const c = r ?? { stock: 0, available: 0, sold: 0 }
  return { ...c, held: Math.max(0, c.stock - c.available - c.sold) }
}
