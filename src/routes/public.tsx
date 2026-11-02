import { Hono } from 'hono'
import type { Context } from 'hono'
import { raw } from 'hono/html'
import type { AppEnv, Order, Seller } from '../env'
import { courierDate, tr, type Dict } from '../i18n'
import { decrypt, sha256 } from '../lib/crypto'
import { shownStatus, cartKeyOf, cartOrders, cartTotal, claimCart, dropCounts, loadDrop, markCartPaid, rejectOrder, reserveOrder, sellingFast, shortNo, type ReserveFailure } from '../lib/orders'
import { confirmGateway, confirmRazorpay, startGatewayPayment } from '../lib/gateway'
import { verifyCallback } from '../lib/razorpay'
import { shopOpen } from '../lib/billing'
import { alertSeller } from '../lib/push'
import { isValidUtr, qrSvg, upiAppLinks, upiLink } from '../lib/upi'
import { clip, liveWhen, normalizePhone, randomId, rupees, waLink } from '../lib/util'
import { waBotEnabled } from '../lib/whatsapp'
import { checkOffer, pctOff } from '../lib/offers'
import { ACTIVE_SHIP, applyTracking, srToken, srTrack, type Scan, type ShipmentRow } from '../lib/shiprocket'
import { toolOn } from '../lib/tools'
import { Flash, Icon, Layout, PhoneInput, ShipSteps, StatusChip, Stepper } from '../views/layout'

export const pub = new Hono<AppEnv>()

const SELLER_COLS = `id, phone, name, shop_name, upi_vpa, pay_mode, rzp_key_id, rzp_secret_enc, rzp_webhook_enc, allowed_modes, account_status, gateway_request, tools_off, slug, offer_min_paise, offer_off_paise, offer_pct`
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

// "Add to cart" on a sale page: the size and quantity picked in the form.
const ADD_SALE_JS = `(function(){var b=document.querySelector('[data-addsale]');if(!b)return;b.onclick=function(){var f=document.getElementById('buy'),it=JSON.parse(b.dataset.addsale),v=f.querySelector('[name=variant]:checked')||f.querySelector('[name=variant]');
if(!v||!v.value){toast(document.querySelector('.sec')?document.querySelector('.sec').textContent:'');return}var q=f.querySelector('[name=qty]');kkCart.add({d:it.d,v:+v.value,q:q?Math.max(1,+q.value||1):1,t:it.t,l:it.labels[v.value]||'',p:it.p,img:it.img,max:it.max});window.scrollTo({top:0,behavior:'smooth'})}})();`
// Scheduled drop: count down to go-live, then reload into the normal sale page.
const SOON_JS = `(function(){var e=document.getElementById('soon');if(!e)return;var at=+e.dataset.at;function f(){var s=Math.max(0,Math.round((at-Date.now())/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
e.textContent=(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');if(s>0)setTimeout(f,1000);else setTimeout(function(){location.reload()},800)}f()})();`

// ---------- Storefront: the seller's whole shop at nukkadsale.in/<slug> (or /s/<id>) ----------

type SfItem = { id: string; title: string; price_paise: number; compare_paise: number; image_key: string | null; category: string; live_at: number; created_at: number; max_per_order: number; stock: number; available: number }
type SfVariant = { id: number; drop_id: string; label: string; available: number }

// The cart lives in the buyer's browser (per shop) until checkout; the server re-checks everything on order.
export const cartJs = (sid: string, t: Dict, offer: { min: number; off: number; pct: number }) => `(function(){
var K='kk_cart_${sid}',OF=${JSON.stringify(offer)};
function rs(p){return '₹'+(p%100?(p/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):(p/100).toLocaleString('en-IN'))}
function get(){try{return JSON.parse(localStorage.getItem(K)||'[]')}catch(e){return[]}}
function save(c){try{localStorage.setItem(K,JSON.stringify(c))}catch(e){}render()}
function items(c){return c.reduce(function(n,x){return n+x.p*x.q},0)}
function disc(n){if(!OF.min||n<OF.min)return 0;var d=OF.off>0?OF.off:Math.floor(n*OF.pct/100);return Math.max(0,Math.min(d,n-100))}
window.kkCart={get:get,save:save,items:items,disc:disc,rs:rs,
  add:function(it){var c=get(),e=c.find(function(x){return x.v==it.v});if(e)e.q=Math.min(e.q+it.q,it.max||e.max||5);else c.push(it);save(c);toast(${JSON.stringify(t.addedToCart)})}};
function render(){var c=get(),b=document.getElementById('cartbar');if(!b)return;var n=c.reduce(function(a,x){return a+x.q},0),tot=items(c);b.hidden=!n;if(!n)return;
  b.querySelector('[data-c]').textContent=(n===1?${JSON.stringify(t.cartBar(1, '{a}'))}:${JSON.stringify(t.cartBar(2, '{a}').replace('2', '{n}'))}).replace('{n}',n).replace('{a}',rs(tot-disc(tot)));
  var h=b.querySelector('small');if(h){var more=OF.min-tot;h.textContent=OF.min?(more>0?${JSON.stringify(t.offerMore('{m}', '{o}'))}.replace('{m}',rs(more)).replace('{o}',OF.off?rs(OF.off):OF.pct+'%'):${JSON.stringify(t.offerGot('{o}'))}.replace('{o}',rs(disc(tot)))):'';h.hidden=!OF.min}}
document.addEventListener('click',function(e){var a=e.target.closest('[data-add]');if(!a)return;e.preventDefault();var it=JSON.parse(a.dataset.add);
  if(it.sizes){var d=document.getElementById('sizesheet');d.querySelector('[data-t]').textContent=it.t;var box=d.querySelector('[data-sz]');box.innerHTML='';
    it.sizes.forEach(function(z,i){var l=document.createElement('button');l.type='button';l.className='btn sm';l.textContent=z.l;l.disabled=!z.a;l.onclick=function(){d.close();kkCart.add({d:it.d,v:z.id,q:1,t:it.t,l:z.l,p:it.p,img:it.img,max:it.max})};box.appendChild(l)});d.showModal()}
  else kkCart.add(it)});
render()})();`

const CartBar = ({ t, sid }: { t: Dict; sid: string }) => (
  <a id="cartbar" class="cartbar" href={`/s/${sid}/cart`} hidden>
    <Icon n="bag" s={20} /><span><span data-c /><small hidden /></span><span class="go">{t.checkout} →</span>
  </a>
)
const SizeSheet = ({ t }: { t: Dict }) => (
  <dialog id="sizesheet" class="sheet"><b data-t style="display:block;margin-bottom:4px" /><small>{t.pickSizeFirst}</small><div data-sz class="row wrap" style="gap:8px;margin-top:12px" /></dialog>
)

async function storefront(c: Context<AppEnv>, seller: Seller) {
  const t = tr(c)
  const open = await shopOpen(c.env, seller)
  const { results: items } = open ? await c.env.DB.prepare(
    `SELECT d.id, d.title, d.price_paise, d.compare_paise, d.image_key, d.category, d.live_at, d.created_at, d.max_per_order,
            (SELECT COALESCE(SUM(stock), 0) FROM variants WHERE drop_id = d.id) AS stock, (SELECT COALESCE(SUM(available), 0) FROM variants WHERE drop_id = d.id) AS available
     FROM drops d WHERE d.seller_id = ? AND d.status = 'live' ORDER BY d.created_at DESC LIMIT 120`).bind(seller.id).all<SfItem>() : { results: [] as SfItem[] }
  const { results: vars } = items.length ? await c.env.DB.prepare(`SELECT v.id, v.drop_id, v.label, v.available FROM variants v JOIN drops d ON d.id = v.drop_id WHERE d.seller_id = ? AND d.status = 'live' ORDER BY v.position`).bind(seller.id).all<SfVariant>() : { results: [] as SfVariant[] }
  const now = Date.now()
  // In stock first, then coming soon, then sold out.
  items.sort((a, b) => (Number(b.available > 0 && b.live_at <= now) * 2 + Number(b.live_at > now)) - (Number(a.available > 0 && a.live_at <= now) * 2 + Number(a.live_at > now)))
  const cats = [...new Set(items.map((x) => x.category).filter(Boolean))]
  const origin = new URL(c.req.url).origin
  const link = seller.slug ? `${origin}/${seller.slug}` : `${origin}/s/${seller.id}`
  const offer = { min: seller.offer_min_paise ?? 0, off: seller.offer_off_paise ?? 0, pct: seller.offer_pct ?? 0 }
  const filterJs = `(function(){var q=document.getElementById('q'),cs=document.querySelectorAll('.chips button'),cat='';function f(){var s=(q.value||'').toLowerCase();document.querySelectorAll('.sfcard').forEach(function(e){e.hidden=!((!cat||e.dataset.cat===cat)&&e.dataset.s.indexOf(s)>-1)})}
q&&q.addEventListener('input',f);cs.forEach(function(b){b.onclick=function(){cs.forEach(function(x){x.classList.remove('on')});b.classList.add('on');cat=b.dataset.cat;f()}})})();`
  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={t.shopItems(seller.shop_name)} scripts={cartJs(seller.id, t, offer) + filterJs}
      og={{ title: seller.shop_name, description: t.shopItems(seller.shop_name), image: imageUrl(origin, items[0]?.image_key ?? null), url: link }}>
      <div class="sfhead"><span class="av"><Icon n="shop" s={28} /></span><div><h1>{seller.shop_name}</h1><small>{t.shopCount(items.length)}</small></div></div>
      {offer.min > 0 && <div class="offerband"><Icon n="receipt" s={18} />{t.offerBanner(rupees(offer.min), offer.off ? rupees(offer.off) : `${offer.pct}%`)}</div>}
      <CartBar t={t} sid={seller.id} />
      {items.length > 6 && <label class="sfsearch"><Icon n="search" s={18} /><input id="q" type="search" placeholder={t.searchPh} aria-label={t.searchPh} /></label>}
      {cats.length > 0 && <div class="chips"><button type="button" class="on" data-cat="">{t.catAll}</button>{cats.map((x) => <button type="button" data-cat={x}>{x}</button>)}</div>}
      {items.length === 0 && <p class="muted">{t.shopEmpty}</p>}
      <div class="sfgrid">
        {items.map((o) => {
          const vs = vars.filter((v) => v.drop_id === o.id)
          const soon = o.live_at > now, out = o.available < 1, fresh = now - o.created_at < 7 * 86_400_000
          const sized = vs.length > 1 || Boolean(vs[0]?.label)
          const add = { d: o.id, t: o.title, p: o.price_paise, img: o.image_key, max: o.max_per_order, ...(sized ? { sizes: vs.map((v) => ({ id: v.id, l: v.label, a: v.available > 0 })) } : { v: vs[0]?.id, q: 1, l: '' }) }
          return (
            <div class={`sfcard${out && !soon ? ' out' : ''}`} data-cat={o.category} data-s={o.title.toLowerCase()}>
              <a href={`/d/${o.id}`}>
                <div class="sfimg">
                  {o.image_key ? <img src={`/img/${o.image_key}`} alt="" loading="lazy" /> : <div class="ph"><Icon n="bag" s={28} /></div>}
                  {soon ? <span class="badge2 soon">{t.comingSoon}</span> : out ? <span class="badge2">{t.soldOutBtn}</span> : fresh ? <span class="badge2">{t.newTag}</span> : null}
                  {!out && o.compare_paise > o.price_paise && <span class="badge2 off">{t.pctOff(pctOff(o.compare_paise, o.price_paise))}</span>}
                </div>
                <b>{clip(o.title, 48)}</b>
                <span class="sfprice"><b>{rupees(o.price_paise)}</b>{o.compare_paise > o.price_paise && <s>{rupees(o.compare_paise)}</s>}</span>
                {soon && <small style="color:var(--info);font-weight:700">{t.dropSoon(liveWhen(o.live_at, t.lang))}</small>}
              </a>
              {!soon && !out && <button type="button" class="btn sm" data-add={JSON.stringify(add)}><Icon n="bag" s={16} />{t.addToCart}</button>}
            </div>
          )
        })}
      </div>
      <SizeSheet t={t} />
      <div class="stack" style="margin-top:18px">
        <a class="btn wa block" href={waLink(seller.phone, '')}>{t.msgSeller(seller.shop_name)}</a>
        <a class="btn block sm" href={waLink(null, `${seller.shop_name} – ${link}`)}><Icon n="share" s={16} />{t.shareShop}</a>
      </div>
    </Layout>,
  )
}

pub.get('/s/:id', async (c) => {
  const seller = await getSeller(c.env.DB, c.req.param('id'))
  if (!seller) return c.notFound()
  return storefront(c, seller)
})

/** nukkadsale.in/<slug> – registered last in index.tsx so it never shadows a real page. */
export async function storefrontBySlug(c: Context<AppEnv>) {
  const slug = (c.req.param('slug') ?? '').toLowerCase()
  const seller = await c.env.DB.prepare(`SELECT ${SELLER_COLS} FROM sellers WHERE slug = ?`).bind(slug).first<Seller>()
  if (!seller) return c.notFound()
  return storefront(c, seller)
}

// ---------- Cart & checkout: several items, one payment ----------

pub.get('/s/:id/cart', async (c) => {
  const t = tr(c)
  const seller = await getSeller(c.env.DB, c.req.param('id'))
  if (!seller) return c.notFound()
  const offer = { min: seller.offer_min_paise ?? 0, off: seller.offer_off_paise ?? 0, pct: seller.offer_pct ?? 0 }
  const page = `(function(){var C=kkCart,L=document.getElementById('lines'),f=document.getElementById('co');
function draw(){var c=C.get();if(!c.length){document.getElementById('empty').hidden=false;f.hidden=true;L.innerHTML='';return}
  L.innerHTML=c.map(function(x,i){return '<div class="cartline">'+(x.img?'<img src="/img/'+x.img+'" alt="">':'<span class="thumb"></span>')+'<div class="grow"><b>'+x.t.replace(/</g,'&lt;')+'</b><div class="muted">'+(x.l?x.l+' · ':'')+C.rs(x.p)+'</div></div>'+
   '<div class="stepper compact"><button type="button" data-i="'+i+'" data-d="-1" aria-label="Less">−</button><input value="'+x.q+'" readonly aria-label="qty"><button type="button" data-i="'+i+'" data-d="1" aria-label="More">+</button></div></div>'}).join('');
  var n=C.items(c),d=C.disc(n);document.getElementById('it').textContent=C.rs(n);var dr=document.getElementById('dr');dr.hidden=!d;dr.querySelector('span:last-child').textContent='−'+C.rs(d);
  document.getElementById('tp').textContent=C.rs(n-d);f.querySelector('[name=lines]').value=JSON.stringify(c.map(function(x){return{d:x.d,v:x.v,q:x.q}}))}
L.addEventListener('click',function(e){var b=e.target.closest('[data-i]');if(!b)return;var c=C.get(),x=c[+b.dataset.i];x.q+=+b.dataset.d;if(x.q<1)c.splice(+b.dataset.i,1);else x.q=Math.min(x.q,x.max||5);C.save(c);draw()});
var K='kk_buyer',sv={};try{sv=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}['name','phone','address','pincode'].forEach(function(k){if(sv[k]&&!f[k].value)f[k].value=sv[k]});
f.addEventListener('submit',function(){try{localStorage.setItem(K,JSON.stringify({name:f.name.value,phone:f.phone.value,address:f.address.value,pincode:f.pincode.value}))}catch(e){}});
draw()})();`
  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={`${t.cartTitle} – ${seller.shop_name}`} scripts={cartJs(seller.id, t, offer) + page}>
      <a class="back" href={seller.slug ? `/${seller.slug}` : `/s/${seller.id}`}>← {t.keepShopping}</a>
      <h1>{t.cartTitle}</h1>
      <Flash msg={c.req.query('err')} />
      <div id="empty" class="empty" hidden><span class="ic"><Icon n="bag" s={26} /></span><b>{t.cartEmpty}</b></div>
      <form id="co" method="post" action={`/s/${seller.id}/cart`} class="stack">
        <div class="card" style="padding:4px 16px"><div id="lines" /></div>
        <div class="card">
          <div class="row between"><span class="muted">{t.itemsTotal}</span><span id="it" /></div>
          <div class="row between" id="dr" hidden style="color:var(--ok);margin-top:6px"><span>{t.offerLine}</span><span /></div>
          <div class="row between" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><b>{t.toPay}</b><b id="tp" /></div>
          <small>{t.heldWhilePay}</small>
        </div>
        <input type="hidden" name="lines" />
        <div class="sec">{t.yourDetails}</div>
        <div><label for="name">{t.yourName}</label><input id="name" name="name" autocomplete="name" required maxlength={60} /></div>
        <div><label for="phone">{t.phone}</label><PhoneInput id="phone" name="phone" /></div>
        <div><label for="address">{t.fullAddress}</label><textarea id="address" name="address" autocomplete="street-address" required minlength={10} maxlength={400} placeholder={t.addressPh} /></div>
        <div style="max-width:200px"><label for="pincode">{t.pincode}</label><input id="pincode" name="pincode" inputmode="numeric" autocomplete="postal-code" pattern="[1-9][0-9]{5}" maxlength={6} placeholder="411045" required /></div>
        <div class="sticky-pay"><button type="submit" class="btn primary block big">{t.checkout} →</button><small style="display:block;text-align:center;margin-top:6px">{t.upiApps}</small></div>
      </form>
    </Layout>,
  )
})

pub.post('/s/:id/cart', async (c) => {
  const t = tr(c)
  const seller = await getSeller(c.env.DB, c.req.param('id'))
  if (!seller) return c.notFound()
  const back = (msg: string) => c.redirect(`/s/${seller.id}/cart?err=${encodeURIComponent(msg)}`, 303)
  const f = await c.req.parseBody()
  let lines: { d: string; v: number; q: number }[] = []
  try { lines = JSON.parse(String(f.lines ?? '[]')) } catch { lines = [] }
  lines = lines.filter((l) => typeof l?.d === 'string' && Number.isInteger(+l.v) && +l.q >= 1).slice(0, 20)
  const phone = normalizePhone(String(f.phone ?? ''))
  const name = String(f.name ?? '').trim().slice(0, 60)
  const pincode = String(f.pincode ?? '').replace(/\D/g, '')
  const rawAddress = String(f.address ?? '').trim().slice(0, 400)
  const address = rawAddress.includes(pincode) ? rawAddress : `${rawAddress} – ${pincode}`
  if (!lines.length) return back(t.cartEmpty)
  if (!phone) return back(t.bErrPhone)
  if (!name || rawAddress.length < 10) return back(t.bErrDetails)
  if (!/^[1-9]\d{5}$/.test(pincode)) return back(t.bErrPincode)
  if (!(await shopOpen(c.env, seller))) return back(seller.account_status === 'active' ? t.shopPaused : t.bErrClosed)
  const ipHash = (await sha256((c.req.header('cf-connecting-ip') ?? '') + c.env.SECRET_KEY)).slice(0, 16)
  // One by one: the first item opens the payment, each next one joins it (same buyer, same UPI ID).
  const orders: Order[] = [], skipped: string[] = []
  for (const l of lines) {
    const data = await loadDrop(c.env.DB, l.d)
    if (!data || data.drop.seller_id !== seller.id || !data.variants.some((v) => v.id === +l.v)) continue
    const res = await reserveOrder(c.env, seller, data.drop, { variantId: +l.v, qty: Math.min(+l.q, data.drop.max_per_order), name, phone, address, ipHash })
    if (res.ok) orders.push(res.order); else skipped.push(failText(t, res.reason, data.drop.max_per_order) + ' – ' + data.drop.title)
  }
  if (!orders.length) return back(skipped[0] ?? t.bErrStock)
  c.executionCtx.waitUntil(alertSeller(c.env, orders[orders.length - 1].id, 'order'))
  const keys = [...new Set((await Promise.all(orders.map((o) => c.env.DB.prepare(`SELECT COALESCE(cart_id, id) AS k FROM orders WHERE id = ?`).bind(o.id).first<{ k: string }>()))).map((r) => r!.k))]
  const first = (await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(keys[0]).first<Order>())!
  const note = skipped.length ? `&err=${encodeURIComponent(skipped.join(' · '))}` : ''
  if (keys.length === 1 && first.pay_mode === 'razorpay' && first.status === 'pending') {
    try { return c.redirect(await startGatewayPayment(c.env, seller, first, `${orders.length} items – ${seller.shop_name}`, new URL(c.req.url).origin), 303) }
    catch (e) { console.error('payment link failed', e) }
  }
  if (keys.length === 1) return c.redirect(`/o/${keys[0]}?cart=done${note}`, 303)
  // Items paying into different UPI IDs can't share one payment – list the payments.
  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={t.cartTitle} scripts={`try{localStorage.removeItem('kk_cart_${seller.id}')}catch(e){}`}>
      <h1>{t.cartTitle}</h1><p>{t.cartSplit}</p>
      <div class="stack">{keys.map((k, i) => <a class="btn block" href={`/o/${k}`}>{i + 1}. {t.orderNo(shortNo(k))}</a>)}</div>
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
  const soon = drop.status === 'live' && (drop.live_at ?? 0) > Date.now()
  const open = drop.status === 'live' && shopIsOpen && counts.available > 0 && !soon
  const offerCart = { min: seller.offer_min_paise ?? 0, off: seller.offer_off_paise ?? 0, pct: seller.offer_pct ?? 0 }
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
      scripts={(open ? BUYER_JS : '') + cartJs(seller.id, t, offerCart) + (open ? ADD_SALE_JS : '') + (soon ? SOON_JS : '')}
      say={open ? t.sayBuyerSale : undefined}
      ok={c.req.query('ok')}
    >
      <a id="myorder" class="alert info" style="display:block;text-decoration:none" href="#" hidden>{t.yourOrder}</a>
      <CartBar t={t} sid={seller.id} />
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
      {offerCart.min > 0 && !offer && <div class="offerband"><Icon n="receipt" s={18} />{t.offerBanner(rupees(offerCart.min), offerCart.off ? rupees(offerCart.off) : `${offerCart.pct}%`)}</div>}
      {drop.description && <p style="white-space:pre-line;margin-top:12px">{drop.description}</p>}

      <Flash msg={c.req.query('err')} />

      {soon ? (
        <div class="card" style="text-align:center">
          <small>{t.dropSoon(liveWhen(drop.live_at, t.lang))}</small>
          <div class="countdown" id="soon" data-at={drop.live_at} style="margin:6px 0" />
          <small>{t.liveIn}</small>
        </div>
      ) : drop.status === 'live' && !shopIsOpen ? (
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
            {!offer && <button type="button" class="btn block" style="margin-top:8px" data-addsale={JSON.stringify({ d: drop.id, t: drop.title, p: drop.price_paise, img: drop.image_key, max: drop.max_per_order, labels: Object.fromEntries(variants.map((v) => [v.id, v.label])) })}><Icon n="bag" s={18} />{t.addToCart}</button>}
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
          <a class="btn block" href={seller.slug ? `/${seller.slug}` : `/s/${seller.id}`} style="margin-top:10px">{t.seeAllItems}</a>
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
  ({ closed: t.bErrClosed, qty: t.bErrQty(max), device: t.bErrDevice, stock: t.bErrStock, soon: t.dropSoonErr })[r]

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

const TrackCard = ({ t, sh }: { t: Dict; sh: ShipmentRow }) => {
  let scans: Scan[] = []
  try { scans = JSON.parse(sh.scans) } catch { scans = [] }
  return (
    <div class="card">
      <div class="row between"><b>{t.trackTitle}</b><span class={`chip ${sh.status === 'delivered' ? 'paid' : 'pending'}`}>{t.shipStatus[sh.status]}</span></div>
      {sh.awb && <small style="display:block;margin-top:2px">{t.shipAwb(sh.courier, sh.awb)}</small>}
      {sh.etd && sh.status !== 'delivered' && <small style="display:block;color:var(--ok);font-weight:700">{t.shipEtd(sh.etd)}</small>}
      {scans.length ? (
        <ol style="list-style:none;padding:0;margin:12px 0 0">
          {scans.slice(0, 8).map((x, i) => (
            <li class="row" style="gap:10px;align-items:flex-start;padding:6px 0">
              <span style={`flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px;background:${i ? 'var(--line)' : 'var(--ok)'}`} />
              <span><b style={`display:block;font-size:.92rem;${i ? 'font-weight:500' : ''}`}>{x.text}</b><small>{[x.place, x.at && courierDate(x.at)].filter(Boolean).join(' · ')}</small></span>
            </li>
          ))}
        </ol>
      ) : <p class="muted" style="margin:8px 0 0;font-size:.9rem">{t.trackNoScans}</p>}
      {sh.awb && <a class="btn sm block" style="margin-top:10px" href={`https://shiprocket.co/tracking/${sh.awb}`} target="_blank" rel="noopener">{t.trackCourier} ↗</a>}
    </div>
  )
}

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
  const discTotal = lines.reduce((n, l) => n + (l.disc_paise || 0), 0)
  // Shiprocket parcel (only if the seller booked one). Tracking older than 30 min refreshes in the background.
  const shipment = await c.env.DB.prepare(`SELECT * FROM shipments WHERE order_key = ? AND ${ACTIVE_SHIP} ORDER BY created_at DESC LIMIT 1`).bind(cartKeyOf(order)).first<ShipmentRow>()
  if (shipment?.awb && !['delivered', 'returned'].includes(shipment.status) && shipment.checked_at < Date.now() - 30 * 60_000) {
    c.executionCtx.waitUntil((async () => {
      const sr = await c.env.DB.prepare(`SELECT id, sr_email, sr_password_enc, sr_token_enc, sr_token_exp FROM sellers WHERE id = ?`).bind(shipment.seller_id).first<{ id: string; sr_email: string | null; sr_password_enc: string | null; sr_token_enc: string | null; sr_token_exp: number }>()
      if (sr?.sr_email) await applyTracking(c.env, shipment, await srTrack(c.env, await srToken(c.env, sr), shipment.awb!))
    })().catch((e) => console.error('track refresh', e)))
  }
  const codFee = order.pay_mode === 'cod' ? data.drop.cod_fee_paise || 0 : 0
  // Quick orders made by the seller may not have the address yet – ask for it here.
  const needDetails = !lines[0].address && ['pending', 'verifying', 'expired'].includes(status)

  return c.html(
    <Layout t={t} path={here(c)} brand={seller.shop_name} title={`${t.orderNo(shortNo(order.id))} – ${seller.shop_name}`}
      scripts={OS_JS + RETURN_JS + (['pending', 'verifying'].includes(status) ? ORDER_POLL_JS : '') +
        `try{var m=JSON.parse(localStorage.getItem('kk_orders')||'{}');m['${order.drop_id}']=location.pathname;localStorage.setItem('kk_orders',JSON.stringify(m))}catch(e){}` +
        (c.req.query('cart') ? `try{localStorage.removeItem('kk_cart_${seller.id}')}catch(e){}` : '')}
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
            <span>{rupees((l.unit_paise ?? l.price_paise) * l.qty)}</span>
          </div>
        ))}
        {shipTotal > 0 && <div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><span class="muted">{t.deliveryLine}</span><span>{rupees(shipTotal)}</span></div>}
        {codFee > 0 && <div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><span class="muted">{t.codChargeLine}</span><span>{rupees(codFee)}</span></div>}
        {discTotal > 0 && <div class="row between" style="padding:10px 0;border-top:1px solid var(--line);color:var(--ok)"><span>{t.offerLine}</span><span>−{rupees(discTotal)}</span></div>}
        {lines.length > 1 || shipTotal > 0 || codFee > 0 || discTotal > 0
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
      {shipment && <TrackCard t={t} sh={shipment} />}
      {status === 'paid' && (
        <div class="alert ok">
          {order.ship_status === 'delivered' ? t.deliveredTo : order.ship_status === 'shipped' ? t.sentTo : t.paidOk}
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
          {shipment && <TrackCard t={t} sh={shipment} />}
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
