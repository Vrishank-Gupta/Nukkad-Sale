import { hmacHex, safeEqual } from './crypto'

/*
 * Razorpay Payment Links. Each seller connects their own Razorpay account, so money
 * settles straight to them – the platform never holds funds.
 */

const api = (baseUrl?: string) => baseUrl || 'https://api.razorpay.com/v1'
const auth = (keyId: string, secret: string) => 'Basic ' + btoa(`${keyId}:${secret}`)

/**
 * Checks keys against Razorpay before they're saved, so a typo is caught by the seller, not by a
 * buyer at checkout. 'bad' = Razorpay rejected them; 'unknown' = couldn't reach Razorpay (allowed).
 */
export async function checkKeys(keyId: string, secret: string, baseUrl?: string): Promise<'ok' | 'bad' | 'unknown'> {
  try {
    const res = await fetch(`${api(baseUrl)}/payment_links?count=1`, { headers: { Authorization: auth(keyId, secret) } })
    if (res.ok) return 'ok'
    return res.status === 401 || res.status === 400 ? 'bad' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Test keys take fake payments; in production that would mark unpaid orders as paid. */
export const isTestKey = (keyId: string) => keyId.startsWith('rzp_test_')

export type LinkRequest = {
  amountPaise: number
  referenceId: string
  description: string
  customerName: string
  customerPhone: string
  callbackUrl: string
  expireAt: number
}

export async function createPaymentLink(keyId: string, secret: string, r: LinkRequest, baseUrl?: string) {
  const res = await fetch(`${api(baseUrl)}/payment_links`, {
    method: 'POST',
    headers: { Authorization: auth(keyId, secret), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: r.amountPaise,
      currency: 'INR',
      accept_partial: false,
      reference_id: r.referenceId,
      description: r.description.slice(0, 2048),
      customer: { name: r.customerName, contact: '+' + r.customerPhone },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: r.callbackUrl,
      callback_method: 'get',
      expire_by: Math.floor(r.expireAt / 1000),
    }),
  })
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${await res.text()}`)
  return (await res.json()) as { id: string; short_url: string }
}

export type RzpLink = { id: string; status: string; amount: number; amount_paid: number; payments?: { payment_id: string; status: string }[] | null }

/**
 * Fetch a payment link's current state. Used to confirm payments without needing the seller
 * to set up a webhook: on the buyer's return, while the order page is open, and by the cron.
 */
export async function getPaymentLink(keyId: string, secret: string, id: string, baseUrl?: string): Promise<RzpLink> {
  const res = await fetch(`${api(baseUrl)}/payment_links/${encodeURIComponent(id)}`, { headers: { Authorization: auth(keyId, secret) } })
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Signature Razorpay appends to the callback redirect after a payment link is paid. */
export async function verifyCallback(secret: string, q: Record<string, string>) {
  const payload = [q.razorpay_payment_link_id, q.razorpay_payment_link_reference_id, q.razorpay_payment_link_status, q.razorpay_payment_id].join('|')
  return Boolean(q.razorpay_signature) && safeEqual(await hmacHex(secret, payload), q.razorpay_signature)
}

export async function verifyWebhook(webhookSecret: string, rawBody: string, signature: string) {
  return Boolean(signature) && safeEqual(await hmacHex(webhookSecret, rawBody), signature)
}
