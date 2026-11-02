-- Several UPI IDs per seller (one is the default, sellers.upi_vpa), chosen per sale.
CREATE TABLE seller_upis (
  id         INTEGER PRIMARY KEY,
  seller_id  TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  vpa        TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',           -- e.g. "PhonePe Business"
  created_at INTEGER NOT NULL,
  UNIQUE (seller_id, vpa)
);
INSERT INTO seller_upis (seller_id, vpa, label, created_at)
  SELECT id, upi_vpa, '', created_at FROM sellers WHERE upi_vpa IS NOT NULL;

-- The UPI ID payments for this sale go to (NULL = the seller's default).
ALTER TABLE drops ADD COLUMN upi_vpa TEXT;

-- Up to 5 photos per sale; drops.image_key stays the cover (first photo).
CREATE TABLE drop_images (
  id        INTEGER PRIMARY KEY,
  drop_id   TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  image_key TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX drop_images_drop ON drop_images(drop_id, position);
INSERT INTO drop_images (drop_id, image_key, position)
  SELECT id, image_key, 0 FROM drops WHERE image_key IS NOT NULL;

-- Seller asked for automatic (gateway) payments; the admin sets it up.
ALTER TABLE sellers ADD COLUMN gateway_request INTEGER NOT NULL DEFAULT 0;

-- Platform admins are separate from seller accounts: own login, own sessions.
-- Only phones listed in ADMIN_PHONES can create an admin PIN.
CREATE TABLE admins (
  phone         TEXT PRIMARY KEY,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  phone      TEXT NOT NULL REFERENCES admins(phone) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
