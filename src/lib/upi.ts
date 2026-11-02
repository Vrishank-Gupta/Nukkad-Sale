import { renderSVG } from 'uqr'

/*
 * Direct UPI: the buyer pays the seller's own UPI ID (ideally a free merchant/business
 * VPA such as PhonePe Business or Paytm for Business – 0% MDR). The deep link opens
 * GPay/PhonePe/Paytm with amount and note prefilled; the QR covers desktop buyers.
 */
const upiQuery = (vpa: string, payee: string, amountPaise: number, note: string) =>
  new URLSearchParams({ pa: vpa, pn: payee.slice(0, 40), am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: note.slice(0, 50) }).toString().replace(/\+/g, '%20')

/** Android: the generic intent opens a chooser of every installed UPI app. */
export const upiLink = (vpa: string, payee: string, amountPaise: number, note: string) => 'upi://pay?' + upiQuery(vpa, payee, amountPaise, note)

/**
 * iOS has no UPI app chooser – `upi://` opens whichever app claimed it last, or nothing.
 * So on iPhone we offer one button per app, using each app's own URL scheme.
 */
export function upiAppLinks(vpa: string, payee: string, amountPaise: number, note: string) {
  const q = upiQuery(vpa, payee, amountPaise, note)
  return [
    { name: 'GPay', href: `gpay://upi/pay?${q}` },
    { name: 'PhonePe', href: `phonepe://pay?${q}` },
    { name: 'Paytm', href: `paytmmp://pay?${q}` },
    { name: 'BHIM / other', href: `upi://pay?${q}` },
  ]
}

export const qrSvg = (text: string) => renderSVG(text, { border: 2 })

export const isValidVpa = (v: string) => /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(v)

/** UPI transaction reference (UTR / RRN) is 12 digits. */
export const isValidUtr = (u: string) => /^\d{12}$/.test(u)
