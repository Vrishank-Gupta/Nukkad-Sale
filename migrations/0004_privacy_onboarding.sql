-- Buyer/seller privacy requests (DPDP): delete or copy my data. The admin verifies the
-- requester on WhatsApp before acting.
CREATE TABLE data_requests (
  id         INTEGER PRIMARY KEY,
  phone      TEXT NOT NULL,                  -- 91XXXXXXXXXX as entered
  kind       TEXT NOT NULL CHECK (kind IN ('delete', 'copy')),
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);

-- Admin's onboarding checklist for gateway sellers (manual steps; the rest is derived).
ALTER TABLE sellers ADD COLUMN onboarding TEXT NOT NULL DEFAULT '{}';
