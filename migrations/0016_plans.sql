-- Pricing plans (see lib/plans.ts and the landing page): Shuruaat (free, 30 paid orders a month),
-- Dukaan (₹999/month, 300), Badi Dukaan (₹1,999/month, unlimited). The plan sets the monthly fee and the
-- order limit; when the limit is reached the shop stops taking new orders until the seller upgrades.
ALTER TABLE sellers ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
-- Existing paying sellers are never limited: any fee already set means unlimited.
UPDATE sellers SET plan = CASE WHEN plan_fee_paise >= 199900 THEN 'badi' WHEN plan_fee_paise >= 99900 THEN 'dukaan' WHEN plan_fee_paise > 0 THEN 'badi' ELSE 'free' END;
-- Upgrade invoices: the plan being bought and the plan before it (to undo a UPI claim that wasn't paid).
-- Monthly invoices leave both NULL. Upgrade invoices use period "YYYY-MM-uN" (periods are unique per seller).
ALTER TABLE invoices ADD COLUMN plan TEXT;
ALTER TABLE invoices ADD COLUMN plan_from TEXT;
