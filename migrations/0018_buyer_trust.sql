-- Buyer trust: order timeline, packed-parcel photo, size chart, advance on cash on delivery, reviews.

-- When each step happened (filled by the triggers below, whichever code path changes the order).
ALTER TABLE orders ADD COLUMN claimed_at INTEGER;     -- buyer said "I have paid"
ALTER TABLE orders ADD COLUMN packed_at INTEGER;
ALTER TABLE orders ADD COLUMN shipped_at INTEGER;
ALTER TABLE orders ADD COLUMN delivered_at INTEGER;
ALTER TABLE orders ADD COLUMN pack_photo_key TEXT;    -- seller's photo of the packed parcel (shown to the buyer)
-- Advance on cash on delivery: the buyer pays adv_paise by UPI first; the rest in cash on delivery.
ALTER TABLE orders ADD COLUMN adv_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN adv_status TEXT NOT NULL DEFAULT '';   -- '' (none) | due | claimed | paid

CREATE TRIGGER orders_ship_times AFTER UPDATE OF ship_status ON orders WHEN NEW.ship_status <> OLD.ship_status
BEGIN
  UPDATE orders SET
    packed_at = CASE WHEN NEW.ship_status IN ('packed', 'shipped', 'delivered') THEN COALESCE(packed_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) ELSE NULL END,
    shipped_at = CASE WHEN NEW.ship_status IN ('shipped', 'delivered') THEN COALESCE(shipped_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) ELSE NULL END,
    delivered_at = CASE WHEN NEW.ship_status = 'delivered' THEN COALESCE(delivered_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) ELSE NULL END
  WHERE id = NEW.id;
END;
CREATE TRIGGER orders_claim_time AFTER UPDATE OF status ON orders WHEN NEW.status = 'verifying' AND OLD.status <> 'verifying'
BEGIN
  UPDATE orders SET claimed_at = COALESCE(claimed_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) WHERE id = NEW.id;
END;

-- Size help: one chart for the shop, shown on the sales the seller picks.
ALTER TABLE sellers ADD COLUMN size_chart_key TEXT;
ALTER TABLE drops ADD COLUMN size_chart INTEGER NOT NULL DEFAULT 0;
-- Advance the seller asks for on a cash-on-delivery order (0 = none).
ALTER TABLE drops ADD COLUMN cod_advance_paise INTEGER NOT NULL DEFAULT 0;

-- Reviews after delivery. The seller can switch them off for the whole shop or hide any one.
ALTER TABLE sellers ADD COLUMN reviews_on INTEGER NOT NULL DEFAULT 1;
CREATE TABLE reviews (
  id         INTEGER PRIMARY KEY,
  seller_id  TEXT NOT NULL REFERENCES sellers(id),
  order_key  TEXT NOT NULL UNIQUE,               -- one review per payment (cart key)
  drop_id    TEXT NOT NULL,
  name       TEXT NOT NULL,                      -- first name only
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text       TEXT NOT NULL DEFAULT '',
  photo_key  TEXT,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX reviews_seller ON reviews(seller_id, hidden, created_at DESC);
CREATE INDEX reviews_drop ON reviews(drop_id, hidden, created_at DESC);
-- When the seller last opened their reviews (for the "new reviews" home task).
ALTER TABLE sellers ADD COLUMN reviews_seen_at INTEGER NOT NULL DEFAULT 0;
