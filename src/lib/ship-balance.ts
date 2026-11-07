import type { Bindings } from '../env'

/**
 * Prepaid shipping balance for NukkadSale Shipping. Every change is a row in ship_ledger; the balance itself is
 * kept on sellers.ship_balance_paise so a booking can take from it atomically.
 */
export type LedgerRow = { id: number; seller_id: string; kind: 'topup' | 'charge' | 'refund' | 'adjust'; amount_paise: number; status: string; ref: string | null; note: string; created_at: number; decided_at: number | null }

/** Takes `paise` from the balance only if there's enough. True if taken. */
export async function takeFromBalance(env: Bindings, sellerId: string, paise: number, ref: string, note: string) {
  const r = await env.DB.prepare(`UPDATE sellers SET ship_balance_paise = ship_balance_paise - ?1 WHERE id = ?2 AND ship_balance_paise >= ?1`).bind(paise, sellerId).run()
  if (r.meta.changes !== 1) return false
  await env.DB.prepare(`INSERT INTO ship_ledger (seller_id, kind, amount_paise, ref, note, created_at) VALUES (?, 'charge', ?, ?, ?, ?)`).bind(sellerId, -paise, ref, note, Date.now()).run()
  return true
}

/** Adds to (or, with a negative amount, takes from) the balance without a floor – refunds, corrections, extra charges. */
export async function changeBalance(env: Bindings, sellerId: string, paise: number, kind: 'refund' | 'adjust' | 'charge', ref: string | null, note: string) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE sellers SET ship_balance_paise = ship_balance_paise + ? WHERE id = ?`).bind(paise, sellerId),
    env.DB.prepare(`INSERT INTO ship_ledger (seller_id, kind, amount_paise, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(sellerId, kind, paise, ref, note, Date.now()),
  ])
}

/** Admin saw a top-up in their UPI app: credit it (once). */
export async function confirmTopup(env: Bindings, id: number) {
  const row = await env.DB.prepare(`UPDATE ship_ledger SET status = 'done', decided_at = ? WHERE id = ? AND kind = 'topup' AND status IN ('new', 'claimed') RETURNING seller_id, amount_paise`)
    .bind(Date.now(), id).first<{ seller_id: string; amount_paise: number }>()
  if (row) await env.DB.prepare(`UPDATE sellers SET ship_balance_paise = ship_balance_paise + ? WHERE id = ?`).bind(row.amount_paise, row.seller_id).run()
  return Boolean(row)
}

export const rejectTopup = (env: Bindings, id: number) =>
  env.DB.prepare(`UPDATE ship_ledger SET status = 'rejected', decided_at = ? WHERE id = ? AND kind = 'topup' AND status = 'claimed'`).bind(Date.now(), id).run()
