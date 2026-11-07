-- Cash on delivery is switched off for every shop: NukkadSale never handles cash or holds money.
-- Orders already placed as cash on delivery keep their normal handling until they're closed.
UPDATE drops SET cod_enabled = 0, cod_fee_paise = 0, cod_advance_paise = 0;
