-- Delivery charge per sale: a flat fee, optionally free when the items cost at least a set amount.
ALTER TABLE drops ADD COLUMN ship_fee_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drops ADD COLUMN free_ship_above_paise INTEGER NOT NULL DEFAULT 0;   -- 0 = never free
-- The delivery charge included in an order's amount (charged once per payment, on one line).
ALTER TABLE orders ADD COLUMN ship_paise INTEGER NOT NULL DEFAULT 0;

-- Order alerts on the seller's phone even when the app is closed (Web Push, free).
CREATE TABLE push_subs (
  endpoint   TEXT PRIMARY KEY,
  seller_id  TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,                  -- browser's public key (base64url)
  auth       TEXT NOT NULL,                  -- browser's auth secret (base64url)
  lang       TEXT NOT NULL DEFAULT 'en',     -- the seller's app language on that phone
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subs_seller ON push_subs(seller_id);
