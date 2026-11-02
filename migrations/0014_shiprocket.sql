-- Shiprocket (optional, per seller): the seller connects their own Shiprocket account; courier charges come from
-- their Shiprocket wallet. Nothing here shows for sellers who don't connect it, or for their buyers.

ALTER TABLE sellers ADD COLUMN sr_email TEXT;               -- Shiprocket API user
ALTER TABLE sellers ADD COLUMN sr_password_enc TEXT;        -- AES-GCM with SECRET_KEY
ALTER TABLE sellers ADD COLUMN sr_token_enc TEXT;           -- cached login token (valid ~10 days)
ALTER TABLE sellers ADD COLUMN sr_token_exp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sellers ADD COLUMN sr_pickup TEXT;              -- pickup location name in Shiprocket
ALTER TABLE sellers ADD COLUMN sr_pickup_pin TEXT;
ALTER TABLE sellers ADD COLUMN sr_box TEXT NOT NULL DEFAULT '25x20x5';   -- default parcel L×B×H in cm
ALTER TABLE sellers ADD COLUMN sr_hook TEXT;                -- secret Shiprocket sends with tracking webhooks

-- Weight of one piece, for courier rates. 0 = use 500 g.
ALTER TABLE drops ADD COLUMN weight_g INTEGER NOT NULL DEFAULT 0;

-- One row per parcel booked through Shiprocket (a cart ships as one parcel).
CREATE TABLE shipments (
  id            TEXT PRIMARY KEY,                -- also the order id we send to Shiprocket
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  order_key     TEXT NOT NULL,                   -- the order (or the first order of a cart) – COALESCE(cart_id, id)
  sr_order_id   TEXT,
  shipment_id   TEXT,
  awb           TEXT,
  courier       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked', 'pickup', 'picked', 'transit', 'out', 'delivered', 'failed', 'rto', 'returned', 'cancelled')),
  status_text   TEXT NOT NULL DEFAULT '',
  label_url     TEXT,
  pickup_date   TEXT,
  etd           TEXT,                            -- expected delivery date from the courier
  charge_paise  INTEGER NOT NULL DEFAULT 0,
  cod_paise     INTEGER NOT NULL DEFAULT 0,      -- cash the courier collects (COD orders)
  weight_g      INTEGER NOT NULL DEFAULT 0,
  scans         TEXT NOT NULL DEFAULT '[]',      -- [{at, text, place}] newest first
  checked_at    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX shipments_key ON shipments(order_key);
CREATE INDEX shipments_seller ON shipments(seller_id, created_at DESC);
CREATE INDEX shipments_awb ON shipments(awb);
