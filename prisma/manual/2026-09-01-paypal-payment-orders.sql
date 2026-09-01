-- PayPal/card payment support: record what was actually charged, in what currency.
-- Apply by hand, per environment:
--   mysql -u <user> -p <database> < prisma/manual/2026-09-01-paypal-payment-orders.sql
--
-- Written out rather than generated because this database also holds KiviCare's
-- wp_* tables, and `prisma db push` would try to reconcile them against a schema
-- that does not describe them.
--
-- Every column has a default or is nullable, so existing rows stay valid with no
-- backfill: they are all Xendit orders charged in rupiah, and `expectedAmount`
-- already holds their amount.
ALTER TABLE `payment_orders`
  ADD COLUMN `gateway`         varchar(32)   NOT NULL DEFAULT 'xendit' AFTER `wcOrderId`,
  ADD COLUMN `chargedCurrency` varchar(3)    NOT NULL DEFAULT 'IDR'    AFTER `gateway`,
  ADD COLUMN `chargedAmount`   decimal(12,2)     NULL                  AFTER `chargedCurrency`,
  ADD COLUMN `fxRate`          decimal(12,2)     NULL                  AFTER `chargedAmount`;
