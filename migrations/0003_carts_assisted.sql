-- Several items paid together ("I'll take Hawas Verde and Kobra"): every item stays its own
-- order row (own stock hold, own sale), and rows paid as one share cart_id = the first row's id.
-- The cart's payable amount is the sum of its rows; the unique paise sit on the first row.
ALTER TABLE orders ADD COLUMN cart_id TEXT;
CREATE INDEX orders_cart ON orders(cart_id);

-- Orders the seller created from a WhatsApp chat ("quick order"), for buyers who DM the seller.
ALTER TABLE orders ADD COLUMN assisted INTEGER NOT NULL DEFAULT 0;
