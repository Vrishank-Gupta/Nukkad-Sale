-- Khatakhat schema. All money is stored in paise (INTEGER) to avoid float errors.
-- Times are unix epoch milliseconds.

CREATE TABLE sellers (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,          -- 91XXXXXXXXXX
  name          TEXT NOT NULL,
  shop_name     TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  upi_vpa       TEXT,                          -- e.g. shop@ybl, used by direct UPI mode
  -- direct = UPI to seller, manual "Yes, I got it". razorpay = gateway, auto-confirmed. (Cashfree removed in 0006.)
  pay_mode      TEXT NOT NULL DEFAULT 'direct' CHECK (pay_mode IN ('direct', 'cashfree', 'razorpay')),
  cf_app_id     TEXT,
  cf_secret_enc TEXT,                          -- AES-GCM encrypted with SECRET_KEY
  cf_sandbox    INTEGER NOT NULL DEFAULT 0,    -- 1 = Cashfree test mode
  -- Set by the platform admin:
  allowed_modes  TEXT NOT NULL DEFAULT 'direct',  -- payment methods switched on for this seller (comma list)
  plan_fee_paise INTEGER NOT NULL DEFAULT 0,      -- monthly Khatakhat fee; 0 = free
  trial_until    INTEGER NOT NULL DEFAULT 0,      -- no invoices before this time
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  rzp_key_id    TEXT,
  rzp_secret_enc  TEXT,                        -- AES-GCM encrypted with SECRET_KEY
  rzp_webhook_enc TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_seller ON sessions(seller_id);

-- One-time codes for PIN reset over WhatsApp.
CREATE TABLE pin_resets (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE drops (
  id            TEXT PRIMARY KEY,              -- short public id used in /d/:id
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_paise   INTEGER NOT NULL CHECK (price_paise > 0),
  image_key     TEXT,
  max_per_order INTEGER NOT NULL DEFAULT 5 CHECK (max_per_order > 0),
  status        TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'closed')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX drops_seller ON drops(seller_id, created_at DESC);

-- Every drop has at least one variant (label '' when the seller adds no sizes).
-- `available` is the source of truth for stock: it is decremented atomically when
-- a buyer reserves, and the CHECK makes overselling impossible at the DB level.
CREATE TABLE variants (
  id         INTEGER PRIMARY KEY,
  drop_id    TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  stock      INTEGER NOT NULL CHECK (stock >= 0),          -- total pieces listed
  available  INTEGER NOT NULL CHECK (available >= 0),      -- not reserved and not sold
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX variants_drop ON variants(drop_id, position);

-- status:
--   pending    stock is held for HOLD_MINUTES while the buyer pays
--   verifying  direct-UPI buyer said "I have paid" (button or screenshot); hold kept until the seller decides
--   paid       money received, ledger credited
--   expired    hold lapsed without payment; stock released
--   rejected   seller could not find the payment; stock released
--   refund_due payment arrived after stock was gone; seller must refund
CREATE TABLE orders (
  id             TEXT PRIMARY KEY,             -- long random id, doubles as buyer's access token
  drop_id        TEXT NOT NULL REFERENCES drops(id),
  seller_id      TEXT NOT NULL REFERENCES sellers(id),
  variant_id     INTEGER NOT NULL REFERENCES variants(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  amount_paise   INTEGER NOT NULL,
  buyer_name     TEXT NOT NULL,
  buyer_phone    TEXT NOT NULL,
  address        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'verifying', 'paid', 'expired', 'rejected', 'refund_due')),
  ship_status    TEXT NOT NULL DEFAULT 'new' CHECK (ship_status IN ('new', 'packed', 'shipped', 'delivered')),
  pay_mode       TEXT NOT NULL,
  utr            TEXT,                         -- optional UPI reference (most buyers can't find it)
  proof_key      TEXT,                         -- R2 key of a payment screenshot the buyer sent (a hint, never proof)
  channel        TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  gateway_ref    TEXT,                         -- gateway payment link id
  pay_url        TEXT,                         -- gateway hosted payment page
  gw_checked_at  INTEGER,                      -- last time we asked the gateway for status
  payment_ref    TEXT,                         -- final payment id / UTR
  ip_hash        TEXT,
  hold_until     INTEGER NOT NULL,
  paid_at        INTEGER,
  wa_sent        INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX orders_seller ON orders(seller_id, created_at DESC);
CREATE INDEX orders_drop ON orders(drop_id, status);
CREATE INDEX orders_hold ON orders(status, hold_until);
CREATE INDEX orders_buyer ON orders(drop_id, buyer_phone, status);

-- Digital khata. Credits are written automatically on payment; sellers can add
-- manual entries (cash sales, courier costs, refunds).
CREATE TABLE ledger (
  id           INTEGER PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES sellers(id),
  order_id     TEXT REFERENCES orders(id),
  kind         TEXT NOT NULL CHECK (kind IN ('credit', 'debit')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  UNIQUE (order_id, kind)                      -- an order can be credited at most once
);
CREATE INDEX ledger_seller ON ledger(seller_id, created_at DESC);

-- Webhook idempotency: gateways retry, we must not double-process.
CREATE TABLE webhook_events (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- Buyers who order over WhatsApp: remembered by their WhatsApp number so the next order
-- needs no typing. last_inbound_at tracks Meta's 24-hour window, inside which replies are free.
CREATE TABLE buyers (
  phone           TEXT PRIMARY KEY,           -- 91XXXXXXXXXX, from WhatsApp itself
  name            TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  pincode         TEXT NOT NULL DEFAULT '',
  lang            TEXT NOT NULL DEFAULT 'en',
  last_inbound_at INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- Where each buyer is in the WhatsApp ordering chat.
CREATE TABLE wa_sessions (
  phone      TEXT PRIMARY KEY,
  state      TEXT NOT NULL,                   -- size | qty | address | confirm_address | pay
  drop_id    TEXT,
  variant_id INTEGER,
  qty        INTEGER NOT NULL DEFAULT 1,
  order_id   TEXT,
  updated_at INTEGER NOT NULL
);

-- Monthly platform fee invoices (what sellers pay Khatakhat).
CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  period        TEXT NOT NULL,                -- YYYY-MM in IST
  amount_paise  INTEGER NOT NULL,             -- fee + unique paise, so a UPI payment can be matched by amount
  status        TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'claimed', 'paid', 'waived')),
  due_at        INTEGER NOT NULL,             -- after this (+ nothing) new sales pause until paid
  paid_at       INTEGER,
  paid_via      TEXT,                         -- razorpay | upi | cash | admin
  gateway_ref   TEXT,
  pay_url       TEXT,
  gw_checked_at INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (seller_id, period)
);
CREATE INDEX invoices_status ON invoices(status, due_at);

-- Platform-wide settings edited in the admin portal (fee collection UPI/Cashfree, defaults).
CREATE TABLE platform_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
