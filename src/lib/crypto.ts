const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const sha256 = async (s: string) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// PINs are short, so lockouts do the real work against online guessing. The server-side
// pepper (SECRET_KEY) means a leaked database alone cannot be brute-forced offline.
// Iterations stay modest to fit the Workers free-plan CPU budget.
export async function hashPin(pin: string, salt: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin + pepper), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 20000 },
    key,
    256,
  )
  return toHex(bits)
}

async function aesKey(secret: string) {
  // Key-derivation salt from the product's first name. Never change it (unlike the brand name): every
  // stored gateway secret was encrypted with it and would no longer decrypt.
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('khatakhat-aes:' + secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encrypt(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain))
  return toB64(iv) + '.' + toB64(new Uint8Array(ct))
}

export async function decrypt(box: string, secret: string): Promise<string> {
  const [iv, ct] = box.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await aesKey(secret), fromB64(ct))
  return new TextDecoder().decode(pt)
}
