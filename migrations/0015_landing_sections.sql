-- Landing-page section tracking: which sections visitors reach ("section"), how long each one is on screen
-- ("dwell", ms), and which section every click / form step happened in (events.section).
-- SQLite can't change a CHECK constraint, so the table is rebuilt with the two new event types.
CREATE TABLE events_new (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('view', 'click', 'form_start', 'form_submit', 'leave', 'section', 'dwell')),
  area         TEXT NOT NULL DEFAULT 'site',
  vid          TEXT NOT NULL,
  sid          TEXT NOT NULL,
  path         TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',          -- button/link text, form id, or section id (section, dwell)
  href         TEXT NOT NULL DEFAULT '',
  ref          TEXT NOT NULL DEFAULT '',
  utm_source   TEXT NOT NULL DEFAULT '',
  utm_medium   TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  device       TEXT NOT NULL DEFAULT '',
  country      TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  ms           INTEGER NOT NULL DEFAULT 0,        -- leave: time the page was visible · dwell: time the section was on screen
  scroll       INTEGER NOT NULL DEFAULT 0,
  section      TEXT NOT NULL DEFAULT ''           -- page section (data-sec) the event happened in
);
INSERT INTO events_new (id, at, type, area, vid, sid, path, label, href, ref, utm_source, utm_medium, utm_campaign, device, country, city, ms, scroll)
  SELECT id, at, type, area, vid, sid, path, label, href, ref, utm_source, utm_medium, utm_campaign, device, country, city, ms, scroll FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_at ON events(at);
CREATE INDEX events_type_at ON events(type, area, at);
CREATE INDEX events_sid ON events(sid);
