import { issueResetCode } from './auth'
import { shopOpen } from './billing'
import { alertSeller } from './push'
import type { Bindings, Order, Seller } from '../env'
import { dictFor, type Dict, type Lang } from '../i18n'
import { startGatewayPayment } from './gateway'
import { cancelCart, cartKeyOf, cartOrders, cartTotal, claimCart, loadDrop, reserveOrder, sellingFast, shortNo, type ReserveFailure } from './orders'
import { randomId, rupees } from './util'
import { downloadMedia, meteredFor, sendButtons, sendCta, sendImage, sendList, sendText } from './whatsapp'

/*
 * WhatsApp ordering bot. Buyers live in WhatsApp, so the whole purchase happens in the chat:
 *
 *   group link → chat opens with "Order #abc1234" → product photo + size buttons
 *   → (quantity) → address (remembered next time) → pay button + "I have paid" / screenshot
 *   → seller confirms → "✅ Payment received" → shipping updates
 *
 * Name and phone come from WhatsApp itself; the buyer only ever types their address once.
 * Every message here is a reply inside Meta's 24-hour customer-service window (free).
 */

export type Inbound = {
  from: string
  id: string
  type: string
  text?: { body: string }
  interactive?: { button_reply?: { id: string }; list_reply?: { id: string } }
  button?: { payload: string }
  image?: { id: string; mime_type?: string }
}

type Buyer = { phone: string; name: string; address: string; pincode: string; lang: Lang }
type Session = { phone: string; state: string; drop_id: string | null; variant_id: number | null; qty: number; order_id: string | null }

const SELLER_COLS = `id, phone, name, shop_name, upi_vpa, pay_mode, rzp_key_id, rzp_secret_enc, rzp_webhook_enc, allowed_modes, account_status, gateway_request, tools_off, slug, offer_min_paise, offer_off_paise, offer_pct`
// Sale codes use the same look-alike-free alphabet as randomId().
const CODE = /#([23456789a-hjkmnp-z]{7})\b/i
const PINCODE = /\b[1-9]\d{5}\b/

export async function handleInbound(env: Bindings, origin: string, msg: Inbound, profileName: string) {
  const db = env.DB
  const phone = msg.from
  const now = Date.now()
  const text = msg.text?.body?.trim() ?? ''
  // Language follows the buyer: Devanagari in their message switches the bot to Hindi.
  const langGuess: Lang | null = /[ऀ-ॿ]/.test(text) ? 'hi' : /[a-z]{3,}/i.test(text) ? 'en' : null

  await db
    .prepare(
      `INSERT INTO buyers (phone, name, lang, last_inbound_at, updated_at) VALUES (?1, ?2, COALESCE(?3, 'en'), ?4, ?4)
       ON CONFLICT(phone) DO UPDATE SET last_inbound_at = ?4, name = CASE WHEN name = '' THEN ?2 ELSE name END, lang = COALESCE(?3, lang)`,
    )
    .bind(phone, profileName.slice(0, 60), langGuess, now)
    .run()
  const buyer = (await db.prepare(`SELECT phone, name, address, pincode, lang FROM buyers WHERE phone = ?`).bind(phone).first<Buyer>())!
  const t = dictFor(buyer.lang)
  const session = await db.prepare(`SELECT * FROM wa_sessions WHERE phone = ?`).bind(phone).first<Session>()
  // Count this conversation's replies against the shop it's about (the sale code in the message,
  // else the sale the buyer was last looking at).
  const meterDrop = text.match(CODE)?.[1]?.toLowerCase() ?? session?.drop_id
  if (meterDrop) {
    const d = await db.prepare(`SELECT seller_id FROM drops WHERE id = ?`).bind(meterDrop).first<{ seller_id: string }>()
    env = meteredFor(env, d?.seller_id, 'bot')
  }
  const ctx: Ctx = { env, origin, phone, buyer, t, session }

  // Seller forgot their PIN: they message "RESET PIN" from their own number and get a code back.
  // It's a reply inside the chat they started, so no template is needed.
  if (/^(reset( pin)?|forgot pin|pin reset|पिन( रीसेट)?)$/i.test(text)) {
    const seller = await db.prepare(`SELECT 1 FROM sellers WHERE phone = ?`).bind(phone).first()
    if (!seller) return sendText(env, phone, t.botResetNoShop)
    const code = await issueResetCode(env, phone)
    return sendText(env, phone, code ? t.botResetCode(code) : t.botResetWait)
  }
  const tap = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? msg.button?.payload
  if (tap) return onTap(ctx, tap)
  if (msg.type === 'image' && msg.image) return onScreenshot(ctx, msg.image.id)
  const code = text.match(CODE)?.[1]?.toLowerCase()
  if (code) return showSale(ctx, code)
  if (/^(status|स्टेटस|order|orders)$/i.test(text)) return showOrders(ctx)
  if (/^(more|items|all|catalog|catalogue|और|सब)$/i.test(text) && session?.drop_id) {
    const d = await env.DB.prepare(`SELECT seller_id FROM drops WHERE id = ?`).bind(session.drop_id).first<{ seller_id: string }>()
    if (d) return showShop(ctx, d.seller_id, session.drop_id)
  }
  if (session?.state === 'address' && text) return onAddress(ctx, text)
  if (session?.state === 'pay' && session.order_id && /^(pay|paid|payment|link|पेमेंट)$/i.test(text)) return remindPay(ctx, session.order_id)
  // Anything else (usually a question like "Do you have Musk Kashmir?") goes to the seller's own WhatsApp.
  if (session?.drop_id) {
    const s = await env.DB.prepare(`SELECT s.shop_name, s.phone FROM drops d JOIN sellers s ON s.id = d.seller_id WHERE d.id = ?`).bind(session.drop_id).first<{ shop_name: string; phone: string }>()
    if (s) return sendText(env, phone, t.botOnlyOrders(s.shop_name, s.phone))
  }
  return sendText(env, phone, t.botHelp)
}

type Ctx = { env: Bindings; origin: string; phone: string; buyer: Buyer; t: Dict; session: Session | null }

const setSession = (ctx: Ctx, s: Partial<Session> & { state: string }) =>
  ctx.env.DB
    .prepare(
      `INSERT INTO wa_sessions (phone, state, drop_id, variant_id, qty, order_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(phone) DO UPDATE SET state = ?2, drop_id = ?3, variant_id = ?4, qty = ?5, order_id = ?6, updated_at = ?7`,
    )
    .bind(ctx.phone, s.state, s.drop_id ?? ctx.session?.drop_id ?? null, s.variant_id ?? ctx.session?.variant_id ?? null, s.qty ?? ctx.session?.qty ?? 1, s.order_id ?? null, Date.now())
    .run()

async function showSale(ctx: Ctx, dropId: string) {
  const { env, t, phone } = ctx
  const data = await loadDrop(env.DB, dropId)
  if (!data) return sendText(env, phone, t.botNoDrop)
  const { drop, variants } = data
  const shop = await env.DB.prepare(`SELECT shop_name, phone FROM sellers WHERE id = ?`).bind(drop.seller_id).first<{ shop_name: string; phone: string }>()
  if (drop.status !== 'live') return sendText(env, phone, t.botClosed)
  const left = variants.reduce((n, v) => n + v.available, 0)
  if (left < 1) {
    const held = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE drop_id = ? AND status IN ('pending', 'verifying')`).bind(drop.id).first<{ n: number }>()
    return sendText(env, phone, held?.n ? t.botAllHeld : t.botSoldOut)
  }
  const image = drop.image_key ? `${ctx.origin}/img/${drop.image_key}` : undefined
  // Extra photos first, so the card with the buttons ends up last – right above the reply box.
  for (const k of data.images.slice(1, 5)) await sendImage(env, phone, `${ctx.origin}/img/${k}`)
  // Buyers never see stock numbers – only "Available" or "Selling fast".
  const stock = variants.reduce((n, v) => n + v.stock, 0)
  const body = t.botProduct(drop.title, drop.description.slice(0, 300), rupees(drop.price_paise), sellingFast({ stock, available: left }) ? t.sellingFast : t.inStock, shop?.shop_name ?? '')
    + (shop ? `\n\n${t.botAsk(shop.shop_name, shop.phone)}` : '')
  const open = variants.filter((v) => v.available > 0)
  await setSession(ctx, { state: 'size', drop_id: drop.id, variant_id: null, qty: 1 })
  const hasSizes = variants.length > 1 || variants[0].label
  // Browse the rest of the shop: a "More items" button when there's room (max 3 buttons), else "send more".
  const others = await env.DB.prepare(`SELECT COUNT(*) AS n FROM drops WHERE seller_id = ? AND status = 'live' AND id <> ?`).bind(drop.seller_id, drop.id).first<{ n: number }>()
  const more = (others?.n ?? 0) > 0 ? [{ id: `more:${drop.seller_id}`, title: t.botMore }] : []
  const hint = more.length ? `\n${t.botMoreHint}` : ''
  if (!hasSizes) return sendButtons(env, phone, body, [{ id: `size:${open[0].id}`, title: t.botBuyNow }, ...more], image)
  if (open.length <= 2) return sendButtons(env, phone, `${body}\n\n${t.botPickSize}`, [...open.map((v) => ({ id: `size:${v.id}`, title: v.label })), ...more], image)
  if (open.length === 3) return sendButtons(env, phone, `${body}${hint}\n\n${t.botPickSize}`, open.map((v) => ({ id: `size:${v.id}`, title: v.label })), image)
  // More than 3 sizes: photo first, then a list.
  await sendButtons(env, phone, `${body}${hint}`, [{ id: `sizes:${drop.id}`, title: t.botChooseSize }], image)
  return sendList(env, phone, t.botPickSize, t.botChooseSize, open.map((v) => ({ id: `size:${v.id}`, title: v.label })))
}

/** The shop's other live items as a tap-able list (max 10). */
async function showShop(ctx: Ctx, sellerId: string, exceptId: string | null) {
  const { env, t, phone } = ctx
  const shop = await env.DB.prepare(`SELECT shop_name FROM sellers WHERE id = ? AND account_status = 'active'`).bind(sellerId).first<{ shop_name: string }>()
  const { results } = await env.DB
    .prepare(`SELECT d.id, d.title, d.price_paise FROM drops d WHERE d.seller_id = ? AND d.status = 'live' AND d.id <> ?
              AND (SELECT COALESCE(SUM(available), 0) FROM variants WHERE drop_id = d.id) > 0 ORDER BY d.created_at DESC LIMIT 10`)
    .bind(sellerId, exceptId ?? '')
    .all<{ id: string; title: string; price_paise: number }>()
  if (!shop || !results.length) return sendText(env, phone, t.botNoMore)
  return sendList(env, phone, t.botMoreItems(shop.shop_name), t.botViewItems, results.map((r) => ({ id: `sale:${r.id}`, title: r.title, description: rupees(r.price_paise) })))
}

async function onTap(ctx: Ctx, id: string) {
  const { env, t, phone, session } = ctx
  const [kind, arg] = id.split(':')
  if (kind === 'more') return showShop(ctx, arg, session?.drop_id ?? null)
  if (kind === 'sale') return showSale(ctx, arg)
  if (kind === 'sizes') {
    const data = await loadDrop(env.DB, arg)
    if (!data) return sendText(env, phone, t.botNoDrop)
    return sendList(env, phone, t.botPickSize, t.botChooseSize, data.variants.filter((v) => v.available > 0).map((v) => ({ id: `size:${v.id}`, title: v.label })))
  }
  if (kind === 'size') {
    const v = await env.DB.prepare(`SELECT v.id, v.available, v.drop_id, d.max_per_order FROM variants v JOIN drops d ON d.id = v.drop_id WHERE v.id = ?`)
      .bind(Number(arg)).first<{ id: number; available: number; drop_id: string; max_per_order: number }>()
    if (!v) return sendText(env, phone, t.botNoDrop)
    if (v.available < 1) return sendText(env, phone, t.bErrStock)
    const maxQty = Math.min(3, v.max_per_order, v.available)
    if (maxQty > 1) {
      await setSession(ctx, { state: 'qty', drop_id: v.drop_id, variant_id: v.id, qty: 1 })
      return sendButtons(env, phone, t.botPickQty, Array.from({ length: maxQty }, (_, i) => ({ id: `qty:${i + 1}`, title: String(i + 1) })))
    }
    ctx.session = { phone, state: 'qty', drop_id: v.drop_id, variant_id: v.id, qty: 1, order_id: null }
    return askAddress(ctx)
  }
  if (kind === 'qty' && session?.variant_id) {
    ctx.session = { ...session, qty: Math.max(1, Math.min(3, Number(arg) || 1)) }
    return askAddress(ctx)
  }
  if (kind === 'addr' && session?.variant_id) {
    if (arg === 'yes') return placeOrder(ctx)
    await setSession(ctx, { state: 'address' })
    return sendText(env, phone, t.botAskAddress)
  }
  if (kind === 'paid') return markClaimed(ctx, arg, null)
  if (kind === 'cancel') {
    const ok = await cancelCart(env, arg, phone)
    await setSession(ctx, { state: 'idle', order_id: null })
    return sendText(env, phone, ok ? t.botCancelled : t.botHelp)
  }
  return sendText(env, phone, t.botHelp)
}

async function askAddress(ctx: Ctx) {
  const { env, t, phone, buyer } = ctx
  // Already paying for something from this seller? This item joins that order – same address.
  const open = await env.DB
    .prepare(`SELECT 1 FROM orders o JOIN drops d ON d.id = ? WHERE o.buyer_phone = ? AND o.seller_id = d.seller_id AND o.status = 'pending' AND o.hold_until > ? AND o.address <> ''`)
    .bind(ctx.session!.drop_id, phone, Date.now()).first()
  if (open) return placeOrder(ctx)
  if (buyer.address && buyer.pincode) {
    await setSession(ctx, { state: 'confirm_address', variant_id: ctx.session!.variant_id!, qty: ctx.session!.qty, drop_id: ctx.session!.drop_id! })
    return sendButtons(env, phone, t.botConfirmAddress(fullAddress(buyer)), [
      { id: 'addr:yes', title: t.botYesHere },
      { id: 'addr:new', title: t.botNewAddress },
    ])
  }
  await setSession(ctx, { state: 'address', variant_id: ctx.session!.variant_id!, qty: ctx.session!.qty, drop_id: ctx.session!.drop_id! })
  return sendText(env, phone, t.botAskAddress)
}

const fullAddress = (b: Pick<Buyer, 'address' | 'pincode'>) => (b.address.includes(b.pincode) ? b.address : `${b.address} – ${b.pincode}`)

async function onAddress(ctx: Ctx, text: string) {
  const pincode = text.match(PINCODE)?.[0]
  if (!pincode || text.length < 12) return sendText(ctx.env, ctx.phone, ctx.t.botNeedPincode)
  const address = text.slice(0, 400)
  await ctx.env.DB.prepare(`UPDATE buyers SET address = ?, pincode = ?, updated_at = ? WHERE phone = ?`).bind(address, pincode, Date.now(), ctx.phone).run()
  ctx.buyer = { ...ctx.buyer, address, pincode }
  return placeOrder(ctx)
}

const failText = (t: Dict, r: ReserveFailure, max: number) => ({ closed: t.botClosed, soon: t.dropSoonErr, qty: t.bErrQty(max), device: t.bErrDevice, stock: t.bErrStock })[r]

async function placeOrder(ctx: Ctx) {
  const { env, t, phone, buyer, session } = ctx
  if (!session?.drop_id || !session.variant_id) return sendText(env, phone, t.botHelp)
  const data = await loadDrop(env.DB, session.drop_id)
  const seller = data && (await env.DB.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE id = ?`).bind(data.drop.seller_id).first<Seller>())
  if (!data || !seller) return sendText(env, phone, t.botNoDrop)
  if (!(await shopOpen(env, seller))) return sendText(env, phone, seller.account_status === 'active' ? t.shopPaused : t.botClosed)
  const res = await reserveOrder(env, seller, data.drop, {
    variantId: session.variant_id,
    qty: session.qty,
    name: buyer.name || 'Customer',
    phone,
    address: fullAddress(buyer),
    ipHash: 'wa:' + phone,
    channel: 'whatsapp',
  })
  if (!res.ok) return sendText(env, phone, failText(t, res.reason, data.drop.max_per_order))
  if (res.order.created_at > Date.now() - 15_000) await alertSeller(env, res.order.id, 'order')
  await setSession(ctx, { state: 'pay', order_id: res.order.id })
  return sendPayment(ctx, res.order, seller, data.drop.title, data.drop.upi_vpa ?? seller.upi_vpa)
}

async function sendPayment(ctx: Ctx, order: Order, seller: Seller, title: string, vpa: string | null) {
  const { env, t, phone, origin } = ctx
  // The whole payment: this item plus anything else the buyer is paying for at this seller.
  const lines = await cartOrders(env.DB, order)
  const list = lines.map((l) => `• ${l.title}${l.label ? ` (${l.label})` : ''} ×${l.qty} – ${rupees(l.price_paise * l.qty)}`).join('\n')
    + (lines.some((l) => l.ship_paise) ? `\n• ${t.deliveryLine} – ${rupees(lines.reduce((n, l) => n + (l.ship_paise || 0), 0))}` : '')
  const total = cartTotal(lines)
  const amt = rupees(total)
  const mins = Math.max(1, Math.round((Math.max(...lines.map((l) => l.hold_until)) - Date.now()) / 60000))
  const key = cartKeyOf(order)
  if (order.pay_mode !== 'direct') {
    const fresh = (await env.DB.prepare(`SELECT pay_url FROM orders WHERE id = ?`).bind(key).first<{ pay_url: string | null }>())?.pay_url
    const url = fresh ?? (await startGatewayPayment(env, seller, order, `${lines.length > 1 ? `${lines.length} items` : title} – ${seller.shop_name}`, origin))
    await sendCta(env, phone, `${t.botCartGateway(list, amt, mins)}\n\n${t.botAddMore}`, t.botPayBtn(amt), url)
    return sendButtons(env, phone, t.botAddMore, [{ id: `cancel:${key}`, title: t.botCancel }])
  }
  // WhatsApp buttons can only open https links, so the pay button goes to our order page,
  // which opens the buyer's UPI app (and shows per-app buttons on iPhone).
  await sendCta(env, phone, `${t.botCart(list, amt, mins)}\n\n${t.botAddMore}`, t.botPayBtn(amt), `${origin}/o/${key}`)
  return sendButtons(env, phone, t.botPayAfter(vpa ?? '', amt), [
    { id: `paid:${key}`, title: t.botIPaid },
    { id: `cancel:${key}`, title: t.botCancel },
  ])
}

async function remindPay(ctx: Ctx, orderId: string) {
  const order = await ctx.env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND buyer_phone = ?`).bind(orderId, ctx.phone).first<Order>()
  if (!order || order.status !== 'pending') return sendText(ctx.env, ctx.phone, ctx.t.botHelp)
  const seller = await ctx.env.DB.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE id = ?`).bind(order.seller_id).first<Seller>()
  const drop = await ctx.env.DB.prepare(`SELECT title, upi_vpa FROM drops WHERE id = ?`).bind(order.drop_id).first<{ title: string; upi_vpa: string | null }>()
  return sendPayment(ctx, order, seller!, drop?.title ?? '', drop?.upi_vpa ?? seller!.upi_vpa)
}

/** Buyer says they paid (button or screenshot). No UTR is ever needed. */
async function markClaimed(ctx: Ctx, orderId: string | null, proofKey: string | null) {
  const { env, t, phone } = ctx
  const order = orderId
    ? await env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND buyer_phone = ?`).bind(orderId, phone).first<Order>()
    : await env.DB.prepare(`SELECT * FROM orders WHERE buyer_phone = ? AND channel = 'whatsapp' AND status IN ('pending', 'verifying', 'expired', 'rejected')
                            AND created_at > ? ORDER BY created_at DESC LIMIT 1`).bind(phone, Date.now() - 86_400_000).first<Order>()
  if (!order) return sendText(env, phone, t.botHelp)
  if (proofKey) await env.DB.prepare(`UPDATE orders SET proof_key = ? WHERE id = ?`).bind(proofKey, order.id).run()
  const shop = await env.DB.prepare(`SELECT shop_name FROM sellers WHERE id = ?`).bind(order.seller_id).first<{ shop_name: string }>()
  if (order.status === 'paid') return sendText(env, phone, t.botThanks(shop?.shop_name ?? ''))
  // A rejected order with a fresh screenshot goes back to the seller to look at again.
  if (order.status === 'rejected') await env.DB.prepare(`UPDATE orders SET status = 'expired' WHERE (id = ?1 OR cart_id = ?1) AND status = 'rejected'`).bind(cartKeyOf(order)).run()
  const ok = order.pay_mode === 'direct' ? await claimCart(env, order, null) : true
  await setSession(ctx, { state: 'idle', order_id: null })
  if (!ok) return sendText(env, phone, t.botTooLate)
  return sendText(env, phone, proofKey ? t.botThanksShot(shop?.shop_name ?? '') : t.botThanks(shop?.shop_name ?? ''))
}

async function onScreenshot(ctx: Ctx, mediaId: string) {
  const { env, phone, session } = ctx
  const media = await downloadMedia(env, mediaId).catch(() => null)
  let key: string | null = null
  if (media && media.body.byteLength < 5 * 1024 * 1024) {
    key = `p/${randomId(16)}`
    await env.IMAGES.put(key, media.body, { httpMetadata: { contentType: media.type } })
  }
  return markClaimed(ctx, session?.state === 'pay' ? session.order_id : null, key)
}

async function showOrders(ctx: Ctx) {
  const { env, t, phone } = ctx
  const { results } = await env.DB
    .prepare(`SELECT o.id, o.status, o.ship_status, o.amount_paise, d.title FROM orders o JOIN drops d ON d.id = o.drop_id
              WHERE o.buyer_phone = ? AND o.status NOT IN ('expired') ORDER BY o.created_at DESC LIMIT 5`)
    .bind(phone)
    .all<{ id: string; status: Order['status']; ship_status: Order['ship_status']; amount_paise: number; title: string }>()
  if (!results.length) return sendText(env, phone, t.botNoOrders)
  const lines = results.map((o) => `• #${shortNo(o.id)} ${o.title} – ${rupees(o.amount_paise)} – ${o.status === 'paid' ? t.ship[o.ship_status] : t.status[o.status]}`)
  return sendText(env, phone, `${t.botOrders}\n${lines.join('\n')}`)
}
