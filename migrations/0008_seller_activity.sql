-- Seller activity for the admin portal: when each seller last used the app, and how many
-- WhatsApp messages the platform sent on their behalf (per day), so usage can be tracked
-- and priced. Counts start at 0 until the WhatsApp Business number is live.
ALTER TABLE sellers ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE wa_usage (
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,                    -- IST date, YYYY-MM-DD
  kind      TEXT NOT NULL,                    -- 'bot' (chat replies) | 'notify' (order updates) | 'template'
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (seller_id, day, kind)
);
