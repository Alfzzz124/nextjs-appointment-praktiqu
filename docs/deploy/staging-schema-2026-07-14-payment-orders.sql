-- ============================================================================
-- Staging schema update for the payment-orders feature (2026-07-14)
-- ============================================================================
--
-- Apply this to the STAGING database only (a copy of `wordpress-praktiqu`),
-- and to the local `wordpress-praktiqu-test` DB before running vitest's
-- integration suites.
--
-- WHY MANUAL SQL, NOT PRISMA:
--   DATABASE_URL is the WordPress DB itself, and prisma/schema.prisma maps BOTH
--   app tables AND the wp_* tables into one datasource. `prisma db push` /
--   `prisma migrate dev` would see the wp_* tables as drift and try to
--   alter/drop them — corrupting WordPress. Run this script directly instead
--   (mysql CLI, phpMyAdmin, Adminer, etc.). Only `prisma generate` is safe.
--
-- Idempotency: CREATE TABLE uses IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `payment_orders` (
  `id`             VARCHAR(191) NOT NULL,
  `source`         VARCHAR(20)  NOT NULL,
  `appointmentId`  VARCHAR(191) NULL,
  `billId`         VARCHAR(191) NULL,
  `encounterId`    VARCHAR(191) NULL,
  `wcOrderId`      INT          NOT NULL,
  `expectedAmount` INT          NOT NULL,
  `status`         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  `transactionId`  VARCHAR(191) NULL,
  `paidAt`         DATETIME(3)  NULL,
  `webhookPayload` JSON         NULL,
  `createdAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payment_orders_wcOrderId_key` (`wcOrderId`),
  INDEX `payment_orders_appointmentId_idx` (`appointmentId`),
  INDEX `payment_orders_billId_idx` (`billId`),
  INDEX `payment_orders_status_idx` (`status`)
) DEFAULT CHARSET = utf8mb4;
