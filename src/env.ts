export type Bindings = {
  DB: D1Database
  IMAGES: R2Bucket
  APP_NAME: string
  HOLD_MINUTES: string
  SECRET_KEY: string
  WA_API_VERSION: string
  WA_TEMPLATE_LANG: string
  WA_TOKEN?: string
  WA_PHONE_ID?: string
  WA_ORDER_TEMPLATE?: string
  WA_OTP_TEMPLATE?: string
  SUPPORT_PHONE?: string
  /** Business details shown on the Privacy / Terms / Refunds / Contact pages. */
  LEGAL_NAME?: string
  LEGAL_ADDRESS?: string
  SUPPORT_EMAIL?: string
  /** WhatsApp ordering bot (all four needed): Meta app secret, webhook verify token, the bot's number. */
  WA_APP_SECRET?: string
  WA_VERIFY_TOKEN?: string
  WA_BOT_NUMBER?: string
  /** Comma-separated phone numbers (91XXXXXXXXXX) allowed to be platform admins at /admin. */
  ADMIN_PHONES?: string
  /** One-time code needed to create an admin PIN (keeps strangers who know the number out). */
  ADMIN_SETUP_CODE?: string
  OPEN_SIGNUP?: string
  /** Web Push (order alerts): VAPID key pair. PUSH_ALLOW_ANY='1' only for local tests (allows a mock push service). */
  VAPID_PUBLIC?: string
  VAPID_PRIVATE_JWK?: string
  PUSH_ALLOW_ANY?: string
  /** Set per request (not a real binding): which seller a WhatsApp message is sent for, for usage counts. */
  WA_METER?: { sellerId: string; kind: 'bot' | 'notify' | 'template' }
  /** '1' only on staging/local: accept Razorpay test keys (rzp_test_…). Never in production. */
  ALLOW_TEST_KEYS?: string
  // Email to the owner about new requests (Cloudflare Email Routing send_email binding)
  LEAD_MAIL?: SendEmail
  MAIL_FROM?: string
  LEAD_MAIL_TO?: string
  /** Testing only: point Graph API calls at a mock server. */
  WA_API_BASE?: string
  /** Testing only: point Razorpay calls at a mock server. */
  RAZORPAY_API_BASE?: string
  /** Shiprocket API base (tests point it at tests/e2e/mock_shiprocket.py). */
  SHIPROCKET_API_BASE?: string
}

export type PayMode = 'direct' | 'razorpay'

export type Seller = {
  id: string
  /** Selling tools switched off by the seller, comma list (see lib/tools.ts). */
  tools_off?: string
  slug?: string | null
  /** Cart offer: items worth at least offer_min_paise in one payment get offer_off_paise (or offer_pct %) off. */
  offer_min_paise?: number
  offer_off_paise?: number
  offer_pct?: number
  sr_email?: string | null
  sr_pickup?: string | null
  sr_pickup_pin?: string | null
  sr_box?: string
  phone: string
  name: string
  shop_name: string
  upi_vpa: string | null
  pay_mode: PayMode
  rzp_key_id: string | null
  rzp_secret_enc: string | null
  rzp_webhook_enc: string | null
  allowed_modes: string
  account_status: 'active' | 'suspended'
  gateway_request: number
  temp_pin: number
  last_seen_at?: number
}

export type Drop = {
  id: string
  seller_id: string
  title: string
  description: string
  price_paise: number
  image_key: string | null
  upi_vpa: string | null
  max_per_order: number
  status: 'live' | 'closed'
  created_at: number
  cod_enabled: number
  cod_fee_paise: number
  ship_fee_paise: number
  free_ship_above_paise: number
  /** Storefront filter ('' = none). */
  category: string
  /** Scheduled drop: ordering opens at this time (ms). 0 = live now. */
  live_at: number
  /** "Was" price while a discount runs (price_paise is the discounted price). 0 = no discount. */
  compare_paise: number
  /** Seller's own cost per piece, for profit. 0 = not set. */
  cost_paise: number
  /** Weight of one piece in grams, for courier rates. 0 = 500 g. */
  weight_g: number
}

/** A personal price link for one buyer. */
export type Offer = {
  id: string
  drop_id: string
  seller_id: string
  price_paise: number
  buyer_name: string
  buyer_phone: string | null
  max_qty: number
  expires_at: number
  used_order_id: string | null
  created_at: number
}

export type Variant = {
  id: number
  drop_id: string
  label: string
  stock: number
  available: number
  position: number
}

export type OrderStatus = 'pending' | 'verifying' | 'paid' | 'expired' | 'rejected' | 'refund_due' | 'cod'
export type ShipStatus = 'new' | 'packed' | 'shipped' | 'delivered'

export type Order = {
  id: string
  drop_id: string
  seller_id: string
  variant_id: number
  qty: number
  amount_paise: number
  buyer_name: string
  buyer_phone: string
  address: string
  status: OrderStatus
  ship_status: ShipStatus
  pay_mode: PayMode | 'cod'
  utr: string | null
  proof_key: string | null
  cart_id: string | null
  assisted: number
  channel: 'web' | 'whatsapp'
  gateway_ref: string | null
  pay_url: string | null
  gw_checked_at: number | null
  payment_ref: string | null
  hold_until: number
  paid_at: number | null
  wa_sent: number
  created_at: number
  ship_paise: number
  /** Price per piece this order was sold at; null on orders from before discounts (= the sale price then). */
  unit_paise: number | null
  /** Cart-offer discount taken off this order (on the cart's first line). */
  disc_paise: number
  cost_paise: number
  offer_id: string | null
}

export type AppEnv = { Bindings: Bindings; Variables: { seller: Seller } }
