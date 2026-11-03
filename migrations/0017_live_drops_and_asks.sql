-- Live drops: a sale the seller runs as an event. Buyers see pieces left, how many sold in the last few
-- minutes and who just bought (first name + size), and can ask to be reminded when it starts.
ALTER TABLE drops ADD COLUMN live_drop INTEGER NOT NULL DEFAULT 0;
-- Waitlist rows are either "tell me when it's back" (restock) or "remind me when it starts" (start).
ALTER TABLE waitlist ADD COLUMN kind TEXT NOT NULL DEFAULT 'restock';

-- "Ask your buyers": before buying stock, the seller shows up to 6 designs and buyers say which they want,
-- optionally paying a small reserve that comes off the price when the design goes on sale.
CREATE TABLE asks (
  id            TEXT PRIMARY KEY,                -- random token in the link /a/<id>
  seller_id     TEXT NOT NULL REFERENCES sellers(id),
  title         TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  reserve_paise INTEGER NOT NULL DEFAULT 0,      -- 0 = votes only
  closes_at     INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX asks_seller ON asks(seller_id, created_at DESC);

CREATE TABLE ask_items (
  id          INTEGER PRIMARY KEY,
  ask_id      TEXT NOT NULL REFERENCES asks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  price_paise INTEGER NOT NULL,
  image_key   TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  drop_id     TEXT                               -- set once the seller turns this design into a sale
);
CREATE INDEX ask_items_ask ON ask_items(ask_id, position);

-- One row per buyer per design they want.
CREATE TABLE ask_votes (
  id         INTEGER PRIMARY KEY,
  ask_id     TEXT NOT NULL REFERENCES asks(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES ask_items(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,                      -- 91XXXXXXXXXX
  size       TEXT NOT NULL DEFAULT '',
  told_at    INTEGER,                            -- seller sent them the sale link
  created_at INTEGER NOT NULL,
  UNIQUE (item_id, phone)
);
CREATE INDEX ask_votes_ask ON ask_votes(ask_id, created_at);

-- The reserve (one per buyer per ask), paid to the seller's UPI with its own exact amount.
CREATE TABLE ask_reserves (
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,               -- random token in the buyer's pay link /a/<ask>/r/<key>
  ask_id       TEXT NOT NULL REFERENCES asks(id) ON DELETE CASCADE,
  seller_id    TEXT NOT NULL REFERENCES sellers(id),
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'claimed', 'paid', 'used', 'refund_due', 'refunded')),
  offer_id     TEXT,                             -- the special-price link the reserve was turned into
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (ask_id, phone)
);
CREATE INDEX ask_reserves_seller ON ask_reserves(seller_id, status);
