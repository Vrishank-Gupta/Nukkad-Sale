import type { Bindings, Seller } from '../env'
import { decrypt, encrypt, sha256 } from './crypto'

/**
 * Shiprocket, optional per seller: either the seller's own account (API user email + password), so courier charges
 * come from their Shiprocket wallet, or NukkadSale Shipping – the platform's account, paid from a prepaid balance. API: https://apidocs.shiprocket.in – base URL can point at tests/e2e/mock_shiprocket.py.
 */
const base = (env: Bindings) => (env.SHIPROCKET_API_BASE || 'https://apiv2.shiprocket.in') + '/v1/external'

export type ShipStatus = 'booked' | 'pickup' | 'picked' | 'transit' | 'out' | 'delivered' | 'failed' | 'rto' | 'returned' | 'cancelled'
export type Scan = { at: string; text: string; place: string }
export type Courier = { id: number; name: string; rate: number; days: string; etd: string; rating: number; cod: boolean }
export type SrSeller = Pick<Seller, 'id'> & { sr_email?: string | null; sr_password_enc?: string | null; sr_token_enc?: string | null; sr_token_exp?: number; sr_pickup?: string | null; sr_pickup_pin?: string | null }

export class ShiprocketError extends Error {}

/** Shiprocket's many status names → our few plain ones. */
export function mapStatus(raw: string): ShipStatus {
  const s = (raw || '').toUpperCase()
  if (/CANCEL/.test(s)) return 'cancelled'
  if (/RTO.*DELIVERED|RETURNED TO ORIGIN/.test(s)) return 'returned'
  if (/RTO/.test(s)) return 'rto'
  if (/^DELIVERED|\bDELIVERED$/.test(s) && !/UNDELIVERED/.test(s)) return 'delivered'
  if (/UNDELIVERED|FAILED|NDR|NOT DELIVERED/.test(s)) return 'failed'
  if (/OUT FOR DELIVERY/.test(s)) return 'out'
  if (/PICKED UP|SHIPPED|IN TRANSIT|REACHED|DESTINATION|HUB|DISPATCHED|TRANSIT/.test(s)) return /PICKED UP/.test(s) ? 'picked' : 'transit'
  if (/PICKUP|OUT FOR PICKUP|MANIFEST/.test(s)) return 'pickup'
  return 'booked'
}

async function call<T>(env: Bindings, token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(base(env) + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let d: any
  try { d = JSON.parse(text) } catch { d = { message: text.slice(0, 200) } }
  if (!r.ok || d?.status_code >= 400) {
    const msg = d?.message ?? (d?.errors ? Object.values(d.errors).flat().join(', ') : `HTTP ${r.status}`)
    throw new ShiprocketError(String(msg))
  }
  return d as T
}

/** Logs in with the seller's API user; the token (valid ~10 days) is cached, encrypted, for 9 days. */
export async function srLogin(env: Bindings, email: string, password: string) {
  const d = await call<{ token?: string }>(env, null, 'POST', '/auth/login', { email, password })
  if (!d.token) throw new ShiprocketError('Shiprocket did not accept this email and password.')
  return d.token
}

/** Marks a seller who ships through NukkadSale's own Shiprocket account (sellers.sr_email). */
export const NK_SHIP = 'NukkadSale Shipping'
export const sharedShipping = (env: Bindings) => Boolean(env.SHIPROCKET_EMAIL && env.SHIPROCKET_PASSWORD)
export const onShared = (s: { sr_email?: string | null }) => s.sr_email === NK_SHIP

/** The platform account's token, cached encrypted in platform_settings for 9 days. */
export async function platformToken(env: Bindings): Promise<string> {
  if (!sharedShipping(env)) throw new ShiprocketError('NukkadSale Shipping is not set up yet.')
  const { results } = await env.DB.prepare(`SELECT key, value FROM platform_settings WHERE key IN ('sr_token_enc', 'sr_token_exp')`).all<{ key: string; value: string }>()
  const m = new Map(results.map((r) => [r.key, r.value]))
  if (m.get('sr_token_enc') && Number(m.get('sr_token_exp')) > Date.now()) return decrypt(m.get('sr_token_enc')!, env.SECRET_KEY)
  const token = await srLogin(env, env.SHIPROCKET_EMAIL!, env.SHIPROCKET_PASSWORD!)
  const put = `INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  await env.DB.batch([env.DB.prepare(put).bind('sr_token_enc', await encrypt(token, env.SECRET_KEY)), env.DB.prepare(put).bind('sr_token_exp', String(Date.now() + 9 * 86_400_000))])
  return token
}

/** Adds a seller's pickup address to the platform account. Location names are unique there. */
export async function srAddPickup(env: Bindings, token: string, p: { location: string; name: string; phone: string; address: string; address2: string; city: string; state: string; pin: string }) {
  await call(env, token, 'POST', '/settings/company/addpickup', {
    pickup_location: p.location, name: p.name, email: `pickup+${p.location.toLowerCase().replace(/[^a-z0-9]/g, '')}@nukkadsale.in`, phone: p.phone,
    address: p.address, address_2: p.address2, city: p.city, state: p.state, country: 'India', pin_code: p.pin,
  })
}

/** Secret part of the platform account's webhook URL (/webhooks/shiprocket/<this>). */
export const platformHook = async (env: Bindings) => (await sha256('sr-platform-hook' + env.SECRET_KEY)).slice(0, 24)

export async function srToken(env: Bindings, s: SrSeller): Promise<string> {
  if (onShared(s)) return platformToken(env)
  if (!s.sr_email || !s.sr_password_enc) throw new ShiprocketError('Shiprocket is not connected.')
  if (s.sr_token_enc && (s.sr_token_exp ?? 0) > Date.now()) return decrypt(s.sr_token_enc, env.SECRET_KEY)
  const token = await srLogin(env, s.sr_email, await decrypt(s.sr_password_enc, env.SECRET_KEY))
  await env.DB.prepare(`UPDATE sellers SET sr_token_enc = ?, sr_token_exp = ? WHERE id = ?`).bind(await encrypt(token, env.SECRET_KEY), Date.now() + 9 * 86_400_000, s.id).run()
  return token
}

export async function srPickups(env: Bindings, token: string) {
  const d = await call<{ data?: { shipping_address?: { pickup_location: string; pin_code: string | number; address: string; city: string }[] } }>(env, token, 'GET', '/settings/company/pickup')
  return (d.data?.shipping_address ?? []).map((p) => ({ name: p.pickup_location, pin: String(p.pin_code), address: `${p.address}, ${p.city}` }))
}

export async function srPincode(env: Bindings, token: string, pin: string) {
  try {
    const d = await call<{ postcode_details?: { city?: string; state?: string } }>(env, token, 'GET', `/open/postcode/details?postcode=${pin}`)
    return { city: d.postcode_details?.city ?? '', state: d.postcode_details?.state ?? '' }
  } catch { return { city: '', state: '' } }
}

export async function srRates(env: Bindings, token: string, from: string, to: string, weightKg: number, cod: boolean): Promise<{ list: Courier[]; recommended: number | null }> {
  const d = await call<{ data?: { available_courier_companies?: any[]; recommended_courier_company_id?: number } }>(env, token, 'GET',
    `/courier/serviceability/?pickup_postcode=${from}&delivery_postcode=${to}&weight=${weightKg}&cod=${cod ? 1 : 0}`)
  const list = (d.data?.available_courier_companies ?? []).map((c) => ({
    id: Number(c.courier_company_id), name: String(c.courier_name), rate: Math.round(Number(c.rate ?? c.freight_charge ?? 0) * 100),
    days: String(c.estimated_delivery_days ?? ''), etd: String(c.etd ?? ''), rating: Number(c.rating ?? 0), cod: Number(c.cod ?? 0) === 1,
  })).sort((a, b) => a.rate - b.rate)
  return { list, recommended: d.data?.recommended_courier_company_id ?? list[0]?.id ?? null }
}

export type BookInput = {
  id: string; date: string; pickup: string; name: string; phone: string; address: string; city: string; state: string; pincode: string
  items: { name: string; sku: string; units: number; price: number }[]; cod: boolean; subTotal: number; codAmount: number
  l: number; b: number; h: number; weightKg: number; courierId: number
}

/** Create the order → assign the AWB with the chosen courier → label → pickup. Returns what got done. */
export async function srBook(env: Bindings, token: string, x: BookInput) {
  const o = await call<{ order_id?: number; shipment_id?: number }>(env, token, 'POST', '/orders/create/adhoc', {
    order_id: x.id, order_date: x.date, pickup_location: x.pickup, comment: 'NukkadSale',
    billing_customer_name: x.name, billing_last_name: '', billing_address: x.address, billing_city: x.city, billing_pincode: x.pincode,
    billing_state: x.state, billing_country: 'India', billing_email: `orders+${x.id}@nukkadsale.in`, billing_phone: x.phone, shipping_is_billing: true,
    order_items: x.items.map((i) => ({ name: i.name, sku: i.sku, units: i.units, selling_price: i.price / 100 })),
    payment_method: x.cod ? 'COD' : 'Prepaid', sub_total: x.subTotal / 100, ...(x.cod ? { cod_amount: x.codAmount / 100 } : {}),
    length: x.l, breadth: x.b, height: x.h, weight: x.weightKg,
  })
  if (!o.shipment_id) throw new ShiprocketError('Shiprocket did not create the shipment.')
  const a = await call<{ awb_assign_status?: number; response?: { data?: { awb_code?: string; courier_name?: string; freight_charges?: number } }; message?: string }>(
    env, token, 'POST', '/courier/assign/awb', { shipment_id: o.shipment_id, courier_id: x.courierId })
  const awb = a.response?.data?.awb_code
  if (!awb) throw new ShiprocketError(a.message || 'The courier could not take this parcel. Try another courier.')
  let label: string | null = null, pickupDate: string | null = null
  try { label = (await call<{ label_url?: string }>(env, token, 'POST', '/courier/generate/label', { shipment_id: [o.shipment_id] })).label_url ?? null } catch { /* reprint later */ }
  try { pickupDate = (await call<{ response?: { pickup_scheduled_date?: string } }>(env, token, 'POST', '/courier/generate/pickup', { shipment_id: [o.shipment_id] })).response?.pickup_scheduled_date ?? null } catch { /* schedule later */ }
  return { srOrderId: String(o.order_id ?? ''), shipmentId: String(o.shipment_id), awb, courier: a.response?.data?.courier_name ?? '', charge: Math.round((a.response?.data?.freight_charges ?? 0) * 100), label, pickupDate }
}

export const srLabel = async (env: Bindings, token: string, shipmentId: string) =>
  (await call<{ label_url?: string }>(env, token, 'POST', '/courier/generate/label', { shipment_id: [Number(shipmentId)] })).label_url ?? null
export const srPickup = async (env: Bindings, token: string, shipmentId: string) =>
  (await call<{ response?: { pickup_scheduled_date?: string } }>(env, token, 'POST', '/courier/generate/pickup', { shipment_id: [Number(shipmentId)] })).response?.pickup_scheduled_date ?? null
export const srCancel = (env: Bindings, token: string, srOrderId: string) => call(env, token, 'POST', '/orders/cancel', { ids: [Number(srOrderId)] })
export const srNdr = (env: Bindings, token: string, awb: string, action: 're-attempt' | 'return') => call(env, token, 'POST', `/ndr/${awb}/action`, { action, comments: 'From NukkadSale' })

export async function srTrack(env: Bindings, token: string, awb: string) {
  const d = await call<{ tracking_data?: { shipment_track?: { current_status?: string; edd?: string }[]; shipment_track_activities?: { date: string; activity: string; location: string }[]; etd?: string } }>(
    env, token, 'GET', `/courier/track/awb/${awb}`)
  const td = d.tracking_data ?? {}
  const raw = td.shipment_track?.[0]?.current_status ?? ''
  const scans: Scan[] = (td.shipment_track_activities ?? []).map((a) => ({ at: a.date, text: a.activity, place: a.location ?? '' }))
  return { status: mapStatus(raw), text: raw, etd: td.etd ?? td.shipment_track?.[0]?.edd ?? '', scans }
}

/** Save a tracking update and move the order along (picked → sent, delivered → delivered). */
export async function applyTracking(env: Bindings, shipmentRow: { id: string; order_key: string }, u: { status: ShipStatus; text: string; etd: string; scans: Scan[] }) {
  const ship = u.status === 'delivered' ? 'delivered' : ['picked', 'transit', 'out', 'failed'].includes(u.status) ? 'shipped' : null
  await env.DB.batch([
    env.DB.prepare(`UPDATE shipments SET status = ?, status_text = ?, etd = COALESCE(NULLIF(?, ''), etd), scans = CASE WHEN ? = '[]' THEN scans ELSE ? END, checked_at = ?, updated_at = ? WHERE id = ?`)
      .bind(u.status, u.text.slice(0, 80), u.etd, JSON.stringify(u.scans.slice(0, 40)), JSON.stringify(u.scans.slice(0, 40)), Date.now(), Date.now(), shipmentRow.id),
    ...(ship ? [env.DB.prepare(`UPDATE orders SET ship_status = ?1 WHERE (id = ?2 OR cart_id = ?2) AND ship_status <> 'delivered'`).bind(ship, shipmentRow.order_key)] : []),
  ])
}

export type ShipmentRow = {
  id: string; seller_id: string; order_key: string; sr_order_id: string | null; shipment_id: string | null; awb: string | null; courier: string
  status: ShipStatus; status_text: string; label_url: string | null; pickup_date: string | null; etd: string | null; charge_paise: number; cod_paise: number; prepaid_paise: number
  weight_g: number; scans: string; checked_at: number; created_at: number; updated_at: number
}
export const ACTIVE_SHIP = `status NOT IN ('cancelled')`

/** Webhook from Shiprocket (URL carries the seller's secret): {awb, current_status, scans[], etd}. */
export async function shiprocketWebhook(env: Bindings, hook: string, body: any) {
  if (!body?.awb) return false
  const seller = await env.DB.prepare(`SELECT id FROM sellers WHERE sr_hook = ?`).bind(hook).first<{ id: string }>()
  // The platform account (NukkadSale Shipping) has one webhook for every seller on it: find the parcel by AWB.
  const sh = seller
    ? await env.DB.prepare(`SELECT * FROM shipments WHERE awb = ? AND seller_id = ?`).bind(String(body.awb), seller.id).first<ShipmentRow>()
    : hook === (await platformHook(env))
      ? await env.DB.prepare(`SELECT sh.* FROM shipments sh JOIN sellers s ON s.id = sh.seller_id WHERE sh.awb = ? AND s.sr_email = ?`).bind(String(body.awb), NK_SHIP).first<ShipmentRow>()
      : null
  if (!sh) return false
  const raw = String(body.current_status ?? body.shipment_status ?? '')
  const scans: Scan[] = Array.isArray(body.scans) ? body.scans.map((x: any) => ({ at: String(x.date ?? ''), text: String(x.activity ?? x['sr-status-label'] ?? ''), place: String(x.location ?? '') })).reverse() : []
  await applyTracking(env, sh, { status: mapStatus(raw), text: raw, etd: String(body.etd ?? ''), scans })
  return true
}

/** Cron fallback: refresh parcels not checked for 3 hours (a few per run, oldest first). */
export async function refreshShipments(env: Bindings) {
  const { results } = await env.DB.prepare(
    `SELECT sh.*, s.sr_email, s.sr_password_enc, s.sr_token_enc, s.sr_token_exp FROM shipments sh JOIN sellers s ON s.id = sh.seller_id
     WHERE sh.awb IS NOT NULL AND sh.status NOT IN ('delivered', 'returned', 'cancelled') AND sh.checked_at < ? AND s.sr_email IS NOT NULL ORDER BY sh.checked_at LIMIT 15`,
  ).bind(Date.now() - 3 * 3_600_000).all<ShipmentRow & SrSeller>()
  for (const sh of results) {
    try { await applyTracking(env, sh, await srTrack(env, await srToken(env, { ...sh, id: sh.seller_id }), sh.awb!)) }
    catch (e) { await env.DB.prepare(`UPDATE shipments SET checked_at = ? WHERE id = ?`).bind(Date.now(), sh.id).run(); console.error('track', sh.id, e) }
  }
}
