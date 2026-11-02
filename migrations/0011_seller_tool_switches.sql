-- Selling tools a seller has switched off (comma list: waitlist, discount, offers, profit, labels).
-- Empty = everything on, so existing shops keep every tool.
ALTER TABLE sellers ADD COLUMN tools_off TEXT NOT NULL DEFAULT '';
