-- NukkadSale Shipping: sellers ship through the platform's own Shiprocket account (no account of their own),
-- paying from a prepaid shipping balance. Prepaid (UPI-paid) orders only – no cash on delivery.
-- A seller on it has sellers.sr_email = 'NukkadSale Shipping' and their own pickup address in sr_pickup / sr_pickup_pin.
ALTER TABLE sellers ADD COLUMN ship_balance_paise INTEGER NOT NULL DEFAULT 0;
-- What this parcel took from the balance (refunded if it's cancelled before pickup).
ALTER TABLE shipments ADD COLUMN prepaid_paise INTEGER NOT NULL DEFAULT 0;

-- Every change to a shipping balance. Top-ups: new → claimed ("I have paid") → done (admin saw the money) | rejected.
CREATE TABLE ship_ledger (
  id          INTEGER PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES sellers(id),
  kind        TEXT NOT NULL,              -- topup | charge | refund | adjust
  amount_paise INTEGER NOT NULL,          -- + adds to the balance, − takes from it
  status      TEXT NOT NULL DEFAULT 'done',
  ref         TEXT,                       -- shipment id for charge/refund
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX ship_ledger_seller ON ship_ledger(seller_id, created_at DESC);
CREATE INDEX ship_ledger_status ON ship_ledger(status, created_at);
