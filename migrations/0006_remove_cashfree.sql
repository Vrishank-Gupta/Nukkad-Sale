-- Cashfree is no longer offered: Razorpay is the only automatic-payment gateway.
-- Any shop that was set to Cashfree falls back to manual UPI, and its Cashfree keys are deleted.
UPDATE sellers SET pay_mode = 'direct' WHERE pay_mode = 'cashfree';
UPDATE sellers SET allowed_modes = TRIM(REPLACE(REPLACE(REPLACE(allowed_modes, 'cashfree', ''), ',,', ','), ',,', ','), ',');
UPDATE sellers SET allowed_modes = 'direct' WHERE allowed_modes = '';
UPDATE platform_settings SET value = TRIM(REPLACE(REPLACE(value, 'cashfree', ''), ',,', ','), ',') WHERE key = 'default_modes';
UPDATE platform_settings SET value = 'direct' WHERE key = 'default_modes' AND value = '';
DELETE FROM platform_settings WHERE key IN ('cf_app_id', 'cf_secret_enc', 'cf_sandbox');
ALTER TABLE sellers DROP COLUMN cf_app_id;
ALTER TABLE sellers DROP COLUMN cf_secret_enc;
ALTER TABLE sellers DROP COLUMN cf_sandbox;
