import { Hono } from 'hono'
import { raw } from 'hono/html'
import type { Context } from 'hono'
import type { Child } from 'hono/jsx'
import type { AppEnv, OrderStatus, PayMode } from '../env'
import { dictFor } from '../i18n'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { decrypt, hashPin, safeEqual, sha256 } from '../lib/crypto'
import { canPayFees, encryptSecret, ensureInvoices, getSettings, isAdmin, markInvoicePaid, MODES, parseModes, saveSettings, type Invoice } from '../lib/billing'
import { clip, displayPhone, istDay, istDayStart, normalizePhone, parsePaise, randomId, rupees, waLink } from '../lib/util'
import { ago, BASE_CSS, BASE_JS, Flash, Icon, type IconName, Layout, PhoneInput, PinInput } from '../views/layout'
import { CHANNELS, label, PAYMENTS, VOLUMES, type Lead } from '../lib/leads'
import { createSeller, setPin, tempPin } from '../lib/sellers'
import { isValidVpa } from '../lib/upi'
import { checkKeys, isTestKey } from '../lib/razorpay'
import { here } from './public'

/*
 * Admin portal for the platform owner – completely separate from seller accounts: its own
 * login (/admin/login), its own PIN and its own session cookie. Sellers never see a link to it.
 * Only phones listed in ADMIN_PHONES can be admins, and creating an admin PIN the first time
 * also needs ADMIN_SETUP_CODE, so knowing the owner's number isn't enough.
 */
export const admin = new Hono<AppEnv>()

const COOKIE = 'kk_a'
const SESSION_DAYS = 30

async function currentAdmin(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const row = await c.env.DB.prepare(`SELECT phone FROM admin_sessions WHERE token_hash = ? AND expires_at > ?`).bind(await sha256(token), Date.now()).first<{ phone: string }>()
  // Removing a number from ADMIN_PHONES revokes access immediately.
  return row && isAdmin(c.env, row.phone) ? row.phone : null
}

async function startAdminSession(c: Context<AppEnv>, phone: string) {
  const token = randomId(40)
  await c.env.DB.prepare(`INSERT INTO admin_sessions (token_hash, phone, expires_at) VALUES (?, ?, ?)`).bind(await sha256(token), phone, Date.now() + SESSION_DAYS * 86_400_000).run()
  setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Strict', path: '/admin', maxAge: SESSION_DAYS * 86_400 })
}

admin.use('*', async (c, next) => {
  if (/^\/admin\/(login|setup)$/.test(c.req.path)) return next()
  if (!(await currentAdmin(c))) return c.redirect('/admin/login')
  await next()
})

const AuthPage = (p: { c: Context<AppEnv>; title: string; children: Child }) => (
  <Layout t={dictFor('en')} path={here(p.c)} title={`${p.title} – NukkadSale Admin`} brand="NukkadSale Admin">
    <h1 style="margin-top:24px">{p.title}</h1>
    <Flash msg={p.c.req.query('err')} />
    <Flash msg={p.c.req.query('ok')} kind="ok" />
    {p.children}
  </Layout>
)

admin.get('/login', (c) =>
  c.html(
    <AuthPage c={c} title="Admin login">
      <form method="post" class="card stack">
        <div><label for="phone">Admin mobile number</label><PhoneInput id="phone" name="phone" /></div>
        <div><label for="pin">Admin PIN</label><PinInput id="pin" t={dictFor('en')} autocomplete="current-password" /></div>
        <button class="btn primary block big" type="submit">Log in</button>
      </form>
      <p style="text-align:center"><a href="/admin/setup">First time? Set up your admin PIN</a></p>
    </AuthPage>,
  ),
)

admin.post('/login', async (c) => {
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  const fail = (m: string) => c.redirect('/admin/login?err=' + enc(m), 303)
  if (!phone || !isAdmin(c.env, phone)) return fail('Wrong number or PIN.')
  const a = await c.env.DB.prepare(`SELECT * FROM admins WHERE phone = ?`).bind(phone).first<{ pin_hash: string; pin_salt: string; failed_logins: number; locked_until: number }>()
  if (!a) return c.redirect('/admin/setup?err=' + enc('Set up your admin PIN first.'), 303)
  if (a.locked_until > Date.now()) return fail('Too many wrong tries. Try again in 15 minutes.')
  if ((await hashPin(String(f.pin ?? ''), a.pin_salt, c.env.SECRET_KEY)) !== a.pin_hash) {
    const fails = a.failed_logins + 1
    await c.env.DB.prepare(`UPDATE admins SET failed_logins = ?, locked_until = ? WHERE phone = ?`).bind(fails >= 5 ? 0 : fails, fails >= 5 ? Date.now() + 15 * 60000 : 0, phone).run()
    return fail('Wrong number or PIN.')
  }
  await c.env.DB.prepare(`UPDATE admins SET failed_logins = 0 WHERE phone = ?`).bind(phone).run()
  await startAdminSession(c, phone)
  return c.redirect('/admin', 303)
})

admin.get('/setup', (c) =>
  c.html(
    <AuthPage c={c} title="Set up admin PIN">
      <form method="post" class="card stack">
        <div><label for="phone">Admin mobile number</label><PhoneInput id="phone" name="phone" /></div>
        <div><label for="code">Setup code</label><input id="code" name="code" type="password" autocomplete="off" required /><div class="hint">The ADMIN_SETUP_CODE set on the server.</div></div>
        <div><label for="pin">Choose a 6-digit admin PIN</label><PinInput id="pin" t={dictFor('en')} autocomplete="new-password" /></div>
        <button class="btn primary block big" type="submit">Create admin PIN</button>
      </form>
    </AuthPage>,
  ),
)

admin.post('/setup', async (c) => {
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  const pin = String(f.pin ?? '')
  const fail = (m: string) => c.redirect('/admin/setup?err=' + enc(m), 303)
  const code = c.env.ADMIN_SETUP_CODE ?? ''
  if (!phone || !isAdmin(c.env, phone) || !code || !safeEqual(await sha256(String(f.code ?? '')), await sha256(code))) return fail('Number or setup code not accepted.')
  if (!/^\d{6}$/.test(pin)) return fail('Admin PIN must be 6 digits.')
  if (await c.env.DB.prepare(`SELECT 1 FROM admins WHERE phone = ?`).bind(phone).first()) return fail('This admin already has a PIN. Please log in.')
  const salt = randomId(16)
  await c.env.DB.prepare(`INSERT INTO admins (phone, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?)`).bind(phone, await hashPin(pin, salt, c.env.SECRET_KEY), salt, Date.now()).run()
  await startAdminSession(c, phone)
  return c.redirect('/admin?ok=' + enc('Admin PIN created.'), 303)
})

admin.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE)
  if (token) await c.env.DB.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).bind(await sha256(token)).run()
  deleteCookie(c, COOKIE, { path: '/admin' })
  return c.redirect('/admin/login', 303)
})

const enc = encodeURIComponent
const t = dictFor('en')
const MODE_LABEL: Record<PayMode, string> = { direct: 'Manual UPI check', razorpay: 'Razorpay (automatic)' }
const MODE_SHORT: Record<PayMode, string> = { direct: 'Manual UPI', razorpay: 'Razorpay' }

// The admin portal is a desktop website: a sidebar and a wide content area (still usable on a phone).
const ADMIN_CSS = `
body{font-size:14px}
.shell{display:grid;grid-template-columns:228px minmax(0,1fr);min-height:100vh}
.shell aside{background:var(--card);border-right:1px solid var(--line);padding:18px 12px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px}
.abrand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:1rem;color:var(--ink);text-decoration:none;padding:4px 8px 16px}
.shell aside nav a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:9px;color:var(--ink);text-decoration:none;font-weight:500}
.shell aside nav a:hover{background:var(--bg)}.shell aside nav a.on{background:var(--brand-soft);color:var(--brand);font-weight:600}
.shell aside nav a .n{margin-left:auto;background:var(--bad);color:#fff;border-radius:99px;font-size:.7rem;font-weight:700;padding:1px 7px}
.alogout{margin-top:auto}
.content{padding:24px 32px 48px;max-width:1280px;width:100%}
.content h1{font-size:1.45rem;margin:0 0 4px}.content .sub{color:var(--muted);margin:0 0 18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:14px 0}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;text-decoration:none;color:inherit;display:block}
.kpi small{font-size:.76rem}.kpi b{display:block;font-size:1.35rem;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.kpi.warn{background:var(--warn-soft);border-color:transparent}.kpi.ok{background:var(--ok-soft);border-color:transparent}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 16px}
.panel h2{margin:0 0 10px;font-size:.95rem}
table.data{width:100%;border-collapse:collapse}
table.data th,table.data td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:.86rem;white-space:nowrap;vertical-align:middle}
table.data th{font-weight:600;color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.03em}
table.data th a{color:inherit;text-decoration:none}table.data th a.on{color:var(--brand)}
table.data tr:last-child td{border-bottom:0}table.data tbody tr:hover td{background:var(--bg)}
table.data td.r,table.data th.r{text-align:right;font-variant-numeric:tabular-nums}
table.data a.rowlink{color:var(--ink);font-weight:600;text-decoration:none}
.tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
.cols{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,1fr);gap:20px;align-items:start}
.cols .card{margin:0 0 12px}.cols>div>h2:first-child{margin-top:0}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 14px}.toolbar input{max-width:320px;min-height:40px;font-size:14px}
.chart{width:100%;height:150px;display:block}.chart rect{fill:var(--brand)}.chart rect.z{fill:var(--line)}
.chartlab{display:flex;justify-content:space-between;color:var(--muted);font-size:.74rem;margin-top:4px}
.dotx{display:inline-block;width:8px;height:8px;border-radius:99px;margin-right:6px;vertical-align:1px}
@media (max-width:900px){.shell{grid-template-columns:1fr}.shell aside{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center}.shell aside nav{display:flex;flex-wrap:wrap}.alogout{margin:0 0 0 auto}.content{padding:16px}.cols{grid-template-columns:1fr}}
`

function page(c: Context<AppEnv>, on: string, title: string, body: Child) {
  const tabs: [string, string, IconName][] = [['/admin', 'Dashboard', 'home'], ['/admin/leads', 'Requests', 'edit'], ['/admin/sellers', 'Sellers', 'users'], ['/admin/analytics', 'Analytics', 'search'], ['/admin/billing', 'Billing', 'receipt'], ['/admin/privacy', 'Privacy', 'lock'], ['/admin/settings', 'Settings', 'gear']]
  const ok = c.req.query('ok')
  return c.html('<!doctype html>' + (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{`${title} – NukkadSale Admin`}</title>
        <link rel="icon" href="/icon-192.png" />
        <style>{raw(BASE_CSS + ADMIN_CSS)}</style>
      </head>
      <body>
        <div class="shell">
          <aside>
            <a class="abrand" href="/admin"><i class="logo"><Icon n="shop" s={16} /></i>NukkadSale <span class="chip closed">Admin</span></a>
            <nav>{tabs.map(([href, label, ic]) => <a href={href} class={on === href ? 'on' : ''}><Icon n={ic} s={18} />{label}</a>)}</nav>
            <form method="post" action="/admin/logout" class="alogout"><button class="btn ghost sm block" type="submit">Log out</button></form>
          </aside>
          <div class="content">
            <Flash msg={c.req.query('err')} />
            {body}
          </div>
        </div>
        {ok && <div class="toast" role="status" data-autohide>{ok}</div>}
        <script>{raw(BASE_JS)}</script>
      </body>
    </html>
  ))
}

/** A 30-day bar chart (inline SVG, no library). values[i] is for days[i]. */
const Bars = ({ values, days, fmt }: { values: number[]; days: string[]; fmt: (n: number) => string }) => {
  const max = Math.max(1, ...values), w = 100 / values.length
  const d = (s: string) => s.slice(8) + '/' + s.slice(5, 7)
  return (
    <>
      <svg class="chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Last 30 days">
        {values.map((v, i) => {
          const h = v ? Math.max(1.2, (v / max) * 38) : 0.6
          return <rect class={v ? '' : 'z'} x={i * w + w * 0.15} y={40 - h} width={w * 0.7} height={h} rx="0.4"><title>{`${d(days[i])}: ${fmt(v)}`}</title></rect>
        })}
      </svg>
      <div class="chartlab"><span>{d(days[0])}</span><span>{d(days[days.length - 1])}</span></div>
    </>
  )
}

/** The last 30 IST days as YYYY-MM-DD, oldest first. */
const last30 = () => Array.from({ length: 30 }, (_, i) => istDay(Date.now() - (29 - i) * 86_400_000))
const IST_DAY_SQL = (col: string) => `date((${col} + 19800000) / 1000, 'unixepoch')`
const seen = (ms: number | null | undefined) => (ms ? ago(t, ms) : 'never')
/** "2 Nov", or "2 Nov 25" for another year. */
const shortDate = (ms: number) => {
  const d = new Date(ms + 330 * 60000), y = d.getUTCFullYear() !== new Date(Date.now() + 330 * 60000).getUTCFullYear()
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(y ? { year: '2-digit' } : {}), timeZone: 'UTC' })
}

type SellerRow = {
  id: string; name: string; shop_name: string; phone: string; pay_mode: PayMode; allowed_modes: string; plan_fee_paise: number; trial_until: number
  account_status: string; created_at: number; rzp_key_id: string | null; gateway_request: number; gmv30: number; orders30: number; open_status: string | null; open_due: number | null
  last_seen_at: number; live_sales: number; msgs30: number
}

const SELLER_LIST_SQL = `SELECT s.id, s.name, s.shop_name, s.phone, s.pay_mode, s.allowed_modes, s.plan_fee_paise, s.trial_until, s.account_status, s.created_at,
  s.rzp_key_id, s.gateway_request, s.last_seen_at,
  (SELECT COUNT(*) FROM drops d WHERE d.seller_id = s.id AND d.status = 'live') AS live_sales,
  (SELECT COALESCE(SUM(count), 0) FROM wa_usage w WHERE w.seller_id = s.id AND w.day >= date('now', '-30 days')) AS msgs30,
  (SELECT COALESCE(SUM(amount_paise), 0) FROM orders o WHERE o.seller_id = s.id AND o.status = 'paid' AND o.paid_at > ?1) AS gmv30,
  (SELECT COUNT(*) FROM orders o WHERE o.seller_id = s.id AND o.status = 'paid' AND o.paid_at > ?1) AS orders30,
  (SELECT status FROM invoices i WHERE i.seller_id = s.id AND i.status IN ('due', 'claimed') ORDER BY created_at LIMIT 1) AS open_status,
  (SELECT due_at FROM invoices i WHERE i.seller_id = s.id AND i.status IN ('due', 'claimed') ORDER BY created_at LIMIT 1) AS open_due
  FROM sellers s`

function billingChip(s: Pick<SellerRow, 'plan_fee_paise' | 'trial_until' | 'open_status' | 'open_due'>) {
  if (!s.plan_fee_paise) return <span class="chip closed">Free</span>
  if (s.trial_until > Date.now()) return <span class="chip verifying">Trial till {istDay(s.trial_until).split('-').reverse().join('/')}</span>
  if (s.open_status === 'claimed') return <span class="chip verifying">Says paid – check</span>
  if (s.open_status === 'due') return s.open_due! < Date.now() ? <span class="chip refund_due">Overdue</span> : <span class="chip pending">Due</span>
  return <span class="chip paid">Paid up</span>
}

// ---------- Dashboard ----------

admin.get('/', async (c) => {
  const db = c.env.DB
  const now = Date.now()
  const monthStart = Date.parse(istDay(now).slice(0, 8) + '01T00:00:00Z') - 330 * 60000
  const days = last30()
  const [r, { results: daily }, { results: top }, { results: recentLeads }, settings] = await Promise.all([
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM sellers) AS sellers,
              (SELECT COUNT(*) FROM sellers WHERE last_seen_at > ?4) AS active7,
              (SELECT COUNT(*) FROM sellers WHERE created_at >= ?3) AS new_sellers,
              (SELECT COALESCE(SUM(plan_fee_paise), 0) FROM sellers WHERE plan_fee_paise > 0 AND trial_until <= ?2 AND account_status = 'active') AS mrr,
              (SELECT COUNT(*) FROM invoices WHERE status IN ('due', 'claimed')) AS open_inv,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM invoices WHERE status IN ('due', 'claimed')) AS open_amt,
              (SELECT COUNT(*) FROM invoices WHERE status = 'due' AND due_at < ?2) AS overdue,
              (SELECT COUNT(*) FROM invoices WHERE status = 'claimed') AS claimed,
              (SELECT COUNT(*) FROM sellers WHERE gateway_request = 1) AS gw_requests,
              (SELECT COUNT(*) FROM leads WHERE status = 'new') AS new_leads,
              (SELECT COUNT(*) FROM sellers WHERE plan_fee_paise > 0) AS fee_sellers,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM invoices WHERE status = 'paid' AND paid_at >= ?3) AS collected,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM orders WHERE status = 'paid' AND paid_at >= ?3) AS gmv,
              (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND paid_at >= ?3) AS orders_month,
              (SELECT COUNT(*) FROM orders WHERE status = 'pending' AND pay_mode = 'cod') AS cod_open,
              (SELECT COALESCE(SUM(count), 0) FROM wa_usage WHERE day >= ?5) AS msgs_month`,
    ).bind(now - 30 * 86_400_000, now, monthStart, now - 7 * 86_400_000, istDay(now).slice(0, 8) + '01').first<Record<string, number>>(),
    db.prepare(`SELECT ${IST_DAY_SQL('paid_at')} AS d, COUNT(*) AS n, SUM(amount_paise) AS amt FROM orders WHERE status = 'paid' AND paid_at > ? GROUP BY d`)
      .bind(now - 31 * 86_400_000).all<{ d: string; n: number; amt: number }>(),
    db.prepare(
      `SELECT s.id, s.shop_name, s.name, s.last_seen_at, COUNT(o.id) AS n, COALESCE(SUM(o.amount_paise), 0) AS amt
       FROM sellers s LEFT JOIN orders o ON o.seller_id = s.id AND o.status = 'paid' AND o.paid_at > ?
       GROUP BY s.id ORDER BY amt DESC, s.last_seen_at DESC LIMIT 8`,
    ).bind(now - 30 * 86_400_000).all<{ id: string; shop_name: string; name: string; last_seen_at: number; n: number; amt: number }>(),
    db.prepare(`SELECT id, business, name, city, status, created_at FROM leads ORDER BY created_at DESC LIMIT 5`).all<Pick<Lead, 'id' | 'business' | 'name' | 'city' | 'status' | 'created_at'>>(),
    getSettings(c.env),
  ])
  const x = r ?? {}
  const byDay = new Map(daily.map((d) => [d.d, d]))
  const Kpi = (p: { label: string; value: string; href?: string; tone?: string }) => (
    <a class={`kpi ${p.tone ?? ''}`} href={p.href ?? '#'}><small class="muted">{p.label}</small><b>{p.value}</b></a>
  )
  const Todo = (p: { href: string; kind: string; icon: IconName; title: string; sub: string }) => (
    <a class={`card task ${p.kind}`} href={p.href} style="margin:0 0 8px"><span class="ic"><Icon n={p.icon} /></span><span><b>{p.title}</b><small>{p.sub}</small></span><span class="go"><Icon n="chevron" s={18} /></span></a>
  )
  const todos = [
    (x.fee_sellers ?? 0) > 0 && !canPayFees(settings) && <Todo href="/admin/settings" kind="bad" icon="wallet" title="Sellers can’t pay their fee yet" sub="Add your UPI ID or Razorpay keys in Settings. Until then no shop is paused for unpaid fees." />,
    (x.new_leads ?? 0) > 0 && <Todo href="/admin/leads" kind="info" icon="edit" title={`${x.new_leads} new request(s) to get started`} sub="Call or WhatsApp them, then create their shop" />,
    (x.claimed ?? 0) > 0 && <Todo href="/admin/billing?f=claimed" kind="info" icon="search" title={`${x.claimed} seller(s) say they paid`} sub="Check your UPI app, then mark paid or not received" />,
    (x.gw_requests ?? 0) > 0 && <Todo href="/admin/sellers?f=gw" kind="warn" icon="key" title={`${x.gw_requests} seller(s) want automatic payments`} sub="Send the Razorpay guide, then add their keys" />,
    (x.overdue ?? 0) > 0 && <Todo href="/admin/billing?f=overdue" kind="bad" icon="pause" title={`${x.overdue} shop(s) paused for unpaid fees`} sub="Send a reminder with the pay link" />,
  ].filter(Boolean)
  return page(c, '/admin', 'Dashboard', (
    <>
      <h1>Dashboard</h1>
      <p class="sub">{new Date(now + 330 * 60000).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
      <div class="kpis">
        <Kpi label="Sellers" value={String(x.sellers ?? 0)} href="/admin/sellers" />
        <Kpi label="Active in last 7 days" value={String(x.active7 ?? 0)} href="/admin/sellers?sort=active" />
        <Kpi label="New sellers this month" value={String(x.new_sellers ?? 0)} href="/admin/sellers?sort=joined" />
        <Kpi label="Orders this month" value={String(x.orders_month ?? 0)} />
        <Kpi label="Sales through NukkadSale (month)" value={rupees(x.gmv ?? 0)} />
        <Kpi label="Open COD orders" value={String(x.cod_open ?? 0)} />
        <Kpi label="WhatsApp messages (month)" value={String(x.msgs_month ?? 0)} />
        <Kpi label="Monthly fees (MRR)" value={rupees(x.mrr ?? 0)} />
        <Kpi label="Collected this month" value={rupees(x.collected ?? 0)} tone="ok" href="/admin/billing?f=paid" />
        <Kpi label={`Unpaid invoices (${x.open_inv ?? 0})`} value={rupees(x.open_amt ?? 0)} tone={(x.open_inv ?? 0) ? 'warn' : ''} href="/admin/billing" />
      </div>
      <div class="cols">
        <div>
          <div class="panel"><h2>Sales through NukkadSale – last 30 days</h2><Bars values={days.map((d) => byDay.get(d)?.amt ?? 0)} days={days} fmt={rupees} /></div>
          <div class="panel">
            <h2>Top sellers – last 30 days</h2>
            <table class="data">
              <thead><tr><th>Shop</th><th class="r">Orders</th><th class="r">Sales</th><th>Last active</th></tr></thead>
              <tbody>
                {top.map((s) => <tr><td><a class="rowlink" href={`/admin/sellers/${s.id}`}>{s.shop_name}</a><br /><small>{s.name}</small></td><td class="r">{s.n}</td><td class="r">{rupees(s.amt)}</td><td>{seen(s.last_seen_at)}</td></tr>)}
                {top.length === 0 && <tr><td colspan={4} class="muted">No sellers yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="panel">
            <h2>Needs your attention</h2>
            {todos.length ? todos : <p class="muted" style="margin:0">All caught up.</p>}
          </div>
          <div class="panel">
            <h2>Latest requests</h2>
            <table class="data">
              <tbody>
                {recentLeads.map((l) => <tr><td><a class="rowlink" href={`/admin/leads/${l.id}`}>{l.business}</a><br /><small>{l.name}{l.city ? ` · ${l.city}` : ''}</small></td><td><span class={`chip ${LEAD_STATUS[l.status][1]}`}>{LEAD_STATUS[l.status][0]}</span></td><td class="r"><small>{ago(t, l.created_at)}</small></td></tr>)}
                {recentLeads.length === 0 && <tr><td class="muted">No requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  ))
})

// ---------- Sellers ----------

const SELLER_SORTS: Record<string, [string, string]> = {
  gmv: ['Sales (30d)', 'gmv30 DESC'], orders: ['Orders (30d)', 'orders30 DESC'], active: ['Last active', 's.last_seen_at DESC'],
  joined: ['Joined', 's.created_at DESC'], msgs: ['Messages (30d)', 'msgs30 DESC'], shop: ['Shop', 's.shop_name COLLATE NOCASE ASC'],
}

admin.get('/sellers', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const like = `%${q}%`
  const f = c.req.query('f') ?? ''
  const sort = SELLER_SORTS[c.req.query('sort') ?? ''] ? c.req.query('sort')! : 'gmv'
  const filter = f === 'gw' ? 'AND s.gateway_request = 1' : f === 'suspended' ? `AND s.account_status = 'suspended'` : f === 'idle' ? `AND s.last_seen_at < ${Date.now() - 7 * 86_400_000}` : ''
  const { results } = await c.env.DB
    .prepare(`${SELLER_LIST_SQL} WHERE (?2 = '' OR s.shop_name LIKE ?3 OR s.name LIKE ?3 OR s.phone LIKE ?3) ${filter} ORDER BY ${SELLER_SORTS[sort][1]}, s.created_at DESC LIMIT 500`)
    .bind(Date.now() - 30 * 86_400_000, q, like)
    .all<SellerRow>()
  const link = (k: string) => `/admin/sellers?${new URLSearchParams({ ...(q ? { q } : {}), ...(f ? { f } : {}), sort: k })}`
  const Th = ({ k, r }: { k: string; r?: boolean }) => <th class={r ? 'r' : ''}><a href={link(k)} class={sort === k ? 'on' : ''}>{SELLER_SORTS[k][0]}{sort === k ? ' ↓' : ''}</a></th>
  const filters = [['', 'All'], ['idle', 'Inactive 7+ days'], ['gw', 'Want Razorpay'], ['suspended', 'Suspended']]
  return page(c, '/admin/sellers', 'Sellers', (
    <>
      <div class="row between"><div><h1>Sellers</h1><p class="sub">{results.length} shown · sorted by {SELLER_SORTS[sort][0].toLowerCase()}</p></div><a class="btn sm primary" href="/admin/sellers/new">+ New shop</a></div>
      <form method="get" class="toolbar">
        <input name="q" value={q} placeholder="Search shop, name or phone" aria-label="Search" />
        {f && <input type="hidden" name="f" value={f} />}<input type="hidden" name="sort" value={sort} />
        <button class="btn sm">Search</button>
        <span class="pills" style="margin-left:auto">{filters.map(([k, l]) => <a class={`btn sm ${f === k ? 'primary' : ''}`} href={`/admin/sellers?${new URLSearchParams({ ...(k ? { f: k } : {}), sort })}`}>{l}</a>)}</span>
      </form>
      <div class="tablewrap">
        <table class="data">
          <thead><tr><Th k="shop" /><th>Plan</th><th>Payments</th><th class="r">Live sales</th><Th k="orders" r /><Th k="gmv" r /><Th k="msgs" r /><Th k="active" /><Th k="joined" /></tr></thead>
          <tbody>
            {results.map((s) => (
              <tr>
                <td><a class="rowlink" href={`/admin/sellers/${s.id}`}>{s.shop_name}</a><br /><small>{s.name} · {displayPhone(s.phone)}</small></td>
                <td>{s.account_status === 'suspended' ? <span class="chip refund_due">Suspended</span> : billingChip(s)}{s.plan_fee_paise ? <small>{rupees(s.plan_fee_paise)}/mo</small> : null}</td>
                <td>{parseModes(s.allowed_modes).map((m) => <span class={`chip ${m === s.pay_mode ? 'paid' : 'closed'}`} style="margin-right:4px">{MODE_SHORT[m]}</span>)}{s.gateway_request ? <span class="chip pending">wants Razorpay</span> : null}</td>
                <td class="r">{s.live_sales}</td>
                <td class="r">{s.orders30}</td>
                <td class="r">{rupees(s.gmv30)}</td>
                <td class="r">{s.msgs30}</td>
                <td>{seen(s.last_seen_at)}</td>
                <td>{shortDate(s.created_at)}</td>
              </tr>
            ))}
            {results.length === 0 && <tr><td colspan={9} class="muted">No sellers match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  ))
})

// ---------- Get-started requests and creating shops ----------

const LEAD_STATUS: Record<Lead['status'], [string, string]> = { new: ['New', 'pending'], contacted: ['Contacted', 'verifying'], onboarded: ['Shop created', 'paid'], closed: ['Closed', 'closed'] }

admin.get('/leads', async (c) => {
  const f = c.req.query('f') ?? 'open'
  const where = f === 'all' ? '' : f === 'open' ? `WHERE status IN ('new', 'contacted')` : `WHERE status = ?1`
  const stmt = c.env.DB.prepare(`SELECT * FROM leads ${where} ORDER BY status = 'contacted', created_at DESC LIMIT 200`)
  const { results } = await (where.includes('?1') ? stmt.bind(f) : stmt).all<Lead>()
  const filters = [['open', 'To do'], ['onboarded', 'Shop created'], ['closed', 'Closed'], ['all', 'All']]
  return page(c, '/admin/leads', 'Requests', (
    <>
      <h1>Requests to get started</h1>
      <p class="hint" style="margin-top:-6px">From the “Get started” form on the website. Talk to them, then create their shop and send the login.</p>
      <div class="pills" style="margin-bottom:10px">{filters.map(([k, l]) => <a class={`btn sm ${k === f ? 'primary' : ''}`} href={`/admin/leads?f=${k}`}>{l}</a>)}</div>
      {results.length === 0 && <p class="muted">Nothing here.</p>}
      {results.map((l) => (
        <a class="card" href={`/admin/leads/${l.id}`} style="display:block;text-decoration:none;color:inherit">
          <div class="row between"><b>{l.business}</b><span class={`chip ${LEAD_STATUS[l.status][1]}`}>{LEAD_STATUS[l.status][0]}</span></div>
          <small>{l.name} · {displayPhone(l.phone)}{l.city ? ` · ${l.city}` : ''}</small>
          <div><small>{[l.sells, label(VOLUMES, l.volume)].filter(Boolean).join(' · ')}</small></div>
          <small class="muted">{ago(t, l.created_at)}</small>
        </a>
      ))}
    </>
  ))
})

admin.get('/leads/:id', async (c) => {
  const l = await c.env.DB.prepare(`SELECT * FROM leads WHERE id = ?`).bind(c.req.param('id')).first<Lead>()
  if (!l) return c.notFound()
  const hello = l.lang === 'hi'
    ? `नमस्ते ${l.name.split(' ')[0]} जी, NukkadSale से बात कर रहे हैं। आपने "${l.business}" के लिए जानकारी भेजी थी – क्या अभी 5 मिनट बात कर सकते हैं?`
    : `Hi ${l.name.split(' ')[0]}, this is NukkadSale. Thanks for your request for "${l.business}" – is now a good time for a quick 5-minute chat?`
  const Row = (p: { k: string; v: string }) => (p.v ? <div class="row between" style="padding:6px 0;border-top:1px solid var(--line);gap:12px"><small class="muted">{p.k}</small><span style="text-align:right">{p.v}</span></div> : null)
  return page(c, '/admin/leads', l.business, (
    <>
      <a href="/admin/leads">← Requests</a>
      <div class="row between"><h1>{l.business}</h1><span class={`chip ${LEAD_STATUS[l.status][1]}`}>{LEAD_STATUS[l.status][0]}</span></div>
      <div class="card">
        <Row k="Name" v={l.name} />
        <Row k="WhatsApp" v={displayPhone(l.phone)} />
        <Row k="City" v={l.city} />
        <Row k="Sells" v={l.sells} />
        <Row k="Sells on" v={label(CHANNELS, l.channel)} />
        <Row k="Orders" v={label(VOLUMES, l.volume)} />
        <Row k="Payments" v={label(PAYMENTS, l.payments)} />
        <Row k="Message" v={l.message} />
        <Row k="Language" v={l.lang === 'hi' ? 'हिंदी' : 'English'} />
        <Row k="Received" v={new Date(l.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} />
      </div>
      <div class="row" style="gap:8px">
        <a class="btn wa grow" href={waLink(l.phone, hello)}><Icon n="chat" s={18} />WhatsApp</a>
        <a class="btn grow" href={`tel:+${l.phone}`}><Icon n="phone" s={18} />Call</a>
      </div>

      <h2>Notes</h2>
      <form method="post" action={`/admin/leads/${l.id}`} class="card stack">
        <textarea name="note" maxlength={2000} placeholder="What you discussed, when to follow up…">{l.note}</textarea>
        <div class="row wrap" style="gap:8px">
          <button class="btn grow" type="submit">Save note</button>
          {l.status === 'new' && <button class="btn grow" type="submit" name="status" value="contacted">Save & mark contacted</button>}
          {l.status !== 'closed' && l.status !== 'onboarded' && <button class="btn ghost grow" type="submit" name="status" value="closed">Close (not interested)</button>}
          {l.status === 'closed' && <button class="btn grow" type="submit" name="status" value="contacted">Reopen</button>}
        </div>
      </form>

      {l.seller_id ? (
        <a class="btn primary block big" href={`/admin/sellers/${l.seller_id}`}>Open their shop in Admin →</a>
      ) : l.status !== 'closed' ? (
        <>
          <h2>Create their shop</h2>
          <ShopForm lead={l} />
        </>
      ) : null}
    </>
  ))
})

admin.post('/leads/:id', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.parseBody()
  const status = ['contacted', 'closed'].includes(String(f.status)) ? String(f.status) : null
  // A request whose shop exists stays "Shop created"; only its note changes.
  await c.env.DB.prepare(`UPDATE leads SET note = ?, status = CASE WHEN ?2 IS NOT NULL AND status != 'onboarded' THEN ?2 ELSE status END, updated_at = ? WHERE id = ?`)
    .bind(String(f.note ?? '').slice(0, 2000), status, Date.now(), id).run()
  return c.redirect(`/admin/leads/${id}?ok=${enc('Saved.')}`, 303)
})

const ShopForm = ({ lead }: { lead?: Lead }) => (
  <form method="post" action="/admin/shops" class="card stack">
    {lead && <input type="hidden" name="lead" value={String(lead.id)} />}
    <div><label for="name">Seller's name</label><input id="name" name="name" value={lead?.name ?? ''} required maxlength={60} /></div>
    <div><label for="shop">Shop name</label><input id="shop" name="shop" value={lead?.business ?? ''} required maxlength={60} /></div>
    <div><label for="phone">Seller's mobile (their login)</label><PhoneInput id="phone" name="phone" value={lead ? lead.phone.slice(2) : undefined} /></div>
    <div><label for="vpa">Their UPI ID</label><input id="vpa" name="vpa" placeholder="name@ybl" autocapitalize="off" autocomplete="off" spellcheck={false} required /><div class="hint">Ask on the call. They can add more UPI IDs later in Settings.</div></div>
    {lead?.payments === 'auto' && <p class="hint">They asked for automatic payments – after creating, switch on Razorpay on their shop page.</p>}
    <p class="hint">A 4-digit PIN is created for them. You'll get a ready WhatsApp message with their login; they can change the PIN in Settings.</p>
    <button class="btn primary block big" type="submit">Create shop</button>
  </form>
)

// Shown once, right after creating a shop or resetting a PIN (the PIN is never stored in plain text).
function credentialsPage(c: Context<AppEnv>, s: { id: string; name: string; shop: string; phone: string; lang: string }, pin: string, kind: 'new' | 'reset') {
  const login = `${new URL(c.req.url).origin}/seller?p=${s.phone.slice(2)}`
  const first = s.name.split(' ')[0]
  const msg = s.lang === 'hi'
    ? (kind === 'new' ? `नमस्ते ${first} जी! आपकी NukkadSale दुकान "${s.shop}" तैयार है 🎉\n\n` : `नमस्ते ${first} जी, आपका नया NukkadSale PIN:\n\n`) +
      `लॉग इन: ${login}\nमोबाइल: ${s.phone.slice(2)}\nPIN: ${pin}\n\nपहली बार लॉग इन के बाद सेटिंग → "अपना PIN बदलें" में अपना PIN रख लें। कोई सवाल हो तो यहीं जवाब दें।`
    : (kind === 'new' ? `Hi ${first}! Your NukkadSale shop "${s.shop}" is ready 🎉\n\n` : `Hi ${first}, here is your new NukkadSale PIN:\n\n`) +
      `Log in: ${login}\nMobile: ${s.phone.slice(2)}\nPIN: ${pin}\n\nAfter logging in, go to Settings → "Change your PIN" to set your own. Any questions, just reply here.`
  return page(c, '/admin/sellers', 'Login details', (
    <>
      <h1 style="display:flex;gap:10px;align-items:center"><Icon n={kind === 'new' ? 'check' : 'key'} s={24} />{kind === 'new' ? 'Shop created' : 'New PIN set'}</h1>
      <div class="card">
        <div class="row between"><small class="muted">Shop</small><b>{s.shop}</b></div>
        <div class="row between"><small class="muted">Mobile</small><b>{displayPhone(s.phone)}</b></div>
        <div class="row between"><small class="muted">PIN</small><b style="font-size:1.6rem;letter-spacing:.2em">{pin}</b></div>
      </div>
      <p class="hint">This PIN is shown only now. Send it to the seller – they'll see a reminder to change it until they do.</p>
      <a class="btn wa block big" href={waLink(s.phone, msg)}><Icon n="chat" s={18} />Send login on WhatsApp</a>
      <a class="btn block" href={`/admin/sellers/${s.id}`} style="margin-top:10px">Open their shop in Admin →</a>
    </>
  ))
}

admin.get('/sellers/new', (c) =>
  page(c, '/admin/sellers', 'New shop', (
    <>
      <a href="/admin/sellers">← Sellers</a>
      <h1>New shop</h1>
      <p class="hint" style="margin-top:-6px">For a seller who didn't use the website form. If they did, create the shop from their request instead.</p>
      <ShopForm />
    </>
  )))

admin.post('/shops', async (c) => {
  const f = await c.req.parseBody()
  const leadId = f.lead ? String(f.lead) : ''
  const back = (m: string) => c.redirect(`${leadId ? `/admin/leads/${leadId}` : '/admin/sellers/new'}?err=${enc(m)}`, 303)
  const name = String(f.name ?? '').trim().slice(0, 60)
  const shop = String(f.shop ?? '').trim().slice(0, 60)
  const phone = normalizePhone(String(f.phone ?? ''))
  const vpa = String(f.vpa ?? '').trim()
  if (!name || !shop) return back('Enter the seller’s name and shop name.')
  if (!phone) return back('Enter a valid 10-digit mobile number.')
  if (!isValidVpa(vpa)) return back('That UPI ID doesn’t look right (it looks like name@bank).')
  const lead = leadId ? await c.env.DB.prepare(`SELECT * FROM leads WHERE id = ?`).bind(leadId).first<Lead>() : null
  if (lead?.seller_id) return c.redirect(`/admin/sellers/${lead.seller_id}`, 303)
  const pin = tempPin()
  const id = await createSeller(c.env, { name, shop, phone, vpa, pin, tempPin: true, wantsAuto: lead?.payments === 'auto' })
  if (!id) return back('This mobile number already has a shop. Find it under Sellers (you can reset its PIN there).')
  if (lead) await c.env.DB.prepare(`UPDATE leads SET status = 'onboarded', seller_id = ?, updated_at = ? WHERE id = ?`).bind(id, Date.now(), lead.id).run()
  return credentialsPage(c, { id, name, shop, phone, lang: lead?.lang ?? 'en' }, pin, 'new')
})

admin.post('/sellers/:id/pin', async (c) => {
  const s = await c.env.DB.prepare(`SELECT id, name, shop_name, phone FROM sellers WHERE id = ?`).bind(c.req.param('id')).first<{ id: string; name: string; shop_name: string; phone: string }>()
  if (!s) return c.notFound()
  const lead = await c.env.DB.prepare(`SELECT lang FROM leads WHERE seller_id = ?`).bind(s.id).first<{ lang: string }>()
  const pin = tempPin()
  await setPin(c.env, s.id, pin, true)
  // Log the seller out everywhere: whoever had the old PIN loses access.
  await c.env.DB.prepare(`DELETE FROM sessions WHERE seller_id = ?`).bind(s.id).run()
  return credentialsPage(c, { id: s.id, name: s.name, shop: s.shop_name, phone: s.phone, lang: lead?.lang ?? 'en' }, pin, 'reset')
})

admin.get('/sellers/:id', async (c) => {
  const id = c.req.param('id')
  const s = await c.env.DB.prepare(`${SELLER_LIST_SQL} WHERE s.id = ?2`).bind(Date.now() - 30 * 86_400_000, id).first<SellerRow>()
  if (!s) return c.notFound()
  const extra = await c.env.DB.prepare(`SELECT rzp_secret_enc IS NOT NULL AS rzp_has FROM sellers WHERE id = ?`).bind(id).first<{ rzp_has: number }>()
  const { results: invoices } = await c.env.DB.prepare(`SELECT * FROM invoices WHERE seller_id = ? ORDER BY period DESC LIMIT 24`).bind(id).all<Invoice>()
  const allowed = parseModes(s.allowed_modes)
  const origin = new URL(c.req.url).origin
  const onbRow = await c.env.DB.prepare(`SELECT onboarding FROM sellers WHERE id = ?`).bind(id).first<{ onboarding: string }>()
  const onb = JSON.parse(onbRow?.onboarding || '{}') as Record<string, boolean>
  const keysAdded = Boolean(extra?.rzp_has)
  const gwPaid = Boolean(await c.env.DB.prepare(`SELECT 1 FROM orders WHERE seller_id = ? AND status = 'paid' AND pay_mode = 'razorpay' LIMIT 1`).bind(id).first())
  const now = Date.now()
  const days = last30()
  const [act, { results: daily }, { results: recent }, { results: sales }, { results: usage }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM orders WHERE seller_id = ?1 AND status = 'paid' AND paid_at > ?2) AS orders7,
              (SELECT COALESCE(SUM(amount_paise), 0) FROM orders WHERE seller_id = ?1 AND status = 'paid') AS gmv_all,
              (SELECT COUNT(DISTINCT buyer_phone) FROM orders WHERE seller_id = ?1 AND status = 'paid') AS buyers,
              (SELECT COUNT(*) FROM drops WHERE seller_id = ?1) AS sales_all,
              (SELECT COUNT(*) FROM orders WHERE seller_id = ?1 AND status = 'pending' AND pay_mode = 'cod') AS cod_open,
              (SELECT COUNT(*) FROM orders WHERE seller_id = ?1 AND status IN ('verifying', 'refund_due')) AS to_check`,
    ).bind(id, now - 7 * 86_400_000).first<Record<string, number>>(),
    c.env.DB.prepare(`SELECT ${IST_DAY_SQL('paid_at')} AS d, COUNT(*) AS n FROM orders WHERE seller_id = ? AND status = 'paid' AND paid_at > ? GROUP BY d`).bind(id, now - 31 * 86_400_000).all<{ d: string; n: number }>(),
    c.env.DB.prepare(`SELECT o.id, o.created_at, o.status, o.pay_mode, o.amount_paise, o.buyer_name, o.qty, d.title FROM orders o JOIN drops d ON d.id = o.drop_id WHERE o.seller_id = ? AND o.status <> 'expired' ORDER BY o.created_at DESC LIMIT 12`)
      .bind(id).all<{ id: string; created_at: number; status: OrderStatus; pay_mode: string; amount_paise: number; buyer_name: string; qty: number; title: string }>(),
    c.env.DB.prepare(`SELECT d.id, d.title, d.status, d.created_at, d.cod_enabled, (SELECT SUM(stock) FROM variants v WHERE v.drop_id = d.id) AS stock,
                      (SELECT COALESCE(SUM(qty), 0) FROM orders o WHERE o.drop_id = d.id AND o.status = 'paid') AS sold FROM drops d WHERE d.seller_id = ? ORDER BY d.created_at DESC LIMIT 8`)
      .bind(id).all<{ id: string; title: string; status: string; created_at: number; cod_enabled: number; stock: number; sold: number }>(),
    c.env.DB.prepare(`SELECT kind, SUM(count) AS n FROM wa_usage WHERE seller_id = ? AND day >= date('now', '-30 days') GROUP BY kind`).bind(id).all<{ kind: string; n: number }>(),
  ])
  const a = act ?? {}
  const perDay = new Map(daily.map((d) => [d.d, d.n]))
  const KIND: Record<string, string> = { bot: 'Bot replies', notify: 'Order updates', template: 'Template messages' }
  return page(c, '/admin/sellers', s.shop_name, (
    <>
      <a href="/admin/sellers">← Sellers</a>
      <div class="row between" style="margin-top:8px;flex-wrap:wrap">
        <div>
          <h1>{s.shop_name} {s.account_status === 'suspended' ? <span class="chip refund_due">Suspended</span> : billingChip(s)}</h1>
          <p class="sub">{s.name} · {displayPhone(s.phone)} · joined {istDay(s.created_at).split('-').reverse().join('/')} · last active {seen(s.last_seen_at)}</p>
        </div>
        <a class="btn wa sm" href={waLink(s.phone, `Hi ${s.name}, this is NukkadSale support.`)}><Icon n="chat" s={16} />WhatsApp seller</a>
      </div>
      <div class="kpis">
        <div class="kpi"><small class="muted">Orders (7 days)</small><b>{a.orders7 ?? 0}</b></div>
        <div class="kpi"><small class="muted">Orders (30 days)</small><b>{s.orders30}</b></div>
        <div class="kpi"><small class="muted">Sales (30 days)</small><b>{rupees(s.gmv30)}</b></div>
        <div class="kpi"><small class="muted">Sales (all time)</small><b>{rupees(a.gmv_all ?? 0)}</b></div>
        <div class="kpi"><small class="muted">Buyers</small><b>{a.buyers ?? 0}</b></div>
        <div class="kpi"><small class="muted">Live sales / total</small><b>{s.live_sales} / {a.sales_all ?? 0}</b></div>
        <div class="kpi"><small class="muted">WhatsApp messages (30d)</small><b>{s.msgs30}</b></div>
        <div class={`kpi ${(a.to_check ?? 0) || (a.cod_open ?? 0) ? 'warn' : ''}`}><small class="muted">To check / open COD</small><b>{a.to_check ?? 0} / {a.cod_open ?? 0}</b></div>
      </div>
      <div class="cols">
      <div>
        <div class="panel"><h2>Paid orders – last 30 days</h2><Bars values={days.map((d) => perDay.get(d) ?? 0)} days={days} fmt={(n) => `${n} order${n === 1 ? '' : 's'}`} /></div>
        <div class="panel">
          <h2>Recent orders</h2>
          <table class="data">
            <thead><tr><th>When</th><th>Buyer</th><th>Item</th><th>Status</th><th class="r">Amount</th></tr></thead>
            <tbody>
              {recent.map((o) => <tr><td><small>{ago(t, o.created_at)}</small></td><td>{o.buyer_name}</td><td>{clip(o.title, 28)} ×{o.qty}</td><td><span class={`chip ${o.status === 'pending' && o.pay_mode === 'cod' ? 'cod' : o.status}`}>{o.status === 'pending' && o.pay_mode === 'cod' ? 'Cash on delivery' : t.status[o.status]}</span></td><td class="r">{rupees(o.amount_paise)}</td></tr>)}
              {recent.length === 0 && <tr><td colspan={5} class="muted">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Sales</h2>
          <table class="data">
            <thead><tr><th>Sale</th><th>Status</th><th class="r">Sold / stock</th><th>Created</th></tr></thead>
            <tbody>
              {sales.map((d) => <tr><td><a class="rowlink" href={`/d/${d.id}`} target="_blank" rel="noopener">{clip(d.title, 36)}</a>{d.cod_enabled ? <span class="chip cod" style="margin-left:6px">COD</span> : null}</td><td><span class={`chip ${d.status === 'live' ? 'live' : 'closed'}`}>{d.status === 'live' ? 'Live' : 'Closed'}</span></td><td class="r">{d.sold} / {d.stock ?? 0}</td><td><small>{istDay(d.created_at).split('-').reverse().join('/')}</small></td></tr>)}
              {sales.length === 0 && <tr><td colspan={4} class="muted">No sales yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>WhatsApp messages – last 30 days</h2>
          {usage.length ? (
            <table class="data"><tbody>{usage.map((u) => <tr><td>{KIND[u.kind] ?? u.kind}</td><td class="r">{u.n}</td></tr>)}</tbody></table>
          ) : <p class="muted" style="margin:0">None yet. Messages are counted here once the WhatsApp Business number is live.</p>}
        </div>
      </div>
      <div>
      <h2 id="payments">Payment methods</h2>
      {s.gateway_request ? <div class="alert info">This seller asked for automatic payments. Switch on Razorpay, enter their Key ID and Key secret (or let them add them in Settings) and make it active.</div> : null}
      <form method="post" action={`/admin/sellers/${id}/payments`} class="card stack">
        <small>Switch on the methods this seller may use. If only one is on, the seller can't change it.</small>
        {MODES.map((m) => (
          <>
            <label class="choice">
              <input type="checkbox" name="allowed" value={m} checked={allowed.includes(m)} data-mode={m} style="width:24px;min-height:24px;flex:none" />
              <span><b>{MODE_LABEL[m]}</b>{m === 'direct' ? <><br /><small>Seller taps “Yes, I got it” for each order. Best for small sellers.</small></> : <><br /><small>Payments confirm themselves – no manual checking. Best for big sellers.</small></>}</span>
            </label>
            {m === 'razorpay' && (
              <div id="keys" class="stack" data-keys="razorpay" hidden={!allowed.includes('razorpay')} style="padding:4px 0 8px 14px;border-left:3px solid var(--brand)">
                <b>Razorpay keys {extra?.rzp_has ? <span class="chip paid">saved ✓</span> : <span class="chip pending">not added yet</span>}</b>
                <small class="muted">From the seller’s Razorpay dashboard: Account &amp; Settings → API Keys (Live mode) → Generate key. Or let the seller paste them in their app: Settings → How you get paid. Send them the step-by-step guide: <a href="/help/razorpay">{origin}/help/razorpay</a></small>
                <div><label for="rzp_key">Key ID</label><input id="rzp_key" name="rzp_key" placeholder="rzp_live_…" value={s.rzp_key_id ?? ''} autocapitalize="off" autocomplete="off" spellcheck={false} /></div>
                <div><label for="rzp_secret">Key secret</label><input id="rzp_secret" name="rzp_secret" type="password" placeholder={extra?.rzp_has ? 'Saved – leave empty to keep it' : 'Paste the Key secret'} autocomplete="off" /></div>
                <details>
                  <summary class="muted">Optional: webhook secret</summary>
                  <div class="stack" style="margin-top:8px">
                    <input name="rzp_webhook" type="password" placeholder="Razorpay Webhook secret" autocomplete="off" aria-label="Razorpay webhook secret" />
                    <small class="muted">Not needed – payments are confirmed by asking Razorpay. If you add one, its URL is {origin}/webhooks/razorpay/{id}</small>
                  </div>
                </details>
              </div>
            )}
          </>
        ))}
        <div>
          <label for="active">Active right now</label>
          <select id="active" name="active">
            {MODES.map((m) => <option value={m} selected={s.pay_mode === m}>{MODE_LABEL[m]}</option>)}
          </select>
          <small class="muted">Pick Razorpay here once its keys are saved, so new orders use it.</small>
        </div>
        <script>{raw(`document.querySelectorAll('[data-mode]').forEach(function(c){var k=document.querySelector('[data-keys="'+c.dataset.mode+'"]');if(k)c.addEventListener('change',function(){k.hidden=!c.checked})})`)}</script>
        <button class="btn primary block" type="submit">Save payment methods</button>
      </form>

      <h2>Monthly fee</h2>
      <form method="post" action={`/admin/sellers/${id}/billing`} class="card stack">
        <div class="duo">
          <div><label for="fee">Fee per month (₹)</label><div class="money"><span>₹</span><input id="fee" name="fee" inputmode="decimal" value={String(s.plan_fee_paise / 100)} /></div></div>
          <div><label for="trial">Free trial until</label><input id="trial" name="trial" type="date" value={s.trial_until ? istDay(s.trial_until) : ''} /></div>
        </div>
        <small>₹0 = free. Invoices are created automatically on the 1st of each month after the trial.</small>
        <div class="row">
          <button class="btn primary grow" type="submit">Save fee</button>
          <button class="btn grow" type="submit" name="invoice_now" value="1">Save & create invoice now</button>
        </div>
      </form>

      <h2>Invoices</h2>
      {invoices.length === 0 && <p class="muted">No invoices yet.</p>}
      {invoices.map((inv) => <InvoiceCard inv={inv} seller={s} origin={origin} />)}

      <h2>Gateway onboarding</h2>
      <form method="post" action={`/admin/sellers/${id}/onboarding`} class="card stack">
        {MANUAL_STEPS.map(([k, label]) => (
          <label class="row" style="font-weight:400"><input type="checkbox" name={k} value="1" checked={Boolean(onb[k])} style="width:22px;min-height:22px;flex:none" /> {label}</label>
        ))}
        <div class="row"><span style="width:22px;text-align:center"><Icon n={keysAdded ? 'check' : 'square'} s={18} /></span> Keys added (automatic){!keysAdded && <a href="#payments" style="margin-left:auto">Add keys ↑</a>}</div>
        <div class="row"><span style="width:22px;text-align:center"><Icon n={s.pay_mode !== 'direct' ? 'check' : 'square'} s={18} /></span> Gateway active (automatic)</div>
        <div class="row"><span style="width:22px;text-align:center"><Icon n={gwPaid ? 'check' : 'square'} s={18} /></span> First gateway payment received (automatic)</div>
        <button class="btn block" type="submit">Save checklist</button>
      </form>

      <h2>Account</h2>
      <form method="post" action={`/admin/sellers/${id}/pin`} class="card">
        <button class="btn block" type="submit" data-confirm="Make a new PIN for this seller? Their old PIN stops working and they're logged out.">Reset PIN and send new login</button>
      </form>
      <form method="post" action={`/admin/sellers/${id}/status`} class="card">
        {s.account_status === 'active' ? (
          <button class="btn block" style="color:var(--bad)" type="submit" data-confirm="Suspend this seller? Their sales stop taking orders.">Suspend seller</button>
        ) : (
          <button class="btn primary block" type="submit">Re-activate seller</button>
        )}
      </form>
      </div>
      </div>
    </>
  ))
})

const MANUAL_STEPS = [['account', 'Gateway account created (in the seller’s name)'], ['kyc_submitted', 'KYC submitted'], ['kyc_approved', 'KYC approved by the gateway']] as const

const InvoiceCard = ({ inv, seller, origin }: { inv: Invoice & { shop_name?: string }; seller: { name: string; phone: string; shop_name: string }; origin: string }) => {
  const overdue = inv.status === 'due' && inv.due_at < Date.now()
  const month = new Date(inv.period + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <div class={`card order ${inv.status === 'paid' ? 'paid' : inv.status === 'claimed' ? 'verifying' : overdue ? 'refund_due' : inv.status === 'due' ? 'pending' : ''}`}>
      <div class="row between"><b>{inv.shop_name ?? seller.shop_name} · {month}</b><b>{rupees(inv.amount_paise)}</b></div>
      <small>
        {inv.status === 'paid' ? `Paid ${istDay(inv.paid_at!).split('-').reverse().join('/')} via ${inv.paid_via}`
          : inv.status === 'waived' ? 'Waived'
          : inv.status === 'claimed' ? `Seller says paid – check ${rupees(inv.amount_paise)} in your UPI app`
          : `${overdue ? 'Overdue since' : 'Due by'} ${istDay(inv.due_at).split('-').reverse().join('/')}`}
      </small>
      {(inv.status === 'due' || inv.status === 'claimed') && (
        <div class="row wrap" style="margin-top:10px">
          <form method="post" action={`/admin/invoices/${inv.id}/paid`} class="grow"><button class="btn ok sm block" type="submit">✓ Mark paid</button></form>
          <a class="btn wa sm grow" href={waLink(seller.phone, `Hi ${seller.name}, your NukkadSale fee of ${rupees(inv.amount_paise)} for ${month} is ${overdue ? 'overdue' : 'due'}. Pay in 1 tap here: ${origin}/app/billing`)}>💬 Remind</a>
          {inv.status === 'claimed' && <form method="post" action={`/admin/invoices/${inv.id}/not-received`}><button class="btn sm" type="submit" data-confirm="Mark as not received? If it's past the due date, their shop pauses again.">✗ Not received</button></form>}
          <form method="post" action={`/admin/invoices/${inv.id}/waive`}><button class="btn sm" type="submit" data-confirm="Waive this invoice?">Waive</button></form>
        </div>
      )}
    </div>
  )
}

admin.post('/sellers/:id/payments', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.parseBody({ all: true })
  const back = (k: 'ok' | 'err', m: string) => c.redirect(`/admin/sellers/${id}?${k}=${enc(m)}`, 303)
  const allowed = MODES.filter((m) => ([] as unknown[]).concat(f.allowed ?? []).includes(m))
  if (!allowed.length) return back('err', 'Switch on at least one payment method.')
  const cur = await c.env.DB.prepare(`SELECT rzp_key_id, rzp_secret_enc, rzp_webhook_enc FROM sellers WHERE id = ?`).bind(id)
    .first<{ rzp_key_id: string | null; rzp_secret_enc: string | null; rzp_webhook_enc: string | null }>()
  if (!cur) return c.notFound()
  const str = (k: string) => String(([] as unknown[]).concat(f[k] ?? '')[0] ?? '').trim()
  const rzpKey = str('rzp_key') || cur.rzp_key_id
  const rzpSecret = str('rzp_secret') ? await encryptSecret(c.env, str('rzp_secret')) : cur.rzp_secret_enc
  const rzpHook = str('rzp_webhook') ? await encryptSecret(c.env, str('rzp_webhook')) : cur.rzp_webhook_enc
  const ready = (m: PayMode) => m === 'direct' || Boolean(rzpKey && rzpSecret)
  if (rzpKey && isTestKey(rzpKey) && c.env.ALLOW_TEST_KEYS !== '1') return back('err', 'Those are Razorpay TEST keys (rzp_test_…) – they take fake payments. Use live keys (rzp_live_…).')
  if (rzpKey && rzpSecret && (str('rzp_secret') || rzpKey !== cur.rzp_key_id)) {
    const plain = str('rzp_secret') || (await decrypt(rzpSecret, c.env.SECRET_KEY))
    if ((await checkKeys(rzpKey, plain, c.env.RAZORPAY_API_BASE)) === 'bad') return back('err', 'Razorpay didn’t accept these keys. Check the full Key ID and Key secret from Live mode.')
  }
  let active = (str('active') as PayMode) || allowed[0]
  if (!allowed.includes(active)) active = allowed[0]
  if (!ready(active)) return back('err', `${MODE_LABEL[active]} needs its keys before it can be active. Enter them under Razorpay above, or let the seller add them in Settings.`)
  await c.env.DB.prepare(
    `UPDATE sellers SET allowed_modes = ?, pay_mode = ?, rzp_key_id = ?, rzp_secret_enc = ?, rzp_webhook_enc = ?,
            gateway_request = CASE WHEN ?2 = 'direct' THEN gateway_request ELSE 0 END WHERE id = ?`,
  ).bind(allowed.join(','), active, rzpKey, rzpSecret, rzpHook, id).run()
  return back('ok', 'Payment methods saved.')
})

admin.post('/sellers/:id/billing', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.parseBody()
  const fee = parsePaise(String(f.fee ?? '0') || '0')
  if (fee === null) return c.redirect(`/admin/sellers/${id}?err=${enc('Enter a valid fee.')}`, 303)
  const trial = /^\d{4}-\d{2}-\d{2}$/.test(String(f.trial ?? '')) ? istDayStart(Date.parse(String(f.trial) + 'T12:00:00Z')) : 0
  await c.env.DB.prepare(`UPDATE sellers SET plan_fee_paise = ?, trial_until = ? WHERE id = ?`).bind(fee, trial, id).run()
  if (f.invoice_now) await ensureInvoices(c.env, id)
  return c.redirect(`/admin/sellers/${id}?ok=${enc('Fee saved.')}`, 303)
})

admin.post('/sellers/:id/onboarding', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.parseBody()
  const onb = Object.fromEntries(MANUAL_STEPS.map(([k]) => [k, Boolean(f[k])]))
  await c.env.DB.prepare(`UPDATE sellers SET onboarding = ? WHERE id = ?`).bind(JSON.stringify(onb), id).run()
  return c.redirect(`/admin/sellers/${id}?ok=${enc('Checklist saved.')}`, 303)
})

admin.post('/sellers/:id/status', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`UPDATE sellers SET account_status = CASE account_status WHEN 'active' THEN 'suspended' ELSE 'active' END WHERE id = ?`).bind(id).run()
  return c.redirect(`/admin/sellers/${id}?ok=${enc('Account updated.')}`, 303)
})

const backTo = (c: Context<AppEnv>, ok: string) => {
  const ref = c.req.header('Referer')
  const url = new URL(ref && new URL(ref).pathname.startsWith('/admin') ? ref : new URL('/admin/billing', c.req.url).href)
  url.searchParams.set('ok', ok)
  return c.redirect(url.pathname + url.search, 303)
}

admin.post('/invoices/:id/paid', async (c) => {
  await markInvoicePaid(c.env, c.req.param('id'), 'admin')
  return backTo(c, 'Marked paid.')
})

// The seller said they paid by UPI but the money isn't there: back to due (pauses again if past due).
admin.post('/invoices/:id/not-received', async (c) => {
  await c.env.DB.prepare(`UPDATE invoices SET status = 'due' WHERE id = ? AND status = 'claimed'`).bind(c.req.param('id')).run()
  return backTo(c, 'Marked not received. The seller sees it as unpaid again.')
})

admin.post('/invoices/:id/waive', async (c) => {
  await c.env.DB.prepare(`UPDATE invoices SET status = 'waived', paid_at = ?, paid_via = 'waived' WHERE id = ? AND status IN ('due', 'claimed')`).bind(Date.now(), c.req.param('id')).run()
  return backTo(c, 'Waived.')
})

// ---------- Privacy / data requests ----------

type DataReq = { id: number; phone: string; kind: 'delete' | 'copy'; note: string; status: string; created_at: number; done_at: number | null }

admin.get('/privacy', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM data_requests ORDER BY status = 'open' DESC, created_at DESC LIMIT 200`).all<DataReq>()
  return page(c, '/admin/privacy', 'Privacy requests', (
    <>
      <h1>Data requests</h1>
      <p class="hint">Verify each request on WhatsApp first (the requester must reply from that number), then act. Reply within 30 days.</p>
      {results.length === 0 && <p class="muted">No requests.</p>}
      {results.map((r) => (
        <div class={`card order ${r.status === 'open' ? 'pending' : 'paid'}`}>
          <div class="row between"><b>{r.kind === 'delete' ? 'Delete data' : 'Copy of data'} · {displayPhone(r.phone)}</b><span class={`chip ${r.status === 'open' ? 'pending' : 'closed'}`}>{r.status}</span></div>
          <small>{istDay(r.created_at).split('-').reverse().join('/')}{r.note ? ` · “${r.note}”` : ''}</small>
          {r.status === 'open' && (
            <div class="row wrap" style="margin-top:10px">
              <a class="btn wa sm" href={waLink(r.phone, `Hi, this is NukkadSale. We received a request to ${r.kind === 'delete' ? 'delete' : 'send a copy of'} your data. Please reply YES from this number to confirm.`)}>💬 Verify</a>
              {r.kind === 'copy' && <a class="btn sm" href={`/admin/privacy/${r.id}/export`}><Icon n="download" s={16} />Export</a>}
              <form method="post" action={`/admin/privacy/${r.id}/done`} class="grow">
                <button class="btn ok sm block" type="submit" data-confirm={r.kind === 'delete' ? 'Anonymise this number’s orders and delete their saved details? This cannot be undone.' : 'Mark as done?'}>
                  {r.kind === 'delete' ? 'Anonymise & mark done' : 'Mark done'}
                </button>
              </form>
              <form method="post" action={`/admin/privacy/${r.id}/reject`}><button class="btn sm" type="submit">Reject</button></form>
            </div>
          )}
        </div>
      ))}
    </>
  ))
})

admin.get('/privacy/:id/export', async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM data_requests WHERE id = ?`).bind(Number(c.req.param('id'))).first<DataReq>()
  if (!r) return c.notFound()
  const [orders, buyer, seller] = await Promise.all([
    c.env.DB.prepare(`SELECT o.id, o.created_at, o.status, o.qty, o.amount_paise, o.buyer_name, o.address, d.title, s.shop_name FROM orders o JOIN drops d ON d.id = o.drop_id JOIN sellers s ON s.id = o.seller_id WHERE o.buyer_phone = ?`).bind(r.phone).all(),
    c.env.DB.prepare(`SELECT phone, name, address, pincode, lang FROM buyers WHERE phone = ?`).bind(r.phone).first(),
    c.env.DB.prepare(`SELECT name, shop_name, phone, upi_vpa, created_at FROM sellers WHERE phone = ?`).bind(r.phone).first(),
  ])
  return c.body(JSON.stringify({ phone: r.phone, seller_account: seller, whatsapp_buyer_profile: buyer, orders: orders.results }, null, 2), 200, {
    'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="data-${r.phone}.json"`,
  })
})

admin.post('/privacy/:id/done', async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM data_requests WHERE id = ?`).bind(Number(c.req.param('id'))).first<DataReq>()
  if (!r) return c.notFound()
  if (r.kind === 'delete') {
    // Orders stay as the seller's records (amounts, items) but no longer identify the buyer.
    const { results: proofs } = await c.env.DB.prepare(`SELECT proof_key FROM orders WHERE buyer_phone = ? AND proof_key IS NOT NULL`).bind(r.phone).all<{ proof_key: string }>()
    for (const p of proofs) await c.env.IMAGES.delete(p.proof_key)
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE orders SET buyer_name = 'Deleted buyer', address = '', utr = NULL, proof_key = NULL, ip_hash = NULL, buyer_phone = 'deleted' WHERE buyer_phone = ?`).bind(r.phone),
      c.env.DB.prepare(`DELETE FROM buyers WHERE phone = ?`).bind(r.phone),
      c.env.DB.prepare(`DELETE FROM wa_sessions WHERE phone = ?`).bind(r.phone),
    ])
  }
  await c.env.DB.prepare(`UPDATE data_requests SET status = 'done', done_at = ? WHERE id = ?`).bind(Date.now(), r.id).run()
  return backTo(c, 'Done.')
})

admin.post('/privacy/:id/reject', async (c) => {
  await c.env.DB.prepare(`UPDATE data_requests SET status = 'rejected', done_at = ? WHERE id = ?`).bind(Date.now(), Number(c.req.param('id'))).run()
  return backTo(c, 'Marked rejected.')
})

// ---------- Billing (all invoices) ----------

// ---------- Traffic analytics (first-party, see lib/analytics.ts) ----------
admin.get('/analytics', async (c) => {
  const db = c.env.DB
  const days = [7, 30, 90].includes(Number(c.req.query('d'))) ? Number(c.req.query('d')) : 30
  const area = c.req.query('area') === 'shop' ? 'shop' : 'site'
  const since = Date.now() - days * 86_400_000
  const q = <T,>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).all<T>().then((r) => r.results)
  const one = <T,>(sql: string, ...b: unknown[]) => db.prepare(sql).bind(...b).first<T>()
  const W = `at >= ?1 AND area = ?2`
  const [tot, live, perDay, pages, sources, clicks, devices, places, funnel, leads, form, sess] = await Promise.all([
    one<{ visitors: number; sessions: number; views: number }>(`SELECT COUNT(DISTINCT vid) visitors, COUNT(DISTINCT sid) sessions, SUM(type = 'view') views FROM events WHERE ${W}`, since, area),
    one<{ n: number }>(`SELECT COUNT(DISTINCT vid) n FROM events WHERE at >= ?1 AND area = ?2`, Date.now() - 5 * 60_000, area),
    q<{ d: string; v: number }>(`SELECT strftime('%Y-%m-%d', at / 1000 + 19800, 'unixepoch') d, COUNT(DISTINCT vid) v FROM events WHERE ${W} AND type = 'view' GROUP BY d`, since, area),
    q<{ path: string; views: number; visitors: number; ms: number; scroll: number }>(
      `SELECT p.path, p.views, p.visitors, COALESCE(l.ms, 0) ms, COALESCE(l.scroll, 0) scroll FROM
         (SELECT path, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM events WHERE ${W} AND type = 'view' GROUP BY path) p LEFT JOIN
         (SELECT path, AVG(ms) ms, AVG(scroll) scroll FROM (SELECT path, sid, MAX(ms) ms, MAX(scroll) scroll FROM events WHERE ${W} AND type = 'leave' GROUP BY path, sid) GROUP BY path) l
       ON l.path = p.path ORDER BY p.views DESC LIMIT 15`, since, area),
    // Where each session came from (its first page view), and how many of those sessions sent the form.
    q<{ src: string; sessions: number; submits: number }>(
      `SELECT src, COUNT(*) sessions, SUM(sub) submits FROM (
         SELECT f.sid, CASE WHEN f.utm_source <> '' THEN f.utm_source WHEN f.ref <> '' THEN f.ref ELSE 'Direct / WhatsApp' END src,
                EXISTS(SELECT 1 FROM events x WHERE x.sid = f.sid AND x.type = 'form_submit' AND x.label = 'getstarted') sub
         FROM events f WHERE f.id IN (SELECT MIN(id) FROM events WHERE ${W} AND type = 'view' GROUP BY sid))
       GROUP BY src ORDER BY sessions DESC LIMIT 12`, since, area),
    q<{ label: string; href: string; n: number }>(`SELECT label, href, COUNT(*) n FROM events WHERE ${W} AND type = 'click' AND label <> '' GROUP BY label, href ORDER BY n DESC LIMIT 15`, since, area),
    q<{ device: string; n: number }>(`SELECT device, COUNT(DISTINCT vid) n FROM events WHERE ${W} GROUP BY device ORDER BY n DESC`, since, area),
    q<{ place: string; n: number }>(`SELECT CASE WHEN city <> '' THEN city || ', ' || country ELSE country END place, COUNT(DISTINCT vid) n FROM events WHERE ${W} AND country <> '' GROUP BY place ORDER BY n DESC LIMIT 10`, since, area),
    one<{ home: number; deep: number; cta: number; start: number; sent: number }>(
      `SELECT COUNT(DISTINCT CASE WHEN type = 'view' AND path = '/' THEN sid END) home,
              COUNT(DISTINCT CASE WHEN type = 'leave' AND path = '/' AND scroll >= 50 THEN sid END) deep,
              COUNT(DISTINCT CASE WHEN type = 'click' AND (href LIKE '%get-started%' OR label LIKE 'Get started%' OR label LIKE 'Start%') THEN sid END) cta,
              COUNT(DISTINCT CASE WHEN type = 'form_start' AND label = 'getstarted' THEN sid END) start,
              COUNT(DISTINCT CASE WHEN type = 'form_submit' AND label = 'getstarted' THEN sid END) sent
       FROM events WHERE at >= ?1 AND area = 'site'`, since),
    one<{ n: number }>(`SELECT COUNT(*) n FROM leads WHERE created_at >= ?`, since),
    one<{ n: number }>(`SELECT COUNT(DISTINCT sid) n FROM events WHERE ${W} AND type = 'form_start'`, since, area),
    one<{ bounced: number; total: number; avg: number }>(
      `SELECT SUM(v = 1 AND c = 0) bounced, COUNT(*) total, AVG(ms) avg FROM (SELECT sid, SUM(type = 'view') v, SUM(type = 'click') c, SUM(CASE WHEN type = 'leave' THEN ms ELSE 0 END) ms FROM events WHERE ${W} GROUP BY sid)`, since, area),
  ])
  const dayKeys = Array.from({ length: days }, (_, i) => istDay(Date.now() - (days - 1 - i) * 86_400_000))
  const byDay = new Map(perDay.map((r) => [r.d, r.v]))
  const visitors = tot?.visitors ?? 0
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–')
  const dur = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` }
  // Sale pages in the shop view: show the product name instead of /d/<id>.
  const ids = pages.map((p) => p.path.match(/^\/[dw]\/([a-z0-9]+)/)?.[1]).filter(Boolean) as string[]
  const titles = ids.length ? new Map((await q<{ id: string; title: string }>(`SELECT id, title FROM drops WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)).map((r) => [r.id, r.title])) : new Map()
  const pageName = (p: string) => { const id = p.match(/^\/[dw]\/([a-z0-9]+)/)?.[1]; return id && titles.get(id) ? `${titles.get(id)} (${p})` : p }
  const bar = (n: number, max: number) => <span style={`display:inline-block;height:8px;border-radius:4px;background:var(--brand);opacity:.75;width:${Math.max(2, Math.round((n / Math.max(1, max)) * 120))}px`} />
  const steps: [string, number][] = funnel ? [['Visited the home page', funnel.home], ['Scrolled half way', funnel.deep], ['Tapped Get started', funnel.cta], ['Started the form', funnel.start], ['Sent the form', funnel.sent]] : []
  const tab = (d: number, a: string, label: string) => <a class={`btn sm${d === days && a === area ? ' primary' : ''}`} href={`/admin/analytics?d=${d}&area=${a}`}>{label}</a>

  return page(c, '/admin/analytics', 'Analytics', (
    <>
      <h1>Analytics</h1>
      <p class="sub">{area === 'site' ? 'Website traffic – home page, forms, legal pages, login' : 'Shop traffic – sale pages, storefronts and order pages'} · last {days} days · no cookies, nothing sent to third parties</p>
      <div class="toolbar">
        {tab(days, 'site', 'Website')}{tab(days, 'shop', 'Shops')}<span style="width:16px" />
        {[7, 30, 90].map((d) => tab(d, area, `${d} days`))}
        <span class="muted" style="margin-left:auto"><span class="dotx" style="background:var(--ok)" />{live?.n ?? 0} on the {area === 'site' ? 'site' : 'shops'} now</span>
      </div>
      <div class="kpis">
        <div class="kpi"><small class="muted">Visitors</small><b>{visitors}</b></div>
        <div class="kpi"><small class="muted">Visits (sessions)</small><b>{tot?.sessions ?? 0}</b></div>
        <div class="kpi"><small class="muted">Page views</small><b>{tot?.views ?? 0}</b></div>
        <div class="kpi"><small class="muted">Avg time per visit</small><b>{dur(sess?.avg ?? 0)}</b></div>
        <div class="kpi"><small class="muted">Bounce rate</small><b>{pct(sess?.bounced ?? 0, sess?.total ?? 0)}</b></div>
        <div class="kpi"><small class="muted">Started a form</small><b>{form?.n ?? 0}</b></div>
        {area === 'site' && <a class="kpi ok" href="/admin/leads"><small class="muted">Get-started requests</small><b>{leads?.n ?? 0}</b></a>}
        {area === 'site' && <div class="kpi"><small class="muted">Visitor → request</small><b>{pct(leads?.n ?? 0, visitors)}</b></div>}
      </div>
      <div class="panel"><h2>Visitors per day</h2><Bars values={dayKeys.map((d) => byDay.get(d) ?? 0)} days={dayKeys} fmt={(n) => `${n} visitors`} /></div>
      <div class="cols">
        <div>
          <div class="panel"><h2>Pages</h2>
            <table class="data"><thead><tr><th>Page</th><th class="r">Views</th><th class="r">Visitors</th><th class="r">Avg time</th><th class="r">Scrolled</th></tr></thead>
              <tbody>{pages.length ? pages.map((p) => <tr><td style="white-space:normal">{pageName(p.path)}</td><td class="r">{p.views}</td><td class="r">{p.visitors}</td><td class="r">{dur(p.ms)}</td><td class="r">{Math.round(p.scroll)}%</td></tr>) : <tr><td colspan={5} class="muted">No visits yet.</td></tr>}</tbody></table></div>
          <div class="panel"><h2>Buttons and links clicked</h2>
            <table class="data"><thead><tr><th>Button / link</th><th>Goes to</th><th class="r">Clicks</th></tr></thead>
              <tbody>{clicks.length ? clicks.map((k) => <tr><td style="white-space:normal">{k.label}</td><td class="muted" style="white-space:normal;max-width:260px;overflow:hidden;text-overflow:ellipsis">{k.href}</td><td class="r">{k.n}</td></tr>) : <tr><td colspan={3} class="muted">No clicks yet.</td></tr>}</tbody></table></div>
        </div>
        <div>
          {area === 'site' && <div class="panel"><h2>Funnel</h2>
            {steps.map(([label, n], i) => <div class="row between" style="padding:7px 0;border-top:1px solid var(--line)"><span>{i + 1}. {label}</span><span class="row" style="gap:10px">{bar(n, steps[0][1])}<b style="min-width:40px;text-align:right">{n}</b><small class="muted" style="min-width:38px;text-align:right">{i ? pct(n, steps[0][1]) : ''}</small></span></div>)}
          </div>}
          <div class="panel"><h2>Where visitors come from</h2>
            <table class="data"><thead><tr><th>Source</th><th class="r">Visits</th>{area === 'site' && <th class="r">Requests</th>}</tr></thead>
              <tbody>{sources.length ? sources.map((r) => <tr><td>{r.src}</td><td class="r">{r.sessions}</td>{area === 'site' && <td class="r">{r.submits}</td>}</tr>) : <tr><td colspan={3} class="muted">No visits yet.</td></tr>}</tbody></table>
            <small class="muted">Add <code>?utm_source=instagram</code> (or youtube, ads…) to links you post to see them here. WhatsApp and apps usually show as Direct.</small></div>
          <div class="panel"><h2>Devices</h2>{devices.map((d) => <div class="row between" style="padding:5px 0"><span>{d.device === 'mobile' ? 'Phone' : 'Computer'}</span><span class="row" style="gap:10px">{bar(d.n, visitors)}<b>{pct(d.n, visitors)}</b></span></div>)}</div>
          <div class="panel"><h2>Places</h2>{places.length ? places.map((p) => <div class="row between" style="padding:5px 0"><span>{p.place}</span><b>{p.n}</b></div>) : <p class="muted">Shown once visits come in through Cloudflare.</p>}</div>
        </div>
      </div>
    </>
  ))
})

admin.get('/billing', async (c) => {
  const f = c.req.query('f') ?? 'open'
  const where = { open: `i.status IN ('due', 'claimed')`, claimed: `i.status = 'claimed'`, overdue: `i.status = 'due' AND i.due_at < ?1`, paid: `i.status IN ('paid', 'waived')`, all: `?1 > 0` }[f] ?? `i.status IN ('due', 'claimed')`
  const { results } = await c.env.DB
    .prepare(`SELECT i.*, s.shop_name, s.name, s.phone FROM invoices i JOIN sellers s ON s.id = i.seller_id WHERE ${where.includes('?1') ? where : `${where} AND ?1 > 0`}
              ORDER BY CASE i.status WHEN 'claimed' THEN 0 WHEN 'due' THEN 1 ELSE 2 END, i.due_at LIMIT 300`)
    .bind(Date.now())
    .all<Invoice & { shop_name: string; name: string; phone: string }>()
  const origin = new URL(c.req.url).origin
  const filters = [['open', 'Unpaid'], ['claimed', 'Says paid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']]
  return page(c, '/admin/billing', 'Billing', (
    <>
      <h1>Billing</h1>
      <div class="tabs">{filters.map(([k, l]) => <a href={`/admin/billing?f=${k}`} class={f === k ? 'on' : ''}>{l}</a>)}</div>
      {results.length === 0 && <p class="muted" style="text-align:center;margin-top:24px">Nothing here.</p>}
      {results.map((inv) => <InvoiceCard inv={inv} seller={inv} origin={origin} />)}
    </>
  ))
})

// ---------- Platform settings ----------

admin.get('/settings', async (c) => {
  const s = await getSettings(c.env)
  const modes = parseModes(s.default_modes)
  return page(c, '/admin/settings', 'Settings', (
    <>
      <h1>Platform settings</h1>
      <form method="post" class="stack">
        <h2>How sellers pay you</h2>
        <div class="card stack">
          <small>Sellers see these on their Billing page. With Razorpay, fee payments confirm automatically; with UPI you confirm with one tap.</small>
          <div><label for="vpa">Your UPI ID (for fees)</label><input id="vpa" name="upi_vpa" value={s.upi_vpa} placeholder="nukkadsale@ybl" autocapitalize="off" spellcheck={false} /></div>
          <div><label for="payee">Payee name</label><input id="payee" name="payee_name" value={s.payee_name} /></div>
          <div><label for="rzpkey">Your Razorpay Key ID</label><input id="rzpkey" name="rzp_key_id" value={s.rzp_key_id} placeholder="rzp_live_…" autocapitalize="off" spellcheck={false} /></div>
          <div><label for="rzpsec">Your Razorpay Key secret</label><input id="rzpsec" name="rzp_secret" type="password" placeholder={s.rzp_secret_enc ? 'Saved – leave empty to keep' : ''} autocomplete="off" /></div>
        </div>
        <h2>Defaults for new sellers</h2>
        <div class="card stack">
          <div class="duo">
            <div><label for="fee">Monthly fee (₹)</label><div class="money"><span>₹</span><input id="fee" name="default_fee" inputmode="decimal" value={String(Number(s.default_fee_paise) / 100)} /></div></div>
            <div><label for="trial">Free trial (days)</label><input id="trial" name="trial_days" type="number" inputmode="numeric" min="0" value={s.trial_days} /></div>
          </div>
          <div><label for="grace">Days to pay before the shop pauses</label><input id="grace" name="grace_days" type="number" inputmode="numeric" min="0" value={s.grace_days} /></div>
          <div>
            <label>Payment methods switched on</label>
            {MODES.map((m) => (
              <label class="row" style="font-weight:400"><input type="checkbox" name="default_modes" value={m} checked={modes.includes(m)} style="width:22px;min-height:22px;flex:none" /> {MODE_LABEL[m]}</label>
            ))}
          </div>
        </div>
        <button class="btn primary block big" type="submit">Save settings</button>
      </form>
      <form method="post" action="/admin/logout" style="margin-top:20px"><button class="btn block ghost" type="submit">Log out of admin</button></form>
    </>
  ))
})

admin.post('/settings', async (c) => {
  const f = await c.req.parseBody({ all: true })
  const str = (k: string) => String(([] as unknown[]).concat(f[k] ?? '')[0] ?? '').trim()
  const modes = MODES.filter((m) => ([] as unknown[]).concat(f.default_modes ?? []).includes(m))
  const patch: Record<string, string> = {
    upi_vpa: str('upi_vpa'),
    payee_name: str('payee_name') || 'NukkadSale',
    rzp_key_id: str('rzp_key_id'),
    default_fee_paise: String(parsePaise(str('default_fee') || '0') ?? 0),
    trial_days: String(Math.max(0, Math.floor(Number(str('trial_days')) || 0))),
    grace_days: String(Math.max(0, Math.floor(Number(str('grace_days') || '2') || 0))),
    default_modes: (modes.length ? modes : ['direct']).join(','),
  }
  if (patch.rzp_key_id && isTestKey(patch.rzp_key_id) && c.env.ALLOW_TEST_KEYS !== '1') return c.redirect(`/admin/settings?err=${enc('Those are Razorpay TEST keys (rzp_test_…). Use your live keys (rzp_live_…).')}`, 303)
  if (str('rzp_secret')) patch.rzp_secret_enc = await encryptSecret(c.env, str('rzp_secret'))
  await saveSettings(c.env, patch)
  return c.redirect(`/admin/settings?ok=${enc('Settings saved.')}`, 303)
})
