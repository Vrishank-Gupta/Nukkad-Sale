import type { Offer } from '../env'

/**
 * Personal price links: a seller gives one buyer a special rate for one sale, shared on WhatsApp.
 * A link is good for one order. If that order lapses (not paid in time) or the seller rejects it,
 * the link works again – the buyer didn't get the item.
 */
export type OfferState = 'ok' | 'missing' | 'expired' | 'used' | 'wrong_phone'

const FREE_AGAIN = `('expired', 'rejected')`

export async function checkOffer(db: D1Database, token: string, dropId: string, phone?: string | null): Promise<{ state: OfferState; offer: Offer | null }> {
  if (!token || !/^[a-z0-9]{6,32}$/i.test(token)) return { state: 'missing', offer: null }
  const offer = await db.prepare(`SELECT * FROM offers WHERE id = ? AND drop_id = ?`).bind(token, dropId).first<Offer>()
  if (!offer) return { state: 'missing', offer: null }
  if (offer.expires_at < Date.now()) return { state: 'expired', offer }
  if (offer.used_order_id) {
    const o = await db.prepare(`SELECT status FROM orders WHERE id = ?`).bind(offer.used_order_id).first<{ status: string }>()
    if (o && !FREE_AGAIN.includes(`'${o.status}'`)) return { state: 'used', offer }
  }
  if (phone && offer.buyer_phone && offer.buyer_phone !== phone) return { state: 'wrong_phone', offer }
  return { state: 'ok', offer }
}

/** Percent off, rounded down, for "25% off" labels. */
export const pctOff = (was: number, now: number) => (was > now && was > 0 ? Math.floor(((was - now) / was) * 100) : 0)
