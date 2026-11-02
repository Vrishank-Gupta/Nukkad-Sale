import { Hono } from 'hono'
import type { AppEnv, Bindings } from './env'
import { tr } from './i18n'
import { currentSeller, sameOrigin } from './lib/auth'
import { billingCron } from './lib/billing'
import { reconcileGateways } from './lib/gateway'
import { expireHolds } from './lib/orders'
import { auth } from './routes/auth'
import { here, pub, storefrontBySlug } from './routes/public'
import { admin } from './routes/admin'
import { legal } from './routes/legal'
import { site } from './routes/site'
import { guide } from './routes/guide'
import { app as sellerApp } from './routes/seller'
import { hooks } from './routes/webhooks'
import { ICONS, SCREENSHOTS } from './icons'
import { cleanEvents, collect } from './lib/analytics'
import { refreshShipments } from './lib/shiprocket'
import { Layout } from './views/layout'

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  c.header('X-Frame-Options', 'DENY')
})
// Old name's domain → the new one, same path, so old ads, bios and shared links keep working.
// Only page loads move: webhooks and form/gateway POSTs still work on the old domain, so nothing
// breaks before Meta's and Razorpay's webhook URLs are switched to nukkadsale.in.
const OLD_HOSTS = new Set(['khatakhat.co.in', 'www.khatakhat.co.in', 'www.nukkadsale.in'])
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (OLD_HOSTS.has(url.hostname) && (c.req.method === 'GET' || c.req.method === 'HEAD') && !url.pathname.startsWith('/webhooks')) {
    return c.redirect(`https://nukkadsale.in${url.pathname}${url.search}`, 301)
  }
  await next()
})
// Webhooks are server-to-server and authenticated by signature, so they skip the origin check.
app.route('/webhooks', hooks)
// Analytics beacons (sendBeacon can't send an Origin check-friendly request on every browser).
app.post('/e', (c) => collect(c))
app.use('*', sameOrigin)

// Marketing site, the "Get started" form and its thank-you page.
app.route('/', site)
app.route('/', guide)

// ---------- Installable app (PWA) ----------

const b64bytes = (b64: string) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))

app.get('/manifest.webmanifest', (c) =>
  c.json(
    {
      id: '/app',
      name: 'NukkadSale – WhatsApp shop',
      short_name: 'NukkadSale',
      description: 'Sell on WhatsApp, get paid on UPI, never oversell. Orders, stock and khata in one app.',
      lang: 'en-IN',
      start_url: '/app?source=app',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#faf7f2',
      theme_color: '#d9480f',
      categories: ['business', 'shopping', 'finance'],
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      // Long-press the home-screen icon to jump straight in.
      shortcuts: [
        { name: 'New sale', short_name: 'New sale', url: '/app/drops/new', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        { name: 'Orders', short_name: 'Orders', url: '/app/orders', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        { name: 'Khata', short_name: 'Khata', url: '/app/khata', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      ],
      // Shown in Android's richer install sheet.
      screenshots: [
        { src: '/screenshot-home.jpg', sizes: '540x1168', type: 'image/jpeg', form_factor: 'narrow', label: 'Your shop at a glance' },
        { src: '/screenshot-buyer.jpg', sizes: '540x1168', type: 'image/jpeg', form_factor: 'narrow', label: 'What buyers see' },
      ],
    },
    200,
    { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  ),
)
app.get('/:icon{(apple-touch-icon|icon-192|icon-512)\\.png}', (c) => {
  const b64 = ICONS[c.req.param('icon')]
  if (!b64) return c.notFound()
  return c.body(b64bytes(b64), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' })
})
app.get('/:shot{screenshot-(home|buyer)\\.jpg}', (c) => {
  const b64 = SCREENSHOTS[c.req.param('shot')]
  return b64 ? c.body(b64bytes(b64), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' }) : c.notFound()
})

/*
 * Service worker. Deliberately small:
 *  - product photos: cache-first (their URLs never change), so repeat visits are instant;
 *  - page loads: always from the network, with a friendly offline page if there is none.
 * Logged-in pages are never cached, so nothing private stays on a shared phone.
 */
const SW_VERSION = 'kk-2'
const SW = `const V='${SW_VERSION}',OFF='/offline';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll([OFF,'/icon-192.png'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;
 if(u.pathname.startsWith('/img/d/')){e.respondWith(caches.open(V).then(c=>c.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res}))));return}
 if(r.mode==='navigate')e.respondWith(fetch(r).catch(()=>caches.match(OFF)))});
// Order alerts (Web Push): show the notification; tapping it opens the right screen.
self.addEventListener('push',e=>{let d={};try{d=e.data.json()}catch(x){d={title:'NukkadSale',body:e.data?e.data.text():''}}
 e.waitUntil(self.registration.showNotification(d.title||'NukkadSale',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',tag:d.tag,renotify:Boolean(d.tag),data:{url:d.url||'/app'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/app';
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.navigate(u);return c.focus()}}return self.clients.openWindow(u)}))});`

app.get('/sw.js', (c) => c.body(SW, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }))

app.get('/offline', (c) => {
  const t = tr(c)
  return c.html(
    <Layout t={t} path="/" title="Offline – NukkadSale">
      <div style="text-align:center;margin-top:60px">
        <div style="font-size:3.4rem">📶</div>
        <h1>You’re offline</h1>
        <p>Please check your internet. Your orders and khata are safe.</p>
        <h2 style="margin-top:28px" lang="hi">इंटरनेट नहीं है</h2>
        <p lang="hi">कृपया इंटरनेट चेक करें। आपके ऑर्डर और खाता सुरक्षित हैं।</p>
        <button class="btn primary block big" style="margin-top:24px" onclick="location.reload()">↻ Try again / फिर से कोशिश करें</button>
      </div>
    </Layout>,
  )
})

app.route('/', auth)
app.route('/', pub)
app.route('/app', sellerApp)
app.route('/admin', admin)
app.route('/', legal)
// A seller's storefront at nukkadsale.in/<slug> – last, so every real page above wins.
app.get('/:slug{[a-z0-9][a-z0-9-]{2,29}}', (c) => storefrontBySlug(c))

app.notFound((c) => {
  const t = tr(c)
  return c.html(
    <Layout t={t} path="/" title={t.notFound}>
      <h1>{t.notFound}</h1>
      <p>{t.notFoundBody}</p>
      <a class="btn block" href="/">{t.goHome}</a>
    </Layout>,
    404,
  )
})

app.onError((err, c) => {
  console.error(err)
  const t = tr(c)
  return c.html(
    <Layout t={t} path="/" title={t.oops}>
      <h1>{t.oops}</h1>
      <p>{t.oopsBody}</p>
    </Layout>,
    500,
  )
})

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        // Check lost gateway payments first so a paid order is never released back to stock.
        reconcileGateways(env).catch((e) => console.error('reconcile', e)).then(() => expireHolds(env)),
        billingCron(env).catch((e) => console.error('billing', e)),
        env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(Date.now()).run(),
        env.DB.prepare(`DELETE FROM webhook_events WHERE received_at < ?`).bind(Date.now() - 30 * 86_400_000).run(),
        cleanEvents(env.DB).catch(() => {}),
        refreshShipments(env).catch((e) => console.error('shipments', e)),
      ]),
    )
  },
} satisfies ExportedHandler<Bindings>
