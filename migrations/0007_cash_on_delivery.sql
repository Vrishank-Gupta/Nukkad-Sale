-- Cash on delivery, per sale. A COD order is an open order (status 'pending', pay_mode 'cod')
-- whose reservation never lapses; it becomes 'paid' when the seller marks the cash received,
-- or 'rejected' (stock back) if the seller cancels. No change to the orders table is needed.
ALTER TABLE drops ADD COLUMN cod_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drops ADD COLUMN cod_fee_paise INTEGER NOT NULL DEFAULT 0;
