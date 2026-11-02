import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { tr, type Dict } from '../i18n'
import { endSession, startSession } from '../lib/auth'
import { hashPin, sha256 } from '../lib/crypto'
import { getSettings, parseModes } from '../lib/billing'
import { createSeller } from '../lib/sellers'
import { isValidVpa } from '../lib/upi'
import { normalizePhone, randomId, waLink } from '../lib/util'
import { sendOtp, waEnabled } from '../lib/whatsapp'
import { Flash, Icon, Layout, PhoneInput, PinInput } from '../views/layout'
import { here } from './public'

export const auth = new Hono<AppEnv>()

const MAX_FAILS = 5
const LOCK_MINUTES = 15
const validPin = (p: string) => /^\d{4,6}$/.test(p)

const Brand = ({ t }: { t: Dict }) => (
  <div style="text-align:center;margin:20px 0 16px">
    <div style="display:inline-flex;width:56px;height:56px;border-radius:16px;background:var(--brand);color:#fff;align-items:center;justify-content:center"><Icon n="shop" s={30} /></div>
    <h1 style="margin:0">NukkadSale</h1>
    <p class="muted">{t.tagline}</p>
  </div>
)

// Short address to give sellers: nukkadsale.in/seller
auth.get('/seller', (c) => c.redirect('/login' + (new URL(c.req.url).search || ''), 302))

auth.get('/login', (c) => {
  const t = tr(c)
  // Pre-filled from the link the admin sends on WhatsApp (/seller?p=98XXXXXXXX), so the seller only types the PIN.
  const pre = (c.req.query('p') ?? '').replace(/\D/g, '').slice(-10)
  const preOk = /^[6-9]\d{9}$/.test(pre)
  const canReset = waEnabled(c.env) && c.env.WA_OTP_TEMPLATE
  return c.html(
    <Layout t={t} path={here(c)} title={`${t.logIn} – NukkadSale`} ok={c.req.query('ok')}>
      <Brand t={t} />
      <Flash msg={c.req.query('err')} />
      <form method="post" class="card stack">
        <div><label for="phone">{t.phone}</label><PhoneInput id="phone" name="phone" value={preOk ? pre : undefined} /></div>
        <div><label for="pin">{t.pin}</label><PinInput id="pin" t={t} autocomplete="current-password" autofocus={preOk} /></div>
        <button class="btn primary block big" type="submit">{t.logIn}</button>
      </form>
      {canReset ? (
        <p style="text-align:center"><a href="/reset">{t.forgotPin}</a></p>
      ) : c.env.SUPPORT_PHONE ? (
        <p style="text-align:center"><a href={waLink(c.env.SUPPORT_PHONE, t.forgotPin)}>{t.forgotPinSupport}</a></p>
      ) : null}
      <a class="btn block" href={openSignup(c) ? '/signup' : '/#get-started'} style="margin-top:8px">{openSignup(c) ? t.newHere : t.newHereRequest}</a>
    </Layout>,
  )
})

auth.post('/login', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? ''))
  const pin = String(f.pin ?? '')
  const fail = (m: string) => c.redirect('/login?err=' + encodeURIComponent(m), 303)
  if (!phone) return fail(t.wrongPhone)
  const s = await c.env.DB.prepare(`SELECT id, pin_hash, pin_salt, failed_logins, locked_until FROM sellers WHERE phone = ?`)
    .bind(phone).first<{ id: string; pin_hash: string; pin_salt: string; failed_logins: number; locked_until: number }>()
  if (!s) return fail(t.noShop)
  if (s.locked_until > Date.now()) return fail(t.locked(Math.ceil((s.locked_until - Date.now()) / 60000)))
  if ((await hashPin(pin, s.pin_salt, c.env.SECRET_KEY)) !== s.pin_hash) {
    const fails = s.failed_logins + 1
    await c.env.DB.prepare(`UPDATE sellers SET failed_logins = ?, locked_until = ? WHERE id = ?`)
      .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0, s.id).run()
    return fail(fails >= MAX_FAILS ? t.locked(LOCK_MINUTES) : t.wrongPin)
  }
  await c.env.DB.prepare(`UPDATE sellers SET failed_logins = 0 WHERE id = ?`).bind(s.id).run()
  await startSession(c, s.id)
  return c.redirect('/app', 303)
})

// Shops are created by the admin from "Get started" requests. Self-signup stays available only
// where OPEN_SIGNUP=1 (local tests, staging).
const openSignup = (c: Context<AppEnv>) => c.env.OPEN_SIGNUP === '1'
auth.use('/signup', async (c, next) => (openSignup(c) ? next() : c.redirect('/#get-started', 302)))

auth.get('/signup', (c) => {
  const t = tr(c)
  return c.html(
    <Layout t={t} path={here(c)} title={`${t.createShopFree} – NukkadSale`}>
      <Brand t={t} />
      <Flash msg={c.req.query('err')} />
      <form method="post" class="card stack">
        <div><label for="name">{t.yourName}</label><input id="name" name="name" autocomplete="name" required maxlength={60} /></div>
        <div><label for="shop">{t.shopName}</label><input id="shop" name="shop" placeholder={t.shopNamePh} required maxlength={60} /></div>
        <div><label for="phone">{t.phone}</label><PhoneInput id="phone" name="phone" /></div>
        <div>
          <label for="vpa">{t.upiId}</label>
          <input id="vpa" name="vpa" placeholder="yourname@ybl" autocapitalize="off" autocomplete="off" spellcheck={false} required />
          <div class="hint">{t.upiIdHint}</div>
          <details>
            <summary style="font-weight:600;color:var(--brand)">{t.upiWhere}</summary>
            <p class="hint" style="margin-top:0">{t.upiWhereBody}</p>
            <p class="hint">{t.upiTip}</p>
          </details>
        </div>
        <div>
          <label>{t.howPaidSignup}</label>
          <div class="stack">
            <label class="choice">
              <input type="radio" name="paywant" value="manual" checked />
              <span><b>{t.opt1}</b><span class="tag">{t.opt1Tag}</span><br /><small>{t.opt1Best}</small></span>
            </label>
            <label class="choice">
              <input type="radio" name="paywant" value="auto" />
              <span><b>{t.opt2}</b><br /><small>{t.opt2Best} {t.opt2Short}</small></span>
            </label>
          </div>
        </div>
        <div>
          <label for="pin">{t.choosePin}</label>
          <PinInput id="pin" t={t} autocomplete="new-password" />
          <div class="hint">{t.choosePinHint}</div>
        </div>
        <button class="btn primary block big" type="submit">{t.createShop}</button>
      </form>
      <a class="btn block" href="/login" style="margin-top:8px">{t.haveShop}</a>
    </Layout>,
  )
})

auth.post('/signup', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const fail = (m: string) => c.redirect('/signup?err=' + encodeURIComponent(m), 303)
  const name = String(f.name ?? '').trim().slice(0, 60)
  const shop = String(f.shop ?? '').trim().slice(0, 60)
  const phone = normalizePhone(String(f.phone ?? ''))
  const vpa = String(f.vpa ?? '').trim()
  const pin = String(f.pin ?? '')
  if (!name || !shop) return fail(t.fillName)
  if (!phone) return fail(t.wrongPhone)
  if (!isValidVpa(vpa)) return fail(t.badUpi)
  if (!validPin(pin)) return fail(t.badPin)
  const wantsAuto = f.paywant === 'auto'
  const id = await createSeller(c.env, { name, shop, phone, vpa, pin, wantsAuto })
  if (!id) return fail(t.phoneTaken)
  await startSession(c, id)
  // Chose automatic payments: go straight to gateway setup if it's switched on, else the request is noted.
  if (wantsAuto) {
    const canSelf = parseModes((await getSettings(c.env)).default_modes).some((m) => m !== 'direct')
    return c.redirect(canSelf ? '/app/settings?ok=' + encodeURIComponent(t.setupGatewayNow) + '#pay' : '/app?ok=' + encodeURIComponent(t.gatewayRequested), 303)
  }
  return c.redirect('/app', 303)
})

auth.post('/logout', async (c) => {
  await endSession(c)
  return c.redirect('/login', 303)
})

// ---------- PIN reset over WhatsApp (only when the Cloud API is configured) ----------

auth.get('/reset', (c) => {
  const t = tr(c)
  if (!waEnabled(c.env) || !c.env.WA_OTP_TEMPLATE) return c.redirect('/login')
  const phone = c.req.query('phone')
  return c.html(
    <Layout t={t} path={here(c)} title={t.resetPin}>
      <h1>{t.resetPin}</h1>
      <Flash msg={c.req.query('err')} />
      {!phone ? (
        <form method="post" action="/reset/send" class="card stack">
          <div><label for="phone">{t.phone}</label><PhoneInput id="phone" name="phone" /></div>
          <button class="btn primary block" type="submit">{t.sendCode}</button>
        </form>
      ) : (
        <form method="post" action="/reset/verify" class="card stack">
          <input type="hidden" name="phone" value={phone} />
          <div><label for="code">{t.codeLabel}</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength={6} required /></div>
          <div><label for="pin">{t.newPin}</label><PinInput id="pin" t={t} autocomplete="new-password" /></div>
          <button class="btn primary block" type="submit">{t.setNewPin}</button>
        </form>
      )}
      <p style="text-align:center"><a href="/login">← {t.logIn}</a></p>
    </Layout>,
  )
})

auth.post('/reset/send', async (c) => {
  const t = tr(c)
  const phone = normalizePhone(String((await c.req.parseBody()).phone ?? ''))
  if (!phone || !waEnabled(c.env)) return c.redirect('/reset?err=' + encodeURIComponent(t.wrongPhone), 303)
  const existing = await c.env.DB.prepare(`SELECT expires_at FROM pin_resets WHERE phone = ?`).bind(phone).first<{ expires_at: number }>()
  // Codes live 10 minutes; allow a resend only after 1 minute to keep Meta message costs down.
  const recentlySent = existing && existing.expires_at - 9 * 60000 > Date.now()
  const seller = await c.env.DB.prepare(`SELECT 1 FROM sellers WHERE phone = ?`).bind(phone).first()
  if (seller && !recentlySent) {
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    await c.env.DB.prepare(`INSERT OR REPLACE INTO pin_resets (phone, code_hash, attempts, expires_at) VALUES (?, ?, 0, ?)`)
      .bind(phone, await sha256(code + c.env.SECRET_KEY), Date.now() + 10 * 60000).run()
    c.executionCtx.waitUntil(sendOtp(c.env, phone, code).catch((e) => console.error('otp send failed', e)))
  }
  // Same response whether or not the number has a shop, so this can't be used to probe numbers.
  return c.redirect('/reset?phone=' + phone, 303)
})

auth.post('/reset/verify', async (c) => {
  const t = tr(c)
  const f = await c.req.parseBody()
  const phone = normalizePhone(String(f.phone ?? '')) ?? ''
  const pin = String(f.pin ?? '')
  const fail = (m: string) => c.redirect(`/reset?phone=${phone}&err=${encodeURIComponent(m)}`, 303)
  if (!validPin(pin)) return fail(t.badPin)
  const r = await c.env.DB.prepare(`UPDATE pin_resets SET attempts = attempts + 1 WHERE phone = ? RETURNING code_hash, attempts, expires_at`)
    .bind(phone).first<{ code_hash: string; attempts: number; expires_at: number }>()
  if (!r || r.expires_at < Date.now() || r.attempts > 5) return fail(t.codeExpired)
  if ((await sha256(String(f.code ?? '').trim() + c.env.SECRET_KEY)) !== r.code_hash) return fail(t.wrongCode)
  const salt = randomId(16)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sellers SET pin_hash = ?, pin_salt = ?, temp_pin = 0, failed_logins = 0, locked_until = 0 WHERE phone = ?`).bind(await hashPin(pin, salt, c.env.SECRET_KEY), salt, phone),
    c.env.DB.prepare(`DELETE FROM pin_resets WHERE phone = ?`).bind(phone),
    c.env.DB.prepare(`DELETE FROM sessions WHERE seller_id = (SELECT id FROM sellers WHERE phone = ?)`).bind(phone),
  ])
  return c.redirect('/login?ok=' + encodeURIComponent(t.pinUpdated), 303)
})
