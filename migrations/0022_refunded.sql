-- A late payment the seller sent back: the order stays 'refund_due' and gets the time the seller marked it refunded.
ALTER TABLE orders ADD COLUMN refunded_at INTEGER;
