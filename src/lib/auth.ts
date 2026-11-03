import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, Seller } from '../env'
import { sha256 } from './crypto'
import { randomId } from './util'

const COOKIE = 'kk_s'
const SESSION_DAYS = 60

export async function startSession(c: Context<AppEnv>, sellerId: string) {
  const token = randomId(40)
  const expires = Date.now() + SESSION_DAYS * 86_400_000
  await c.env.DB.prepare(`INSERT INTO sessions (token_hash, seller_id, expires_at) VALUES (?, ?, ?)`).bind(await sha256(token), sellerId, expires).run()
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE)
  if (token) await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run()
  deleteCookie(c, COOKIE, { path: '/' })
}

export async function currentSeller(c: Context<AppEnv>): Promise<Seller | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  return c.env.DB
    .prepare(
      `SELECT s.id, s.phone, s.name, s.shop_name, s.upi_vpa, s.pay_mode, s.rzp_key_id, s.rzp_secret_enc, s.rzp_webhook_enc, s.allowed_modes, s.account_status, s.gateway_request, s.temp_pin, s.last_seen_at, s.tools_off, s.slug, s.offer_min_paise, s.offer_off_paise, s.offer_pct, s.sr_email, s.sr_pickup, s.sr_pickup_pin, s.sr_box, s.plan
       FROM sessions x JOIN sellers s ON s.id = x.seller_id WHERE x.token_hash = ? AND x.expires_at > ?`,
    )
    .bind(await sha256(token), Date.now())
    .first<Seller>()
}

export const requireSeller: MiddlewareHandler<AppEnv> = async (c, next) => {
  const seller = await currentSeller(c)
  if (!seller) return c.redirect('/login')
  c.set('seller', seller)
  // "Last active" for the admin portal – written at most every 5 minutes, off the request path.
  const now = Date.now()
  if (now - (seller.last_seen_at ?? 0) > 5 * 60_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE sellers SET last_seen_at = ? WHERE id = ?`).bind(now, seller.id).run())
  }
  await next()
}

/** CSRF guard: state-changing requests must come from our own pages. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin')
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Bad origin', 403)
  }
  await next()
}
