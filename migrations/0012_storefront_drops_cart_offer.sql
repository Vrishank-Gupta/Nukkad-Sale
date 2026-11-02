-- Storefront link, scheduled drops, categories, and a "spend more, save more" cart offer.

-- Easy shop address: nukkadsale.in/<slug>. Unique when set.
ALTER TABLE sellers ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX sellers_slug ON sellers(slug) WHERE slug IS NOT NULL;
-- Cart offer: when the items in one payment add up to offer_min_paise, take offer_off_paise or offer_pct % off.
-- 0 = no offer.
ALTER TABLE sellers ADD COLUMN offer_min_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sellers ADD COLUMN offer_off_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sellers ADD COLUMN offer_pct INTEGER NOT NULL DEFAULT 0;

-- Category shown as a filter on the storefront ('' = none).
ALTER TABLE drops ADD COLUMN category TEXT NOT NULL DEFAULT '';
-- Scheduled drop: buyers can see it but not order before this time. 0 = live now.
ALTER TABLE drops ADD COLUMN live_at INTEGER NOT NULL DEFAULT 0;

-- Cart-offer discount taken off this order (kept on the cart's first line).
ALTER TABLE orders ADD COLUMN disc_paise INTEGER NOT NULL DEFAULT 0;
