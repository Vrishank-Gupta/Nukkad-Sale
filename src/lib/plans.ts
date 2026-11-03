import type { Bindings } from '../env'
import { istDay, randomId } from './util'

/*
 * Pricing plans – the same three as on the landing page (#pricing). Every feature is in every plan;
 * plans differ in how many paid orders a month the shop can take.
 *
 * - An "order" is one payment: a cart counts once. It counts when it is paid (by UPI or gateway) or,
 *   for cash on delivery, when it is placed. Months are IST calendar months.
 * - When a shop reaches its limit, buyers can't start new orders (same as a paused shop) and the seller
 *   app asks to upgrade. Orders already placed can still be paid, confirmed and sent.
 * - Upgrading creates an upgrade invoice (credited with anything already paid this month). Paying it
 *   online switches the plan at once; "I have paid" by UPI switches it too, and the admin's
 *   "Not received" switches it back.
 */

export type PlanId = 'free' | 'dukaan' | 'badi'
export const PLAN_IDS: PlanId[] = ['free', 'dukaan', 'badi']
export const PLANS: Record<PlanId, { fee: number; limit: number | null; en: string; hi: string }> = {
  free: { fee: 0, limit: 30, en: 'Shuruaat', hi: 'शुरुआत' },
  dukaan: { fee: 99_900, limit: 300, en: 'Dukaan', hi: 'दुकान' },
  badi: { fee: 199_900, limit: null, en: 'Badi Dukaan', hi: 'बड़ी दुकान' },
}
export const asPlan = (x: unknown): PlanId => (typeof x === 'string' && x in PLANS ? (x as PlanId) : 'free')
export const planName = (p: PlanId, lang: 'en' | 'hi' = 'en') => PLANS[p][lang]
const rank = (p: PlanId) => PLAN_IDS.indexOf(p)
export const higherPlans = (p: PlanId) => PLAN_IDS.filter((x) => rank(x) > rank(p))

/** Start of the current IST month, and the "YYYY-MM" period. */
export const monthPeriod = (now = Date.now()) => istDay(now).slice(0, 7)
export const monthStart = (now = Date.now()) => Date.parse(monthPeriod(now) + '-01T00:00:00Z') - 330 * 60_000
/** 1st of next month (IST), for "resets on …". */
export const nextMonthStart = (now = Date.now()) => {
  const [y, m] = monthPeriod(now).split('-').map(Number)
  return Date.parse(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00Z`) - 330 * 60_000
}

/** SQL counting this month's orders (one per payment). Bind: seller id, month start. */
export const USED_SQL = `SELECT COUNT(DISTINCT COALESCE(cart_id, id)) AS n FROM orders
  WHERE seller_id = ?1 AND ((status = 'paid' AND paid_at >= ?2) OR (pay_mode = 'cod' AND status = 'pending' AND created_at >= ?2))`

export type Usage = { plan: PlanId; used: number; limit: number | null; left: number | null; reached: boolean; near: boolean; resetsAt: number }

export async function planUsage(env: Bindings, sellerId: string, plan?: PlanId): Promise<Usage> {
  const now = Date.now()
  const p = plan ?? asPlan((await env.DB.prepare(`SELECT plan FROM sellers WHERE id = ?`).bind(sellerId).first<{ plan: string }>())?.plan)
  const limit = PLANS[p].limit
  if (limit === null) return { plan: p, used: 0, limit, left: null, reached: false, near: false, resetsAt: nextMonthStart(now) }
  const used = (await env.DB.prepare(USED_SQL).bind(sellerId, monthStart(now)).first<{ n: number }>())?.n ?? 0
  return { plan: p, used, limit, left: Math.max(0, limit - used), reached: used >= limit, near: used >= Math.ceil(limit * 0.8), resetsAt: nextMonthStart(now) }
}

/** Switch a seller's plan (and the fee billed from next month). Paying sellers aren't put back on a trial. */
export async function applyPlan(env: Bindings, sellerId: string, plan: PlanId) {
  await env.DB.prepare(`UPDATE sellers SET plan = ?, plan_fee_paise = ?, trial_until = MIN(trial_until, ?) WHERE id = ?`)
    .bind(plan, PLANS[plan].fee, Date.now(), sellerId).run()
}

/** A fee plus 1–99 paise no other open invoice of that fee uses, so a plain UPI payment identifies the seller. */
export async function uniqueFee(env: Bindings, fee: number) {
  const { results } = await env.DB.prepare(`SELECT amount_paise FROM invoices WHERE status IN ('due', 'claimed') AND amount_paise BETWEEN ? AND ?`)
    .bind(fee, fee + 99).all<{ amount_paise: number }>()
  const used = new Set(results.map((t) => t.amount_paise - fee))
  const free = Array.from({ length: 99 }, (_, i) => i + 1).filter((k) => !used.has(k))
  return fee + (free.length ? free[Math.floor(Math.random() * free.length)] : 0)
}

/**
 * The seller asked to move up to `target`. Returns 'applied' when nothing is left to pay (already paid
 * enough this month), otherwise the id of the open upgrade invoice to pay.
 */
export async function requestUpgrade(env: Bindings, sellerId: string, current: PlanId, target: PlanId): Promise<'applied' | 'same' | string> {
  if (rank(target) <= rank(current)) return 'same'
  const now = Date.now(), period = monthPeriod(now)
  // Credit what was already paid for this month (monthly fee or an earlier upgrade), unique paise left out.
  const paid = (await env.DB.prepare(`SELECT COALESCE(SUM(amount_paise - amount_paise % 100), 0) AS p FROM invoices WHERE seller_id = ? AND (period = ?2 OR period LIKE ?2 || '-u%') AND status IN ('paid', 'claimed')`)
    .bind(sellerId, period).first<{ p: number }>())?.p ?? 0
  const charge = Math.max(0, PLANS[target].fee - paid)
  if (charge === 0) {
    await applyPlan(env, sellerId, target)
    return 'applied'
  }
  // One open upgrade at a time: change it if the seller picked a different plan.
  const open = await env.DB.prepare(`SELECT id, plan, amount_paise FROM invoices WHERE seller_id = ? AND plan IS NOT NULL AND status = 'due' ORDER BY created_at DESC LIMIT 1`)
    .bind(sellerId).first<{ id: string; plan: string; amount_paise: number }>()
  if (open) {
    if (open.plan !== target || open.amount_paise - (open.amount_paise % 100) !== charge) {
      await env.DB.prepare(`UPDATE invoices SET plan = ?, plan_from = ?, amount_paise = ?, pay_url = NULL, gateway_ref = NULL WHERE id = ?`)
        .bind(target, current, await uniqueFee(env, charge), open.id).run()
    }
    return open.id
  }
  const n = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE seller_id = ? AND period LIKE ? || '-u%'`).bind(sellerId, period).first<{ n: number }>())?.n ?? 0
  const id = randomId(12)
  await env.DB.prepare(`INSERT INTO invoices (id, seller_id, period, amount_paise, due_at, created_at, plan, plan_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, sellerId, `${period}-u${n + 1}`, await uniqueFee(env, charge), now + 7 * 86_400_000, now, target, current).run()
  return id
}

/**
 * An upgrade invoice was paid (or claimed by UPI): switch the plan, and drop this month's unpaid monthly
 * invoice – the upgrade already covers the month.
 */
export async function upgradePaid(env: Bindings, invoiceId: string) {
  const inv = await env.DB.prepare(`SELECT seller_id, plan, period FROM invoices WHERE id = ?`).bind(invoiceId).first<{ seller_id: string; plan: string | null; period: string }>()
  if (!inv?.plan) return
  await applyPlan(env, inv.seller_id, asPlan(inv.plan))
  await env.DB.prepare(`UPDATE invoices SET status = 'waived', paid_at = ?, paid_via = 'upgraded' WHERE seller_id = ? AND period = ? AND plan IS NULL AND status = 'due'`)
    .bind(Date.now(), inv.seller_id, inv.period.slice(0, 7)).run()
}

/** The admin found a claimed upgrade wasn't paid: back to the plan before it. */
export async function upgradeUndone(env: Bindings, invoiceId: string) {
  const inv = await env.DB.prepare(`SELECT seller_id, plan, plan_from, period FROM invoices WHERE id = ?`).bind(invoiceId).first<{ seller_id: string; plan: string | null; plan_from: string | null; period: string }>()
  if (!inv?.plan || !inv.plan_from) return
  await applyPlan(env, inv.seller_id, asPlan(inv.plan_from))
  // The monthly invoice the upgrade had replaced is owed again.
  await env.DB.prepare(`UPDATE invoices SET status = 'due', paid_at = NULL, paid_via = NULL WHERE seller_id = ? AND period = ? AND plan IS NULL AND status = 'waived' AND paid_via = 'upgraded'`)
    .bind(inv.seller_id, inv.period.slice(0, 7)).run()
}
