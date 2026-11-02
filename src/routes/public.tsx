import { Hono } from 'hono'
import type { Context } from 'hono'
import { raw } from 'hono/html'
import type { AppEnv, Order, Seller } from '../env'
import { tr, type Dict } from '../i18n'
import { decrypt, sha256 } from '../lib/crypto'
import { shownStatus, cartKeyOf, cartOrders, cartTotal, claimCart, dropCounts, loadDrop, markCartPaid, rejectOrder, reserveOrder, sellingFast, shortNo, type ReserveFailure } from '../lib/orders'
import { confirmGateway, confirmRazorpay, startGatewayPayment } from '../lib/gateway'
import { verifyCallback } from '../lib/razorpay'
import { shopOpen } from '../lib/billing'
import { alertSeller } from '../lib/push'
import { isValidUtr, qrSvg, upiAppLinks, upiLink } from '../lib/upi'
import { clip, normalizePhone, randomId, rupees, waLink } from '../lib/util'
import { waBotEnabled } from '../lib/whatsapp'
import { checkOffer, pctOff } from '../lib/offers'
import { toolOn } from '../lib/tools'
import { Flash, Icon, Layout, PhoneInput, ShipSteps, StatusChip, Stepper } from '../views/layout'

export const pub = new Hono<AppEnv>()

const SELLER_COLS = `id, phone, name, shop_name, upi_vpa, pay_mode, rzp_key_id, rzp_secret_enc, rzp_webhook_enc, allowed_modes, account_status, gateway_request, tools_off`
const getSeller = (db: D1Database, id: string) => db.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE id = ?`).bind(id).first<Seller>()

export const imageUrl = (origin: string, key: string | null) => (key ? `${origin}/img/${key}` : undefined)
export const here = (c: Context) => {
  const u = new URL(c.req.url)
  return u.pathname + u.search
}

// Language switch: remembered for a year, then straight back to the same page.
pub.get('/lang', (c) => {
  const to = c.req.query('to') === 'hi' ? 'hi' : 'en'
  const back = c.req.query('back') ?? '/'
  c.header('Set-Cookie', `lang=${to}; Path=/; Max-Age=31536000; SameSite=Lax`)
  return c.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/', 303)
})

/** Swipeable product photos with a "2 / 4" counter. */
const Gallery = ({ images, alt }: { images: string[]; alt: string }) => (
  <div style="position:relative;margin-top:8px">
    <div class="gallery" data-gallery>
      {images.map((k, i) => <img src={`/img/${k}`} alt={i ? '' : alt} loading={i ? 'lazy' : 'eager'} />)}
    </div>
    {images.length > 1 && <span class="gcount" data-gcount>1 / {images.length}</span>}
  </div>
)

type ShopItem = { id: string; title: string; price_paise: number; image_key: string | null; stock: number; available: number }

/** A shop's live sales (newest first), with availability only – never counts shown to buyers. */
export const shopItems = async (db: D1Database, sellerId: string, exceptId: string | null, limit: number) =>
  (await db
    .prepare(`SELECT d.id, d.title, d.price_paise, d.image_key,
                     (SELECT COALESCE(SUM(stock), 0) FROM variants WHERE drop_id = d.id) AS stock,
                     (SELECT COALESCE(SUM(available), 0) FROM variants WHERE drop_id = d.id) AS available
              FROM drops d WHERE d.seller_id = ? AND d.status = 'live' AND d.id <> ? ORDER BY d.created_at DESC LIMIT ?`)
    .bind(sellerId, exceptId ?? '', limit)
    .all<ShopItem>()).results

const ItemRow = ({ t, items }: { t: Dict; items: ShopItem[] }) => (
  <div class="morerow">
    {items.map((o) => (
      <a class="moreitem" href={`/d/${o.id}`}>
        {o.image_key ? <img src={`/img/${o.image_key}`} alt="" loading="lazy" /> : <div class="thumb" style="width:100%;height:140px"><Icon n="bag" s={28} /></div>}
        <b>{clip(o.title, 36)}</b>
        <small>{rupees(o.price_paise)}{o.available < 1 ? ` · ${t.soldOutBtn}` : sellingFast(o) ? ` · ${t.sellingFast}` : ''}</small>
      </a>
    ))}
  </div>
)

// ---------- Shop page: everything a seller is selling ----------

pub.get('/s/:id', async (c) => {
  const t = tr(c)
  const seller = await getSeller(c.env.DB, c.req.param('id'))
  if (!seller) return c.notFound()
  const items = (await shopOpen(c.env, seller)) ? await shopItems(c.env.DB, seller.id, null, 60) : []
  // Available items first, sold-out ones after.
  items.sort((a, b) => Number(b.available > 0) - Number(a.available > 0))
  const origin = new URL(c.req.url).origin
  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={t.shopItems(seller.shop_name)}
      og={{ title: t.shopItems(seller.shop_name), description: t.shopItems(seller.shop_name), image: imageUrl(origin, items[0]?.image_key ?? null), url: `${origin}/s/${seller.id}` }}>
      <h1>{t.shopItems(seller.shop_name)}</h1>
      {items.length === 0 && <p class="muted">{t.shopEmpty}</p>}
      <div class="shopgrid">
        {items.map((o) => (
          <a class="moreitem" href={`/d/${o.id}`} style={o.available < 1 ? 'opacity:.55' : ''}>
            {o.image_key ? <img src={`/img/${o.image_key}`} alt="" loading="lazy" /> : <div class="thumb" style="width:100%;aspect-ratio:1"><Icon n="bag" s={28} /></div>}
            <b>{clip(o.title, 44)}</b>
            <small>{rupees(o.price_paise)}{o.available < 1 ? ` · ${t.soldOutBtn}` : sellingFast(o) ? ` · ${t.sellingFast}` : ''}</small>
          </a>
        ))}
      </div>
      <a class="btn wa block" style="margin-top:18px" href={waLink(seller.phone, '')}>{t.msgSeller(seller.shop_name)}</a>
    </Layout>,
  )
})

// ---------- WhatsApp order link ----------

// The link sellers paste in groups. WhatsApp's crawler reads the product card (photo, price);
// a buyer's tap bounces straight into a chat with the ordering bot, message ready to send.
pub.get('/w/:id', async (c) => {
  const t = tr(c)
  const data = await loadDrop(c.env.DB, c.req.param('id'))
  if (!data) return c.notFound()
  if (!waBotEnabled(c.env)) return c.redirect(`/d/${data.drop.id}`)
  const { drop } = data
  const seller = await getSeller(c.env.DB, drop.seller_id)
  const origin = new URL(c.req.url).origin
  const chat = `https://wa.me/${c.env.WA_BOT_NUMBER}?text=${encodeURIComponent(t.botOrderPrefill(drop.id, drop.title))}`
  return c.html(
    <Layout t={t} path={here(c)} brand={seller?.shop_name ?? ''} title={`${drop.title} – ${seller?.shop_name ?? ''}`}
      og={{ title: `${drop.title} · ${rupees(drop.price_paise)}`, description: clip(drop.description || t.flashBy(seller?.shop_name ?? ''), 150), image: imageUrl(origin, drop.image_key), url: `${origin}/w/${drop.id}` }}
      scripts={`location.replace(${JSON.stringify(chat)})`}>
      {drop.image_key && <img class="hero" src={`/img/${drop.image_key}`} alt={drop.title} style="margin-top:8px" />}
      <h1>{drop.title}</h1>
      <p class="price">{rupees(drop.price_paise)}</p>
      <a class="btn wa block big" href={chat}>{t.orderOnWa}</a>
      <p style="text-align:center;margin-top:14px"><a href={`/d/${drop.id}`}>{t.orderOnWeb}</a></p>
    </Layout>,
  )
})

// ---------- Sale page ----------

const BUYER_JS = `
(function(){
  // This phone remembers the buyer's orders, so they can always get back to the status page.
  try{var mine=JSON.parse(localStorage.getItem('kk_orders')||'{}'),o=mine[location.pathname.split('/')[2]],m=document.getElementById('myorder');if(o&&m){m.href=o;m.hidden=false}}catch(e){}
  var f=document.getElementById('buy');if(!f)return;
  var K='kk_buyer',saved={};try{saved=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}
  ['name','phone','address','pincode'].forEach(function(n){if(saved[n]&&f[n]&&!f[n].value)f[n].value=saved[n]});
  // Returning buyer: show "Delivering to …  Change" instead of the whole form – checkout in one tap.
  var ok=saved.name&&/^\\d{10}$/.test((saved.phone||'').replace(/\\D/g,'').slice(-10))&&(saved.address||'').length>=10&&/^\\d{6}$/.test(saved.pincode||'');
  var sm=document.getElementById('saved'),det=document.getElementById('details');
  if(ok&&!/[?&]err=/.test(location.search)){sm.querySelector('[data-who]').textContent=saved.name+' · '+saved.phone;sm.querySelector('[data-where]').textContent=saved.address+' – '+saved.pincode;sm.hidden=false;det.hidden=true;
    sm.querySelector('button').onclick=function(){sm.hidden=true;det.hidden=false;f.name.focus()}}
  f.addEventListener('submit',function(){try{localStorage.setItem(K,JSON.stringify({name:f.name.value,phone:f.phone.value,address:f.address.value,pincode:f.pincode.value}))}catch(e){}});
  var btn=document.getElementById('paybtn'),bar=document.getElementById('buybar'),price=+f.dataset.price,fmt=new Intl.NumberFormat('en-IN',{maximumFractionDigits:2});
  var ship=+f.dataset.ship||0,freeAbove=+f.dataset.freeabove||0;
  function total(){var q=Math.max(1,parseInt((f.qty||{}).value,10)||1),items=price*q,d=ship&&!(freeAbove&&items>=freeAbove)?ship:0;btn.textContent=f.dataset.paytpl.replace('{amt}','₹'+fmt.format((items+d)/100))}
  f.addEventListener('input',total);total();
  // Sticky "Buy now" bar while the real pay button is off screen.
  if(bar&&'IntersectionObserver' in window){bar.hidden=false;new IntersectionObserver(function(es){bar.classList.toggle('gone',es[0].isIntersecting)}).observe(btn.closest('.sticky-pay')||btn);
    bar.querySelector('button').onclick=function(){f.scrollIntoView({behavior:'smooth',block:'start'})}}
  var id=f.dataset.drop;
  function tick(){fetch('/d/'+id+'/stock.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    // Buyers only ever learn open / selling fast / sold out – never how many pieces exist.
    document.querySelectorAll('[data-fast]').forEach(function(el){el.hidden=!d.fast});
    d.variants.forEach(function(v){var el=document.getElementById('v'+v.id);if(el){el.disabled=!v.open;if(el.disabled&&el.checked)el.checked=false}});
    if(!d.open){btn.disabled=true;btn.textContent=d.held?f.dataset.heldtxt:f.dataset.soldtxt;if(bar)bar.remove()}
  }).catch(function(){})}
  setInterval(function(){if(!document.hidden)tick()},8000);
})();`

pub.get('/d/:id', async (c) => {
  const t = tr(c)
  const data = await loadDrop(c.env.DB, c.req.param('id'))
  if (!data) return c.notFound()
  const { drop, variants } = data
  const [seller, counts] = await Promise.all([getSeller(c.env.DB, drop.seller_id), dropCounts(c.env.DB, drop.id)])
  if (!seller) return c.notFound()
  const origin = new URL(c.req.url).origin
  const hasSizes = variants.length > 1 || variants[0]?.label
  const shopIsOpen = await shopOpen(c.env, seller)
  const open = drop.status === 'live' && shopIsOpen && counts.available > 0
  const firstOpen = variants.find((v) => v.available > 0)
  // Other things this shop is selling, so a buyer who came for one item can browse the rest.
  const others = await shopItems(c.env.DB, seller.id, drop.id, 6)
  // Not capped by stock – that would reveal the count. The server refuses if not enough is left.
  // Personal price link (?o=…): a special rate the seller gave this buyer. Checked again on order.
  const token = c.req.query('o') ?? ''
  const offerCheck = token && toolOn(seller, 'offers') ? await checkOffer(c.env.DB, token, drop.id) : null
  const offer = offerCheck?.state === 'ok' ? offerCheck.offer : null
  const price = offer ? offer.price_paise : drop.price_paise
  // Struck-through "was" price: the regular price for a personal price, or the pre-discount price.
  const was = offer ? Math.max(drop.price_paise, drop.compare_paise || 0) : drop.compare_paise > drop.price_paise ? drop.compare_paise : 0
  const maxQty = offer ? Math.min(drop.max_per_order, offer.max_qty) : drop.max_per_order
  const fast = sellingFast(counts)
  const till = offer ? new Date(offer.expires_at).toLocaleString(t.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''

  return c.html(
    <Layout
      t={t}
      path={here(c)}
      brand={seller.shop_name}
      title={`${drop.title} – ${seller.shop_name}`}
      og={{ title: `${drop.title} · ${rupees(drop.price_paise)}`, description: clip(drop.description || t.flashBy(seller.shop_name), 150), image: imageUrl(origin, drop.image_key), url: `${origin}/d/${drop.id}` }}
      scripts={open ? BUYER_JS : undefined}
      say={open ? t.sayBuyerSale : undefined}
      ok={c.req.query('ok')}
    >
      <a id="myorder" class="alert info" style="display:block;text-decoration:none" href="#" hidden>{t.yourOrder}</a>
      {data.images.length > 0 && <Gallery images={data.images} alt={drop.title} />}
      {offer && (
        <div class="alert ok" style="margin-top:12px"><b style="display:flex;gap:8px;align-items:center"><Icon n="key" s={18} />{t.offerFor(offer.buyer_name)}</b>
          <small style="display:block;margin-top:2px">{t.offerSub(till)}{offer.max_qty > 1 ? ` · ${t.offerMaxQty(offer.max_qty)}` : ''}</small></div>
      )}
      {offerCheck && !offer && <div class="alert info" style="margin-top:12px">{t.offerGone}</div>}
      <h1 style="margin-top:14px">{drop.title}</h1>
      <div class="row between">
        <span class="row" style="gap:10px;align-items:baseline;flex-wrap:wrap">
          <span class="price">{rupees(price)}</span>
          {was > price && <><s class="muted" aria-label={t.wasPrice}>{rupees(was)}</s><span class="chip paid">{t.pctOff(pctOff(was, price))}</span></>}
        </span>
        {open && <b style="color:var(--warn)" data-fast hidden={!fast}>{t.sellingFast}</b>}
      </div>
      {drop.ship_fee_paise > 0 && (
        <p class="muted" style="margin:4px 0 0;display:flex;gap:6px;align-items:center"><Icon n="box" s={16} />
          {drop.free_ship_above_paise ? t.deliveryFreeAbove(rupees(drop.ship_fee_paise), rupees(drop.free_ship_above_paise)) : t.deliveryFee(rupees(drop.ship_fee_paise))}
        </p>
      )}
      {drop.description && <p style="white-space:pre-line;margin-top:12px">{drop.description}</p>}

      <Flash msg={c.req.query('err')} />

      {drop.status === 'live' && !shopIsOpen ? (
        <div class="alert info">{t.shopPaused}</div>
      ) : drop.status !== 'live' || counts.available < 1 ? (
        <>
          <div class="alert info">{drop.status !== 'live' ? t.saleClosed : counts.held > 0 ? t.allHeld : t.allSold}</div>
          {toolOn(seller, 'waitlist') && <form method="post" action={`/d/${drop.id}/waitlist`} class="card stack" id="notify">
            <div><b style="display:block">{t.waitTitle}</b><small>{t.waitSub(seller.shop_name)}</small></div>
            <div><label for="wname">{t.yourName}</label><input id="wname" name="name" autocomplete="name" required maxlength={60} /></div>
            <div><label for="wphone">{t.phone}</label><PhoneInput id="wphone" name="phone" /></div>
            <button class="btn primary block" type="submit"><Icon n="clock" s={18} />{t.waitBtn}</button>
          </form>}
        </>
      ) : (
        <form id="buy" method="post" action={`/d/${drop.id}`} class="stack" data-drop={drop.id} data-price={price} data-ship={drop.ship_fee_paise || 0} data-freeabove={drop.free_ship_above_paise || 0}
          data-paytpl={t.payBtn('{amt}')} data-heldtxt={t.allReservedBtn} data-soldtxt={t.soldOutBtn}>
          {offer && <input type="hidden" name="offer" value={offer.id} />}
          {hasSizes ? (
            <div>
              <div class="sec">{t.pickSize}</div>
              <div class="pills">
                {variants.map((v) => (
                  <>
                    <input type="radio" name="variant" id={`v${v.id}`} value={v.id} disabled={v.available < 1} checked={v.id === firstOpen?.id} required />
                    <label for={`v${v.id}`}>{v.label}</label>
                  </>
                ))}
              </div>
            </div>
          ) : (
            <input type="hidden" name="variant" value={variants[0].id} />
          )}
          {maxQty > 1 && (
            <div>
              <label for="qty">{t.quantity}</label>
              <div style="max-width:220px"><Stepper id="qty" name="qty" value={1} min={1} max={maxQty} /></div>
            </div>
          )}
          <div class="sec">{t.yourDetails}</div>
          <div id="saved" class="card row" hidden style="margin:0;align-items:flex-start">
            <span style="color:var(--muted);display:flex"><Icon n="pin" /></span>
            <div class="grow"><small>{t.deliverTo}</small><b style="display:block" data-who /><span data-where style="white-space:pre-line" /></div>
            <button type="button" class="btn sm">{t.change}</button>
          </div>
          <div id="details" class="stack">
            <div>
              <label for="name">{t.yourName}</label>
              <input id="name" name="name" autocomplete="name" required maxlength={60} />
            </div>
            <div>
              <label for="phone">{t.phone}</label>
              <PhoneInput id="phone" name="phone" />
            </div>
            <div>
              <label for="address">{t.fullAddress}</label>
              <textarea id="address" name="address" autocomplete="street-address" required minlength={10} maxlength={400} placeholder={t.addressPh} />
            </div>
            <div style="max-width:200px">
              <label for="pincode">{t.pincode}</label>
              <input id="pincode" name="pincode" inputmode="numeric" autocomplete="postal-code" pattern="[1-9][0-9]{5}" maxlength={6} placeholder="411045" required />
            </div>
          </div>
          <div class="sticky-pay">
            <button id="paybtn" type="submit" class="btn primary block big">{t.payBtn(rupees(price))}</button>
            <small style="display:block;text-align:center;margin-top:6px">{t.upiApps}</small>
            <small style="display:block;text-align:center">{t.heldWhilePay} {seller.pay_mode === 'direct' ? t.payTo(seller.shop_name) : ''}</small>
            {drop.cod_enabled ? (
              <>
                <div class="or"><span>{t.codOr}</span></div>
                <button type="submit" name="pay" value="cod" class="btn block"><Icon n="cash" s={18} />{drop.cod_fee_paise ? t.codBtnFee(rupees(drop.cod_fee_paise)) : t.codBtn}</button>
              </>
            ) : null}
          </div>
        </form>
      )}
      <div class="stack" style="margin-top:16px">
        <a class="btn wa block sm" href={waLink(seller.phone, `${drop.title} – ${origin}/d/${drop.id}`)}>{t.askSeller(seller.shop_name)}</a>
        <a class="btn block sm" href={waLink(null, t.friendMsg(drop.title, rupees(drop.price_paise), `${origin}/d/${drop.id}`))}>{t.shareFriend}</a>
      </div>
      {others.length > 0 && (
        <>
          <h2>{t.moreFrom(seller.shop_name)}</h2>
          <ItemRow t={t} items={others} />
          <a class="btn block" href={`/s/${seller.id}`} style="margin-top:10px">{t.seeAllItems}</a>
        </>
      )}
      {open && (
        <div id="buybar" class="buybar" hidden>
          <div><b style="font-size:1.2rem">{rupees(price)}</b>{was > price && <s class="muted" style="margin-left:6px;font-size:.85rem">{rupees(was)}</s>}<br /><small style="color:var(--warn);font-weight:700" data-fast hidden={!fast}>{t.sellingFast}</small></div>
          <button type="button" class="btn primary">{t.buyNow} →</button>
        </div>
      )}
    </Layout>,
  )
})

pub.get('/d/:id/stock.json', async (c) => {
  const id = c.req.param('id')
  const [counts, { results }] = await Promise.all([
    dropCounts(c.env.DB, id),
    c.env.DB.prepare(`SELECT id, available FROM variants WHERE drop_id = ?`).bind(id).all<{ id: number; available: number }>(),
  ])
  // Public endpoint: availability only, no numbers.
  return c.json({ open: counts.available > 0, held: counts.held > 0, fast: sellingFast(counts), variants: results.map((v) => ({ id: v.id, open: v.available > 0 })) }, 200, { 'Cache-Control': 'no-store' })
})

const failText = (t: Dict, r: ReserveFailure, max: number) =>
  ({ closed: t.bErrClosed, qty: t.bErrQty(max), device: t.bErrDevice, stock: t.bErrStock })[r]

pub.post('/d/:id', async (c) => {
  const t = tr(c)
  const id = c.req.param('id')
  const back = (msg: string) => c.redirect(`/d/${id}?err=${encodeURIComponent(msg)}`, 303)
  const data = await loadDrop(c.env.DB, id)
  if (!data) return c.notFound()
  const seller = await getSeller(c.env.DB, data.drop.seller_id)
  if (!seller) return c.notFound()

  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  const name = String(f.name ?? '').trim().slice(0, 60)
  const pincode = String(f.pincode ?? '').replace(/\D/g, '')
  const rawAddress = String(f.address ?? '').trim().slice(0, 400)
  const address = rawAddress.includes(pincode) ? rawAddress : `${rawAddress} – ${pincode}`
  const variantId = Number(f.variant)
  const qty = Math.floor(Number(f.qty ?? 1))
  if (!phone) return back(t.bErrPhone)
  if (!name || rawAddress.length < 10) return back(t.bErrDetails)
  if (!/^[1-9]\d{5}$/.test(pincode)) return back(t.bErrPincode)
  if (!data.variants.some((v) => v.id === variantId)) return back(t.bErrSize)

  if (!(await shopOpen(c.env, seller))) return back(seller.account_status === 'active' ? t.shopPaused : t.bErrClosed)
  const ipHash = (await sha256((c.req.header('cf-connecting-ip') ?? '') + c.env.SECRET_KEY)).slice(0, 16)
  const cod = f.pay === 'cod' && Boolean(data.drop.cod_enabled)
  // A personal price applies only through a valid link, for the right number, within its piece limit.
  let unitPaise: number | undefined, offerId: string | undefined
  if (f.offer && toolOn(seller, 'offers')) {
    const { state, offer } = await checkOffer(c.env.DB, String(f.offer), id, phone)
    if (state === 'wrong_phone') return back(t.offerWrongPhone)
    if (state !== 'ok' || !offer) return c.redirect(`/d/${id}?err=${encodeURIComponent(t.offerGone)}`, 303)
    if (qty > offer.max_qty) return back(failText(t, 'qty', offer.max_qty))
    unitPaise = offer.price_paise; offerId = offer.id
  }
  const res = await reserveOrder(c.env, seller, data.drop, { variantId, qty, name, phone, address, ipHash, cod, unitPaise, offerId })
  if (!res.ok) return back(failText(t, res.reason, data.drop.max_per_order))
  const order = res.order
  if (offerId && order.offer_id === offerId) await c.env.DB.prepare(`UPDATE offers SET used_order_id = ? WHERE id = ?`).bind(order.id, offerId).run()
  // A brand-new order (not a re-tap returning the same one) → alert the seller's phone.
  if (order.created_at > Date.now() - 15_000) c.executionCtx.waitUntil(alertSeller(c.env, order.id, order.pay_mode === 'cod' ? 'cod' : 'order'))

  if (order.pay_mode === 'razorpay' && order.status === 'pending') {
    if (order.pay_url) return c.redirect(order.pay_url, 303)
    try {
      const url = await startGatewayPayment(c.env, seller, order, `${data.drop.title} ×${order.qty} – ${seller.shop_name}`, new URL(c.req.url).origin)
      return c.redirect(url, 303)
    } catch (e) {
      console.error('payment link failed', e)
      await rejectOrder(c.env, order.id, seller.id)
      return back(t.bErrGateway)
    }
  }
  return c.redirect(`/o/${order.id}`, 303)
})

// "Notify me when it's back" – the seller messages these buyers from the sale page.
pub.post('/d/:id/waitlist', async (c) => {
  const t = tr(c)
  const id = c.req.param('id')
  const drop = await c.env.DB.prepare(`SELECT id, seller_id FROM drops WHERE id = ?`).bind(id).first<{ id: string; seller_id: string }>()
  if (!drop) return c.notFound()
  const seller = await getSeller(c.env.DB, drop.seller_id)
  if (!seller) return c.notFound()
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  const name = String(f.name ?? '').trim().slice(0, 60)
  if (!toolOn(seller, 'waitlist')) return c.redirect(`/d/${id}`, 303)
  if (!phone) return c.redirect(`/d/${id}?err=${encodeURIComponent(t.bErrPhone)}#notify`, 303)
  if (!name) return c.redirect(`/d/${id}?err=${encodeURIComponent(t.bErrDetails)}#notify`, 303)
  // Joining again just refreshes the request (and asks to be told again).
  await c.env.DB.prepare(
    `INSERT INTO waitlist (drop_id, seller_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (drop_id, phone) DO UPDATE SET name = excluded.name, notified_at = NULL, created_at = excluded.created_at`,
  ).bind(id, drop.seller_id, name, phone, Date.now()).run()
  return c.redirect(`/d/${id}?ok=${encodeURIComponent(t.waitDone(seller.shop_name))}`, 303)
})

// ---------- Buyer order page ----------

// Pick the right pay buttons for the buyer's phone; on a computer, open the QR straight away.
export const OS_JS = `(function(){var ua=navigator.userAgent,ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),mobile=ios||/Android|Mobi/i.test(ua);
if(ios)document.querySelectorAll('[data-os]').forEach(function(e){e.hidden=e.dataset.os!=='ios'});var q=document.getElementById('qr');if(q&&!mobile)q.open=true})();`

// After tapping Pay the buyer leaves for their UPI app. When they come back, point them at "I have paid".
const RETURN_JS = `(function(){document.querySelectorAll('[data-paylink]').forEach(function(a){a.addEventListener('click',function(){try{sessionStorage.setItem('kk_left',location.pathname)}catch(e){}})});
document.addEventListener('visibilitychange',function(){var b=document.getElementById('ipaid');var left;try{left=sessionStorage.getItem('kk_left')}catch(e){}
if(document.visibilityState==='visible'&&b&&left===location.pathname){try{sessionStorage.removeItem('kk_left')}catch(e){}b.scrollIntoView({behavior:'smooth',block:'center'});b.classList.add('nudge');toast(b.dataset.nudge,3500)}})})();`

const ORDER_POLL_JS = `(function(){var s=document.getElementById('st').dataset.s;setInterval(function(){if(document.hidden)return;fetch(location.pathname+'/status.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d.status!==s)location.reload()}).catch(function(){})},6000)})();`

pub.get('/o/:id', async (c) => {
  const t = tr(c)
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(c.req.param('id')).first<Order>()
  if (!order) return c.notFound()
  const [data, seller] = await Promise.all([loadDrop(c.env.DB, order.drop_id), getSeller(c.env.DB, order.seller_id)])
  if (!data || !seller) return c.notFound()
  // Everything paid together with this order (several products = one payment).
  const lines = await cartOrders(c.env.DB, order)
  const total = cartTotal(lines)
  const holdUntil = Math.max(...lines.map((l) => l.hold_until))
  // The cron sweep may lag a minute behind; show a lapsed hold as "time over" straight away.
  const status = order.pay_mode === 'cod' ? shownStatus(order) : order.status === 'pending' && holdUntil < Date.now() ? 'expired' : order.status
  // Payments go to the UPI ID chosen for this sale (or the seller's default).
  const payVpa = data.drop.upi_vpa ?? seller.upi_vpa
  const note = lines.length > 1 ? `${shortNo(order.id)} ${lines.length} items` : `${shortNo(order.id)} ${data.drop.title}`
  const upi = payVpa ? upiLink(payVpa, seller.shop_name, total, note) : null
  const amt = rupees(total)
  const shipTotal = lines.reduce((n, l) => n + (l.ship_paise || 0), 0)
  const codFee = order.pay_mode === 'cod' ? data.drop.cod_fee_paise || 0 : 0
  // Quick orders made by the seller may not have the address yet – ask for it here.
  const needDetails = !lines[0].address && ['pending', 'verifying', 'expired'].includes(status)

  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={`${t.orderNo(shortNo(order.id))} – ${seller.shop_name}`}
      scripts={OS_JS + RETURN_JS + (['pending', 'verifying'].includes(status) ? ORDER_POLL_JS : '') +
        `try{var m=JSON.parse(localStorage.getItem('kk_orders')||'{}');m['${order.drop_id}']=location.pathname;localStorage.setItem('kk_orders',JSON.stringify(m))}catch(e){}`}
      say={status === 'pending' && order.pay_mode === 'direct' ? t.sayBuyerPay : undefined}>
      <div class="row between" style="margin-top:8px">
        <h1 style="font-size:1rem;margin:0;font-weight:700">{t.orderNo(shortNo(order.id))}</h1>
        <span id="st" data-s={order.status}>{status === 'verifying' ? <span class="chip verifying">{t.checkingChip}</span> : <StatusChip t={t} status={status} />}</span>
      </div>
      <div class="card" style="padding:4px 16px">
        {lines.map((l, i) => (
          <div class="row" style={`padding:12px 0;${i ? 'border-top:1px solid var(--line)' : ''}`}>
            {l.image_key ? <img class="thumb" src={`/img/${l.image_key}`} alt="" /> : <div class="thumb"><Icon n="bag" s={22} /></div>}
            <div class="grow">
              <b>{l.title}</b>
              <div class="muted">{l.label ? `${l.label} · ` : ''}{t.qty} {l.qty}</div>
            </div>
            <span>{rupees(l.price_paise * l.qty)}</span>
          </div>
        ))}
        {shipTotal > 0 && <div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><span class="muted">{t.deliveryLine}</span><span>{rupees(shipTotal)}</span></div>}
        {codFee > 0 && <div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><span class="muted">{t.codChargeLine}</span><span>{rupees(codFee)}</span></div>}
        {lines.length > 1 || shipTotal > 0 || codFee > 0
          ? <div class="row between" style="padding:12px 0;border-top:2px solid var(--line)"><b>{t.total}</b><b>{amt}</b></div>
          : <div class="row between" style="padding:0 0 12px"><span /><b>{amt}</b></div>}
      </div>
      <Flash msg={c.req.query('err')} />
      {needDetails && (
        <form method="post" action={`/o/${order.id}/details`} class="card stack" style="border:2px solid var(--brand)">
          <b>{t.yourDetails}</b>
          <div><label for="name">{t.yourName}</label><input id="name" name="name" autocomplete="name" required maxlength={60} value={lines[0].buyer_name === 'Customer' ? '' : lines[0].buyer_name} /></div>
          <div><label for="address">{t.fullAddress}</label><textarea id="address" name="address" autocomplete="street-address" required minlength={10} maxlength={400} placeholder={t.addressPh} /></div>
          <div style="max-width:200px"><label for="pincode">{t.pincode}</label><input id="pincode" name="pincode" inputmode="numeric" autocomplete="postal-code" pattern="[1-9][0-9]{5}" maxlength={6} required /></div>
          <button class="btn primary block" type="submit">{t.save}</button>
        </form>
      )}

      {status === 'paid' && (
        <div class="bigok" aria-hidden="true">✓</div>
      )}
      {status === 'paid' && <h1 style="text-align:center;color:var(--ok);margin-top:0">{t.paidBig}</h1>}
      {status === 'paid' && <div class="card"><ShipSteps t={t} ship={order.ship_status} /></div>}
      {status === 'paid' && (
        <div class="alert ok">
          {t.paidOk}
          <div style="white-space:pre-line;font-weight:400;margin-top:6px">{order.buyer_name}{'\n'}{order.address}</div>
        </div>
      )}
      {status === 'cod' && (
        <>
          <div class="card stack" style="text-align:center;border-color:var(--warn)">
            <div style="color:var(--warn);display:flex;justify-content:center"><Icon n="cash" s={40} /></div>
            <h1 style="margin:0">{t.codPlacedTitle}</h1>
            <p style="margin:0">{t.codPlacedBody(rupees(order.amount_paise), seller.shop_name)}</p>
            {data.drop.cod_fee_paise > 0 && <small>{t.codIncludesFee(rupees(data.drop.cod_fee_paise))}</small>}
          </div>
          <div class="card"><ShipSteps t={t} ship={order.ship_status} labels={t.codSteps} /></div>
          <div class="card"><b>{t.yourDetails}</b><div style="white-space:pre-line;margin-top:6px">{order.buyer_name}{'\n'}{order.address}</div></div>
        </>
      )}
      {status === 'verifying' && <div class="alert info">{t.verifyingNote(seller.shop_name)}</div>}
      {status === 'expired' && <div class="alert bad">{t.expiredNote}</div>}
      {status === 'rejected' && <div class="alert bad">{t.rejectedNote}</div>}
      {(status === 'expired' || status === 'rejected') && data.drop.status === 'live' && lines.length === 1 && (
        <a class="btn primary block" href={`/d/${order.drop_id}`}><Icon n="refresh" s={18} />{t.tryAgain}</a>
      )}
      {status === 'refund_due' && <div class="alert bad">{t.refundNote2(seller.shop_name)}</div>}

      {status === 'pending' && (
        <div class="card" style="text-align:center">
          <small>{t.keptFor}</small>
          <div class="countdown" data-countdown={order.hold_until} data-reload="1">
            {Math.max(0, Math.ceil((order.hold_until - Date.now()) / 60000))}:00
          </div>
        </div>
      )}

      {status === 'pending' && order.pay_mode !== 'direct' && order.pay_url && (
        <a class="btn primary block big" href={order.pay_url} data-paylink>{t.payBtn(amt)}</a>
      )}

      {order.pay_mode === 'direct' && upi && (status === 'pending' || status === 'expired') && (
        <>
          {status === 'pending' && (
            <>
              <div class="sec"><span class="num">1</span>{t.step1Pay}</div>
              <p>{t.exactAmount}</p>
              <p class="price" style="text-align:center;margin:6px 0">{amt}</p>
              {/* Android: one button, the phone shows its own UPI app chooser. */}
              <div data-os="android">
                <a class="btn primary block big" href={upi} data-paylink>{t.payWithApp(amt)}</a>
                <small style="display:block;text-align:center;margin-top:6px">{t.upiApps}</small>
              </div>
              {/* iPhone: no chooser exists, so one button per app (switched on by OS_JS). */}
              <div data-os="ios" hidden>
                <p style="text-align:center;font-weight:700">{t.chooseApp}</p>
                <div class="appgrid">
                  {upiAppLinks(payVpa!, seller.shop_name, order.amount_paise, `${shortNo(order.id)} ${data.drop.title}`).map((a) => (
                    <a class="btn" href={a.href} data-paylink>{a.name}</a>
                  ))}
                </div>
              </div>
              <p class="hint" style="text-align:center">{t.copyFallback}</p>
              <div class="row">
                <input type="hidden" id="cp-vpa" value={payVpa ?? ''} />
                <input type="hidden" id="cp-amt" value={(order.amount_paise / 100).toFixed(2)} />
                <button type="button" class="btn sm grow" data-copy="#cp-vpa">{t.copyUpi}</button>
                <button type="button" class="btn sm grow" data-copy="#cp-amt">{t.copyAmount}</button>
              </div>
              <details id="qr">
                <summary>{t.scanQr}</summary>
                <div class="qr">{raw(qrSvg(upi))}</div>
                <p style="text-align:center"><small>UPI ID: <b>{payVpa}</b></small></p>
              </details>
              <div class="sec"><span class="num">2</span>{t.step2Back}</div>
            </>
          )}
          {/* Buyers can't find UTRs, so: one big "I have paid" button, and an optional screenshot (their habit). */}
          <form method="post" action={`/o/${order.id}/utr`} enctype="multipart/form-data" class="card stack">
            <button type="submit" id="ipaid" class="btn ok block big" data-nudge={t.backToPay}>{t.iPaid}</button>
            <details>
              <summary style="font-weight:600;gap:8px"><Icon n="clip" s={18} />{t.shotLabel}</summary>
              <input type="file" name="proof" accept="image/*" aria-label={t.shotLabel} />
              <div class="hint">{t.shotHelp}</div>
            </details>
          </form>
        </>
      )}
      {order.channel === 'whatsapp' && c.env.WA_BOT_NUMBER && (
        <a class="btn wa block big" style="margin-top:16px" href={`https://wa.me/${c.env.WA_BOT_NUMBER}`}>{t.backToWa}</a>
      )}
      {status === 'pending' && <a class="btn block" style="margin-top:20px" href={`/s/${seller.id}`}>{t.addAnother(seller.shop_name)}</a>}
      <a class="btn wa block" style="margin-top:12px" href={waLink(seller.phone, t.aboutOrder(shortNo(order.id)))}>{t.msgSeller(seller.shop_name)}</a>
    </Layout>,
  )
})

// Buyer adds name and address to a quick order the seller made from a chat.
pub.post('/o/:id/details', async (c) => {
  const t = tr(c)
  const id = c.req.param('id')
  const order = await c.env.DB.prepare(`SELECT id, cart_id FROM orders WHERE id = ?`).bind(id).first<Order>()
  if (!order) return c.notFound()
  const f = await c.req.parseBody()
  const name = String(f.name ?? '').trim().slice(0, 60)
  const pincode = String(f.pincode ?? '').replace(/\D/g, '')
  const raw = String(f.address ?? '').trim().slice(0, 400)
  if (!name || raw.length < 10) return c.redirect(`/o/${id}?err=${encodeURIComponent(t.bErrDetails)}`, 303)
  if (!/^[1-9]\d{5}$/.test(pincode)) return c.redirect(`/o/${id}?err=${encodeURIComponent(t.bErrPincode)}`, 303)
  const address = raw.includes(pincode) ? raw : `${raw} – ${pincode}`
  await c.env.DB.prepare(`UPDATE orders SET buyer_name = ?1, address = ?2 WHERE id = ?3 OR cart_id = ?3`).bind(name, address, cartKeyOf(order)).run()
  return c.redirect(`/o/${id}`, 303)
})

pub.get('/o/:id/status.json', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`SELECT status, pay_mode, gw_checked_at FROM orders WHERE id = ?`).bind(id).first<{ status: string; pay_mode: string; gw_checked_at: number | null }>()
  if (!row) return c.notFound()
  // While a gateway buyer waits on this page, ask the gateway directly (at most every 15 s).
  if (row.pay_mode === 'razorpay' && row.status === 'pending' && Date.now() - (row.gw_checked_at ?? 0) > 15_000) {
    if (await confirmGateway(c.env, id, row.pay_mode, (p) => c.executionCtx.waitUntil(p)).catch(() => false)) row.status = 'paid'
  }
  return c.json({ status: row.status }, 200, { 'Cache-Control': 'no-store' })
})

pub.post('/o/:id/utr', async (c) => {
  const t = tr(c)
  const id = c.req.param('id')
  const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(id).first<Order>()
  if (!order || order.pay_mode !== 'direct') return c.notFound()
  const f = await c.req.parseBody()
  const utr = String(f.utr ?? '').replace(/\D/g, '')
  if (utr && !isValidUtr(utr)) return c.redirect(`/o/${id}?err=${encodeURIComponent(t.badUtr)}`, 303)
  const proof = f.proof
  if (proof instanceof File && proof.size > 0 && proof.size < 5 * 1024 * 1024 && proof.type.startsWith('image/')) {
    const key = `p/${randomId(16)}`
    await c.env.IMAGES.put(key, proof.stream(), { httpMetadata: { contentType: proof.type } })
    await c.env.DB.prepare(`UPDATE orders SET proof_key = ? WHERE id = ?`).bind(key, id).run()
  }
  const ok = await claimCart(c.env, order, utr || null)
  return c.redirect(ok ? `/o/${id}` : `/o/${id}?err=${encodeURIComponent(t.soldMeanwhile)}`, 303)
})

// Razorpay sends the buyer back here after paying. We confirm straight away; markPaid makes
// all the paths (return, order-page poll, cron, optional webhook) idempotent.
pub.get('/o/:id/paid', async (c) => {
  const id = c.req.param('id')
  const q = c.req.query()
  const order = await c.env.DB.prepare(`SELECT seller_id, gateway_ref, pay_mode FROM orders WHERE id = ?`).bind(id).first<{ seller_id: string; gateway_ref: string; pay_mode: string }>()
  if (order && q.razorpay_payment_link_status === 'paid' && q.razorpay_payment_link_id === order.gateway_ref) {
    const seller = await getSeller(c.env.DB, order.seller_id)
    if (seller?.rzp_secret_enc && (await verifyCallback(await decrypt(seller.rzp_secret_enc, c.env.SECRET_KEY), q))) {
      await markCartPaid(c.env, id, q.razorpay_payment_id, (p) => c.executionCtx.waitUntil(p))
    }
  }
  // No (valid) signature on the redirect? Ask Razorpay directly – the link's status is the truth.
  if (order?.pay_mode === 'razorpay') await confirmRazorpay(c.env, id, (p) => c.executionCtx.waitUntil(p)).catch((e) => console.error('razorpay confirm', e))
  return c.redirect(`/o/${id}`, 303)
})

// ---------- Images (R2) ----------

pub.get('/img/:key{.+}', async (c) => {
  // Payment screenshots (p/…) are private – sellers see them through /app/proof/:order.
  if (c.req.param('key').startsWith('p/')) return c.notFound()
  const obj = await c.env.IMAGES.get(c.req.param('key'))
  if (!obj) return c.notFound()
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Keys are content-unique, so browsers and Cloudflare's edge can cache forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
    },
  })
})
