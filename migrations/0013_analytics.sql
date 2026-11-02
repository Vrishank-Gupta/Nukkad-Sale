-- First-party traffic analytics (no cookies, no third parties): one row per page view, click, form step or page leave.
CREATE TABLE events (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('view', 'click', 'form_start', 'form_submit', 'leave')),
  area         TEXT NOT NULL DEFAULT 'site',      -- site (marketing, legal, login) | shop (sale pages, storefronts, orders)
  vid          TEXT NOT NULL,                     -- random id kept in the visitor's browser (localStorage)
  sid          TEXT NOT NULL,                     -- random id per browser tab session
  path         TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',          -- button/link text, or form id
  href         TEXT NOT NULL DEFAULT '',
  ref          TEXT NOT NULL DEFAULT '',          -- referrer host
  utm_source   TEXT NOT NULL DEFAULT '',
  utm_medium   TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  device       TEXT NOT NULL DEFAULT '',          -- mobile | desktop
  country      TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  ms           INTEGER NOT NULL DEFAULT 0,        -- leave: time the page was visible
  scroll       INTEGER NOT NULL DEFAULT 0         -- leave: deepest scroll, %
);
CREATE INDEX events_at ON events(at);
CREATE INDEX events_type_at ON events(type, area, at);
CREATE INDEX events_sid ON events(sid);
