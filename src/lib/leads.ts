// Choices on the "Get started" form, shared by the marketing site and the admin's Requests inbox.
// Stored values are the keys; labels are shown in the visitor's language.

export const CHANNELS = {
  wa_groups: { en: 'WhatsApp groups / communities', hi: 'WhatsApp ग्रुप / कम्युनिटी' },
  wa_chats: { en: 'WhatsApp chats & status', hi: 'WhatsApp चैट और स्टेटस' },
  instagram: { en: 'Instagram', hi: 'Instagram' },
  shop: { en: 'Shop / exhibitions', hi: 'दुकान / प्रदर्शनी' },
  starting: { en: 'Just starting', hi: 'अभी शुरू कर रहे हैं' },
} as const

export const VOLUMES = {
  lt50: { en: 'Under 50 orders a month', hi: 'महीने में 50 से कम ऑर्डर' },
  '50_200': { en: '50–200 orders a month', hi: 'महीने में 50–200 ऑर्डर' },
  '200_1000': { en: '200–1,000 orders a month', hi: 'महीने में 200–1,000 ऑर्डर' },
  gt1000: { en: 'More than 1,000 orders a month', hi: 'महीने में 1,000 से ज़्यादा ऑर्डर' },
} as const

export const PAYMENTS = {
  upi: { en: 'UPI straight to me – I confirm with one tap', hi: 'सीधे मेरे UPI में – मैं एक टैप से पक्का करूँ' },
  auto: { en: 'Automatic confirmation (Razorpay)', hi: 'अपने आप पक्का (Razorpay)' },
  unsure: { en: 'Not sure – help me choose', hi: 'पता नहीं – चुनने में मदद करें' },
} as const

export type Lead = {
  id: number; name: string; business: string; phone: string; city: string; sells: string; channel: string; volume: string; payments: string
  message: string; lang: string; status: 'new' | 'contacted' | 'onboarded' | 'closed'; note: string; seller_id: string | null; created_at: number; updated_at: number
}

/** Label for a stored choice (comma-separated for multi-choice fields), in English for the admin. */
export function label(map: Record<string, { en: string; hi: string }>, value: string, lang: 'en' | 'hi' = 'en') {
  return value.split(',').filter(Boolean).map((v) => map[v]?.[lang] ?? v).join(', ')
}
