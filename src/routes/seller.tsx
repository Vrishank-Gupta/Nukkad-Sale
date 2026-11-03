import { Hono } from 'hono'
import { raw } from 'hono/html'
import type { Context } from 'hono'
import type { Child, FC } from 'hono/jsx'
import type { AppEnv, Drop, Offer, Order, PayMode, Seller, ShipStatus, Variant } from '../env'
import { pctOff } from '../lib/offers'
import { TOOLS, toolOn, type Tool } from '../lib/tools'
import { ACTIVE_SHIP, applyTracking, mapStatus, srBook, srCancel, srLabel, srLogin, srNdr, srPickup, srPickups, srPincode, srRates, srToken, srTrack, ShiprocketError, type ShipmentRow } from '../lib/shiprocket'
import { dictFor, tr, type Dict } from '../i18n'
import { allowedEndpoint, pushEnabled, pushToSeller } from '../lib/push'
import { requireSeller } from '../lib/auth'
import { decrypt, encrypt, hashPin } from '../lib/crypto'
import { checkKeys, isTestKey } from '../lib/razorpay'
import { setPin } from '../lib/sellers'
import { notifyOwner } from '../lib/mail'
import { billingState, confirmInvoice, ensureInvoices, getSettings, onlineFeePayments, parseModes, startInvoicePayment, type Invoice } from '../lib/billing'
import { notifyBuyer } from '../lib/notify'
import { asPlan, higherPlans, planUsage, PLANS, requestUpgrade, upgradePaid, type PlanId, type Usage } from '../lib/plans'
import { upiAppLinks, upiLink } from '../lib/upi'
import { cancelCod, shownStatus, markPaid, cartKeyOf, cartOrders, dropCounts, loadDrop, markCartPaid, rejectCart, reserveOrder, shortNo } from '../lib/orders'
import { isValidVpa } from '../lib/upi'
import { clip, displayPhone, istDay, istDayStart, liveWhen, normalizePhone, parsePaise, randomId, rupees, waLink } from '../lib/util'
import { waBotEnabled, waEnabled } from '../lib/whatsapp'
import { ago, BASE_CSS, Empty, Flash, Icon, type IconName, InstallCard, Layout, PhoneInput, PinInput, ShipSteps, StatusChip, Stepper, StockBar, StockSummary, type Nav } from '../views/layout'
import { here, OS_JS } from './public'

export const app = new Hono<AppEnv>()
app.use('*', requireSeller)

// While the plan fee is overdue the shop is paused. Paying, finishing orders already placed,
// help and settings stay open, so buyers who already ordered are never left hanging.
const OPEN_WHEN_PAUSED = /^\/app\/(billing|orders|proof|help|settings|pin|pulse\.json)(\/|$)/
app.use('*', async (c, next) => {
  if (OPEN_WHEN_PAUSED.test(c.req.path)) return next()
  const bill = await billingState(c.env, c.get('seller').id)
  if (bill.overdue && bill.open) {
    if (c.req.method !== 'GET') return c.redirect('/app/billing', 303)
    return pausedPage(c, bill.open)
  }
  // Plan limit reached: the shop stops taking orders until the seller upgrades (or the month resets).
  const s = c.get('seller')
  const use = await planUsage(c.env, s.id, asPlan(s.plan))
  if (!use.reached) return next()
  if (c.req.method !== 'GET') return c.redirect('/app/billing', 303)
  return limitPage(c, use)
})

/** Plan cards with an upgrade button for every plan above the seller's. */
const UpgradeOptions: FC<{ t: Dict; current: PlanId; primaryFirst?: boolean }> = ({ t, current, primaryFirst = true }) => (
  <div class="stack">
    {higherPlans(current).map((p, i) => (
      <form method="post" action="/app/billing/upgrade" class="card stack" style={i === 0 && primaryFirst ? 'border:2px solid var(--brand)' : ''}>
        <input type="hidden" name="plan" value={p} />
        <div class="row between"><b style="font-size:1.1rem">{t.planNames[p]}</b><b>{t.planPrice(rupees(PLANS[p].fee))}</b></div>
        <small class="muted" style="margin-top:-6px">{t.planLimit(PLANS[p].limit)}{p === 'badi' ? ` · ${t.planExtraBadi}` : ''}</small>
        <button class={`btn block ${i === 0 && primaryFirst ? 'primary big' : ''}`} type="submit">{t.upgradeLabel(t.planNames[p])}</button>
      </form>
    ))}
  </div>
)

function limitPage(c: Context<AppEnv>, use: Usage) {
  const t = tr(c)
  const s = c.get('seller')
  return c.html(
    <Layout t={t} path={here(c)} nav="home" title={t.limitTitle(use.limit ?? 0)} brand={s.shop_name}>
      <div class="card stack" style="text-align:center;border:2px solid var(--warn);margin-top:16px">
        <div style="color:var(--warn);display:flex;justify-content:center"><Icon n="pause" s={44} /></div>
        <h1 style="margin:0">{t.limitTitle(use.limit ?? 0)}</h1>
        <p style="margin:0">{t.limitBody}</p>
        <small class="muted">{t.planOn(t.planNames[use.plan])} · {t.planLimit(use.limit)}</small>
      </div>
      <h2>{t.plansTitle}</h2>
      <UpgradeOptions t={t} current={use.plan} />
      <small class="muted" style="display:block;margin-top:8px">{t.upgradeNote}</small>
      <p class="muted" style="margin-top:12px">{t.limitWait(fmtDate(use.resetsAt))} {t.pausedSafe}</p>
      <a class="btn block" href="/app/orders" style="margin-top:12px">{t.pausedOrders}</a>
      {c.env.SUPPORT_PHONE && <a class="btn block wa" href={waLink(c.env.SUPPORT_PHONE, t.pausedHelpMsg(s.shop_name))} style="margin-top:10px"><Icon n="chat" s={18} />{t.pausedHelp}</a>}
    </Layout>,
  )
}

/** "18 of 30 orders used this month" with a bar – home and the plan page. */
const PlanMeter: FC<{ t: Dict; use: Usage; link?: boolean }> = ({ t, use, link }) => {
  const pctUsed = use.limit ? Math.min(100, Math.round((use.used / use.limit) * 100)) : 0
  const body = (
    <>
      <div class="row between"><b>{t.planOn(t.planNames[use.plan])}</b>{use.limit !== null && <small class="muted">{t.planLeft(use.left ?? 0)}</small>}</div>
      {use.limit !== null ? (
        <>
          <div style="height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin:8px 0 6px"><div style={`height:100%;width:${pctUsed}%;background:var(--${use.reached ? 'bad' : use.near ? 'warn' : 'ok'})`} /></div>
          <small>{t.planUsed(use.used, use.limit)} · {t.planResets(fmtDate(use.resetsAt))}</small>
        </>
      ) : <small style="display:block;margin-top:4px">{t.planUnlimitedNow}</small>}
    </>
  )
  return link ? <a class="card" href="/app/billing" style="display:block;text-decoration:none;color:inherit">{body}</a> : <div class="card">{body}</div>
}

function pausedPage(c: Context<AppEnv>, inv: Invoice) {
  const t = tr(c)
  const s = c.get('seller')
  return c.html(
    <Layout t={t} path={here(c)} nav="home" title={t.pausedTitle} brand={s.shop_name}>
      <div class="card stack" style="text-align:center;border:2px solid var(--bad);margin-top:16px">
        <div style="color:var(--bad);display:flex;justify-content:center"><Icon n="pause" s={44} /></div>
        <h1 style="margin:0">{t.pausedTitle}</h1>
        <p style="margin:0">{t.pausedBody(rupees(inv.amount_paise), monthName(inv.period, t))}</p>
        <a class="btn primary block big" href="/app/billing">{t.payNow}</a>
        <small class="muted">{t.pausedSafe}</small>
      </div>
      <a class="btn block" href="/app/orders" style="margin-top:12px">{t.pausedOrders}</a>
      {c.env.SUPPORT_PHONE && <a class="btn block wa" href={waLink(c.env.SUPPORT_PHONE, t.pausedHelpMsg(s.shop_name))} style="margin-top:10px"><Icon n="chat" s={18} />{t.pausedHelp}</a>}
    </Layout>,
  )
}

const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const enc = encodeURIComponent

const attentionCount = async (db: D1Database, sellerId: string) =>
  (await db.prepare(`SELECT COUNT(DISTINCT COALESCE(cart_id, id)) AS n FROM orders WHERE seller_id = ? AND (status IN ('verifying', 'refund_due') OR (status = 'pending' AND pay_mode = 'cod' AND ship_status = 'new'))`).bind(sellerId).first<{ n: number }>())?.n ?? 0

/** Go back to the page the seller tapped from, carrying a success message for the toast. */
function backWith(c: Context<AppEnv>, fallback: string, ok: string) {
  const ref = c.req.header('Referer')
  const url = new URL(ref && new URL(ref).pathname.startsWith('/app') ? ref : new URL(fallback, c.req.url).href)
  url.searchParams.set('ok', ok)
  url.searchParams.delete('err')
  return c.redirect(url.pathname + url.search, 303)
}

/** Every dashboard page shares the same frame: bottom nav, attention badge, toast, live refresh. */
// Pages laid out in two columns on a computer.
const WIDE = /^\/app(\/|\/orders|\/drops\/[a-z0-9]+|\/buyers)?$/
async function page(c: Context<AppEnv>, nav: Nav, title: string, body: Child, scripts = PULSE_JS, say?: string) {
  const t = tr(c)
  const s = c.get('seller')
  const [badge, bill, use] = await Promise.all([attentionCount(c.env.DB, s.id), billingState(c.env, s.id), planUsage(c.env, s.id, asPlan(s.plan))])
  const keysMissing = s.pay_mode === 'razorpay' && !s.rzp_secret_enc
  return c.html(
    <Layout t={t} path={here(c)} nav={nav} badge={badge} title={title} brand={s.shop_name} ok={c.req.query('ok')} scripts={scripts} say={say} wide={WIDE.test(c.req.path) && c.req.path !== '/app/drops/new'}>
      {s.account_status === 'suspended' && <div class="alert bad">{t.accountSuspended}</div>}
      {bill.open && !c.req.path.startsWith('/app/billing') && (
        <a class={`alert ${bill.overdue ? 'bad' : 'info'}`} href="/app/billing" style="display:block;text-decoration:none">
          {bill.open.plan ? (bill.open.status === 'claimed' ? t.feeClaimed : t.upgradeDue(t.planNames[bill.open.plan], rupees(bill.open.amount_paise))) : bill.overdue ? t.feeOverdue(rupees(bill.open.amount_paise)) : bill.open.status === 'claimed' ? t.feeClaimed : t.feeDue(rupees(bill.open.amount_paise), monthName(bill.open.period, t), fmtDate(bill.open.due_at))}
          {bill.open.status === 'due' && <b style="display:block;margin-top:4px">{t.payNow}</b>}
        </a>
      )}
      {keysMissing && <a class="alert bad" href="/app/settings" style="display:block;text-decoration:none">{t.needKeys}</a>}
      {use.near && !use.reached && use.limit !== null && !c.req.path.startsWith('/app/billing') && (
        <a class="alert warn" href="/app/billing" style="display:block;text-decoration:none">{t.nearLimit(use.left ?? 0, use.limit)}<b style="display:block;margin-top:4px">{t.upgradeLabel(t.planNames[higherPlans(use.plan)[0] ?? 'badi'])}</b></a>
      )}
      {bill.open?.status === 'due' && !bill.open.plan && !bill.overdue && !c.req.path.startsWith('/app/billing') && (
        // Once a day until the due date: a popup that's hard to miss, with one tap to pay.
        <div class="modal" id="feepop" hidden data-key={`kk_fee_${bill.open.id}_${istDay(Date.now())}`}>
          <div class="card stack" role="dialog" aria-modal="true" aria-labelledby="feepop-t">
            <b id="feepop-t" style="font-size:1.05rem;display:flex;gap:8px;align-items:center"><Icon n="receipt" />{t.popTitle}</b>
            <p style="margin:0">{t.popBody(rupees(bill.open.amount_paise), fmtDate(bill.open.due_at))}</p>
            <a class="btn primary block big" href="/app/billing">{t.payNow}</a>
            <button class="btn block ghost" type="button" data-close>{t.popLater}</button>
          </div>
          <script>{raw(`(function(){var m=document.getElementById('feepop'),k=m.dataset.key;try{if(localStorage.getItem(k))return}catch(e){}m.hidden=false;m.querySelector('[data-close]').onclick=function(){m.hidden=true;try{localStorage.setItem(k,'1')}catch(e){}}})()`)}</script>
        </div>
      )}
      {body}
    </Layout>,
  )
}

const fmtDate = (ms: number) => istDay(ms).split('-').reverse().join('/')
const monthName = (period: string, t: Dict) => new Date(period.slice(0, 7) + '-01T00:00:00Z').toLocaleString(t.lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** New sales pause while the plan fee is overdue or the shop is suspended (existing sales keep working). */
async function salesBlocked(c: Context<AppEnv>) {
  const s = c.get('seller')
  if (s.account_status === 'suspended') return tr(c).accountSuspended
  if ((await billingState(c.env, s.id)).overdue) return tr(c).salesPaused
  const use = await planUsage(c.env, s.id, asPlan(s.plan))
  return use.reached ? tr(c).limitSales(use.limit ?? 0) : null
}

// Polls a cheap fingerprint of the seller's orders and offers a refresh when anything changes.
const PULSE_JS = `(function(){var v=null,n=null;function t(){if(document.hidden)return;fetch('/app/pulse.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
if(n!==null&&d.n>n)say(d.say);n=d.n;
if(v!==null&&d.v!==v&&!document.getElementById('pulse')){var a=document.createElement('a');a.id='pulse';a.href=location.pathname+location.search;a.className='toast';a.style.textDecoration='none';a.textContent=d.msg;document.body.appendChild(a)}v=d.v}).catch(function(){})}
t();setInterval(t,10000)})();`

app.get('/pulse.json', async (c) => {
  const r = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(created_at), 0) AS c, COALESCE(MAX(paid_at), 0) AS p, COALESCE(SUM(status = 'verifying'), 0) AS v FROM orders WHERE seller_id = ?`)
    .bind(c.get('seller').id)
    .first<Record<string, number>>()
  return c.json({ v: r ? `${r.n}.${r.c}.${r.p}.${r.v}` : '', n: r?.n ?? 0, msg: tr(c).newActivity, say: tr(c).soundNew }, 200, { 'Cache-Control': 'no-store' })
})

// ---------- Home ----------

type DropRow = Drop & { stock: number; available: number; sold: number }

const SaleChip: FC<{ t: Dict; d: { status: string; available: number } }> = ({ t, d }) =>
  d.status === 'closed' ? <span class="chip closed">{t.closed}</span> : d.available < 1 ? <span class="chip sold">{t.soldOut}</span> : <span class="chip live">{t.live}</span>

const Task: FC<{ href: string; kind: string; icon: IconName; title: string; sub?: string }> = (p) => (
  <a class={`card task ${p.kind}`} href={p.href}>
    <span class="ic"><Icon n={p.icon} /></span>
    <span><b>{p.title}</b>{p.sub && <small>{p.sub}</small>}</span>
    <span class="go"><Icon n="chevron" s={18} /></span>
  </a>
)

app.get('/', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const db = c.env.DB
  const [{ results: drops }, today, counts] = await Promise.all([
    db.prepare(
      `SELECT d.*, (SELECT SUM(stock) FROM variants WHERE drop_id = d.id) AS stock, (SELECT SUM(available) FROM variants WHERE drop_id = d.id) AS available,
              (SELECT COALESCE(SUM(qty), 0) FROM orders WHERE drop_id = d.id AND status = 'paid') AS sold
       FROM drops d WHERE d.seller_id = ? ORDER BY d.status = 'closed', d.created_at DESC LIMIT 50`,
    ).bind(s.id).all<DropRow>(),
    db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS amt, COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'paid' AND paid_at >= ?`)
      .bind(s.id, istDayStart(Date.now())).first<{ amt: number; n: number }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT CASE WHEN status = 'verifying' THEN COALESCE(cart_id, id) END) AS checkPay,
              COUNT(DISTINCT CASE WHEN status = 'refund_due' THEN COALESCE(cart_id, id) END) AS refunds,
              COUNT(DISTINCT CASE WHEN ${TO_SEND} THEN COALESCE(o.cart_id, o.id) END) AS toSend,
              COUNT(DISTINCT CASE WHEN status = 'pending' AND hold_until > ?2 THEN COALESCE(cart_id, id) END) AS paying
       FROM orders o WHERE seller_id = ?1`,
    ).bind(s.id, Date.now()).first<{ checkPay: number; refunds: number; toSend: number; paying: number }>(),
  ])
  const n = counts ?? { checkPay: 0, refunds: 0, toSend: 0, paying: 0 }
  // The week at a glance: daily sales for the last 7 IST days, buyers, money not yet confirmed.
  const weekStart = istDayStart(Date.now()) - 6 * 86_400_000
  const [{ results: week }, people, waiting, ever, { results: backIn }, shipAttn] = await Promise.all([
    db.prepare(`SELECT paid_at, amount_paise FROM orders WHERE seller_id = ? AND status = 'paid' AND paid_at >= ?`).bind(s.id, weekStart).all<{ paid_at: number; amount_paise: number }>(),
    db.prepare(`SELECT COUNT(*) AS buyers, COALESCE(SUM(n > 1), 0) AS repeat FROM (SELECT COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'paid' GROUP BY buyer_phone)`).bind(s.id).first<{ buyers: number; repeat: number }>(),
    db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS amt FROM orders WHERE seller_id = ? AND status IN ('pending', 'verifying') AND pay_mode = 'direct'`).bind(s.id).first<{ amt: number }>(),
    db.prepare(`SELECT COUNT(*) AS anyo, COALESCE(SUM(status = 'paid'), 0) AS paid FROM orders WHERE seller_id = ?`).bind(s.id).first<{ anyo: number; paid: number }>(),
    // Buyers who asked to be told – shown only once the sale has stock again.
    db.prepare(`SELECT w.drop_id, COUNT(*) AS n FROM waitlist w JOIN drops d ON d.id = w.drop_id
                WHERE w.seller_id = ? AND w.notified_at IS NULL AND d.status = 'live' AND (SELECT SUM(available) FROM variants WHERE drop_id = d.id) > 0
                GROUP BY w.drop_id ORDER BY n DESC`).bind(s.id).all<{ drop_id: string; n: number }>(),
    // Shiprocket parcels the seller must act on: failed delivery, or returned and not yet restocked.
    s.sr_email ? db.prepare(`SELECT COUNT(*) AS n FROM shipments WHERE seller_id = ? AND (status = 'failed' OR (status = 'returned' AND status_text <> 'restocked'))`).bind(s.id).first<{ n: number }>() : Promise.resolve({ n: 0 }),
  ])
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i * 86_400_000)
  const perDay = days.map((d) => week.filter((o) => o.paid_at >= d && o.paid_at < d + 86_400_000).reduce((x, o) => x + o.amount_paise, 0))
  const weekTotal = perDay.reduce((a, b) => a + b, 0)
  const peak = Math.max(1, ...perDay)
  const dayLabel = (ms: number) => new Date(ms + 6 * 3600_000).toLocaleDateString(t.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'narrow', timeZone: 'Asia/Kolkata' })
  const backInN = toolOn(s, 'waitlist') ? backIn.reduce((a, b) => a + b.n, 0) : 0
  const shipN = shipAttn?.n ?? 0
  const anyTask = n.checkPay + n.refunds + n.toSend + n.paying + backInN + shipN > 0
  // Getting started: shown until the first confirmed payment, then the money card takes over.
  const setup: { done: boolean; label: string; href?: string }[] = [
    { done: true, label: t.gsShop },
    { done: !s.temp_pin, label: t.gsPin, href: '/app/settings#pin' },
    { done: drops.length > 0, label: t.gsSale, href: '/app/drops/new' },
    { done: (ever?.anyo ?? 0) > 0, label: t.gsShare, href: drops[0] ? `/app/drops/${drops[0].id}#share` : '/app/drops/new' },
    { done: (ever?.paid ?? 0) > 0, label: t.gsFirstPaid, href: '/app/orders?tab=check' },
  ]
  const started = (ever?.paid ?? 0) > 0
  const next = setup.find((x) => !x.done)
  const doneN = setup.filter((x) => x.done).length

  const use = await planUsage(c.env, s.id, asPlan(s.plan))
  return page(c, 'home', s.shop_name, (
    <>
      <h1 class="vh">{s.shop_name}</h1>
      <p class="muted" style="margin:6px 0 0">{t.namaste(s.name.split(' ')[0])}</p>
      {use.limit !== null && <PlanMeter t={t} use={use} link />}
      {started && s.temp_pin ? (
        <div class="alert info row between" style="gap:10px"><span class="row" style="gap:8px;align-items:flex-start"><Icon n="key" s={18} />{t.tempPinBanner}</span><a class="btn sm" href="/app/settings#pin" style="flex:none">{t.changePinBtn}</a></div>
      ) : null}
      {started ? (
        <div class="card" style="background:var(--brand-soft);border-color:transparent">
          <small>{t.todayEarned}</small>
          <div class="stat">{rupees(today?.amt ?? 0)}</div>
          <small>{t.ordersToday(today?.n ?? 0)}</small>
          {(waiting?.amt ?? 0) > 0 && <a href="/app/orders?tab=check" class="row" style="gap:6px;margin-top:8px;color:var(--warn);font-weight:700;text-decoration:none;font-size:.88rem"><Icon n="clock" s={16} />{t.moneyWaiting(rupees(waiting!.amt))}</a>}
        </div>
      ) : (
        <div class="card setup">
          <div class="row between"><b>{t.gsTitle}</b><small>{t.gsProgress(doneN, setup.length)}</small></div>
          <div class="meter" role="progressbar" aria-valuenow={doneN} aria-valuemin={0} aria-valuemax={setup.length}><i style={`width:${Math.round((doneN / setup.length) * 100)}%`} /></div>
          <ol class="setuplist">
            {setup.map((x) => (
              <li class={x.done ? 'done' : x === next ? 'next' : ''}>
                {x.done ? <span class="tick"><Icon n="check" s={14} /></span> : <span class="dot" />}
                {x.href && !x.done ? <a href={x.href}><span>{x.label}</span>{x === next && <Icon n="chevron" s={18} />}</a> : <span>{x.label}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <InstallCard t={t} />

      {drops.length === 0 ? (
        <>
          <a class="btn primary block big" href="/app/drops/new" style="margin-top:6px">{t.createFirst}</a>
        </>
      ) : (
        <div class="cols"><div>
          <h2>{t.attention}</h2>
          {n.checkPay > 0 && <Task href="/app/orders?tab=check" kind="info" icon="search" title={t.toCheck(n.checkPay)} sub={t.toCheckSub} />}
          {n.refunds > 0 && <Task href="/app/orders?tab=check" kind="bad" icon="refund" title={t.refunds(n.refunds)} sub={t.refundsSub} />}
          {n.toSend > 0 && <Task href="/app/orders?tab=send" kind="warn" icon="box" title={t.toSend(n.toSend)} sub={t.toSendSub} />}
          {n.paying > 0 && <Task href="/app/orders?tab=check" kind="" icon="clock" title={t.notPaid(n.paying)} sub={t.notPaidSub} />}
          {shipN > 0 && <Task href="/app/orders?tab=done" kind="bad" icon="box" title={t.shipAttn(shipN)} sub={t.shipAttnSub} />}
          {backInN > 0 && <Task href={`/app/drops/${backIn[0].drop_id}#waiting`} kind="warn" icon="users" title={t.taskWaiting(backInN)} sub={t.taskWaitingSub} />}
          {!anyTask && <p class="muted">{t.allDone}</p>}

          <a class="btn primary block big" href="/app/drops/new" style="margin:18px 0 6px">{t.newSale}</a>
          <a class="btn block" href="/app/quick-order" style="margin-bottom:6px">{t.qoBtn}</a>

          <a class="card" href="/app/khata" style="display:block;text-decoration:none;color:inherit">
            <div class="row between"><b>{t.weekTitle}</b><b style="font-size:1.3rem">{rupees(weekTotal)}</b></div>
            {weekTotal > 0 ? (
              <>
                <div class="weekbars" role="img" aria-label={t.weekTitle}>
                  {perDay.map((v, i) => (
                    <span><i style={`height:${Math.max(4, Math.round((v / peak) * 64))}px;${i === 6 ? 'background:var(--brand)' : ''}`} /><small>{dayLabel(days[i])}</small></span>
                  ))}
                </div>
                <small>{t.weekOrders(week.length, rupees(week.length ? Math.round(weekTotal / week.length) : 0))}</small>
              </>
            ) : <p class="muted" style="margin:8px 0 2px;font-size:.9rem">{t.weekEmpty}</p>}
          </a>
          {(people?.buyers ?? 0) > 0 && <a class="card task" href="/app/buyers"><span class="ic"><Icon n="users" /></span><span><b>{t.buyersLink(people?.buyers ?? 0, people?.repeat ?? 0)}</b></span><span class="go">›</span></a>}


          </div><div>
          <h2>{t.yourSales}</h2>
          {drops.map((d) => (
            <div class="card">
              <a class="row" href={`/app/drops/${d.id}`} style="text-decoration:none;color:inherit">
                {d.image_key ? <img class="thumb" src={`/img/${d.image_key}`} alt="" loading="lazy" /> : <div class="thumb"><Icon n="bag" s={22} /></div>}
                <div class="grow">
                  <div class="row between"><b>{clip(d.title, 30)}</b><SaleChip t={t} d={d} /></div>
                  <small>{rupees(d.price_paise)} · {t.soldOf(d.sold, d.stock)}</small>
                  <div style="margin-top:8px"><StockBar stock={d.stock} sold={d.sold} held={Math.max(0, d.stock - d.available - d.sold)} /></div>
                </div>
              </a>
              {d.status === 'live' && d.available > 0 && (
                <a class="btn wa sm block" style="margin-top:12px" href={`/app/drops/${d.id}#share`}>{t.shareAgain}</a>
              )}
            </div>
          ))}
        </div></div>
      )}
    </>
  ), PULSE_JS, t.sayHome)
})

// ---------- New sale ----------

const NEW_DROP_JS = `(function(){
var inp=document.getElementById('image'),box=document.getElementById('photo'),prev=document.getElementById('prev'),strip=document.getElementById('strip');
// Shrink phone photos (often 4–8 MB) to ~150 KB before upload: faster on mobile data and keeps storage in the free tier.
function shrink(f){return (window.createImageBitmap?createImageBitmap(f):Promise.reject()).then(function(b){var s=Math.min(1,1080/Math.max(b.width,b.height)),cv=document.createElement('canvas');
 cv.width=Math.round(b.width*s);cv.height=Math.round(b.height*s);cv.getContext('2d').drawImage(b,0,0,cv.width,cv.height);
 return new Promise(function(res){cv.toBlob(function(o){res(o&&o.size<f.size?new File([o],'photo.jpg',{type:'image/jpeg'}):f)},'image/jpeg',0.82)})}).catch(function(){return f})}
// Gallery picks replace the photos; each camera shot is added (up to 5). Everything is sent through #image.
var cam=document.getElementById('cam'),picked=[];
function show(){prev.src=URL.createObjectURL(picked[0]);box.classList.add('has');strip.innerHTML='';picked.forEach(function(f){var i=document.createElement('img');i.alt='';i.src=URL.createObjectURL(f);strip.appendChild(i)})}
function apply(){if(!window.DataTransfer)return;Promise.all(picked.map(shrink)).then(function(out){var dt=new DataTransfer();out.forEach(function(o){dt.items.add(o)});inp.files=dt.files})}
inp.addEventListener('change',function(){var fs=[].slice.call(inp.files,0,5);if(!fs.length)return;picked=fs;show();apply()});
if(cam){if(!window.DataTransfer)cam.name='image';cam.addEventListener('change',function(){var f=cam.files&&cam.files[0];if(!f)return;picked=picked.concat([f]).slice(-5);show();apply()})}
var sizes=document.getElementById('sizes'),list=document.getElementById('sizelist'),one=document.getElementById('stockbox'),tpl=document.getElementById('sizerow');
function row(l,q){var d=tpl.content.firstElementChild.cloneNode(true);d.querySelector('[name=size_label]').value=l||'';if(q)d.querySelector('[name=size_qty]').value=q;list.appendChild(d)}
var pre=document.querySelector('form[data-sizes]');if(pre){document.getElementById('hs1').checked=true;JSON.parse(pre.dataset.sizes).forEach(function(s){row(s.l,s.q)})}
function sync(){var many=document.getElementById('hs1').checked;sizes.hidden=!many;one.hidden=many;document.getElementById('stock').required=!many;if(many&&!list.children.length){row('S');row('M');row('L')}}
document.querySelectorAll('[name=has_sizes]').forEach(function(r){r.addEventListener('change',sync)});sync();
document.getElementById('addsize').onclick=function(){row('')};
sizes.addEventListener('click',function(e){var rm=e.target.closest('[data-rm]');if(rm)rm.closest('.sizerow').remove();var p=e.target.dataset.preset;if(p){list.innerHTML='';p.split(',').forEach(row)}});
})();`

app.get('/drops/new', async (c) => {
  const t = tr(c)
  const cats = (await c.env.DB.prepare(`SELECT DISTINCT category FROM drops WHERE seller_id = ? AND category <> '' ORDER BY category LIMIT 20`).bind(c.get('seller').id).all<{ category: string }>()).results.map((r) => r.category)
  const blocked = await salesBlocked(c)
  if (blocked) return page(c, 'home', t.newSaleTitle, (
    <>
      <a class="back" href="/app">{t.backHome}</a>
      <div class="alert bad" style="margin-top:14px">{blocked}</div>
      {c.get('seller').account_status === 'active' && <a class="btn primary block big" href="/app/billing">{t.payNow}</a>}
    </>
  ))
  // "Sell again": start from an earlier sale – photo, text, price and sizes filled in.
  const from = c.req.query('from') ? await loadDrop(c.env.DB, c.req.query('from')!) : null
  const pre = from && from.drop.seller_id === c.get('seller').id ? from : null
  const preSizes = pre && (pre.variants.length > 1 || pre.variants[0].label) ? pre.variants.map((v) => ({ l: v.label, q: v.stock })) : null
  const upis = await sellerUpis(c.env.DB, c.get('seller').id)
  return page(c, 'home', t.newSaleTitle, (
    <>
      <a class="back" href="/app">{t.backHome}</a>
      <h1>{t.newSaleTitle}</h1>
      <Flash msg={c.req.query('err')} />
      <form method="post" enctype="multipart/form-data" data-sizes={preSizes ? JSON.stringify(preSizes) : undefined}>
        {pre?.images.map((k) => <input type="hidden" name="reuse_image" value={k} />)}
        <div class="sec"><span class="num">1</span>{t.stepPhoto}</div>
        <label class={`photo${pre?.images.length ? ' has' : ''}`} id="photo" for="image">
          <img id="prev" alt="" src={pre?.images[0] ? `/img/${pre.images[0]}` : undefined} />
          <span class="ph ic"><Icon n="camera" s={34} /></span>
          <span class="ph">{t.tapPhoto}</span>
          <span class="chg">{t.changePhoto}</span>
          <input id="image" name="image" type="file" accept="image/*" multiple />
        </label>
        {/* Android hides the camera when a picker allows several files, so the camera gets its own button. */}
        <div class="row" style="margin-top:10px;gap:8px">
          <label class="btn grow" for="cam" style="margin:0"><Icon n="camera" s={18} />{t.takePhoto}</label>
          <label class="btn grow" for="image" style="margin:0"><Icon n="image" s={18} />{t.fromGallery}</label>
          <input id="cam" type="file" accept="image/*" capture="environment" style="position:absolute;opacity:0;width:1px;height:1px;min-height:0" />
        </div>
        <div class="photos" id="strip">{pre?.images.map((k) => <img src={`/img/${k}`} alt="" />)}</div>
        <div class="hint">{t.photosHint}</div>

        <div class="sec"><span class="num">2</span>{t.stepWhat}</div>
        <div class="stack">
          <div><label for="title">{t.productName}</label><input id="title" name="title" required maxlength={80} placeholder={t.productNamePh} value={pre?.drop.title} /></div>
          <div><label for="description">{t.details}</label><textarea id="description" name="description" maxlength={1000} placeholder={t.detailsPh}>{pre?.drop.description ?? ''}</textarea></div>
          <div><label for="category">{t.categoryLabel}</label><input id="category" name="category" maxlength={30} list="cats" placeholder={t.categoryPh} value={pre?.drop.category || undefined} />
            <datalist id="cats">{cats.map((x) => <option value={x} />)}</datalist></div>
        </div>

        <div class="sec"><span class="num">3</span>{t.stepPrice}</div>
        <div class="money"><span>₹</span><input id="price" name="price" inputmode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" required placeholder="799" value={pre ? String((pre.drop.compare_paise > pre.drop.price_paise ? pre.drop.compare_paise : pre.drop.price_paise) / 100) : undefined} aria-label={t.stepPrice} /></div>
        {toolOn(c.get('seller'), 'profit') && <details class="quiet" style="margin-top:8px" open={Boolean(pre?.drop.cost_paise)}>
          <summary><u>{t.addCostLink}</u></summary>
          <label for="cost">{t.costLabel}</label>
          <div class="money"><span>₹</span><input id="cost" name="cost" inputmode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" placeholder="0" value={pre?.drop.cost_paise ? String(pre.drop.cost_paise / 100) : undefined} /></div>
          <small>{t.costHint}</small>
        </details>}

        <div class="sec"><span class="num">4</span>{t.stepStock}</div>
        <div class="pills two" style="margin-bottom:12px">
          <input type="radio" name="has_sizes" id="hs0" value="" checked /><label for="hs0">{t.oneType}</label>
          <input type="radio" name="has_sizes" id="hs1" value="1" /><label for="hs1">{t.manySizes}</label>
        </div>
        <div id="stockbox" style="max-width:260px"><Stepper id="stock" name="stock" value={pre && !preSizes ? pre.variants[0].stock : 10} min={1} max={10000} label={t.quantity} /></div>
        <div id="sizes" hidden class="card">
          <div class="row wrap" style="margin-bottom:12px">
            <small>{t.quickFill}</small>
            <button type="button" class="btn sm" data-preset="S,M,L,XL">S M L XL</button>
            <button type="button" class="btn sm" data-preset="28,30,32,34,36">28–36</button>
            <button type="button" class="btn sm" data-preset={t.freeSize}>{t.freeSize}</button>
            <button type="button" class="btn sm" data-preset="250g,500g,1kg">250g 500g 1kg</button>
          </div>
          <div id="sizelist" />
          <template id="sizerow">
            <div class="row sizerow" style="margin-bottom:10px">
              <input name="size_label" placeholder={t.sizeName} maxlength={20} style="flex:1;min-width:0" aria-label={t.sizeName} />
              <Stepper id="" name="size_qty" value={1} min={0} max={10000} compact label={t.quantity} />
              <button type="button" class="btn sm ghost" data-rm aria-label="Remove" style="padding:0 6px;border:0;min-width:44px"><Icon n="x" s={18} /></button>
            </div>
          </template>
          <button type="button" id="addsize" class="btn sm block">{t.addSize}</button>
        </div>

        {upis.length > 1 && (
          <>
            <div class="sec"><span class="num">5</span>{t.upiForSale}</div>
            <select name="upi" aria-label={t.upiForSale}>
              {upis.map((u) => <option value={u.vpa} selected={u.vpa === (pre?.drop.upi_vpa ?? c.get('seller').upi_vpa)}>{u.vpa}{u.label ? ` – ${u.label}` : ''}</option>)}
            </select>
          </>
        )}
        <div class="sec"><span class="num" style="background:var(--muted)"><Icon n="box" s={14} /></span>{t.shipLabel}</div>
        <div class="duo" style="gap:10px">
          <div><small style="display:block;margin-bottom:4px">{t.shipPerOrder}</small><span class="money"><span>₹</span><input name="ship_fee" inputmode="decimal" placeholder="0" value={pre?.drop.ship_fee_paise ? String(pre.drop.ship_fee_paise / 100) : ''} aria-label={t.shipLabel} /></span></div>
          <div><small style="display:block;margin-bottom:4px">{t.freeShipLabel}</small><span class="money"><span>₹</span><input name="free_ship_above" inputmode="decimal" placeholder="—" value={pre?.drop.free_ship_above_paise ? String(pre.drop.free_ship_above_paise / 100) : ''} aria-label={t.freeShipLabel} /></span></div>
        </div>
        <div class="hint">{t.shipHint}</div>
        <label class="choice" style="margin-top:18px">
          <input type="checkbox" name="cod" value="1" checked={Boolean(pre?.drop.cod_enabled)} data-codtoggle />
          <span class="grow">
            <b style="display:flex;gap:8px;align-items:center"><Icon n="cash" s={18} />{t.codLabel}</b>
            <small style="display:block;margin-top:2px">{t.codHint}</small>
            <span data-codfee hidden={!pre?.drop.cod_enabled} style="display:block;margin-top:10px;max-width:220px">
              <small style="display:block;margin-bottom:4px">{t.codFeeLabel}</small>
              <span class="money"><span>₹</span><input name="cod_fee" inputmode="decimal" placeholder="0" value={pre?.drop.cod_fee_paise ? String(pre.drop.cod_fee_paise / 100) : ''} aria-label={t.codFeeLabel} /></span>
            </span>
          </span>
        </label>
        <script>{raw(`document.querySelectorAll('[data-codtoggle]').forEach(function(c){c.addEventListener('change',function(){c.closest('label').querySelector('[data-codfee]').hidden=!c.checked})})`)}</script>
        <details style="margin-top:12px">
          <summary>{t.moreOptions}</summary>
          <label for="max">{t.maxPer}</label>
          <div style="max-width:260px"><Stepper id="max" name="max" value={pre?.drop.max_per_order ?? 5} min={1} max={20} /></div>
          {c.get('seller').sr_email && <><label for="wg" style="margin-top:14px">{t.shipWeight}</label><input id="wg" name="weight_g" inputmode="numeric" placeholder="500" style="max-width:200px" value={pre?.drop.weight_g ? String(pre.drop.weight_g) : undefined} /></>}
          <label for="liveat" style="margin-top:14px">{t.goLiveLabel}</label>
          <input id="liveat" name="live_at" type="datetime-local" style="max-width:260px" />
          <small>{t.goLiveHint}</small>
        </details>
        <div class="sticky-pay">
          <button type="submit" class="btn primary block big">{t.publish}</button>
        </div>
      </form>
    </>
  ), NEW_DROP_JS, t.sayNewSale)
})

app.post('/drops/new', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  if (await salesBlocked(c)) return c.redirect('/app/drops/new', 303)
  const f = await c.req.parseBody({ all: true })
  const fail = (m: string) => c.redirect('/app/drops/new?err=' + enc(m), 303)
  const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim()
  const many = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => String(x).trim())

  const title = one(f.title).slice(0, 80)
  const description = one(f.description).slice(0, 1000)
  const price = parsePaise(one(f.price))
  const maxPer = Math.min(20, Math.max(1, Math.floor(Number(one(f.max)) || 5)))
  const category = one(f.category).trim().replace(/\s+/g, ' ').slice(0, 30)
  // The phone sends local time (India): '2026-11-05T21:00'. Only future times count.
  const liveAtRaw = one(f.live_at) ? Date.parse(one(f.live_at) + ':00+05:30') : 0
  const liveAt = liveAtRaw > Date.now() + 60_000 ? liveAtRaw : 0
  if (!title) return fail(t.needName)
  if (!price || price < 100) return fail(t.needPrice)

  let variants: { label: string; qty: number }[]
  if (one(f.has_sizes)) {
    const labels = many(f.size_label)
    const qtys = many(f.size_qty)
    variants = labels.map((label, i) => ({ label: label.slice(0, 20), qty: Math.floor(Number(qtys[i])) })).filter((v) => v.label && v.qty > 0)
    if (!variants.length) return fail(t.needSize)
    if (new Set(variants.map((v) => v.label.toLowerCase())).size !== variants.length) return fail(t.dupSize)
  } else {
    const qty = Math.floor(Number(one(f.stock)))
    if (!(qty > 0)) return fail(t.needStock)
    variants = [{ label: '', qty }]
  }
  if (variants.some((v) => v.qty > 10000)) return fail(t.tooMuchStock)

  const id = randomId(7)
  // Up to 5 photos. "Sell again" keeps the earlier photos unless new ones are picked.
  const files = (Array.isArray(f.image) ? f.image : [f.image]).filter((x): x is File => x instanceof File && x.size > 0).slice(0, 5)
  if (files.some((x) => !x.type.startsWith('image/'))) return fail(t.needPhotoFile)
  if (files.some((x) => x.size > MAX_IMAGE_BYTES)) return fail(t.photoTooBig)
  let imageKeys: string[] = []
  if (files.length) {
    imageKeys = files.map(() => `d/${id}-${randomId(6)}`)
    await Promise.all(files.map((x, i) => c.env.IMAGES.put(imageKeys[i], x.stream(), { httpMetadata: { contentType: x.type } })))
  } else {
    const reuse = many(f.reuse_image).slice(0, 5)
    if (reuse.length) {
      // Only the seller's own earlier photos can be reused.
      const { results } = await c.env.DB.prepare(`SELECT DISTINCT i.image_key FROM drop_images i JOIN drops d ON d.id = i.drop_id WHERE d.seller_id = ? AND i.image_key IN (${reuse.map(() => '?').join(',')})`)
        .bind(s.id, ...reuse).all<{ image_key: string }>()
      const ok = new Set(results.map((r) => r.image_key))
      imageKeys = reuse.filter((k) => ok.has(k))
    }
  }
  const imageKey = imageKeys[0] ?? null
  const chosenUpi = one(f.upi)
  const upiVpa = chosenUpi && (await c.env.DB.prepare(`SELECT 1 FROM seller_upis WHERE seller_id = ? AND vpa = ?`).bind(s.id, chosenUpi).first()) ? chosenUpi : null

  const cod = one(f.cod) === '1'
  const codFee = cod ? Math.min(100_000, parsePaise(one(f.cod_fee) || '0') ?? 0) : 0
  const shipFee = Math.min(100_000, parsePaise(one(f.ship_fee) || '0') ?? 0)
  const freeShipAbove = shipFee ? Math.min(100_000_000, parsePaise(one(f.free_ship_above) || '0') ?? 0) : 0
  const cost = Math.max(0, parsePaise(one(f.cost) || '0') ?? 0)
  const weightG = Math.max(0, Math.min(30000, Math.floor(Number(one(f.weight_g)) || 0)))

  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO drops (id, seller_id, title, description, price_paise, image_key, upi_vpa, max_per_order, created_at, cod_enabled, cod_fee_paise, ship_fee_paise, free_ship_above_paise, cost_paise, category, live_at, weight_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, s.id, title, description, price, imageKey, upiVpa, maxPer, now, cod ? 1 : 0, codFee, shipFee, freeShipAbove, cost, category, liveAt, weightG),
    ...imageKeys.map((k, i) => c.env.DB.prepare(`INSERT INTO drop_images (drop_id, image_key, position) VALUES (?, ?, ?)`).bind(id, k, i)),
    ...variants.map((v, i) =>
      c.env.DB.prepare(`INSERT INTO variants (drop_id, label, stock, available, position) VALUES (?, ?, ?, ?, ?)`).bind(id, v.label, v.qty, v.qty, i),
    ),
  ])
  return c.redirect(`/app/drops/${id}?new=1`, 303)
})

// ---------- Sale detail ----------

export function shareText(t: Dict, drop: Drop, variants: Variant[], seller: Seller, link: string) {
  // Same shape as a typical community post: title, details, price, then the order link and shop name.
  const sizes = variants.filter((v) => v.label && v.available > 0).map((v) => v.label)
  return [
    `*${drop.title}*`,
    drop.description ? clip(drop.description, 300) : null,
    ``,
    drop.compare_paise > drop.price_paise
      ? `💰 *${rupees(drop.price_paise)}* ~${rupees(drop.compare_paise)}~ (${t.pctOff(pctOff(drop.compare_paise, drop.price_paise))})`
      : `💰 *${rupees(drop.price_paise)}*`,
    sizes.length ? `📏 ${t.shareSizes}: ${sizes.join(', ')}` : null,
    drop.ship_fee_paise ? `🚚 ${drop.free_ship_above_paise ? t.shareShipFree(rupees(drop.ship_fee_paise), rupees(drop.free_ship_above_paise)) : t.shareShip(rupees(drop.ship_fee_paise))}` : null,
    drop.cod_enabled ? `💵 ${t.codBtn}` : null,
    (drop.live_at ?? 0) > Date.now() ? `⏰ *${t.shareLiveAt(liveWhen(drop.live_at, t.lang))}*` : null,
    `📦 ${t.shareLimited}`,
    ``,
    `👉 ${link.includes('/w/') ? t.waOrderCta : t.shareCta}: ${link}`,
    ``,
    `*${seller.shop_name}*`,
  ].filter((l) => l !== null).join('\n')
}

app.get('/drops/:id', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const data = await loadDrop(c.env.DB, c.req.param('id'))
  if (!data || data.drop.seller_id !== s.id) return c.notFound()
  const { drop, variants } = data
  const origin = new URL(c.req.url).origin
  // With the WhatsApp bot on, buyers order inside WhatsApp; otherwise on the website.
  const link = waBotEnabled(c.env) ? `${origin}/w/${drop.id}` : `${origin}/d/${drop.id}`
  const [counts, { results: orders }] = await Promise.all([
    dropCounts(c.env.DB, drop.id),
    c.env.DB.prepare(`SELECT o.*, ? AS title, ? AS image_key, v.label FROM orders o JOIN variants v ON v.id = o.variant_id WHERE o.drop_id = ? AND o.status NOT IN ('expired', 'rejected') ORDER BY o.created_at DESC LIMIT 200`)
      .bind(drop.title, drop.image_key, drop.id).all<OrderRow>(),
  ])
  const text = shareText(t, drop, variants, s, link)
  const sizes = variants.length > 1 || variants[0].label
  const isNew = c.req.query('new')
  const [{ results: offers }, { results: waiting }] = await Promise.all([
    c.env.DB.prepare(`SELECT f.*, o.status AS order_status FROM offers f LEFT JOIN orders o ON o.id = f.used_order_id WHERE f.drop_id = ? ORDER BY f.created_at DESC LIMIT 20`)
      .bind(drop.id).all<Offer & { order_status: string | null }>(),
    c.env.DB.prepare(`SELECT * FROM waitlist WHERE drop_id = ? ORDER BY notified_at IS NOT NULL, created_at DESC LIMIT 100`).bind(drop.id).all<{ id: number; name: string; phone: string; notified_at: number | null }>(),
  ])
  const regular = drop.compare_paise > drop.price_paise ? drop.compare_paise : drop.price_paise
  const offerState = (f: Offer & { order_status: string | null }) =>
    f.used_order_id && f.order_status && !['expired', 'rejected'].includes(f.order_status) ? 'used' : f.expires_at < Date.now() ? 'ended' : 'active'
  const fresh = c.req.query('offer') ? offers.find((f) => f.id === c.req.query('offer')) : undefined
  const tillOf = (ms: number) => new Date(ms).toLocaleString(t.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const offerLink = (f: Offer) => `${origin}/d/${drop.id}?o=${f.id}`
  const toTell = waiting.filter((w) => !w.notified_at)

  return page(c, 'home', drop.title, (
    <>
      <a class="back" href="/app">{t.backHome}</a>
      {isNew && (
        <div class="alert ok" style="font-size:1.1rem">{t.liveNow}<div style="font-weight:500;margin-top:4px">{t.liveNowSub}</div></div>
      )}
      <Flash msg={c.req.query('err')} />
      <div class="row" style="margin-top:12px">
        {drop.image_key ? <img class="thumb" src={`/img/${drop.image_key}`} alt="" /> : <div class="thumb"><Icon n="bag" s={22} /></div>}
        <div class="grow"><h1 style="margin:0;font-size:1.3rem">{drop.title}</h1>
          <b>{rupees(drop.price_paise)}</b>{drop.compare_paise > drop.price_paise && <> <s class="muted">{rupees(drop.compare_paise)}</s> <span class="chip paid">{t.pctOff(pctOff(drop.compare_paise, drop.price_paise))}</span></>}
        </div>
        <SaleChip t={t} d={{ status: drop.status, available: counts.available }} />
      </div>
      {(drop.live_at ?? 0) > Date.now() && <div class="alert info row" style="gap:8px;margin-top:10px"><Icon n="clock" s={18} />{t.dropSoon(liveWhen(drop.live_at, t.lang))}</div>}
      {data.images.length > 1 && <div class="photos">{data.images.map((k) => <img src={`/img/${k}`} alt="" />)}</div>}
      <p><small>{t.paymentsTo(drop.upi_vpa ?? s.upi_vpa ?? '')}</small></p>
      {/* Profit per piece – one quiet line; tap to add or change the cost. */}
      {toolOn(s, 'profit') && <details class="quiet" id="cost">
        <summary>{drop.cost_paise > 0 ? <span>{t.profitPerPiece(rupees(drop.price_paise - drop.cost_paise))} · <u>{t.edit}</u></span> : <u>{t.addCostLink}</u>}</summary>
        <form method="post" action={`/app/drops/${drop.id}/cost`} class="row" style="margin-top:8px;align-items:flex-end">
          <div class="grow"><label for="costin">{t.costLabel}</label><div class="money"><span>₹</span><input id="costin" name="cost" inputmode="decimal" placeholder="0" value={drop.cost_paise ? String(drop.cost_paise / 100) : ''} /></div></div>
          <button class="btn" type="submit">{t.costSave}</button>
        </form>
        <small>{t.costHint}</small>
      </details>}

      {toolOn(s, 'waitlist') && toTell.length > 0 && (
        <div class="card" style="border:1.5px solid var(--brand)" id="waiting">
          <b>{t.waitlistTitle(toTell.length)}</b>
          <small style="display:block;margin:2px 0 8px">{t.waitlistHint}</small>
          {toTell.map((w) => (
            <div class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
              <span><b>{w.name}</b><br /><small>{displayPhone(w.phone)}</small></span>
              <span class="row" style="gap:6px">
                <a class="btn wa sm" href={waLink(w.phone, t.waitlistMsg(w.name.split(' ')[0], drop.title, s.shop_name, `${origin}/d/${drop.id}`))} aria-label={t.offerSend}><Icon n="chat" s={16} /></a>
                <form method="post" action={`/app/drops/${drop.id}/waitlist/${w.id}/done`}><button class="btn sm" type="submit" aria-label={t.waitlistMark} title={t.waitlistMark}><Icon n="check" s={16} />{t.waitlistDoneShort}</button></form>
              </span>
            </div>
          ))}
        </div>
      )}

      <div class="cols"><div>
      {drop.status === 'live' && (
        <>
          <h2 id="share">{t.shareTitle}</h2>
          <div class="card stack">
            {data.images[0] && <img src={`/img/${data.images[0]}`} alt="" style="width:100%;max-height:260px;object-fit:cover;border-radius:12px" />}
            <pre class="bubble" id="sharetext">{text}</pre>
            <button type="button" class="btn wa block big" data-share-photos={JSON.stringify(data.images.map((k) => `/img/${k}`))} data-share-text="#sharetext" hidden><Icon n="camera" s={18} />{t.sharePhotoWa}</button>
            <a class="btn wa block" href={waLink(null, text)}><Icon n="share" s={18} />{t.shareWa}</a>
            <div class="row">
              <button type="button" class="btn grow sm" data-copy="#sharetext" data-done={t.copiedMsg}>{t.copyMsg}</button>
              <button type="button" class="btn grow sm" data-copy="#link" data-done={t.copiedLink}>{t.copyLink}</button>
            </div>
            <button type="button" class="btn block sm" data-share="#sharetext" hidden><Icon n="share" s={16} />{t.shareMore}</button>
            <input id="link" value={link} readonly aria-label="link" />
            {data.images.length > 0 && (
              <div class="row wrap" style="gap:8px"><small style="width:100%">{t.downloadPhotos}</small>{data.images.map((k, i) => <a class="btn sm" href={`/img/${k}`} download={`${drop.id}-${i + 1}.jpg`}><Icon n="download" s={16} />{t.photoN(i + 1)}</a>)}</div>
            )}
          </div>
        </>
      )}

      {drop.status === 'live' && (toolOn(s, 'discount') || drop.compare_paise > drop.price_paise || toolOn(s, 'offers')) && (
        <div class="saletools">
          {(toolOn(s, 'discount') || drop.compare_paise > drop.price_paise) && <details class="card tool" open={Boolean(c.req.query('discount'))}>
            <summary><span class="ic"><Icon n="receipt" s={18} /></span><span class="grow"><b>{t.discountTitle}</b><small>{drop.compare_paise > drop.price_paise ? t.discountOn(pctOff(drop.compare_paise, drop.price_paise), rupees(drop.compare_paise)) : t.discountHint}</small></span></summary>
            <form method="post" action={`/app/drops/${drop.id}/discount`} class="stack" style="margin-top:10px">
              <div><label for="dprice">{t.discountNew}</label><div class="money"><span>₹</span><input id="dprice" name="price" inputmode="decimal" required placeholder={String(Math.round((regular * 0.8) / 100))} value={drop.compare_paise > drop.price_paise ? String(drop.price_paise / 100) : ''} /></div>
                <div class="row wrap" style="gap:6px;margin-top:8px">{[10, 20, 30, 50].map((p) => <button type="button" class="btn sm" data-fill="#dprice" data-val={String(Math.floor((regular * (100 - p)) / 10000))}>{t.pctOff(p)}</button>)}</div></div>
              <button class="btn primary block" type="submit">{drop.compare_paise > drop.price_paise ? t.discountUpdate : t.discountStart}</button>
            </form>
            {drop.compare_paise > drop.price_paise && <form method="post" action={`/app/drops/${drop.id}/discount/end`} style="margin-top:8px"><button class="btn block ghost" type="submit">{t.discountEnd(rupees(drop.compare_paise))}</button></form>}
          </details>}

          {toolOn(s, 'offers') && <details class="card tool" id="offers" open={Boolean(fresh || c.req.query('offers'))}>
            <summary><span class="ic"><Icon n="key" s={18} /></span><span class="grow"><b>{t.offerTitle}</b><small>{t.offerHint}</small></span></summary>
            {fresh && (
              <div class="alert ok stack" style="margin-top:10px">
                <b>{t.offerReady}</b>
                <input id="offerlink" value={offerLink(fresh)} readonly aria-label="link" />
                <div class="row">
                  {fresh.buyer_phone
                    ? <a class="btn wa grow" href={waLink(fresh.buyer_phone, t.offerMsg(fresh.buyer_name, drop.title, rupees(fresh.price_paise), rupees(regular), offerLink(fresh), tillOf(fresh.expires_at)))}><Icon n="chat" s={18} />{t.offerSend}</a>
                    : <a class="btn wa grow" href={waLink(null, t.offerMsg(fresh.buyer_name, drop.title, rupees(fresh.price_paise), rupees(regular), offerLink(fresh), tillOf(fresh.expires_at)))}><Icon n="chat" s={18} />{t.offerSend}</a>}
                  <button type="button" class="btn" data-copy="#offerlink" data-done={t.copiedLink}>{t.copyLink}</button>
                </div>
              </div>
            )}
            <form method="post" action={`/app/drops/${drop.id}/offers`} class="stack" style="margin-top:10px">
              <div><label for="oprice">{t.offerPrice}</label><div class="money"><span>₹</span><input id="oprice" name="price" inputmode="decimal" required placeholder={String(Math.round((drop.price_paise * 0.9) / 100))} /></div></div>
              <div><label for="ophone">{t.offerPhone}</label><PhoneInput id="ophone" name="phone" /></div>
              <div class="duo">
                <div><label for="oname">{t.offerName}</label><input id="oname" name="name" maxlength={40} /></div>
                <div><label for="oqty">{t.offerQty}</label><Stepper id="oqty" name="qty" value={1} min={1} max={drop.max_per_order} compact /></div>
              </div>
              <div><label for="ovalid">{t.offerValid}</label>
                <select id="ovalid" name="hours">{[1, 24, 72, 168].map((h, i) => <option value={String(h)} selected={h === 24}>{t.offerValids[i]}</option>)}</select></div>
              <button class="btn primary block" type="submit">{t.offerCreate}</button>
            </form>
            {offers.length > 0 && (
              <div style="margin-top:12px">
                <small style="font-weight:700">{t.offersTitle}</small>
                {offers.map((f) => {
                  const st = offerState(f)
                  return (
                    <div class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
                      <span><b>{rupees(f.price_paise)}</b> · {f.buyer_name || (f.buyer_phone ? displayPhone(f.buyer_phone) : '—')}<br /><small>{st === 'active' ? tillOf(f.expires_at) : ''}</small></span>
                      <span class="row" style="gap:6px">
                        <span class={`chip ${st === 'active' ? 'pending' : st === 'used' ? 'paid' : 'closed'}`}>{st === 'active' ? t.offerActive : st === 'used' ? t.offerUsedChip : t.offerExpiredChip}</span>
                        {st === 'active' && <form method="post" action={`/app/drops/${drop.id}/offers/${f.id}/delete`}><button class="btn sm ghost" type="submit" aria-label={t.offerDelete}><Icon n="x" s={16} /></button></form>}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </details>}
        </div>
      )}

      </div><div>
      <h2>{t.stockTitle}</h2>
      <div class="card"><StockSummary t={t} {...counts} /></div>

      <h2>{t.ordersTitle(orders.length)}</h2>
      {orders.length === 0 && <p class="muted">{t.noOrdersYet}</p>}
      {orders.map((o) => <OrderCard t={t} o={o} origin={origin} shop={s.shop_name} />)}

      <a class="btn block" href={`/app/drops/new?from=${drop.id}`} style="margin-top:20px">{t.sellAgain}</a>
      <details class="card" style="margin-top:12px">
        <summary>{t.manage}</summary>
        <form method="post" action={`/app/drops/${drop.id}/stock`} class="stack">
          {variants.map((v) => (
            <div>
              <label for={`s${v.id}`}>{sizes ? v.label : t.totalPieces} <small style="font-weight:400">· {t.leftNow(v.available)}</small></label>
              <div style="max-width:260px"><Stepper id={`s${v.id}`} name={`v${v.id}`} value={v.stock} min={0} max={10000} /></div>
            </div>
          ))}
          <button class="btn block" type="submit">{t.saveStock}</button>
        </form>
        <hr />
        <form method="post" action={`/app/drops/${drop.id}/status`}>
          {drop.status === 'live' ? (
            <button class="btn block ghost" type="submit" data-confirm={t.closeConfirm} style="color:var(--bad)">{t.closeSale}</button>
          ) : (
            <button class="btn block primary" type="submit">{t.reopenSale}</button>
          )}
        </form>
      </details>
      </div></div>
    </>
  ), PULSE_JS, drop.status === 'live' ? t.sayShare : undefined)
})

app.post('/drops/:id/stock', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const id = c.req.param('id')
  const data = await loadDrop(c.env.DB, id)
  if (!data || data.drop.seller_id !== s.id) return c.notFound()
  const f = await c.req.parseBody()
  const stmts = data.variants
    .map((v) => ({ v, n: Math.floor(Number(f[`v${v.id}`])) }))
    .filter(({ v, n }) => Number.isFinite(n) && n >= 0 && n <= 10000 && n !== v.stock)
    // Shift `available` by the same delta; the WHERE refuses cuts below what's already sold or held.
    .map(({ v, n }) => c.env.DB.prepare(`UPDATE variants SET available = available + (?1 - stock), stock = ?1 WHERE id = ?2 AND available + (?1 - stock) >= 0`).bind(n, v.id))
  if (!stmts.length) return c.redirect(`/app/drops/${id}`, 303)
  const res = await c.env.DB.batch(stmts)
  const skipped = res.filter((r) => r.meta.changes === 0).length
  return c.redirect(`/app/drops/${id}?` + (skipped ? 'err=' + enc(t.stockTooLow) : 'ok=' + enc(t.stockSaved)), 303)
})

// ---------- Discount, personal price links, cost, waitlist ----------

const ownDrop = (c: Context<AppEnv>) =>
  c.env.DB.prepare(`SELECT * FROM drops WHERE id = ? AND seller_id = ?`).bind(c.req.param('id'), c.get('seller').id).first<Drop>()

app.post('/drops/:id/discount', async (c) => {
  const t = tr(c)
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  const regular = drop.compare_paise > drop.price_paise ? drop.compare_paise : drop.price_paise
  const price = parsePaise(String((await c.req.parseBody()).price ?? ''))
  if (!price || price < 100 || price >= regular) return c.redirect(`/app/drops/${drop.id}?discount=1&err=${encodeURIComponent(t.errDiscount)}`, 303)
  // The sale price becomes the price; the regular price is kept to show struck through.
  await c.env.DB.prepare(`UPDATE drops SET price_paise = ?, compare_paise = ? WHERE id = ?`).bind(price, regular, drop.id).run()
  return c.redirect(`/app/drops/${drop.id}?ok=${encodeURIComponent(t.discountSaved)}#share`, 303)
})

app.post('/drops/:id/discount/end', async (c) => {
  const t = tr(c)
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  if (drop.compare_paise > 0) await c.env.DB.prepare(`UPDATE drops SET price_paise = compare_paise, compare_paise = 0 WHERE id = ?`).bind(drop.id).run()
  return c.redirect(`/app/drops/${drop.id}?ok=${encodeURIComponent(t.discountEnded)}#share`, 303)
})

app.post('/drops/:id/cost', async (c) => {
  const t = tr(c)
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  const raw = String((await c.req.parseBody()).cost ?? '').trim()
  const cost = raw ? parsePaise(raw) ?? 0 : 0
  // Orders that never had a cost (placed before it was set) get it too, so this month's profit is right.
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE drops SET cost_paise = ? WHERE id = ?`).bind(Math.max(0, cost), drop.id),
    c.env.DB.prepare(`UPDATE orders SET cost_paise = ? * qty WHERE drop_id = ? AND cost_paise = 0`).bind(Math.max(0, cost), drop.id),
  ])
  return c.redirect(`/app/drops/${drop.id}?ok=${encodeURIComponent(t.costSaved)}`, 303)
})

app.post('/drops/:id/offers', async (c) => {
  const t = tr(c)
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  const f = await c.req.parseBody()
  const price = parsePaise(String(f.price ?? ''))
  if (!price || price < 100 || price > drop.price_paise) return c.redirect(`/app/drops/${drop.id}?offers=1&err=${encodeURIComponent(t.errOfferPrice)}#offers`, 303)
  const phone = normalizePhone(String(f.phone ?? '')) || null
  const hours = [1, 24, 72, 168].includes(Number(f.hours)) ? Number(f.hours) : 24
  const qty = Math.max(1, Math.min(drop.max_per_order, Math.floor(Number(f.qty) || 1)))
  const id = randomId(10)
  await c.env.DB.prepare(`INSERT INTO offers (id, drop_id, seller_id, price_paise, buyer_name, buyer_phone, max_qty, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, drop.id, drop.seller_id, price, String(f.name ?? '').trim().slice(0, 40), phone, qty, Date.now() + hours * 3_600_000, Date.now()).run()
  return c.redirect(`/app/drops/${drop.id}?offer=${id}#offers`, 303)
})

app.post('/drops/:id/offers/:oid/delete', async (c) => {
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  // Ending it now keeps the history (and any order that used it) intact.
  await c.env.DB.prepare(`UPDATE offers SET expires_at = ? WHERE id = ? AND drop_id = ?`).bind(Date.now() - 1, c.req.param('oid'), drop.id).run()
  return c.redirect(`/app/drops/${drop.id}?offers=1#offers`, 303)
})

app.post('/drops/:id/waitlist/:wid/done', async (c) => {
  const drop = await ownDrop(c)
  if (!drop) return c.notFound()
  await c.env.DB.prepare(`UPDATE waitlist SET notified_at = ? WHERE id = ? AND drop_id = ?`).bind(Date.now(), Number(c.req.param('wid')), drop.id).run()
  return c.redirect(`/app/drops/${drop.id}#waiting`, 303)
})

// ---------- Shop link and cart offer ----------
const RESERVED = new Set(['app', 'admin', 'login', 'seller', 'signup', 'logout', 'reset', 'privacy', 'terms', 'refunds', 'contact', 'help', 'data-request', 'lang',
  'offline', 'thanks', 'get-started', 'manifest', 'img', 'site', 'webhooks', 'api', 'shop', 'nukkadsale', 'support', 'about', 'blog', 'www'])
export const suggestSlug = (name: string) => (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'my-shop').padEnd(3, '0')

app.post('/shoplink', async (c) => {
  const t = tr(c)
  const slug = String((await c.req.parseBody()).slug ?? '').trim().toLowerCase()
  const back = (k: string, m: string) => c.redirect(`/app/settings?${k}=${encodeURIComponent(m)}#shoplink`, 303)
  if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug) || RESERVED.has(slug)) return back('err', t.shopLinkBad)
  const taken = await c.env.DB.prepare(`SELECT 1 FROM sellers WHERE slug = ? AND id <> ?`).bind(slug, c.get('seller').id).first()
  if (taken) return back('err', t.shopLinkTaken)
  await c.env.DB.prepare(`UPDATE sellers SET slug = ? WHERE id = ?`).bind(slug, c.get('seller').id).run()
  return back('ok', t.shopLinkSaved)
})

app.post('/cartoffer', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const back = (k: string, m: string) => c.redirect(`/app/settings?${k}=${encodeURIComponent(m)}#cartoffer`, 303)
  const id = c.get('seller').id
  if (f.clear) { await c.env.DB.prepare(`UPDATE sellers SET offer_min_paise = 0, offer_off_paise = 0, offer_pct = 0 WHERE id = ?`).bind(id).run(); return back('ok', t.cartOfferSaved) }
  const min = parsePaise(String(f.min ?? '')) ?? 0
  const off = parsePaise(String(f.off ?? '') || '0') ?? 0
  const pct = Math.floor(Number(String(f.pct ?? '').replace(/\D/g, '')) || 0)
  // Either a rupee amount (below the threshold) or a percentage (1–90), not both.
  if (min < 100 || (off > 0) === (pct > 0) || off >= min || pct > 90) return back('err', t.cartOfferBad)
  await c.env.DB.prepare(`UPDATE sellers SET offer_min_paise = ?, offer_off_paise = ?, offer_pct = ? WHERE id = ?`).bind(min, off, off ? 0 : pct, id).run()
  return back('ok', t.cartOfferSaved)
})

// ---------- Shiprocket (optional): connect, check rates, book, label, pickup, track, failed delivery, returns ----------

type SrRow = { sr_email: string | null; sr_password_enc: string | null; sr_token_enc: string | null; sr_token_exp: number; sr_pickup: string | null; sr_pickup_pin: string | null; sr_box: string; sr_hook: string | null }
const srRow = (c: Context<AppEnv>) => c.env.DB.prepare(`SELECT id, sr_email, sr_password_enc, sr_token_enc, sr_token_exp, sr_pickup, sr_pickup_pin, sr_box, sr_hook FROM sellers WHERE id = ?`).bind(c.get('seller').id).first<SrRow & { id: string }>()
const box = (b: string) => { const [l, w, h] = (b || '25x20x5').split('x').map((x) => Math.max(1, Math.min(200, Number(x) || 1))); return { l, b: w, h } }
const srFail = (c: Context<AppEnv>, to: string, e: unknown) => c.redirect(`${to}${to.includes('?') ? '&' : '?'}err=${encodeURIComponent(tr(c).shipErr(e instanceof Error ? e.message : String(e)))}`, 303)

app.get('/ship', async (c) => {
  const t = tr(c)
  const r = (await srRow(c))!
  let pickups: { name: string; pin: string; address: string }[] = [], err = ''
  if (r.sr_email) { try { pickups = await srPickups(c.env, await srToken(c.env, r)) } catch (e) { err = t.shipErr((e as Error).message) } }
  // Rate checker: ?pin=&g=&cod= – courier prices before any booking.
  const pin = (c.req.query('pin') ?? '').replace(/\D/g, ''), g = Math.max(50, Math.min(30000, Number(c.req.query('g')) || 500)), cod = c.req.query('cod') === '1'
  let rates: Awaited<ReturnType<typeof srRates>> | null = null
  if (r.sr_email && r.sr_pickup_pin && /^[1-9]\d{5}$/.test(pin)) { try { rates = await srRates(c.env, await srToken(c.env, r), r.sr_pickup_pin, pin, g / 1000, cod) } catch (e) { err = t.shipErr((e as Error).message) } }
  const origin = new URL(c.req.url).origin
  return page(c, 'settings', t.shipTitle, (
    <>
      <a class="back" href="/app/settings">← {t.settingsTitle}</a>
      <h1>{t.shipTitle}</h1>
      <p class="hint">{t.srHint}</p>
      <Flash msg={c.req.query('err') || err} />
      {!r.sr_email ? (
        <form method="post" action="/app/ship/connect" class="card stack">
          <div><label for="sre">{t.shipEmail}</label><input id="sre" name="email" type="email" required autocomplete="off" /></div>
          <div><label for="srp">{t.shipPass}</label><input id="srp" name="password" type="password" required autocomplete="new-password" /></div>
          <button class="btn primary block" type="submit">{t.shipConnect}</button>
          <details><summary>{t.shipHow}</summary><ol style="margin:6px 0 0;padding-left:20px">{t.shipHowSteps.map((x) => <li>{x}</li>)}</ol></details>
        </form>
      ) : (
        <>
          <div class="card row between"><span class="row" style="gap:8px"><Icon n="check" s={18} />{t.shipConnected(r.sr_email)}</span>
            <form method="post" action="/app/ship/disconnect"><button class="btn sm ghost" type="submit" data-confirm={t.shipDisconnect + '?'}>{t.shipDisconnect}</button></form></div>
          <form method="post" action="/app/ship/settings" class="card stack">
            <div><label for="pk">{t.shipPickupLabel}</label>
              {pickups.length ? <select id="pk" name="pickup">{pickups.map((p) => <option value={p.name} selected={p.name === r.sr_pickup}>{p.name} – {p.address} ({p.pin})</option>)}</select> : <p class="hint">{t.shipPickupNone}</p>}</div>
            <div><label for="bx">{t.shipBoxLabel}</label><input id="bx" name="box" value={r.sr_box} pattern="\d{1,3}x\d{1,3}x\d{1,3}" placeholder="25x20x5" style="max-width:200px" /></div>
            <button class="btn block" type="submit">{t.shipSave}</button>
          </form>

          <h2 id="rates">{t.shipCourier}</h2>
          <form method="get" action="/app/ship#rates" class="card stack">
            <div class="duo">
              <div><label for="rpin">{t.pincode}</label><input id="rpin" name="pin" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength={6} required value={pin} placeholder="560038" /></div>
              <div><label for="rg">{t.shipWeight}</label><input id="rg" name="g" inputmode="numeric" value={String(g)} /></div>
            </div>
            <label class="row" style="gap:8px"><input type="checkbox" name="cod" value="1" checked={cod} style="width:auto;min-height:0" />{t.codBtn}</label>
            <button class="btn block" type="submit">{t.shipCheck}</button>
          </form>
          {rates && <CourierList t={t} rates={rates} />}

          <h2>{t.shipHookTitle}</h2>
          <div class="card stack"><small>{t.shipHookHint}</small>
            <input readonly value={`${origin}/webhooks/shiprocket/${r.sr_hook ?? ''}`} aria-label="URL" id="hookurl" />
            <button type="button" class="btn sm" data-copy="#hookurl" data-done={t.copiedLink}>{t.copyLink}</button></div>
        </>
      )}
    </>
  ))
})

const CourierList: FC<{ t: Dict; rates: Awaited<ReturnType<typeof srRates>>; pick?: boolean }> = ({ t, rates, pick }) => {
  if (!rates.list.length) return <div class="alert info">{t.shipNoCourier}</div>
  const fastest = [...rates.list].sort((a, b) => (Number(a.days) || 99) - (Number(b.days) || 99))[0]
  const chosen = rates.recommended ?? rates.list[0].id
  return (
    <div class="card" style="padding:4px 16px">
      {rates.list.slice(0, 12).map((x, i) => (
        <label class="row" style={`gap:12px;padding:12px 0;align-items:center;${i ? 'border-top:1px solid var(--line)' : ''}${pick ? ';cursor:pointer' : ''}`}>
          {pick && <input type="radio" name="courier" value={String(x.id)} checked={x.id === chosen} required style="width:auto;min-height:0" />}
          <span class="grow"><b style="display:block">{x.name}</b><small>{[t.shipDays(x.days), x.etd ? t.shipEtd(x.etd) : ''].filter(Boolean).join(' · ')}
            {x.id === rates.list[0].id && <span class="chip paid" style="margin-left:6px">{t.shipCheapest}</span>}{x.id === fastest.id && x.id !== rates.list[0].id && <span class="chip pending" style="margin-left:6px">{t.shipFastest}</span>}</small></span>
          <b>{rupees(x.rate)}</b>
        </label>
      ))}
    </div>
  )
}

app.post('/ship/connect', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const email = String(f.email ?? '').trim(), password = String(f.password ?? '')
  try {
    const token = await srLogin(c.env, email, password)
    const pickups = await srPickups(c.env, token).catch(() => [])
    await c.env.DB.prepare(`UPDATE sellers SET sr_email = ?, sr_password_enc = ?, sr_token_enc = ?, sr_token_exp = ?, sr_pickup = ?, sr_pickup_pin = ?, sr_hook = COALESCE(sr_hook, ?) WHERE id = ?`)
      .bind(email, await encrypt(password, c.env.SECRET_KEY), await encrypt(token, c.env.SECRET_KEY), Date.now() + 9 * 86_400_000, pickups[0]?.name ?? null, pickups[0]?.pin ?? null, randomId(24), c.get('seller').id).run()
    return c.redirect(`/app/ship?ok=${encodeURIComponent(t.shipSaved)}`, 303)
  } catch {
    return c.redirect(`/app/ship?err=${encodeURIComponent(t.shipBadLogin)}`, 303)
  }
})

app.post('/ship/settings', async (c) => {
  const t = tr(c)
  const r = (await srRow(c))!
  const f = await c.req.parseBody()
  const boxIn = String(f.box ?? '').replace(/\s/g, '').toLowerCase()
  let pickup = r.sr_pickup, pin = r.sr_pickup_pin
  if (f.pickup) { try { const p = (await srPickups(c.env, await srToken(c.env, r))).find((x) => x.name === String(f.pickup)); if (p) { pickup = p.name; pin = p.pin } } catch (e) { return srFail(c, '/app/ship', e) } }
  await c.env.DB.prepare(`UPDATE sellers SET sr_pickup = ?, sr_pickup_pin = ?, sr_box = ? WHERE id = ?`).bind(pickup, pin, /^\d{1,3}x\d{1,3}x\d{1,3}$/.test(boxIn) ? boxIn : r.sr_box, c.get('seller').id).run()
  return c.redirect(`/app/ship?ok=${encodeURIComponent(t.shipSaved)}`, 303)
})

app.post('/ship/disconnect', async (c) => {
  await c.env.DB.prepare(`UPDATE sellers SET sr_email = NULL, sr_password_enc = NULL, sr_token_enc = NULL, sr_token_exp = 0, sr_pickup = NULL, sr_pickup_pin = NULL WHERE id = ?`).bind(c.get('seller').id).run()
  return c.redirect(`/app/settings?ok=${encodeURIComponent(tr(c).shipDisconnected)}`, 303)
})

// The parcel for one order/cart: everything in it, its weight and the COD cash.
async function parcelFor(c: Context<AppEnv>, key: string) {
  const { results: lines } = await c.env.DB.prepare(
    `SELECT o.*, d.title, d.weight_g, v.label FROM orders o JOIN drops d ON d.id = o.drop_id JOIN variants v ON v.id = o.variant_id
     WHERE (o.id = ?1 OR o.cart_id = ?1) AND o.seller_id = ?2 AND (o.status = 'paid' OR (o.status = 'pending' AND o.pay_mode = 'cod'))`,
  ).bind(key, c.get('seller').id).all<Order & { title: string; weight_g: number; label: string }>()
  if (!lines.length) return null
  const o = lines[0]
  const pin = (o.address.match(/\b[1-9]\d{5}\b(?!.*\b[1-9]\d{5}\b)/s) ?? [''])[0]
  const cod = o.pay_mode === 'cod' && o.status === 'pending'
  return { lines, o, pin, cod, total: lines.reduce((n, l) => n + l.amount_paise, 0), grams: lines.reduce((n, l) => n + (l.weight_g || 500) * l.qty, 0) }
}

app.get('/ship/book/:key', async (c) => {
  const t = tr(c)
  const key = c.req.param('key')
  const r = (await srRow(c))!
  if (!r.sr_email) return c.redirect('/app/ship', 303)
  const p = await parcelFor(c, key)
  if (!p) return c.notFound()
  const dupe = await c.env.DB.prepare(`SELECT id FROM shipments WHERE order_key = ? AND ${OPEN_SHIP}`).bind(key).first()
  if (dupe) return c.redirect('/app/orders?tab=send', 303)
  const pin = (c.req.query('pin') ?? p.pin).replace(/\D/g, '')
  const grams = Math.max(50, Math.min(30000, Number(c.req.query('g')) || p.grams))
  const bx = c.req.query('box') && /^\d{1,3}x\d{1,3}x\d{1,3}$/.test(c.req.query('box')!) ? c.req.query('box')! : r.sr_box
  let rates: Awaited<ReturnType<typeof srRates>> | null = null, place = { city: '', state: '' }, err = ''
  try {
    const token = await srToken(c.env, r)
    if (!r.sr_pickup_pin) throw new ShiprocketError(t.shipPickupNone)
    ;[rates, place] = await Promise.all([srRates(c.env, token, r.sr_pickup_pin, pin, grams / 1000, p.cod), srPincode(c.env, token, pin)])
  } catch (e) { err = t.shipErr((e as Error).message) }
  return page(c, 'orders', t.shipBookTitle, (
    <>
      <a class="back" href="/app/orders?tab=send">← {t.ordersPageTitle}</a>
      <h1>{t.shipBookTitle}</h1>
      <Flash msg={c.req.query('err') || err} />
      <div class="card">
        <small>{t.shipTo}</small>
        <b style="display:block">{p.o.buyer_name}</b>
        <span style="white-space:pre-line">{p.o.address}</span>
        <small style="display:block">{displayPhone(p.o.buyer_phone)} · #{shortNo(key)} · {p.lines.map((l) => `${clip(l.title, 28)}${l.label ? ` (${l.label})` : ''} ×${l.qty}`).join(', ')}</small>
        {p.cod && <small style="display:block;color:var(--warn);font-weight:700;margin-top:4px">{t.shipCod(rupees(p.total))}</small>}
      </div>
      <form method="get" action={`/app/ship/book/${key}`} class="card stack">
        <div class="duo">
          <div><label for="bpin">{t.pincode}</label><input id="bpin" name="pin" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength={6} value={pin} required /></div>
          <div><label for="bg">{t.shipWeight}</label><input id="bg" name="g" inputmode="numeric" value={String(grams)} /></div>
        </div>
        <div><label for="bbox">{t.shipBox}</label><input id="bbox" name="box" value={bx} pattern="\d{1,3}x\d{1,3}x\d{1,3}" style="max-width:200px" /></div>
        <button class="btn block sm" type="submit"><Icon n="refresh" s={16} />{t.shipCheck}</button>
      </form>
      {rates && rates.list.length > 0 ? (
        <form method="post" action={`/app/ship/book/${key}`} class="stack">
          <div class="duo">
            <div><label for="bcity">{t.shipCity}</label><input id="bcity" name="city" value={place.city} required maxlength={40} /></div>
            <div><label for="bstate">{t.shipState}</label><input id="bstate" name="state" value={place.state} required maxlength={40} /></div>
          </div>
          <h2 style="margin-bottom:0">{t.shipCourier}</h2>
          <CourierList t={t} rates={rates} pick />
          <input type="hidden" name="pin" value={pin} /><input type="hidden" name="g" value={String(grams)} /><input type="hidden" name="box" value={bx} />
          <div class="sticky-pay"><button class="btn primary block big" type="submit">{t.shipBook}</button></div>
        </form>
      ) : rates ? <div class="alert info">{t.shipNoCourier}</div> : null}
    </>
  ))
})

app.post('/ship/book/:key', async (c) => {
  const t = tr(c)
  const key = c.req.param('key')
  const r = (await srRow(c))!
  const p = await parcelFor(c, key)
  if (!r.sr_email || !p) return c.redirect('/app/orders?tab=send', 303)
  if (await c.env.DB.prepare(`SELECT 1 FROM shipments WHERE order_key = ? AND ${OPEN_SHIP}`).bind(key).first()) return c.redirect('/app/orders?tab=send', 303)
  const f = await c.req.parseBody()
  const pin = String(f.pin ?? '').replace(/\D/g, ''), grams = Math.max(50, Math.min(30000, Number(f.g) || p.grams)), b = box(String(f.box ?? r.sr_box))
  const courierId = Number(f.courier)
  const back = `/app/ship/book/${key}?pin=${pin}&g=${grams}`
  if (!courierId || !/^[1-9]\d{5}$/.test(pin)) return c.redirect(back, 303)
  const id = `${shortNo(key)}-${randomId(4)}`.toLowerCase()
  const date = new Date(Date.now() + 19_800_000).toISOString().slice(0, 16).replace('T', ' ')
  try {
    const token = await srToken(c.env, r)
    const res = await srBook(c.env, token, {
      id, date, pickup: r.sr_pickup!, name: p.o.buyer_name, phone: p.o.buyer_phone.slice(-10), address: p.o.address.replace(/\s+/g, ' ').slice(0, 190),
      city: String(f.city ?? '').trim(), state: String(f.state ?? '').trim(), pincode: pin,
      items: p.lines.map((l) => ({ name: `${l.title}${l.label ? ` (${l.label})` : ''}`.slice(0, 90), sku: `${l.drop_id}-${l.variant_id}`, units: l.qty, price: Math.round(l.amount_paise / l.qty) })),
      cod: p.cod, subTotal: p.total, codAmount: p.cod ? p.total : 0, l: b.l, b: b.b, h: b.h, weightKg: grams / 1000, courierId,
    })
    const now = Date.now()
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO shipments (id, seller_id, order_key, sr_order_id, shipment_id, awb, courier, status, label_url, pickup_date, charge_paise, cod_paise, weight_g, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, c.get('seller').id, key, res.srOrderId, res.shipmentId, res.awb, res.courier, res.pickupDate ? 'pickup' : 'booked', res.label, res.pickupDate, res.charge, p.cod ? p.total : 0, grams, now, now),
      // Booked = packed and waiting for pickup.
      c.env.DB.prepare(`UPDATE orders SET ship_status = 'packed' WHERE (id = ?1 OR cart_id = ?1) AND ship_status = 'new'`).bind(key),
    ])
    return c.redirect(`/app/orders?tab=send&ok=${encodeURIComponent(t.shipBooked)}`, 303)
  } catch (e) { return srFail(c, back, e) }
})

const ownShipment = (c: Context<AppEnv>) => c.env.DB.prepare(`SELECT * FROM shipments WHERE id = ? AND seller_id = ?`).bind(c.req.param('id'), c.get('seller').id).first<ShipmentRow>()

app.post('/ship/:id/label', async (c) => {
  const sh = await ownShipment(c); const r = (await srRow(c))!
  if (!sh?.shipment_id) return c.redirect('/app/orders?tab=send', 303)
  try {
    const url = sh.label_url || (await srLabel(c.env, await srToken(c.env, r), sh.shipment_id))
    if (url && !sh.label_url) await c.env.DB.prepare(`UPDATE shipments SET label_url = ? WHERE id = ?`).bind(url, sh.id).run()
    return url ? c.redirect(url, 303) : c.redirect('/app/orders?tab=send', 303)
  } catch (e) { return srFail(c, '/app/orders?tab=send', e) }
})

app.post('/ship/:id/pickup', async (c) => {
  const sh = await ownShipment(c); const r = (await srRow(c))!
  if (!sh?.shipment_id) return c.redirect('/app/orders?tab=send', 303)
  try {
    const d = await srPickup(c.env, await srToken(c.env, r), sh.shipment_id)
    await c.env.DB.prepare(`UPDATE shipments SET pickup_date = ?, status = 'pickup', updated_at = ? WHERE id = ?`).bind(d, Date.now(), sh.id).run()
    return backWith(c, '/app/orders?tab=send', d ? tr(c).shipPickupOn(d) : tr(c).shipSaved)
  } catch (e) { return srFail(c, '/app/orders?tab=send', e) }
})

app.post('/ship/:id/cancel', async (c) => {
  const sh = await ownShipment(c); const r = (await srRow(c))!
  if (!sh || !['booked', 'pickup'].includes(sh.status)) return c.redirect('/app/orders?tab=send', 303)
  try {
    if (sh.sr_order_id) await srCancel(c.env, await srToken(c.env, r), sh.sr_order_id)
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE shipments SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(Date.now(), sh.id),
      c.env.DB.prepare(`UPDATE orders SET ship_status = 'new' WHERE (id = ?1 OR cart_id = ?1) AND ship_status = 'packed'`).bind(sh.order_key),
    ])
    return backWith(c, '/app/orders?tab=send', tr(c).shipCancelled)
  } catch (e) { return srFail(c, '/app/orders?tab=send', e) }
})

app.post('/ship/:id/ndr', async (c) => {
  const sh = await ownShipment(c); const r = (await srRow(c))!
  const action = String((await c.req.parseBody()).action) === 'return' ? 'return' : 're-attempt'
  if (!sh?.awb || sh.status !== 'failed') return c.redirect('/app/orders?tab=send', 303)
  try {
    await srNdr(c.env, await srToken(c.env, r), sh.awb, action)
    await c.env.DB.prepare(`UPDATE shipments SET status = ?, status_text = ?, updated_at = ? WHERE id = ?`).bind(action === 'return' ? 'rto' : 'transit', action === 'return' ? 'RTO requested' : 'Re-attempt requested', Date.now(), sh.id).run()
    return backWith(c, '/app/orders?tab=send', tr(c).shipNdrDone)
  } catch (e) { return srFail(c, '/app/orders?tab=send', e) }
})

app.post('/ship/:id/refresh', async (c) => {
  const sh = await ownShipment(c); const r = (await srRow(c))!
  if (!sh?.awb) return c.redirect('/app/orders?tab=send', 303)
  try { await applyTracking(c.env, sh, await srTrack(c.env, await srToken(c.env, r), sh.awb)) } catch (e) { return srFail(c, '/app/orders?tab=send', e) }
  return c.redirect('/app/orders?tab=send', 303)
})

// Parcel came back: the pieces go back on sale (once).
app.post('/ship/:id/restock', async (c) => {
  const sh = await ownShipment(c)
  if (!sh || sh.status !== 'returned') return c.redirect('/app/orders?tab=send', 303)
  // Claim the restock first so a double tap can't add the pieces twice.
  const claim = await c.env.DB.prepare(`UPDATE shipments SET status_text = 'restocked', updated_at = ? WHERE id = ? AND status_text <> 'restocked'`).bind(Date.now(), sh.id).run()
  if (claim.meta.changes !== 1) return c.redirect('/app/orders?tab=send', 303)
  const { results } = await c.env.DB.prepare(`SELECT id, variant_id, qty, status, pay_mode FROM orders WHERE id = ?1 OR cart_id = ?1`).bind(sh.order_key).all<{ id: string; variant_id: number; qty: number; status: string; pay_mode: string }>()
  for (const l of results) {
    // Cash on delivery never got paid: the order is off (cancelCod gives its stock back).
    if (l.pay_mode === 'cod' && l.status === 'pending') await cancelCod(c.env, l.id, c.get('seller').id)
    else await c.env.DB.prepare(`UPDATE variants SET available = MIN(stock, available + ?) WHERE id = ?`).bind(l.qty, l.variant_id).run()
  }
  return backWith(c, '/app/orders?tab=all', tr(c).shipRestocked)
})

app.post('/tools', async (c) => {
  const t = tr(c)
  const on = new Set(([] as unknown[]).concat((await c.req.parseBody({ all: true })).on ?? []).map(String))
  const off = TOOLS.filter((x) => !on.has(x)).join(',')
  await c.env.DB.prepare(`UPDATE sellers SET tools_off = ? WHERE id = ?`).bind(off, c.get('seller').id).run()
  return c.redirect(`/app/settings?ok=${encodeURIComponent(t.toolsSaved)}#tools`, 303)
})

app.post('/drops/:id/status', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`UPDATE drops SET status = CASE status WHEN 'live' THEN 'closed' ELSE 'live' END WHERE id = ? AND seller_id = ?`).bind(id, c.get('seller').id).run()
  return c.redirect(`/app/drops/${id}`, 303)
})

// ---------- Orders ----------

type OrderRow = Order & { title: string; label: string; image_key: string | null }

const NEXT_SHIP: Record<ShipStatus, ShipStatus | null> = { new: 'packed', packed: 'shipped', shipped: 'delivered', delivered: null }

// Shiprocket on an order card: book (if connected and not booked yet), or the parcel's status and actions.
// A parcel that blocks booking another: anything not cancelled, except one that came back and wasn't restocked.
const OPEN_SHIP = `status <> 'cancelled' AND NOT (status = 'returned' AND status_text <> 'restocked')`

const ShipBox: FC<{ t: Dict; o: OrderRow; ship?: ShipmentRow; sr?: boolean; origin: string; shop: string }> = ({ t, o, ship, sr, origin, shop }) => {
  if (!ship) return sr && o.ship_status !== 'delivered' ? <a class="btn block" style="margin-top:10px" href={`/app/ship/book/${cartKeyOf(o)}`}><Icon n="box" s={18} />{t.shipBtn}</a> : null
  const live = !['delivered', 'returned', 'cancelled'].includes(ship.status)
  const tone = ship.status === 'delivered' ? 'paid' : ship.status === 'failed' || ship.status === 'rto' ? 'refund' : 'pending'
  return (
    <div class="card" style="margin:10px 0 0;background:var(--bg)">
      <div class="row between"><b style="font-size:.92rem">{ship.awb ? t.shipAwb(ship.courier, ship.awb) : ship.courier}</b><span class={`chip ${tone}`}>{t.shipStatus[ship.status]}</span></div>
      <small>{ship.status === 'booked' || ship.status === 'pickup' ? (ship.pickup_date ? t.shipPickupOn(ship.pickup_date) : '') : ship.etd && live ? t.shipEtd(ship.etd) : ship.status_text === 'restocked' ? t.shipRestocked : ship.status_text}</small>
      {ship.cod_paise > 0 && <small style="display:block;color:var(--warn);font-weight:700">{t.shipCod(rupees(ship.cod_paise))}</small>}
      {ship.status === 'failed' && <p class="hint" style="margin:6px 0">{t.shipFailedHint}</p>}
      {ship.status === 'returned' && <p class="hint" style="margin:6px 0">{ship.status_text === 'restocked' ? (o.status === 'paid' ? t.shipRefundHint : '') : t.shipBackHint}</p>}
      <div class="row wrap" style="gap:6px;margin-top:8px">
        {ship.status === 'failed' && <><form method="post" action={`/app/ship/${ship.id}/ndr`}><button class="btn sm primary" name="action" value="re-attempt" type="submit">{t.shipReattempt}</button></form>
          <form method="post" action={`/app/ship/${ship.id}/ndr`}><button class="btn sm" name="action" value="return" type="submit">{t.shipReturn}</button></form></>}
        {ship.status === 'returned' && ship.status_text !== 'restocked' && <><a class="btn sm primary" href={`/app/ship/book/${cartKeyOf(o)}`}>{t.shipResend}</a>
          <form method="post" action={`/app/ship/${ship.id}/restock`}><button class="btn sm" type="submit" data-confirm={o.pay_mode === 'cod' ? t.shipRestockCod : undefined}>{t.shipRestock}</button></form></>}
        {ship.status === 'returned' && ship.status_text === 'restocked' && o.status === 'paid' && <a class="btn sm wa" href={waLink(o.buyer_phone, t.shipRefundMsg(o.buyer_name.split(' ')[0], shop))}><Icon n="chat" s={16} />{t.shipRefundBtn}</a>}
        {['booked', 'pickup'].includes(ship.status) && <form method="post" action={`/app/ship/${ship.id}/label`}><button class="btn sm" type="submit"><Icon n="receipt" s={16} />{t.srLabel}</button></form>}
        {ship.status === 'booked' && !ship.pickup_date && <form method="post" action={`/app/ship/${ship.id}/pickup`}><button class="btn sm" type="submit">{t.shipPickup}</button></form>}
        {live && ship.awb && <a class="btn sm wa" href={waLink(o.buyer_phone, t.shipTrackMsg(o.buyer_name.split(' ')[0], shop, ship.courier, ship.awb, `${origin}/o/${cartKeyOf(o)}`))}><Icon n="chat" s={16} />{t.shipSendTrack}</a>}
        {live && ship.awb && <form method="post" action={`/app/ship/${ship.id}/refresh`}><button class="btn sm ghost" type="submit" aria-label={t.shipRefresh}><Icon n="refresh" s={16} /></button></form>}
        {['booked', 'pickup'].includes(ship.status) && <form method="post" action={`/app/ship/${ship.id}/cancel`}><button class="btn sm ghost" type="submit" data-confirm={t.shipCancelConfirm} style="color:var(--bad)">{t.shipCancel}</button></form>}
      </div>
    </div>
  )
}

const OrderCard: FC<{ t: Dict; o: OrderRow; group?: OrderRow[]; origin: string; shop: string; ship?: ShipmentRow; sr?: boolean }> = ({ t, o, group, origin, shop, ship, sr }) => {
  // A payment can hold several items; the card stands for all of them.
  const lines = group?.length ? group : [o]
  const item = lines.map((l) => `${l.title}${l.label ? ` (${l.label})` : ''} ×${l.qty}`).join(', ')
  const no = shortNo(o.id)
  const amt = rupees(lines.reduce((n, l) => n + l.amount_paise, 0))
  o = { ...o, proof_key: lines.find((l) => l.proof_key)?.proof_key ?? null, utr: lines.find((l) => l.utr)?.utr ?? null }
  const next = NEXT_SHIP[o.ship_status]
  const minsLeft = Math.max(0, Math.ceil((o.hold_until - Date.now()) / 60000))
  const status = o.pay_mode === 'cod' ? shownStatus(o) : o.status === 'pending' && minsLeft === 0 ? 'expired' : o.status
  return (
    <div class={`card order ${status}`}>
      <div class="row" style="align-items:flex-start">
        {o.image_key ? <img class="thumb" src={`/img/${o.image_key}`} alt="" loading="lazy" /> : <div class="thumb"><Icon n="bag" s={22} /></div>}
        <div class="grow">
          <div class="row between"><b style="font-size:1.05rem">{o.buyer_name}</b><b>{amt}</b></div>
          {lines.map((l) => <div>{clip(l.title, 30)} {l.label && <span class="chip closed" style="color:var(--ink)">{l.label}</span>} ×{l.qty}</div>)}
          <div class="row between"><small>#{no} · {ago(t, o.created_at)}{o.channel === 'whatsapp' ? ` · ${t.viaWa}` : ''}{o.assisted ? ` · ${t.fromChat}` : ''}</small>{status !== 'verifying' && <StatusChip t={t} status={status} />}</div>
        </div>
      </div>
      {o.proof_key && (
        <a class="row" href={`/app/proof/${lines.find((l) => l.proof_key)?.id ?? o.id}`} style="margin-top:10px;text-decoration:none;color:inherit">
          <img class="thumb" src={`/app/proof/${lines.find((l) => l.proof_key)?.id ?? o.id}`} alt="" loading="lazy" style="object-fit:cover" />
          <small>{t.buyerShot}</small>
        </a>
      )}

      {status === 'verifying' && (
        <div class="ask">
          <div class="q">{t.didYouGet(amt)}</div>
          <small style="color:inherit">{o.utr ? <>{t.utrIs}: <b>{o.utr.replace(/(\d{4})(?=\d)/g, '$1 ')}</b></> : t.noUtr}</small>
          <div class="row" style="margin-top:12px">
            <form method="post" action={`/app/orders/${o.id}/received`} class="grow">
              <button class="btn ok block" type="submit">{t.yesGot}</button>
            </form>
            <form method="post" action={`/app/orders/${o.id}/reject`}>
              <button class="btn" type="submit" data-confirm={t.noConfirm}>{t.noDidnt}</button>
            </form>
          </div>
        </div>
      )}

      {/* Gateway orders confirm themselves – never show manual buttons for them. */}
      {status === 'pending' && o.pay_mode !== 'direct' && (
        <>
          <p><small>{t.autoConfirm}</small></p>
          <a class="btn wa sm block" href={waLink(o.buyer_phone, t.remindMsg(o.buyer_name, item, shop, `${origin}/o/${o.id}`))}>{t.remind}</a>
        </>
      )}
      {/* Direct UPI: buyers often pay without telling anyone, so ask about every open amount. */}
      {(status === 'pending' || status === 'expired') && o.pay_mode === 'direct' && (
        <div class="ask" style="background:var(--warn-soft)">
          <div class="q" style="color:var(--warn)">{t.didCome(amt)}</div>
          <small style="color:inherit">{status === 'pending' ? t.waitingPay(minsLeft) : t.timeOverNote}</small>
          <div class="row" style="margin-top:12px">
            <form method="post" action={`/app/orders/${o.id}/received`} class="grow">
              <button class="btn ok block" type="submit">{t.yesGot}</button>
            </form>
            {status === 'pending' && (
              <a class="btn wa" href={waLink(o.buyer_phone, t.remindMsg(o.buyer_name, item, shop, `${origin}/o/${o.id}`))}>{t.remind}</a>
            )}
          </div>
        </div>
      )}

      {status === 'paid' && (
        <>
          <ShipSteps t={t} ship={o.ship_status} />
          <ShipBox t={t} o={o} ship={ship} sr={sr} origin={origin} shop={shop} />
          <div class="stack" style="margin-top:10px">
            {next && (
              <form method="post" action={`/app/orders/${o.id}/ship`}>
                <button class="btn primary block" type="submit">{t.markAs(t.ship[next])}</button>
              </form>
            )}
            <a class="btn wa sm block" href={waLink(o.buyer_phone, o.ship_status === 'new' ? t.paidMsg(o.buyer_name, item, no, shop) : t.shipMsg(o.buyer_name, no, item, t.ship[o.ship_status], shop))}>
              {t.message}
            </a>
          </div>
          <details>
            <summary>{t.address}</summary>
            <p style="white-space:pre-line;margin-top:0" id={`a${o.id}`}>{o.buyer_name}{'\n'}{o.address}{'\n'}{displayPhone(o.buyer_phone)}</p>
            <button type="button" class="btn sm" data-copy={`#a${o.id}`} data-done={t.copiedAddress}>{t.copyAddress}</button>
          </details>
        </>
      )}

      {status === 'cod' && (
        <>
          <div class="ask" style="background:var(--warn-soft)">
            <div class="q" style="color:var(--warn);display:flex;gap:8px;align-items:center"><Icon n="cash" />{t.codCollect(amt)}</div>
          </div>
          <ShipSteps t={t} ship={o.ship_status} labels={t.codSteps} />
          <ShipBox t={t} o={o} ship={ship} sr={sr} origin={origin} shop={shop} />
          <div class="stack" style="margin-top:10px">
            {o.ship_status === 'new' && (
              <a class="btn wa block" href={waLink(o.buyer_phone, t.codConfirmMsg(o.buyer_name, item, amt, shop))}><Icon n="chat" s={18} />{t.codConfirmBtn}</a>
            )}
            {next && (
              <form method="post" action={`/app/orders/${o.id}/ship`}>
                <button class={`btn block ${o.ship_status === 'new' ? '' : 'primary'}`} type="submit">{t.markAs(t.ship[next])}</button>
              </form>
            )}
            <form method="post" action={`/app/orders/${o.id}/cash`}>
              <button class={`btn ok block ${o.ship_status === 'delivered' ? 'big' : ''}`} type="submit"><Icon n="check" s={18} />{t.cashReceived}</button>
            </form>
            {o.ship_status !== 'delivered' && (
              <form method="post" action={`/app/orders/${o.id}/cancel-cod`}>
                <button class="btn ghost block sm" type="submit" data-confirm={t.codCancelAsk}>{t.codCancel}</button>
              </form>
            )}
          </div>
          <details>
            <summary>{t.address}</summary>
            <p style="white-space:pre-line;margin-top:0" id={`a${o.id}`}>{o.buyer_name}{'\n'}{o.address}{'\n'}{displayPhone(o.buyer_phone)}</p>
            <button type="button" class="btn sm" data-copy={`#a${o.id}`} data-done={t.copiedAddress}>{t.copyAddress}</button>
          </details>
        </>
      )}

      {status === 'refund_due' && (
        <>
          <p><small>{t.refundNote}</small></p>
          <a class="btn wa sm block" href={waLink(o.buyer_phone, t.refundMsg(o.buyer_name, item, amt, shop))}>{t.tellRefund}</a>
        </>
      )}
    </div>
  )
}

// "Check payment" = buyers who said they paid, refunds, and every open direct-UPI amount –
// including holds that lapsed in the last day, since buyers often pay without telling anyone.
const CHECK_WHERE = `(o.status IN ('verifying', 'refund_due') OR (o.pay_mode = 'direct' AND (o.status = 'pending' OR (o.status = 'expired' AND o.created_at > ?2 - 86400000))))`

// Waiting to be sent: paid and not yet out, or cash on delivery – unless the parcel came back and went back into stock.
const TO_SEND = `((o.status = 'paid' AND o.ship_status IN ('new', 'packed')) OR (o.status = 'pending' AND o.pay_mode = 'cod'))
  AND NOT EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_key = COALESCE(o.cart_id, o.id) AND sh.status = 'returned' AND sh.status_text = 'restocked')`

const TABS = [
  { key: 'check', label: (t: Dict) => t.tabCheck, where: CHECK_WHERE },
  // Cash-on-delivery orders are sent first and paid later, so they sit here until delivered.
  { key: 'send', label: (t: Dict) => t.tabSend, where: TO_SEND },
  { key: 'done', label: (t: Dict) => t.tabDone, where: `o.status = 'paid'` },
  { key: 'all', label: (t: Dict) => t.tabAll, where: `o.status <> 'expired' OR ?2 = 0` },
] as const

// ---------- Shipping labels: a print page for everything in "To send" (no PDF service, the browser prints) ----------
app.get('/orders/labels', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, d.title, v.label FROM orders o JOIN drops d ON d.id = o.drop_id JOIN variants v ON v.id = o.variant_id
     WHERE o.seller_id = ? AND ${TO_SEND}
     ORDER BY o.created_at`,
  ).bind(s.id).all<Order & { title: string; label: string }>()
  // One label per parcel: lines paid together (a cart) go in one box.
  const parcels = new Map<string, (Order & { title: string; label: string })[]>()
  for (const o of results) parcels.set(cartKeyOf(o), [...(parcels.get(cartKeyOf(o)) ?? []), o])
  const css = `${BASE_CSS}
    body{background:#fff}.bar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}
    .sheet{display:grid;grid-template-columns:1fr 1fr;gap:4mm;padding:4mm;max-width:210mm;margin:0 auto}
    .lbl{border:1.5px dashed #9a9087;border-radius:3mm;padding:4mm 5mm;min-height:66mm;break-inside:avoid;page-break-inside:avoid;color:#000;background:#fff;font-size:11pt;line-height:1.35}
    .lbl .k{font-size:8pt;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#555}.lbl .to{font-size:13pt;font-weight:800;margin:1mm 0}
    .lbl .addr{white-space:pre-line}.lbl .items{border-top:1px solid #ccc;margin-top:2mm;padding-top:2mm;font-size:9.5pt}.lbl .cod{font-weight:900;margin-top:1.5mm}
    .lbl .from{border-top:1px solid #ccc;margin-top:2mm;padding-top:2mm;font-size:9pt}
    @page{size:A4;margin:8mm}@media print{.bar{display:none}.sheet{padding:0;gap:4mm}body{background:#fff}}
    @media (prefers-color-scheme:dark){body{background:var(--bg)}}`
  const no = (o: Order) => shortNo(cartKeyOf(o))
  return c.html(
    <html lang={t.lang}>
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>{t.labelsTitle} – {s.shop_name}</title><style>{raw(css)}</style></head>
      <body>
        <div class="bar">
          <a class="back" href="/app/orders?tab=send">← {t.ordersPageTitle}</a>
          <button type="button" class="btn primary sm" onclick="print()"><Icon n="receipt" s={16} />{t.labelsPrint}</button>
        </div>
        <h1 class="vh">{t.labelsTitle}</h1>
        <p class="muted" style="text-align:center;margin:10px 16px;font-size:.88rem">{parcels.size ? t.labelsHint : t.labelsNone}</p>
        <div class="sheet">
          {[...parcels.values()].map((lines) => {
            const o = lines[0]
            const cod = o.pay_mode === 'cod' && o.status === 'pending'
            return (
              <div class="lbl">
                <div class="k">{t.labelsTo}</div>
                <div class="to">{o.buyer_name}</div>
                <div class="addr">{o.address}</div>
                <div>{displayPhone(o.buyer_phone)}</div>
                <div class="items">#{no(o)} · {lines.map((l) => `${clip(l.title, 34)}${l.label ? ` (${l.label})` : ''} ×${l.qty}`).join(' · ')}</div>
                {cod && <div class="cod">COD – {t.collectCash(rupees(lines.reduce((n, l) => n + l.amount_paise, 0)))}</div>}
                <div class="from"><span class="k">{t.labelsFrom}</span> {s.shop_name} · {displayPhone(s.phone)}</div>
              </div>
            )
          })}
        </div>
      </body>
    </html>,
  )
})

app.get('/orders', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const now = Date.now()
  const counts = await c.env.DB
    // The "Check payment" number counts only what needs the seller (buyer says paid, refunds) – the same number
    // as "N payments to check" on home. Buyers still paying are listed in the tab, but not counted.
    .prepare(`SELECT ${TABS.slice(0, 2).map((x) => `COUNT(DISTINCT CASE WHEN ${x.key === 'check' ? `o.status IN ('verifying', 'refund_due')` : x.where} THEN COALESCE(o.cart_id, o.id) END) AS "${x.key}"`).join(', ')},
              COUNT(DISTINCT CASE WHEN ${CHECK_WHERE} THEN COALESCE(o.cart_id, o.id) END) AS anycheck FROM orders o WHERE o.seller_id = ?1`)
    .bind(s.id, now)
    .first<Record<string, number>>()
  // Open on the first tab that has work in it, so the seller lands on what needs doing.
  const tab = TABS.find((x) => x.key === c.req.query('tab')) ?? TABS.find((x) => (counts?.[x.key] ?? 0) > 0) ?? ((counts?.anycheck ?? 0) > 0 ? TABS[0] : TABS[2])
  const { results } = await c.env.DB
    .prepare(`SELECT o.*, d.title, d.image_key, v.label FROM orders o JOIN drops d ON d.id = o.drop_id JOIN variants v ON v.id = o.variant_id
              WHERE o.seller_id = ?1 AND (${tab.where})
              ORDER BY CASE o.status WHEN 'verifying' THEN 0 WHEN 'refund_due' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, o.created_at DESC LIMIT 200`)
    .bind(...(tab.where.includes('?2') ? [s.id, now] : [s.id]))
    .all<OrderRow>()
  const origin = new URL(c.req.url).origin
  // Items paid together share one card (cart key = first item's id), in list order.
  const byKey = new Map<string, OrderRow[]>()
  for (const r of results) byKey.set(r.cart_id ?? r.id, [...(byKey.get(r.cart_id ?? r.id) ?? []), r])
  const groups = [...byKey.values()].map((g) => g.sort((a, b) => a.created_at - b.created_at))
  // Shiprocket parcels for these orders (only for sellers who connected it).
  const keys = groups.map((g) => cartKeyOf(g[0]))
  const ships = new Map<string, ShipmentRow>()
  if (s.sr_email && keys.length) for (const r of (await c.env.DB.prepare(`SELECT * FROM shipments WHERE ${ACTIVE_SHIP} AND order_key IN (${keys.map(() => '?').join(',')}) ORDER BY created_at`).bind(...keys).all<ShipmentRow>()).results) ships.set(r.order_key, r)
  return page(c, 'orders', t.ordersPageTitle, (
    <>
      <div class="row between"><h1>{t.ordersPageTitle}</h1><a class="btn sm" href="/app/quick-order"><Icon n="edit" s={16} />{t.qoTitle}</a></div>
      <div class="tabs">
        {TABS.map((x) => (
          <a href={`/app/orders?tab=${x.key}`} class={x.key === tab.key ? 'on' : ''}>
            {x.label(t)}{counts && x.key in counts ? ` (${counts[x.key]})` : ''}
          </a>
        ))}
      </div>
      <Flash msg={c.req.query('err')} />
      {tab.key === 'send' && results.length > 0 && toolOn(s, 'labels') && (
        <a class="btn block sm" href="/app/orders/labels" style="margin:4px 0 8px"><Icon n="receipt" s={18} />{t.labelsBtn(new Set(results.map((o) => cartKeyOf(o))).size)}</a>
      )}
      {results.length === 0 && (tab.key === 'check' ? <Empty icon="search" title={t.emptyCheckT} sub={t.emptyCheckS} /> : tab.key === 'send' ? <Empty icon="box" title={t.emptySendT} sub={t.emptySendS} /> : <Empty icon="receipt" title={t.emptyDoneT} sub={t.emptyDoneS} />)}
      <div class="ordergrid">
      {groups.map((g, i) => (
        <>
          {tab.key === 'check' && ['pending', 'expired'].includes(g[0].status) && !['pending', 'expired'].includes(groups[i - 1]?.[0].status ?? '') && (
            <>
              <h2>{t.waitingMoney}</h2>
              <p class="hint" style="margin-top:-4px">{t.waitingMoneySub}</p>
            </>
          )}
          <OrderCard t={t} o={g[0]} group={g} origin={origin} shop={s.shop_name} ship={ships.get(cartKeyOf(g[0]))} sr={Boolean(s.sr_email)} />
        </>
      ))}
      </div>
    </>
  ), PULSE_JS, t.sayOrders)
})

const ownOrder = (c: Context<AppEnv>, id: string) =>
  c.env.DB.prepare(`SELECT * FROM orders WHERE id = ? AND seller_id = ?`).bind(id, c.get('seller').id).first<Order>()

app.post('/orders/:id/received', async (c) => {
  const o = await ownOrder(c, c.req.param('id'))
  if (!o) return c.notFound()
  await markCartPaid(c.env, o.id, o.utr ? `utr:${o.utr}` : 'manual', (p) => c.executionCtx.waitUntil(p))
  return backWith(c, '/app/orders', tr(c).markedPaid)
})

// The buyer's payment screenshot – only for the seller who owns the order.
app.get('/proof/:id', async (c) => {
  const o = await ownOrder(c, c.req.param('id'))
  const obj = o?.proof_key ? await c.env.IMAGES.get(o.proof_key) : null
  if (!obj) return c.notFound()
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } })
})

app.post('/orders/:id/reject', async (c) => {
  await rejectCart(c.env, c.req.param('id'), c.get('seller').id, (p) => c.executionCtx.waitUntil(p))
  return backWith(c, '/app/orders', tr(c).markedNotPaid)
})

app.post('/orders/:id/ship', async (c) => {
  const t = tr(c)
  const o = await ownOrder(c, c.req.param('id'))
  const next = o && NEXT_SHIP[o.ship_status]
  if (!o || !next) return c.redirect('/app/orders?tab=send', 303)
  // Items paid together are packed and sent together.
  const r = await c.env.DB.prepare(`UPDATE orders SET ship_status = ?1 WHERE (id = ?2 OR cart_id = ?2) AND (status = 'paid' OR (status = 'pending' AND pay_mode = 'cod')) AND ship_status = ?3`).bind(next, cartKeyOf(o), o.ship_status).run()
  if (r.meta.changes > 0) c.executionCtx.waitUntil(notifyBuyer(c.env, cartKeyOf(o), 'ship'))
  return backWith(c, '/app/orders?tab=send', t.markedShip(t.ship[next]))
})

// Cash on delivery: the cash is in hand → the order becomes paid and goes into the khata.
app.post('/orders/:id/cash', async (c) => {
  const o = await ownOrder(c, c.req.param('id'))
  if (o && shownStatus(o) === 'cod') await markPaid(c.env, o.id, 'cash-on-delivery', (p) => c.executionCtx.waitUntil(p), false)
  return backWith(c, '/app/orders?tab=send', tr(c).cashMarked)
})

app.post('/orders/:id/cancel-cod', async (c) => {
  await cancelCod(c.env, c.req.param('id'), c.get('seller').id)
  return backWith(c, '/app/orders?tab=send', tr(c).codCancelled)
})

// ---------- Khata (ledger) ----------

type Entry = { id: number; kind: 'credit' | 'debit'; amount_paise: number; note: string; created_at: number; order_id: string | null }

app.get('/khata', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const db = c.env.DB
  const now = Date.now()
  const monthStart = Date.parse(istDay(now).slice(0, 8) + '01T00:00:00Z') - 330 * 60000
  const since = istDayStart(now) - 13 * 86_400_000
  const sum = (from: number) =>
    db.prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'credit' THEN amount_paise ELSE 0 END), 0) AS cr, COALESCE(SUM(CASE kind WHEN 'debit' THEN amount_paise ELSE 0 END), 0) AS dr FROM ledger WHERE seller_id = ? AND created_at >= ?`)
      .bind(s.id, from).first<{ cr: number; dr: number }>()
  const [today, month, all, { results: entries }, costs] = await Promise.all([
    sum(istDayStart(now)), sum(monthStart), sum(0),
    db.prepare(`SELECT * FROM ledger WHERE seller_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 300`).bind(s.id, since).all<Entry>(),
    // Product cost of what was sold this month (copied onto each order), and whether any cost was ever set.
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'paid' AND paid_at >= ?2 THEN cost_paise ELSE 0 END), 0) AS month,
                       (SELECT COUNT(*) FROM drops WHERE seller_id = ?1 AND cost_paise > 0) AS priced
                FROM orders WHERE seller_id = ?1`).bind(s.id, monthStart).first<{ month: number; priced: number }>(),
  ])
  // Group the last 14 days by IST calendar day.
  const days = new Map<string, Entry[]>()
  for (const e of entries) {
    const d = istDay(e.created_at)
    days.set(d, [...(days.get(d) ?? []), e])
  }
  const fmtDay = (d: string) => (d === istDay(now) ? t.today : d === istDay(now - 86_400_000) ? t.yesterday : d.split('-').reverse().join('/'))
  const net = (x: { cr: number; dr: number } | null) => (x?.cr ?? 0) - (x?.dr ?? 0)
  const add = c.req.query('add') === 'debit' ? 'debit' : c.req.query('add') === 'credit' || c.req.query('err') ? 'credit' : null

  return page(c, 'khata', t.khataTitle, (
    <>
      <h1>{t.khataTitle}</h1>
      <div class="duo">
        <div class="card" style="background:var(--ok-soft);border-color:transparent"><small>{t.today}</small><div class="stat">{rupees(net(today))}</div></div>
        <div class="card"><small>{t.thisMonth}</small><div class="stat">{rupees(net(month))}</div></div>
      </div>
      <p><small>{t.allTime(rupees(all?.cr ?? 0), rupees(all?.dr ?? 0))}</small></p>
      {!toolOn(s, 'profit') ? null : (costs?.priced ?? 0) > 0 ? (
        <div class="card" style="border-color:var(--ok)">
          <div class="row between"><b>{t.profitTitle}</b><b style="font-size:1.25rem;color:var(--ok)">{rupees((month?.cr ?? 0) - (month?.dr ?? 0) - (costs?.month ?? 0))}</b></div>
          <small>{t.profitLine(rupees(month?.cr ?? 0), rupees(costs?.month ?? 0), rupees(month?.dr ?? 0))}</small>
        </div>
      ) : (all?.cr ?? 0) > 0 ? <p class="muted" style="margin-top:-4px"><small>{t.profitHint}</small></p> : null}
      <Flash msg={c.req.query('err')} />

      {add ? (
        <form method="post" action="/app/khata" class="card stack" style={`border:2px solid var(--${add === 'debit' ? 'bad' : 'ok'})`}>
          <input type="hidden" name="kind" value={add} />
          <b style={`color:var(--${add === 'debit' ? 'bad' : 'ok'});font-size:1.1rem`}>{add === 'debit' ? t.moneyOut : t.moneyIn}</b>
          <div class="money"><span>₹</span><input name="amount" inputmode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" placeholder="0" required autofocus aria-label={t.amount} /></div>
          <input name="note" placeholder={t.notePh} maxlength={120} />
          <div class="row">
            <a class="btn" href="/app/khata" aria-label="Clear"><Icon n="x" s={18} /></a>
            <button class={`btn grow ${add === 'debit' ? 'primary' : 'ok'}`} type="submit">{t.save}</button>
          </div>
        </form>
      ) : (
        <div class="row">
          <a class="btn ok grow" href="/app/khata?add=credit">{t.moneyIn}</a>
          <a class="btn grow" href="/app/khata?add=debit" style="background:var(--bad);border-color:var(--bad);color:#fff">{t.moneyOut}</a>
        </div>
      )}

      {[...days.entries()].map(([d, list]) => {
        const cr = list.filter((e) => e.kind === 'credit').reduce((n, e) => n + e.amount_paise, 0)
        const dr = list.filter((e) => e.kind === 'debit').reduce((n, e) => n + e.amount_paise, 0)
        return (
          <>
            <h2 class="row between"><span>{fmtDay(d)}</span><small>+{rupees(cr)}{dr ? ` · −${rupees(dr)}` : ''}</small></h2>
            <div class="card" style="padding:4px 16px">
              {list.map((e, i) => (
                <div class="row between" style={`padding:12px 0;${i ? 'border-top:1px solid var(--line)' : ''}`}>
                  <div class="grow">
                    <div>{e.note || (e.kind === 'credit' ? t.moneyIn : t.moneyOut)}</div>
                    <small>{new Date(e.created_at + 330 * 60000).toISOString().slice(11, 16)}{e.order_id ? ` · #${shortNo(e.order_id)}` : ''}</small>
                  </div>
                  <b style={`color:var(--${e.kind === 'credit' ? 'ok' : 'bad'})`}>{e.kind === 'credit' ? '+' : '−'}{rupees(e.amount_paise)}</b>
                </div>
              ))}
            </div>
          </>
        )
      })}
      {entries.length === 0 && <Empty icon="book" title={t.khataEmptyT} sub={t.noEntries} />}
      <a class="btn block" style="margin-top:20px" href="/app/khata.csv"><Icon n="download" s={18} />{t.downloadCsv}</a>
    </>
  ), PULSE_JS, t.sayKhata)
})

app.post('/khata', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const amount = parsePaise(String(f.amount ?? ''))
  const kind = f.kind === 'debit' ? 'debit' : 'credit'
  if (!amount) return c.redirect('/app/khata?err=' + enc(t.badAmount), 303)
  await c.env.DB.prepare(`INSERT INTO ledger (seller_id, kind, amount_paise, note, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(c.get('seller').id, kind, amount, String(f.note ?? '').trim().slice(0, 120), Date.now()).run()
  return c.redirect('/app/khata?ok=' + enc(t.entrySaved), 303)
})

app.get('/khata.csv', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM ledger WHERE seller_id = ? ORDER BY created_at`).bind(c.get('seller').id).all<Entry>()
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = results.map((e) =>
    [new Date(e.created_at + 330 * 60000).toISOString().slice(0, 16).replace('T', ' '), e.kind === 'credit' ? 'IN' : 'OUT', (e.amount_paise / 100).toFixed(2), q(e.note), e.order_id ?? ''].join(','),
  )
  // Leading BOM so Excel opens Hindi text and ₹ correctly.
  return c.body('﻿' + ['Date (IST),Type,Amount (INR),Note,Order', ...rows].join('\n'), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="khata-${istDay(Date.now())}.csv"`,
  })
})

// ---------- Settings ----------

app.get('/settings', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const allowed = parseModes(s.allowed_modes)
  const origin = new URL(c.req.url).origin
  const upis = await sellerUpis(c.env.DB, s.id)
  return page(c, 'settings', t.settingsTitle, (
    <>
      <h1>{t.settingsTitle}</h1>
      <Flash msg={c.req.query('err')} />

      <h2>{t.upiIdsTitle}</h2>
      <p class="hint" style="margin-top:-4px">{t.upiIdsHint}</p>
      <div class="card" style="padding:4px 16px">
        {upis.map((u, i) => (
          <div class="row" style={`padding:12px 0;${i ? 'border-top:1px solid var(--line)' : ''}`}>
            <div class="grow">
              <b style="overflow-wrap:anywhere">{u.vpa}</b> {u.vpa === s.upi_vpa && <span class="chip paid">{t.defaultTag}</span>}
              {u.label && <small style="display:block">{u.label}</small>}
            </div>
            {u.vpa !== s.upi_vpa && (
              <>
                <form method="post" action={`/app/upi/${u.id}/default`}><button class="btn sm" type="submit">{t.makeDefault}</button></form>
                <form method="post" action={`/app/upi/${u.id}/remove`}><button class="btn sm ghost" type="submit" aria-label={t.removeUpi} style="border:0;padding:0 8px">✕</button></form>
              </>
            )}
          </div>
        ))}
      </div>
      <details class="card">
        <summary>{t.addUpi}</summary>
        <form method="post" action="/app/upi/add" class="stack">
          <input name="vpa" placeholder="name@bank" autocapitalize="off" spellcheck={false} required aria-label={t.upiId} />
          <input name="label" placeholder={t.upiLabelPh} maxlength={40} />
          <button class="btn primary block" type="submit">{t.save}</button>
        </form>
      </details>

      <form method="post" data-mode={s.pay_mode}>
        <h2>{t.shopDetails}</h2>
        <div class="card stack">
          <div><label for="shop">{t.shopName}</label><input id="shop" name="shop" value={s.shop_name} required maxlength={60} /></div>
        </div>

        <h2 id="pay">{t.howPaid}</h2>
        {allowed.length === 1 && <p class="hint" style="margin-top:-4px">{t.fixedByAdmin}</p>}
        <div class="stack">
          {allowed.includes('direct') && (
          <label class="choice">
            <input type="radio" name="mode" value="direct" checked={s.pay_mode === 'direct'} />
            <span>
              <b>{t.opt1}</b><span class="tag">{t.opt1Tag}</span><br />
              <small><b>{t.directTitle}.</b> {t.directBody}</small><br />
              <small style="color:var(--ok);font-weight:600">{t.opt1Best}</small>
            </span>
          </label>
          )}

          {!allowed.includes('razorpay') && (
            <div class="optgroup stack">
              <div><b>{t.opt2}</b><br /><small>{t.opt2Best}</small><br /><small>{t.opt2Fee}</small></div>
              {s.gateway_request
                ? <div class="alert info" style="margin:0">{t.gatewayPending}</div>
                : <button class="btn block" type="submit" formaction="/app/gateway-request" formnovalidate>{t.requestGateway}</button>}
            </div>
          )}
          {allowed.includes('razorpay') && (
          <div class="optgroup stack">
            <div>
              <b>{t.opt2}</b><br />
              <small>{t.opt2Best}</small><br />
              <small>{t.opt2Fee}</small>
            </div>
            {allowed.includes('razorpay') && (<>
            <label class="choice">
              <input type="radio" name="mode" value="razorpay" checked={s.pay_mode === 'razorpay'} />
              <span><b>{t.rzpTitle}</b><span class="tag">{t.rzpTag}</span><br /><small>{t.rzpBody}</small></span>
            </label>
            <div class="gw gw-rzp stack">
              <small>{t.rzpWhere} <a href="/help/razorpay">{t.rzpGuide}</a></small>
              <input name="rzp_key" placeholder={t.rzpKeyId} value={s.rzp_key_id ?? ''} autocapitalize="off" spellcheck={false} aria-label={t.rzpKeyId} />
              <input name="rzp_secret" type="password" placeholder={`${t.rzpSecret} ${s.rzp_secret_enc ? t.rzpSaved : ''}`} autocomplete="off" aria-label={t.rzpSecret} />
              <details>
                <summary style="font-weight:600">{t.rzpHookTitle}</summary>
                <div class="stack">
                  <small>{t.rzpHook}</small>
                  <div class="row"><input id="hook" value={`${origin}/webhooks/razorpay/${s.id}`} readonly aria-label="webhook" /><button type="button" class="btn sm" data-copy="#hook">⧉</button></div>
                  <input name="rzp_webhook" type="password" placeholder={`${t.rzpHookSecret} ${s.rzp_webhook_enc ? t.rzpSaved : ''}`} autocomplete="off" aria-label={t.rzpHookSecret} />
                </div>
              </details>
            </div>
            </>)}

          </div>
          )}
        </div>
        <button class="btn primary block big" type="submit" style="margin-top:16px">{t.saveSettings}</button>
      </form>

      <h2>{t.waTitle}</h2>
      <div class="card"><p>{waEnabled(c.env) && c.env.WA_ORDER_TEMPLATE ? t.waAuto : t.waManual}</p></div>

      <label class="choice" style="margin-top:20px">
        <input type="checkbox" id="sound" checked />
        <span><b>{t.soundToggle}</b><br /><small>{t.soundHint}</small></span>
      </label>
      <script>{raw(`(function(){var c=document.getElementById('sound');try{c.checked=localStorage.getItem('kk_sound')!=='0'}catch(e){}c.onchange=function(){try{localStorage.setItem('kk_sound',c.checked?'1':'0')}catch(e){}if(c.checked)say(${JSON.stringify(t.soundNew)})}})()`)}</script>

      <h2>{t.language}</h2>
      <div class="pills two">
        <a class="btn grow" href={`/lang?to=en&back=/app/settings`} style={t.lang === 'en' ? 'border-color:var(--brand);color:var(--brand)' : ''}>English</a>
        <a class="btn grow" href={`/lang?to=hi&back=/app/settings`} style={t.lang === 'hi' ? 'border-color:var(--brand);color:var(--brand)' : ''}>हिंदी</a>
      </div>

      {pushEnabled(c.env) && (
        <>
          <h2 id="alerts-h">{t.alertsTitle}</h2>
          <div class="card stack" id="alerts" data-vapid={c.env.VAPID_PUBLIC} data-enabled={t.alertsEnabled} data-blocked={t.alertsBlocked} data-ios={t.alertsIos} data-unsupported={t.alertsUnsupported}>
            <p style="margin:0">{t.alertsBody}</p>
            <small data-st style="display:block" />
            <button type="button" class="btn primary block" data-on>{t.alertsOn}</button>
            <form method="post" action="/app/push/test" data-test hidden><button class="btn block sm" type="submit">{t.alertsTest}</button></form>
          </div>
          <script>{raw(ALERTS_JS)}</script>
        </>
      )}

      <h2 id="pin">{t.changePinTitle}</h2>
      <form method="post" action="/app/pin" class="card stack">
        <div><label for="curpin">{t.currentPin}</label><PinInput id="curpin" name="current" t={t} autocomplete="current-password" /></div>
        <div><label for="newpin">{t.newPinLabel}</label><PinInput id="newpin" name="pin" t={t} autocomplete="new-password" /></div>
        <button class="btn block" type="submit">{t.changePinBtn}</button>
      </form>

      <h2 id="shoplink">{t.shopLinkTitle}</h2>
      <p class="hint" style="margin-top:-4px">{t.shopLinkHint}</p>
      <form method="post" action="/app/shoplink" class="card stack">
        <div class="money" style="gap:0"><span style="white-space:nowrap;font-weight:600">nukkadsale.in/</span><input name="slug" value={s.slug ?? suggestSlug(s.shop_name)} pattern="[a-z0-9][a-z0-9-]{2,29}" maxlength={30} required aria-label={t.shopLinkTitle} autocapitalize="off" spellcheck={false} /></div>
        <div class="row">
          <button class="btn grow" type="submit">{t.shopLinkSave}</button>
          {s.slug && <a class="btn wa grow" href={waLink(null, `${s.shop_name} – ${new URL(c.req.url).origin}/${s.slug}`)}><Icon n="share" s={18} />{t.shareShop}</a>}
        </div>
      </form>

      <h2 id="cartoffer">{t.cartOfferTitle}</h2>
      <p class="hint" style="margin-top:-4px">{t.cartOfferHint}</p>
      <form method="post" action="/app/cartoffer" class="card stack">
        <div><label for="omin">{t.cartOfferMin}</label><div class="money"><span>₹</span><input id="omin" name="min" inputmode="decimal" placeholder="1500" value={s.offer_min_paise ? String(s.offer_min_paise / 100) : ''} /></div></div>
        <div class="duo">
          <div><label for="ooff">{t.cartOfferAmt}</label><div class="money"><span>₹</span><input id="ooff" name="off" inputmode="decimal" placeholder="150" value={s.offer_off_paise ? String(s.offer_off_paise / 100) : ''} /></div></div>
          <div><label for="opct">{t.cartOfferPct}</label><div class="money"><input id="opct" name="pct" inputmode="numeric" placeholder="10" value={s.offer_pct ? String(s.offer_pct) : ''} /><span>%</span></div></div>
        </div>
        {(s.offer_min_paise ?? 0) > 0 && <div class="alert ok" style="margin:0">{t.offerBanner(rupees(s.offer_min_paise!), s.offer_off_paise ? rupees(s.offer_off_paise) : `${s.offer_pct}%`)}</div>}
        <div class="row">
          <button class="btn grow" type="submit">{t.cartOfferSave}</button>
          {(s.offer_min_paise ?? 0) > 0 && <button class="btn grow ghost" type="submit" name="clear" value="1">{t.cartOfferOff}</button>}
        </div>
      </form>

      <a class="card task" href="/app/ship" id="shipping"><span class="ic"><Icon n="box" /></span><span class="grow"><b>{t.shipTitle}</b><small>{s.sr_email ? t.shipConnected(s.sr_email) : t.srHint}</small></span><span class="go"><Icon n="chevron" s={18} /></span></a>

      <h2 id="tools">{t.toolsTitle}</h2>
      <p class="hint" style="margin-top:-4px">{t.toolsHint}</p>
      <form method="post" action="/app/tools" class="card" style="padding:4px 16px">
        {t.toolsList.map(([key, name, sub], i) => (
          <label class="row" style={`padding:12px 0;gap:12px;align-items:center;cursor:pointer;${i ? 'border-top:1px solid var(--line)' : ''}`}>
            <span class="grow"><b style="display:block">{name}</b><small>{sub}</small></span>
            <input type="checkbox" class="switch" name="on" value={key} checked={toolOn(s, key as Tool)} aria-label={name} />
          </label>
        ))}
        <button class="btn block" type="submit" style="margin:4px 0 12px">{t.save}</button>
      </form>
      <div style="margin-top:20px"><InstallCard t={t} always /></div>
      <a class="btn block" href="/app/billing" style="margin-top:24px">{t.billingLink}</a>
      <a class="btn block" href="/app/help" style="margin-top:10px"><Icon n="help" s={18} />{t.help}</a>
      <p class="muted" style="margin-top:20px;text-align:center"><small>{t.loggedInAs(s.name, displayPhone(s.phone))}</small></p>
      <form method="post" action="/logout"><button class="btn block ghost" type="submit">{t.logOut}</button></form>
    </>
  ), '', t.saySettings)
})

// ---------- Order alerts (Web Push) ----------

const ALERTS_JS = `(function(){var box=document.getElementById('alerts');if(!box)return;var on=box.querySelector('[data-on]'),st=box.querySelector('[data-st]'),test=box.querySelector('[data-test]');
function say(k){st.textContent=box.dataset[k]||''}
function done(){on.hidden=true;test.hidden=false;say('enabled')}
var ios=/iPhone|iPad|iPod/.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){on.hidden=true;say(ios&&!standalone?'ios':'unsupported');return}
if(Notification.permission==='denied'){on.hidden=true;say('blocked');return}
function key(s){s=s.replace(/-/g,'+').replace(/_/g,'/');var r=atob(s+'==='.slice((s.length+3)%4)),a=new Uint8Array(r.length);for(var i=0;i<r.length;i++)a[i]=r.charCodeAt(i);return a}
function save(sub){return fetch('/app/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sub:sub.toJSON(),lang:document.documentElement.lang})}).then(function(r){if(!r.ok)throw 0})}
// Already on: refresh the saved subscription (keeps the language current).
navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription()}).then(function(s){if(s){done();save(s).catch(function(){})}}).catch(function(){});
on.onclick=function(){Notification.requestPermission().then(function(p){if(p!=='granted'){say(p==='denied'?'blocked':'unsupported');return}
  return navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription().then(function(s){return s||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(box.dataset.vapid)})})}).then(save).then(done)})
  .catch(function(){say('unsupported')})}})();`

app.post('/push/subscribe', async (c) => {
  const s = c.get('seller')
  type SubBody = { sub?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; lang?: string }
  const body: SubBody = await c.req.json<SubBody>().catch(() => ({}))
  const endpoint = String(body.sub?.endpoint ?? ''), p256dh = String(body.sub?.keys?.p256dh ?? ''), auth = String(body.sub?.keys?.auth ?? '')
  if (!allowedEndpoint(c.env, endpoint) || endpoint.length > 1000 || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,32}$/.test(auth)) return c.json({ ok: false }, 400)
  await c.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, seller_id, p256dh, auth, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET seller_id = excluded.seller_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`,
  ).bind(endpoint, s.id, p256dh, auth, body.lang === 'hi' ? 'hi' : 'en', Date.now()).run()
  return c.json({ ok: true })
})

app.post('/push/test', async (c) => {
  const t = tr(c)
  await pushToSeller(c.env, c.get('seller').id, (lang) => ({ title: dictFor(lang).pushTestTitle, body: dictFor(lang).pushTestBody, url: '/app/orders', tag: 'test' }))
  return backWith(c, '/app/settings', t.alertsTestSent)
})

app.post('/pin', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const f = await c.req.parseBody()
  const back = (k: 'ok' | 'err', m: string) => c.redirect(`/app/settings?${k}=${encodeURIComponent(m)}#pin`, 303)
  const current = String(f.current ?? ''), pin = String(f.pin ?? '')
  const row = await c.env.DB.prepare(`SELECT pin_hash, pin_salt FROM sellers WHERE id = ?`).bind(s.id).first<{ pin_hash: string; pin_salt: string }>()
  if (!row || (await hashPin(current, row.pin_salt, c.env.SECRET_KEY)) !== row.pin_hash) return back('err', t.wrongCurrentPin)
  if (!/^\d{4,6}$/.test(pin)) return back('err', t.badPin)
  if (pin === current) return back('err', t.samePin)
  await setPin(c.env, s.id, pin, false)
  return back('ok', t.pinChanged)
})

app.post('/settings', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const f = await c.req.parseBody()
  const fail = (m: string) => c.redirect('/app/settings?err=' + enc(m), 303)
  const shop = String(f.shop ?? '').trim().slice(0, 60)
  const mode: PayMode = f.mode === 'razorpay' ? 'razorpay' : 'direct'
  if (!parseModes(s.allowed_modes).includes(mode)) return fail(t.modeNotAllowed)
  const key = String(f.rzp_key ?? '').trim()
  const secret = String(f.rzp_secret ?? '').trim()
  const hook = String(f.rzp_webhook ?? '').trim()
  if (!shop) return fail(t.needShopName)
  if (key && !/^rzp_(live|test)_[A-Za-z0-9]+$/.test(key)) return fail(t.rzpBadKey)
  const secretEnc = secret ? await encrypt(secret, c.env.SECRET_KEY) : s.rzp_secret_enc
  const hookEnc = hook ? await encrypt(hook, c.env.SECRET_KEY) : s.rzp_webhook_enc
  // Razorpay needs only the keys: payments are confirmed by asking Razorpay; the webhook is optional.
  if (mode === 'razorpay' && !(key && secretEnc)) return fail(t.rzpMissing)
  if (key && isTestKey(key) && c.env.ALLOW_TEST_KEYS !== '1') return fail(t.rzpTestKey)
  // New or changed keys are checked with Razorpay now, so a typo never reaches a buyer.
  if (key && secretEnc && (secret || key !== s.rzp_key_id)) {
    const plain = secret || (await decrypt(secretEnc, c.env.SECRET_KEY))
    if ((await checkKeys(key, plain, c.env.RAZORPAY_API_BASE)) === 'bad') return fail(t.rzpKeysRejected)
  }
  await c.env.DB.prepare(
    `UPDATE sellers SET shop_name = ?, pay_mode = ?, rzp_key_id = ?, rzp_secret_enc = ?, rzp_webhook_enc = ? WHERE id = ?`,
  ).bind(shop, mode, key || null, secretEnc, hookEnc, s.id).run()
  return c.redirect('/app/settings?ok=' + enc(t.saved), 303)
})

// ---------- Help ----------

app.get('/help', (c) => {
  const t = tr(c)
  return page(c, 'settings', t.helpTitle, (
    <>
      <a class="back" href="/app/settings">← {t.settingsTitle}</a>
      <h1>{t.helpTitle}</h1>
      <h2>{t.howItWorks}</h2>
      <div class="card stack">
        {[t.step1, t.step2, t.step3].map((step, i) => (
          <div class="row" style="align-items:flex-start"><span class="num">{i + 1}</span><span>{step}</span></div>
        ))}
      </div>
      {t.faq.map(([q, a]) => (
        <details class="card">
          <summary>{q}</summary>
          <p style="margin-top:0">{a}</p>
        </details>
      ))}
      {c.env.SUPPORT_PHONE && (
        <>
          <h2>{t.needMoreHelp}</h2>
          <a class="btn wa block big" href={waLink(c.env.SUPPORT_PHONE, `Hi, I need help with NukkadSale (${c.get('seller').shop_name})`)}>{t.chatSupport}</a>
        </>
      )}
      <p class="muted" style="margin-top:24px;text-align:center"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> · <a href="/contact">Contact</a></p>
    </>
  ), '')
})

// ---------- NukkadSale plan (seller pays the platform) ----------

app.get('/billing', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  await ensureInvoices(c.env, s.id) // a trial may have just ended
  const [plan, { results: invoices }, settings] = await Promise.all([
    c.env.DB.prepare(`SELECT plan_fee_paise, trial_until FROM sellers WHERE id = ?`).bind(s.id).first<{ plan_fee_paise: number; trial_until: number }>(),
    c.env.DB.prepare(`SELECT * FROM invoices WHERE seller_id = ? ORDER BY period DESC LIMIT 24`).bind(s.id).all<Invoice>(),
    getSettings(c.env),
  ])
  const open = invoices.find((i) => i.status === 'due' || i.status === 'claimed')
  const overdue = open?.status === 'due' && open.due_at < Date.now()
  // What NukkadSale did for them, shown right above the Pay button.
  const ist = (ym: string) => Date.parse(ym + '-01T00:00:00Z') - 330 * 60_000
  const thisMonth = istDay(Date.now()).slice(0, 7)
  const [y, m] = thisMonth.split('-').map(Number)
  const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
  const value = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN paid_at >= ?2 THEN 1 END), 0) AS n, COALESCE(SUM(CASE WHEN paid_at >= ?2 THEN amount_paise END), 0) AS amt,
            COALESCE(SUM(CASE WHEN paid_at >= ?3 AND paid_at < ?2 THEN 1 END), 0) AS n_last, COALESCE(SUM(CASE WHEN paid_at >= ?3 AND paid_at < ?2 THEN amount_paise END), 0) AS amt_last
     FROM orders WHERE seller_id = ?1 AND status = 'paid' AND paid_at >= ?3`,
  ).bind(s.id, ist(thisMonth), ist(lastMonth)).first<{ n: number; amt: number; n_last: number; amt_last: number }>()
  const online = onlineFeePayments(settings)
  const use = await planUsage(c.env, s.id, asPlan(s.plan))
  const upi = open && settings.upi_vpa ? upiLink(settings.upi_vpa, settings.payee_name, open.amount_paise, `NukkadSale ${open.period} ${s.shop_name}`) : null
  return page(c, 'settings', t.billingTitle, (
    <>
      <a class="back" href="/app/settings">← {t.settingsTitle}</a>
      <h1>{t.billingTitle}</h1>
      <PlanMeter t={t} use={use} />
      {plan && plan.plan_fee_paise > 0 && <small class="muted" style="display:block;margin:-4px 0 8px">{t.planPrice(rupees(plan.plan_fee_paise))}{plan.trial_until > Date.now() ? ` · ${t.trialTill(fmtDate(plan.trial_until))}` : ''}</small>}
      <div class="card" style="background:var(--ok-soft);border-color:transparent">
        <b style="color:var(--ok)">{t.planValue(value?.n ?? 0, rupees(value?.amt ?? 0))}</b>
        {(value?.n_last ?? 0) > 0 && <small style="display:block;margin-top:2px">{t.planValueLast(value!.n_last, rupees(value!.amt_last))}</small>}
      </div>
      <Flash msg={c.req.query('err')} />
      {open ? (
        <div class="card stack" style={`border:2px solid var(--${overdue ? 'bad' : 'warn'})`}>
          {open.plan ? (
            <>
              <b>{t.upgradeDue(t.planNames[open.plan], rupees(open.amount_paise))}</b>
              <small class="muted">{t.upgradeNote}</small>
            </>
          ) : <b style={overdue && !open.plan ? 'color:var(--bad)' : ''}>{overdue ? t.feeOverdue(rupees(open.amount_paise)) : t.feeDue(rupees(open.amount_paise), monthName(open.period, t), fmtDate(open.due_at))}</b>}
          {open.status === 'claimed' ? (
            <div class="alert info" style="margin:0">{t.feeClaimed}</div>
          ) : (
            <>
              {online && (
                <form method="post" action={`/app/billing/pay/${open.id}`}>
                  <button class="btn primary block big" type="submit">{t.payOnline(rupees(open.amount_paise))}</button>
                  <small style="display:block;text-align:center;margin-top:6px">{t.payOnlineHint}</small>
                </form>
              )}
              {upi && (
                <>
                  {online && <hr />}
                  <div>{t.payUpiTo} <b>{settings.upi_vpa}</b> · <b>{rupees(open.amount_paise)}</b></div>
                  <div data-os="android"><a class={`btn block ${online ? '' : 'primary big'}`} href={upi}>{t.payWithApp(rupees(open.amount_paise))}</a></div>
                  <div data-os="ios" hidden><div class="appgrid">{upiAppLinks(settings.upi_vpa, settings.payee_name, open.amount_paise, `NukkadSale ${open.period}`).map((a) => <a class="btn" href={a.href}>{a.name}</a>)}</div></div>
                  <form method="post" action={`/app/billing/claim/${open.id}`}>
                    <button class="btn ok block" type="submit">{t.iPaid}</button>
                    <small style="display:block;text-align:center;margin-top:6px">{t.claimHint}</small>
                  </form>
                </>
              )}
              {open.plan && (
                <form method="post" action={`/app/billing/cancel/${open.id}`}>
                  <button class="btn ghost block sm" type="submit">{t.upgradeCancel}</button>
                </form>
              )}
            </>
          )}
        </div>
      ) : (
        plan?.plan_fee_paise ? <div class="alert ok">{t.feeAllPaid}</div> : null
      )}
      {!open?.plan && higherPlans(use.plan).length > 0 && (
        <>
          <h2>{t.plansTitle}</h2>
          <UpgradeOptions t={t} current={use.plan} primaryFirst={use.near || use.reached} />
          <small class="muted" style="display:block;margin-top:8px">{t.planEvery}</small>
        </>
      )}
      {invoices.length > 0 && (
        <>
          <h2>{t.pastPayments}</h2>
          <div class="card" style="padding:4px 16px">
            {invoices.map((inv, i) => (
              <div class="row between" style={`padding:12px 0;${i ? 'border-top:1px solid var(--line)' : ''}`}>
                <span>{inv.plan ? `${t.upgradeLabel(t.planNames[inv.plan])} · ${monthName(inv.period, t)}` : monthName(inv.period, t)}</span>
                <span><b>{rupees(inv.amount_paise)}</b> <span class={`chip ${inv.status === 'paid' ? 'paid' : inv.status === 'waived' ? 'closed' : inv.status === 'claimed' ? 'verifying' : 'pending'}`}>{t.feeStatus[inv.status]}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  ), OS_JS)
})

const ownInvoice = (c: Context<AppEnv>, id: string) =>
  c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ? AND seller_id = ?`).bind(id, c.get('seller').id).first<Invoice>()

app.post('/billing/pay/:id', async (c) => {
  const inv = await ownInvoice(c, c.req.param('id'))
  if (!inv || inv.status !== 'due') return c.redirect('/app/billing', 303)
  try {
    const url = await startInvoicePayment(c.env, inv, c.get('seller'), new URL(c.req.url).origin)
    if (url) return c.redirect(url, 303)
  } catch (e) {
    console.error('invoice payment', e)
  }
  return c.redirect('/app/billing?err=' + enc(tr(c).bErrGateway), 303)
})

app.post('/billing/claim/:id', async (c) => {
  const s = c.get('seller')
  const r = await c.env.DB.prepare(`UPDATE invoices SET status = 'claimed' WHERE id = ? AND seller_id = ? AND status = 'due'`).bind(c.req.param('id'), s.id).run()
  let upgraded = ''
  if (r.meta.changes) {
    // The shop stays open while the owner checks, so tell them right away.
    const inv = await ownInvoice(c, c.req.param('id'))
    // A claimed upgrade switches the plan straight away; the admin's "Not received" switches it back.
    if (inv?.plan) { await upgradePaid(c.env, inv.id); upgraded = tr(c).planNames[inv.plan] }
    const origin = new URL(c.req.url).origin
    c.executionCtx.waitUntil(notifyOwner(c.env, `${s.shop_name} says they paid ${inv ? rupees(inv.amount_paise) : 'their fee'}`,
      `${s.shop_name} (${s.name}, ${displayPhone(s.phone)}) tapped "I have paid" for their NukkadSale fee${inv ? ` of ${rupees(inv.amount_paise)} (${inv.period})` : ''}.\n\nCheck for that exact amount in your UPI app, then mark it paid – or "Not received" – in Admin:\n${origin}/admin/billing?f=claimed\n\nTheir shop stays open until you decide.`))
  }
  return upgraded ? c.redirect('/app?ok=' + enc(tr(c).upgradeClaimed(upgraded)), 303) : c.redirect('/app/billing?ok=' + enc(tr(c).feeClaimed), 303)
})

// Move up a plan: creates (or updates) the upgrade invoice, or switches at once if this month is already paid for.
app.post('/billing/upgrade', async (c) => {
  const s = c.get('seller')
  const f = await c.req.parseBody()
  const target = asPlan(f.plan)
  const res = await requestUpgrade(c.env, s.id, asPlan(s.plan), target)
  if (res === 'applied') return c.redirect('/app?ok=' + enc(tr(c).upgradeDone(tr(c).planNames[target])), 303)
  return c.redirect('/app/billing', 303)
})

app.post('/billing/cancel/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ? AND seller_id = ? AND plan IS NOT NULL AND status = 'due'`).bind(c.req.param('id'), c.get('seller').id).run()
  return c.redirect('/app/billing', 303)
})

// Back from the platform's Razorpay page – confirm with Razorpay right away.
app.get('/billing/return/:id', async (c) => {
  const inv = await ownInvoice(c, c.req.param('id'))
  const paid = inv ? await confirmInvoice(c.env, inv.id).catch((e) => { console.error('invoice confirm', e); return false }) : false
  if (paid && inv?.plan) return c.redirect('/app?ok=' + enc(tr(c).upgradeDone(tr(c).planNames[inv.plan])), 303)
  return c.redirect('/app/billing', 303)
})

// ---------- Buyers (the seller's customer list) ----------

type BuyerRow = { phone: string; name: string; orders: number; spent: number; last: number }

const buyersQuery = (db: D1Database, sellerId: string) =>
  db.prepare(`SELECT buyer_phone AS phone, MAX(buyer_name) AS name, COUNT(*) AS orders, SUM(amount_paise) AS spent, MAX(paid_at) AS last
              FROM orders WHERE seller_id = ? AND status = 'paid' GROUP BY buyer_phone ORDER BY spent DESC LIMIT 1000`).bind(sellerId).all<BuyerRow>()

app.get('/buyers', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const { results } = await buyersQuery(c.env.DB, s.id)
  return page(c, 'home', t.buyersTitle, (
    <>
      <a class="back" href="/app">{t.backHome}</a>
      <h1>{t.buyersTitle} ({results.length})</h1>
      <p class="hint" style="margin-top:-4px">{t.buyersTip}</p>
      {results.length === 0 && <Empty icon="users" title={t.buyersEmptyT} sub={t.buyersEmpty} />}
      {results.length > 0 && <a class="btn block sm" href="/app/buyers.csv" style="margin-bottom:6px">{t.exportContacts}</a>}
      {results.map((b) => (
        <div class="card row">
          <div class="thumb" style="font-size:1.2rem;font-weight:800;color:var(--brand);background:var(--brand-soft)">{(b.name || '?').slice(0, 1).toUpperCase()}</div>
          <div class="grow">
            <div class="row between"><b>{b.name}</b><b>{rupees(b.spent)}</b></div>
            <small>{t.ordersN(b.orders)} · {t.lastOrder(fmtDate(b.last))}{b.orders > 1 ? ' · ' : ''}</small>{b.orders > 1 && <span class="chip paid">{t.repeatTag}</span>}
          </div>
          <a class="btn wa sm" href={waLink(b.phone, t.newCollectionMsg(b.name.split(' ')[0], s.shop_name))} aria-label="WhatsApp"><Icon n="chat" s={18} /></a>
        </div>
      ))}
    </>
  ), '')
})

// Phone-contacts friendly CSV (Google Contacts / WhatsApp broadcast lists).
app.get('/buyers.csv', async (c) => {
  const { results } = await buyersQuery(c.env.DB, c.get('seller').id)
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = results.map((b) => [q(b.name), '+' + b.phone, b.orders, (b.spent / 100).toFixed(2), istDay(b.last)].join(','))
  return c.body('\uFEFF' + ['Name,Phone,Orders,Total spent (INR),Last order', ...rows].join('\n'), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="buyers-${istDay(Date.now())}.csv"`,
  })
})

// ---------- UPI IDs (several per seller; one default, any one per sale) ----------

type Upi = { id: number; vpa: string; label: string }
const sellerUpis = async (db: D1Database, sellerId: string) =>
  (await db.prepare(`SELECT id, vpa, label FROM seller_upis WHERE seller_id = ? ORDER BY created_at`).bind(sellerId).all<Upi>()).results

app.post('/upi/add', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const f = await c.req.parseBody()
  const vpa = String(f.vpa ?? '').trim().toLowerCase()
  if (!isValidVpa(vpa)) return c.redirect('/app/settings?err=' + enc(t.badUpi), 303)
  const r = await c.env.DB.prepare(`INSERT OR IGNORE INTO seller_upis (seller_id, vpa, label, created_at) VALUES (?, ?, ?, ?)`)
    .bind(s.id, vpa, String(f.label ?? '').trim().slice(0, 40), Date.now()).run()
  if (r.meta.changes === 0) return c.redirect('/app/settings?err=' + enc(t.upiExists), 303)
  // The first UPI ID ever becomes the default automatically.
  if (!s.upi_vpa) await c.env.DB.prepare(`UPDATE sellers SET upi_vpa = ? WHERE id = ?`).bind(vpa, s.id).run()
  return c.redirect('/app/settings?ok=' + enc(t.upiAdded), 303)
})

app.post('/upi/:id/default', async (c) => {
  const s = c.get('seller')
  await c.env.DB.prepare(`UPDATE sellers SET upi_vpa = (SELECT vpa FROM seller_upis WHERE id = ? AND seller_id = ?) WHERE id = ? AND EXISTS (SELECT 1 FROM seller_upis WHERE id = ? AND seller_id = ?)`)
    .bind(Number(c.req.param('id')), s.id, s.id, Number(c.req.param('id')), s.id).run()
  return c.redirect('/app/settings?ok=' + enc(tr(c).saved), 303)
})

app.post('/upi/:id/remove', async (c) => {
  const s = c.get('seller')
  const u = await c.env.DB.prepare(`SELECT vpa FROM seller_upis WHERE id = ? AND seller_id = ?`).bind(Number(c.req.param('id')), s.id).first<{ vpa: string }>()
  if (u?.vpa === s.upi_vpa) return c.redirect('/app/settings?err=' + enc(tr(c).cantRemoveDefault), 303)
  // Sales that used it keep showing it on existing orders; new orders on those sales fall back to the default.
  if (u) await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM seller_upis WHERE id = ? AND seller_id = ?`).bind(Number(c.req.param('id')), s.id),
    c.env.DB.prepare(`UPDATE drops SET upi_vpa = NULL WHERE seller_id = ? AND upi_vpa = ?`).bind(s.id, u.vpa),
  ])
  return c.redirect('/app/settings?ok=' + enc(tr(c).saved), 303)
})

// Seller asks for automatic (gateway) payments; the admin sees the request and sets it up.
app.post('/gateway-request', async (c) => {
  const s = c.get('seller')
  const r = await c.env.DB.prepare(`UPDATE sellers SET gateway_request = 1 WHERE id = ? AND gateway_request = 0`).bind(s.id).run()
  if (r.meta.changes) {
    const origin = new URL(c.req.url).origin
    c.executionCtx.waitUntil(notifyOwner(c.env, `${s.shop_name} wants automatic payments (Razorpay)`,
      `${s.shop_name} (${s.name}, ${displayPhone(s.phone)}) asked for automatic payments.\n\nSend them the keys guide: ${origin}/help/razorpay\nThen switch on Razorpay for their shop: ${origin}/admin/sellers/${s.id}#payments`))
  }
  return c.redirect('/app/settings?ok=' + enc(tr(c).gatewayRequested) + '#pay', 303)
})

// ---------- Quick order (buyer messaged the seller directly) ----------

app.get('/quick-order', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const { results: drops } = await c.env.DB.prepare(`SELECT * FROM drops WHERE seller_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 40`).bind(s.id).all<Drop>()
  const variants = drops.length
    ? (await c.env.DB.prepare(`SELECT * FROM variants WHERE drop_id IN (${drops.map(() => '?').join(',')}) AND available > 0 ORDER BY position`).bind(...drops.map((d) => d.id)).all<Variant>()).results
    : []
  const live = drops.filter((d) => variants.some((v) => v.drop_id === d.id))
  return page(c, 'orders', t.qoTitle, (
    <>
      <a class="back" href="/app/orders">← {t.ordersPageTitle}</a>
      <h1>{t.qoTitle}</h1>
      <p class="hint" style="margin-top:-4px">{t.qoHint}</p>
      <Flash msg={c.req.query('err')} />
      {live.length === 0 ? (
        <>
          <p class="muted">{t.qoNoSales}</p>
          <a class="btn primary block" href="/app/drops/new">{t.newSale}</a>
        </>
      ) : (
        <form method="post" class="stack">
          <div class="sec"><span class="num">1</span>{t.qoBuyer}</div>
          <div><label for="phone">{t.phone}</label><PhoneInput id="phone" name="phone" /></div>
          <div><label for="name">{t.qoNameOpt}</label><input id="name" name="name" maxlength={60} /></div>
          <div class="sec"><span class="num">2</span>{t.qoWhat}</div>
          {live.map((d) => (
            <div class="card">
              <div class="row">
                {d.image_key ? <img class="thumb" src={`/img/${d.image_key}`} alt="" loading="lazy" /> : <div class="thumb"><Icon n="bag" s={22} /></div>}
                <div class="grow"><b>{clip(d.title, 40)}</b><div><small>{rupees(d.price_paise)}</small></div></div>
              </div>
              {variants.filter((v) => v.drop_id === d.id).map((v) => (
                <div class="row between" style="margin-top:10px">
                  <span>{v.label || t.quantity} <small>· {t.leftNow(v.available)}</small></span>
                  <Stepper id={`q${v.id}`} name={`q_${v.id}`} value={0} min={0} max={v.available} compact label={`${d.title} ${v.label || ''} – ${t.quantity}`} />
                </div>
              ))}
            </div>
          ))}
          <details class="card">
            <summary>{t.qoAddress}</summary>
            <div class="stack">
              <textarea name="address" maxlength={400} placeholder={t.addressPh} aria-label={t.qoAddress} />
              <input name="pincode" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength={6} placeholder={t.pincode} aria-label={t.pincode} />
              <div class="hint">{t.qoAddressHint}</div>
            </div>
          </details>
          <div class="sticky-pay"><button class="btn primary block big" type="submit">{t.qoMake}</button></div>
        </form>
      )}
    </>
  ), '')
})

app.post('/quick-order', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const fail = (m: string) => c.redirect('/app/quick-order?err=' + enc(m), 303)
  if (await salesBlocked(c)) return fail((await salesBlocked(c))!)
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  if (!phone) return fail(t.bErrPhone)
  const picks = Object.entries(f).filter(([k, v]) => k.startsWith('q_') && Number(v) > 0).map(([k, v]) => ({ variantId: Number(k.slice(2)), qty: Math.floor(Number(v)) }))
  if (!picks.length) return fail(t.qoPickOne)
  const pincode = String(f.pincode ?? '').replace(/\D/g, '')
  const raw = String(f.address ?? '').trim().slice(0, 400)
  const address = raw.length >= 10 ? (pincode && !raw.includes(pincode) ? `${raw} – ${pincode}` : raw) : ''
  const name = String(f.name ?? '').trim().slice(0, 60) || 'Customer'
  let first: string | null = null
  let failed = 0
  for (const p of picks) {
    const v = await c.env.DB.prepare(`SELECT v.drop_id FROM variants v JOIN drops d ON d.id = v.drop_id WHERE v.id = ? AND d.seller_id = ?`).bind(p.variantId, s.id).first<{ drop_id: string }>()
    const data = v && (await loadDrop(c.env.DB, v.drop_id))
    if (!data) { failed++; continue }
    // Items join one payment automatically (same buyer, same seller, same UPI ID).
    const res = await reserveOrder(c.env, s, data.drop, { variantId: p.variantId, qty: p.qty, name, phone, address, ipHash: 'seller', channel: 'web', assisted: true, holdMinutes: 30 })
    if (res.ok) first ??= res.order.id
    else failed++
  }
  if (!first) return fail(t.qoSomeFailed(failed))
  return c.redirect(`/app/quick-order/done/${first}` + (failed ? `?err=${enc(t.qoSomeFailed(failed))}` : ''), 303)
})

app.get('/quick-order/done/:id', async (c) => {
  const t = tr(c)
  const s = c.get('seller')
  const o = await ownOrder(c, c.req.param('id'))
  if (!o) return c.notFound()
  const lines = await cartOrders(c.env.DB, o)
  const total = lines.reduce((n, l) => n + l.amount_paise, 0)
  const key = cartKeyOf(o)
  const link = `${new URL(c.req.url).origin}/o/${key}`
  const vpa = o.pay_mode === 'direct' ? lines[0].upi_vpa ?? s.upi_vpa ?? '' : ''
  const list = lines.map((l) => `• ${l.title}${l.label ? ` (${l.label})` : ''} ×${l.qty} – ${rupees(l.price_paise * l.qty)}`).join('\n')
  const msg = t.qoMsg(o.buyer_name === 'Customer' ? '' : o.buyer_name.split(' ')[0], s.shop_name, list, rupees(total), link, vpa, !o.address)
  return page(c, 'orders', t.qoTitle, (
    <>
      <a class="back" href="/app/orders">← {t.ordersPageTitle}</a>
      <Flash msg={c.req.query('err')} />
      <h1>{t.qoTitle}</h1>
      <div class="alert ok" style="margin-top:12px">{t.qoReady}</div>
      <div class="card stack">
        <pre class="bubble" id="qomsg">{msg}</pre>
        <a class="btn wa block big" href={waLink(o.buyer_phone, msg)}>{t.qoSend}</a>
        <div class="row">
          <button type="button" class="btn grow sm" data-copy="#qomsg" data-done={t.copiedMsg}>{t.copyMsg}</button>
          <a class="btn grow sm" href={`/o/${key}`} target="_blank">{t.qoOpenPay}</a>
        </div>
      </div>
      <a class="btn block" href="/app/quick-order">{t.qoAnother}</a>
    </>
  ), '')
})
