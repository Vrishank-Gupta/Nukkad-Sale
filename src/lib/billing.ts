import type { Bindings } from '../env'
import { createPaymentLink, getPaymentLink } from './razorpay'
import { decrypt, encrypt } from './crypto'
import { istDay, istDayStart, randomId } from './util'
import { planUsage, upgradePaid } from './plans'

/*
 * Monthly platform fees (what sellers pay NukkadSale).
 *
 * - The admin sets a fee and an optional free trial per seller.
 * - The cron job creates one invoice per seller per IST calendar month.
 * - Sellers pay online through the PLATFORM's own Razorpay account (auto-confirmed), or by
 *   UPI to the platform's UPI ID using a unique amount (the admin confirms with one tap).
 * - Reminders (banner + a daily popup) until the due date, then the shop pauses: the seller's app
 *   shows a blocker and buyers can't start new orders. Orders already placed can still be paid,
 *   confirmed and sent. Paying online, or tapping "I have paid" (UPI), opens the shop again at once.
 */

export type PlatformSettings = {
  upi_vpa: string
  payee_name: string
  rzp_key_id: string
  rzp_secret_enc: string
  default_fee_paise: string
  trial_days: string
  grace_days: string
  default_modes: string
}

const DEFAULTS: PlatformSettings = {
  upi_vpa: '',
  payee_name: 'NukkadSale',
  rzp_key_id: '',
  rzp_secret_enc: '',
  default_fee_paise: '0',
  trial_days: '30',
  grace_days: '2',
  default_modes: 'direct',
}

export async function getSettings(env: Bindings): Promise<PlatformSettings> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM platform_settings`).all<{ key: keyof PlatformSettings; value: string }>()
  const s = { ...DEFAULTS }
  for (const r of results) if (r.key in s) s[r.key] = r.value
  return s
}

export async function saveSettings(env: Bindings, patch: Partial<PlatformSettings>) {
  const stmts = Object.entries(patch).map(([k, v]) =>
    env.DB.prepare(`INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(k, String(v)),
  )
  if (stmts.length) await env.DB.batch(stmts)
}

export const encryptSecret = (env: Bindings, v: string) => encrypt(v, env.SECRET_KEY)

/** Your own Razorpay account, used to collect plan fees from sellers. */
const platformRazorpay = async (env: Bindings, s: PlatformSettings) =>
  s.rzp_key_id && s.rzp_secret_enc ? { keyId: s.rzp_key_id, secret: await decrypt(s.rzp_secret_enc, env.SECRET_KEY) } : null

export const onlineFeePayments = (s: PlatformSettings) => Boolean(s.rzp_key_id && s.rzp_secret_enc)
/** Sellers can only be expected to pay (and be paused for not paying) if there is a way to pay. */
export const canPayFees = (s: PlatformSettings) => Boolean(s.upi_vpa) || onlineFeePayments(s)

export const currentPeriod = (now = Date.now()) => istDay(now).slice(0, 7)

export type Invoice = {
  id: string
  seller_id: string
  period: string
  amount_paise: number
  status: 'due' | 'claimed' | 'paid' | 'waived'
  due_at: number
  paid_at: number | null
  paid_via: string | null
  /** Upgrade invoices only: the plan being bought and the plan before it. */
  plan?: string | null
  plan_from?: string | null
  gateway_ref: string | null
  pay_url: string | null
  created_at: number
}

/** Create this month's invoice for every seller whose fee applies. Safe to run repeatedly. */
export async function ensureInvoices(env: Bindings, sellerId?: string) {
  const now = Date.now()
  const period = currentPeriod(now)
  const settings = await getSettings(env)
  // A month is billed only if the trial ended before that month began – a trial ending on the
  // 28th is followed by the first invoice on the 1st, not a full month's fee 3 days earlier.
  // Sellers with no trial (trial_until at sign-up) are billed straight away.
  const monthStart = Date.parse(period + '-01T00:00:00Z') - 330 * 60_000
  const { results } = await env.DB
    .prepare(
      `SELECT s.id, s.plan_fee_paise FROM sellers s
       WHERE s.plan_fee_paise > 0 AND (s.trial_until <= ?1 OR s.trial_until <= s.created_at + 60000) AND s.trial_until <= ?4 AND s.account_status = 'active' ${sellerId ? 'AND s.id = ?3' : ''}
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.seller_id = s.id AND (i.period = ?2 OR (i.period LIKE ?2 || '-u%' AND i.status IN ('paid', 'claimed')))) LIMIT 50`,
    )
    .bind(...(sellerId ? [monthStart, period, sellerId, now] : [monthStart, period, null, now]))
    .all<{ id: string; plan_fee_paise: number }>()
  for (const s of results) {
    // Unique paise per open invoice of the same fee, so a plain UPI payment identifies the seller.
    const { results: taken } = await env.DB
      .prepare(`SELECT amount_paise FROM invoices WHERE status IN ('due', 'claimed') AND amount_paise BETWEEN ? AND ?`)
      .bind(s.plan_fee_paise, s.plan_fee_paise + 99)
      .all<{ amount_paise: number }>()
    const used = new Set(taken.map((t) => t.amount_paise - s.plan_fee_paise))
    const free = Array.from({ length: 99 }, (_, i) => i + 1).filter((k) => !used.has(k))
    const amount = s.plan_fee_paise + (free.length ? free[Math.floor(Math.random() * free.length)] : 0)
    const dueAt = now + graceDays(settings) * 86_400_000
    await env.DB.prepare(`INSERT OR IGNORE INTO invoices (id, seller_id, period, amount_paise, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(randomId(12), s.id, period, amount, dueAt, now).run()
  }
}

/** Days a seller has to pay an invoice before the shop pauses (admin setting, default 2). */
export const graceDays = (s: PlatformSettings) => {
  const n = Number(s.grace_days)
  return Number.isFinite(n) && n >= 0 ? n : 2
}

/** What the seller dashboard needs: the open invoice (if any) and whether the shop is paused for it. */
export async function billingState(env: Bindings, sellerId: string) {
  const open = await env.DB
    .prepare(`SELECT * FROM invoices WHERE seller_id = ? AND status IN ('due', 'claimed') ORDER BY plan IS NOT NULL, created_at LIMIT 1`)
    .bind(sellerId)
    .first<Invoice>()
  // Only the monthly fee pauses a shop; an upgrade the seller hasn't paid for yet just waits.
  const overdue = Boolean(open && !open.plan && open.status === 'due' && open.due_at < Date.now()) && canPayFees(await getSettings(env))
  return { open, overdue }
}

/** Can buyers start new orders with this seller? Not when suspended, paused for an unpaid fee, or at the plan's order limit. */
export async function shopOpen(env: Bindings, seller: { id: string; account_status: string }) {
  if (seller.account_status !== 'active') return false
  if ((await planUsage(env, seller.id)).reached) return false
  const r = await env.DB.prepare(`SELECT 1 FROM invoices WHERE seller_id = ? AND status = 'due' AND plan IS NULL AND due_at < ? LIMIT 1`).bind(seller.id, Date.now()).first()
  return !r || !canPayFees(await getSettings(env))
}

/** Start an online payment for an invoice via the platform's Razorpay account. */
export async function startInvoicePayment(env: Bindings, inv: Invoice, seller: { name: string; phone: string; shop_name: string }, origin: string): Promise<string | null> {
  if (inv.pay_url && inv.status === 'due') return inv.pay_url
  const auth = await platformRazorpay(env, await getSettings(env))
  if (!auth) return null
  const link = await createPaymentLink(auth.keyId, auth.secret, {
    amountPaise: inv.amount_paise,
    referenceId: `inv_${inv.id}_${randomId(4)}`,
    description: `NukkadSale ${inv.plan ? `upgrade to ${inv.plan === 'badi' ? 'Badi Dukaan' : 'Dukaan'}` : inv.period} – ${seller.shop_name}`,
    customerName: seller.name,
    customerPhone: seller.phone,
    callbackUrl: `${origin}/app/billing/return/${inv.id}`,
    expireAt: Date.now() + 7 * 86_400_000,
  }, env.RAZORPAY_API_BASE)
  await env.DB.prepare(`UPDATE invoices SET gateway_ref = ?, pay_url = ? WHERE id = ?`).bind(link.id, link.short_url, inv.id).run()
  return link.short_url
}

/** Ask Razorpay whether an invoice's link is paid; mark the invoice paid if so. */
export async function confirmInvoice(env: Bindings, invoiceId: string): Promise<boolean> {
  const inv = await env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first<Invoice>()
  if (!inv?.gateway_ref || inv.status === 'paid' || inv.status === 'waived') return false
  const auth = await platformRazorpay(env, await getSettings(env))
  if (!auth) return false
  await env.DB.prepare(`UPDATE invoices SET gw_checked_at = ? WHERE id = ?`).bind(Date.now(), invoiceId).run()
  const link = await getPaymentLink(auth.keyId, auth.secret, inv.gateway_ref, env.RAZORPAY_API_BASE)
  if (Number(link.amount_paid) < inv.amount_paise) return false
  return markInvoicePaid(env, invoiceId, 'razorpay')
}

export async function markInvoicePaid(env: Bindings, invoiceId: string, via: string) {
  const r = await env.DB.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_via = ? WHERE id = ? AND status IN ('due', 'claimed')`)
    .bind(Date.now(), via, invoiceId).run()
  if (r.meta.changes === 1) await upgradePaid(env, invoiceId)
  return r.meta.changes === 1
}

/** Cron: create this month's invoices and catch any online fee payment whose webhook was lost. */
export async function billingCron(env: Bindings) {
  await ensureInvoices(env)
  const { results } = await env.DB
    .prepare(`SELECT id FROM invoices WHERE status IN ('due', 'claimed') AND gateway_ref IS NOT NULL AND COALESCE(gw_checked_at, 0) < ? LIMIT 10`)
    .bind(Date.now() - 5 * 60_000)
    .all<{ id: string }>()
  for (const r of results) await confirmInvoice(env, r.id).catch((e) => console.error('invoice reconcile', r.id, e))
}

export const isAdmin = (env: Bindings, phone: string) => (env.ADMIN_PHONES ?? '').split(',').map((p) => p.trim()).includes(phone)

export const MODES = ['direct', 'razorpay'] as const
export const parseModes = (csv: string) => MODES.filter((m) => csv.split(',').includes(m))
