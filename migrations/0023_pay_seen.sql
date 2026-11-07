-- When the buyer first opened the pay page of an unpaid order. From then on that payment's amount never changes:
-- an item added later becomes its own payment (the buyer may already have paid the amount they saw).
ALTER TABLE orders ADD COLUMN pay_seen_at INTEGER;
