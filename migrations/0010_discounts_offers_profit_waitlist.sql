-- Seller growth tools, all free to run: discounts, personal price links, profit, restock waitlist.

-- Discount on a listed sale: the discounted price becomes drops.price_paise (so every price path –
-- web, cart, WhatsApp bot, unique paise – works unchanged) and the old price is kept here to show
-- struck through. 0 = no discount running.
ALTER TABLE drops ADD COLUMN compare_paise INTEGER NOT NULL DEFAULT 0;
-- The seller's own cost per piece (optional, never shown to buyers) – for profit in the khata.
ALTER TABLE drops ADD COLUMN cost_paise INTEGER NOT NULL DEFAULT 0;

-- Price per piece this order was sold at (discount or personal price included). NULL on older orders,
-- which were always at the sale price. Carts re-pick their unique paise from this, never from a price
-- that changed later.
ALTER TABLE orders ADD COLUMN unit_paise INTEGER;
-- The seller's cost for this order (cost per piece × qty), copied when the order is placed.
ALTER TABLE orders ADD COLUMN cost_paise INTEGER NOT NULL DEFAULT 0;
-- The personal price link this order used, if any.
ALTER TABLE orders ADD COLUMN offer_id TEXT;

-- Personal price links: a special rate for one buyer, shared by the seller on WhatsApp.
-- One order per link; the link is free again if that order lapses or is rejected.
CREATE TABLE offers (
  id            TEXT PRIMARY KEY,                       -- random token in the link
  drop_id       TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  price_paise   INTEGER NOT NULL CHECK (price_paise > 0),
  buyer_name    TEXT NOT NULL DEFAULT '',
  buyer_phone   TEXT,                                   -- 91XXXXXXXXXX: only this number can use it (optional)
  max_qty       INTEGER NOT NULL DEFAULT 1 CHECK (max_qty > 0),
  expires_at    INTEGER NOT NULL,
  used_order_id TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX offers_drop ON offers(drop_id, created_at DESC);

-- "Tell me when it's back": buyers who found a sale sold out or ended.
CREATE TABLE waitlist (
  id          INTEGER PRIMARY KEY,
  drop_id     TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL REFERENCES sellers(id),
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,                            -- 91XXXXXXXXXX
  notified_at INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (drop_id, phone)
);
CREATE INDEX waitlist_seller ON waitlist(seller_id, notified_at);
