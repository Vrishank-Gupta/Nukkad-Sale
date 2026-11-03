import type { Context } from 'hono'
import type { AppEnv } from '../env'

/**
 * First-party traffic analytics. A tiny script on public pages sends page views, clicks, form steps and
 * time-on-page to /e; nothing goes to a third party, no cookies are set (ids live in the browser's storage),
 * Do-Not-Track and bots are skipped, and events are deleted after 180 days.
 */
export const TRACK_JS = `(function(){try{if(navigator.doNotTrack==='1'||/bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent))return;
var r=function(){return Math.random().toString(36).slice(2,12)},vid,sid;
try{vid=localStorage.getItem('kk_vid');if(!vid){vid=r()+r();localStorage.setItem('kk_vid',vid)}}catch(e){vid=r()}
try{sid=sessionStorage.getItem('kk_sid');if(!sid){sid=r();sessionStorage.setItem('kk_sid',sid)}}catch(e){sid=r()}
var q=new URLSearchParams(location.search),ref='';try{ref=document.referrer?new URL(document.referrer).hostname:''}catch(e){}if(ref===location.hostname)ref='';
var vis=0,last=Date.now(),shown=document.visibilityState==='visible',maxS=0,started={};
function send(t,x){var b=JSON.stringify(Object.assign({t:t,v:vid,s:sid,p:location.pathname,r:ref,us:q.get('utm_source')||'',um:q.get('utm_medium')||'',uc:q.get('utm_campaign')||'',w:innerWidth},x||{}));
 try{navigator.sendBeacon?navigator.sendBeacon('/e',b):fetch('/e',{method:'POST',body:b,keepalive:true})}catch(e){}}
send('view');
addEventListener('scroll',function(){var h=document.documentElement.scrollHeight-innerHeight;if(h>0)maxS=Math.max(maxS,Math.min(100,Math.round(scrollY/h*100)))},{passive:true});
function secOf(el){var x=el&&el.closest&&el.closest('[data-sec]');return x?x.getAttribute('data-sec'):''}
document.addEventListener('click',function(e){var a=e.target.closest('a,button,summary,label.btn');if(!a)return;var l=(a.dataset.track||a.innerText||a.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,60);send('click',{l:l,h:(a.getAttribute('href')||'').slice(0,120),sec:secOf(a)})},true);
document.addEventListener('focusin',function(e){var f=e.target.closest&&e.target.closest('form');if(!f)return;var k=f.id||f.getAttribute('action')||'form';if(!started[k]){started[k]=1;send('form_start',{l:k,sec:secOf(f)})}});
document.addEventListener('submit',function(e){var f=e.target;send('form_submit',{l:f.id||f.getAttribute('action')||'form',sec:secOf(f)})},true);
// Page sections (data-sec): "section" the first time one stays in the middle of the screen for 0.6 s (so jumping
// past it with a "Get started" link doesn't count), "dwell" = total time it sat there while the tab was visible
// (cumulative; the server keeps the largest per visit).
var secIn={},secT={},secSent={},seen={},secTm={};
function secAcc(){var n=Date.now();for(var k in secIn){if(shown)secT[k]=(secT[k]||0)+n-secIn[k];secIn[k]=n}}
function secFlush(){secAcc();for(var k in secT){if(secT[k]-(secSent[k]||0)>=1000){secSent[k]=secT[k];send('dwell',{l:k,sec:k,ms:secT[k]})}}}
if('IntersectionObserver' in window){var els=document.querySelectorAll('[data-sec]');if(els.length){var io=new IntersectionObserver(function(es){secAcc();es.forEach(function(en){var k=en.target.getAttribute('data-sec');
 if(en.isIntersecting){secIn[k]=Date.now();if(!seen[k])secTm[k]=setTimeout(function(){if(secIn[k]&&!seen[k]){seen[k]=1;send('section',{l:k,sec:k})}},600)}else{delete secIn[k];clearTimeout(secTm[k])}})},{rootMargin:'-50% 0px -50% 0px',threshold:0});
 for(var i=0;i<els.length;i++)io.observe(els[i])}}
function acc(){if(shown)vis+=Date.now()-last;last=Date.now()}
document.addEventListener('visibilitychange',function(){acc();secAcc();shown=document.visibilityState==='visible';if(!shown){send('leave',{ms:vis,sc:maxS});secFlush()}});
addEventListener('pagehide',function(){acc();send('leave',{ms:vis,sc:maxS});secFlush()});
// Browsers can drop the last beacon when moving to another page – a light update every 30 s keeps time-on-page right.
setInterval(function(){if(document.visibilityState==='visible'){acc();send('leave',{ms:vis,sc:maxS});secFlush()}},30000)}catch(e){}})();`

/** Landing page sections, top to bottom (data-sec on each <section> in routes/site.tsx). */
export const LANDING_SECTIONS: [string, string][] = [
  ['hero', 'Top – headline'], ['what', 'What you get'], ['pain', 'The problem (DMs)'], ['how', 'How it works'],
  ['paise', 'Exact-amount UPI'], ['shop', 'Shop link'], ['tools', 'Selling tools'], ['shipping', 'Shipping'],
  ['profit', 'Profit'], ['features', 'Everything in the app'], ['payments', 'Two ways to get paid'], ['hindi', 'Hindi'],
  ['onboarding', 'We set it up'], ['pricing', 'Pricing'], ['faq', 'FAQ'], ['form', 'Get-started form'],
]

const SITE = new Set(['/', '/thanks', '/privacy', '/terms', '/refunds', '/contact', '/data-request', '/login', '/seller', '/help/razorpay', '/signup', '/reset'])
const TYPES = new Set(['view', 'click', 'form_start', 'form_submit', 'leave', 'section', 'dwell'])
const s = (x: unknown, n: number) => String(x ?? '').slice(0, n)

export async function collect(c: Context<AppEnv>) {
  const raw = await c.req.text()
  if (raw.length > 2048) return c.body(null, 204)
  let e: Record<string, unknown>
  try { e = JSON.parse(raw) } catch { return c.body(null, 204) }
  const type = s(e.t, 12), path = s(e.p, 160)
  if (!TYPES.has(type) || !/^\/[\w\-/.]*$/.test(path) || path.startsWith('/app') || path.startsWith('/admin') || !e.v || !e.s) return c.body(null, 204)
  const ua = c.req.header('user-agent') ?? ''
  if (/bot|crawl|spider|headless/i.test(ua)) return c.body(null, 204)
  const cf = (c.req.raw as Request & { cf?: { country?: string; city?: string } }).cf
  const device = /Mobi|Android|iPhone/i.test(ua) || Number(e.w) < 760 ? 'mobile' : 'desktop'
  await c.env.DB.prepare(
    `INSERT INTO events (at, type, area, vid, sid, path, label, href, ref, utm_source, utm_medium, utm_campaign, device, country, city, ms, scroll, section)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(Date.now(), type, SITE.has(path) ? 'site' : 'shop', s(e.v, 32), s(e.s, 32), path, s(e.l, 60), s(e.h, 120), s(e.r, 80),
    s(e.us, 60).toLowerCase(), s(e.um, 60).toLowerCase(), s(e.uc, 60), device, s(cf?.country ?? c.req.header('cf-ipcountry'), 4), s(cf?.city, 60),
    Math.max(0, Math.min(3_600_000, Math.round(Number(e.ms) || 0))), Math.max(0, Math.min(100, Math.round(Number(e.sc) || 0))), s(e.sec, 24).replace(/[^\w-]/g, '')).run()
  return c.body(null, 204)
}

export const cleanEvents = (db: D1Database) => db.prepare(`DELETE FROM events WHERE at < ?`).bind(Date.now() - 180 * 86_400_000).run()
