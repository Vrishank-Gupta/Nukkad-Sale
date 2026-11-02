import type { Bindings } from '../env'
import { getSettings, parseModes } from './billing'
import { hashPin } from './crypto'
import { randomId } from './util'

/**
 * Creates a shop with the admin's defaults (payment methods, monthly fee, free trial).
 * Returns the new seller id, or null if the phone number already has a shop.
 */
export async function createSeller(
  env: Bindings,
  s: { name: string; shop: string; phone: string; vpa: string; pin: string; wantsAuto?: boolean; tempPin?: boolean },
): Promise<string | null> {
  const id = randomId(10)
  const salt = randomId(16)
  const vpa = s.vpa.toLowerCase()
  const d = await getSettings(env)
  const modes = parseModes(d.default_modes)
  try {
    await env.DB.prepare(
      `INSERT INTO sellers (id, phone, name, shop_name, pin_hash, pin_salt, upi_vpa, created_at, allowed_modes, pay_mode, plan_fee_paise, trial_until, gateway_request, temp_pin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, s.phone, s.name, s.shop, await hashPin(s.pin, salt, env.SECRET_KEY), salt, vpa, Date.now(), (modes.length ? modes : ['direct']).join(','),
      modes.includes('direct') || !modes.length ? 'direct' : modes[0], Number(d.default_fee_paise) || 0, Date.now() + (Number(d.trial_days) || 0) * 86_400_000,
      s.wantsAuto ? 1 : 0, s.tempPin ? 1 : 0).run()
  } catch {
    return null
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO seller_upis (seller_id, vpa, label, created_at) VALUES (?, ?, '', ?)`).bind(id, vpa, Date.now()).run()
  return id
}

/** A random 4-digit PIN for the admin to hand over (avoids 0000-style and repeated digits). */
export function tempPin(): string {
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000
    const p = String(n)
    if (new Set(p).size >= 3 && !'0123456789'.includes(p) && !'9876543210'.includes(p)) return p
  }
}

/** Sets a new PIN; `temp` marks it as one the admin handed over. Also clears a lockout. */
export async function setPin(env: Bindings, sellerId: string, pin: string, temp: boolean) {
  const salt = randomId(16)
  await env.DB.prepare(`UPDATE sellers SET pin_hash = ?, pin_salt = ?, temp_pin = ?, failed_logins = 0, locked_until = 0 WHERE id = ?`)
    .bind(await hashPin(pin, salt, env.SECRET_KEY), salt, temp ? 1 : 0, sellerId).run()
}
