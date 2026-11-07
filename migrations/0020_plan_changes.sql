-- A seller's own move to a smaller plan takes effect at the start of a later month (plan_next from plan_next_from, "YYYY-MM").
ALTER TABLE sellers ADD COLUMN plan_next TEXT;
ALTER TABLE sellers ADD COLUMN plan_next_from TEXT;
