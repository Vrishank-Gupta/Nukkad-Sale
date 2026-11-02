-- "Get started" requests from the marketing site. The admin contacts the person, then creates
-- their shop from the request and sends them their login.
CREATE TABLE leads (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  business   TEXT NOT NULL,
  phone      TEXT NOT NULL,                  -- 91XXXXXXXXXX
  city       TEXT NOT NULL DEFAULT '',
  sells      TEXT NOT NULL DEFAULT '',       -- what they sell
  channel    TEXT NOT NULL DEFAULT '',       -- where they sell today
  volume     TEXT NOT NULL DEFAULT '',       -- orders per month (range)
  payments   TEXT NOT NULL DEFAULT '',       -- upi | auto | unsure
  message    TEXT NOT NULL DEFAULT '',
  lang       TEXT NOT NULL DEFAULT 'en',
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'onboarded', 'closed')),
  note       TEXT NOT NULL DEFAULT '',       -- admin's notes
  seller_id  TEXT,                           -- set once the shop is created
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX leads_status ON leads (status, created_at);

-- 1 while the seller still uses the PIN the admin gave them; cleared when they change it.
ALTER TABLE sellers ADD COLUMN temp_pin INTEGER NOT NULL DEFAULT 0;
