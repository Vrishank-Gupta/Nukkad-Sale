// Crockford-ish alphabet without look-alike characters (0/O, 1/I/L) so ids survive being read aloud.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

export function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Normalise an Indian mobile number to 91XXXXXXXXXX, or null if invalid. */
export function normalizePhone(input: string): string | null {
  let d = (input || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? '91' + d : null
}

export const displayPhone = (p: string) => '+91 ' + p.slice(2, 7) + ' ' + p.slice(7)

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const inrPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** ₹799 for whole rupees, ₹799.50 (never ₹799.5) when there are paise – the exact amount matters for UPI matching. */
export const rupees = (paise: number) => '₹' + (paise % 100 ? inrPaise : inr).format(paise / 100)

/** Parse "499", "499.5", "1,299" into paise. */
export function parsePaise(input: string): number | null {
  const s = (input || '').replace(/[,₹\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(parseFloat(s) * 100)
}

// India Standard Time helpers (no DST, fixed +05:30).
const IST_OFFSET = 330 * 60 * 1000
export const istDay = (ms: number) => new Date(ms + IST_OFFSET).toISOString().slice(0, 10)
export const istDayStart = (ms: number) => Date.parse(istDay(ms) + 'T00:00:00Z') - IST_OFFSET

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** wa.me click-to-chat link – free, opens WhatsApp with the text prefilled. */
export const waLink = (phone: string | null, text: string) =>
  `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`

/** "today, 9:00 pm" / "tomorrow, 9:00 pm" / "5 Nov, 9:00 pm" in India time – for scheduled drops. */
export function liveWhen(ms: number, lang: 'en' | 'hi' = 'en') {
  const loc = lang === 'hi' ? 'hi-IN' : 'en-IN'
  const time = new Date(ms).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  const day = (x: number) => new Date(x).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const d = day(ms) === day(Date.now()) ? (lang === 'hi' ? 'आज' : 'today') : day(ms) === day(Date.now() + 86_400_000) ? (lang === 'hi' ? 'कल' : 'tomorrow')
    : new Date(ms).toLocaleDateString(loc, { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  return `${d}, ${time}`
}

/** Photo uploads: only raster formats a phone camera makes. SVG and anything else can carry scripts. */
export const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
export const isPhotoType = (t: string) => PHOTO_TYPES.has((t || '').toLowerCase())
