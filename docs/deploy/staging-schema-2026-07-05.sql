-- ============================================================================
-- Staging schema update for the tsc-fix branch (PR #15, 2026-07-05)
-- ============================================================================
--
-- Apply this to the STAGING database only (a copy of `wordpress-praktiqu`).
--
-- WHY MANUAL SQL, NOT PRISMA:
--   DATABASE_URL is the WordPress DB itself, and prisma/schema.prisma maps BOTH
--   app tables AND the wp_* tables into one datasource. `prisma db push` /
--   `prisma migrate dev` would see the wp_* tables as drift and try to
--   alter/drop them — corrupting WordPress. Run this script directly instead
--   (mysql CLI, phpMyAdmin, Adminer, etc.). Only `prisma generate` is safe.
--
-- These objects back native features referenced in code but never created
-- (note-templates, client goals) plus two column changes. Column names match
-- the Prisma field names exactly so the generated client works.
--
-- Idempotency: CREATE TABLE uses IF NOT EXISTS. The two ALTERs are NOT
-- idempotent on stock MySQL — skip them if the column already has the target
-- shape (check with: SHOW COLUMNS FROM clinics LIKE 'timezone';).
-- ============================================================================

-- 1. note_templates (src/services/notes-templates/service.ts)
CREATE TABLE IF NOT EXISTS `note_templates` (
  `id`          VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `content`     LONGTEXT NOT NULL,
  `variables`   JSON NULL,
  `category`    VARCHAR(191) NULL,
  `clinicId`    VARCHAR(191) NULL,
  `ownerId`     VARCHAR(191) NULL,
  `status`      INT NOT NULL DEFAULT 1,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `note_templates_clinicId_status_idx` (`clinicId`, `status`),
  INDEX `note_templates_ownerId_idx` (`ownerId`)
) DEFAULT CHARSET = utf8mb4;

-- 2. goals (src/services/progress/service.ts)
CREATE TABLE IF NOT EXISTS `goals` (
  `id`          VARCHAR(191) NOT NULL,
  `clientId`    VARCHAR(191) NOT NULL,
  `title`       VARCHAR(191) NULL,
  `description` TEXT NULL,
  `isAchieved`  TINYINT(1) NOT NULL DEFAULT 0,
  `achievedAt`  DATETIME(3) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `goals_clientId_idx` (`clientId`)
) DEFAULT CHARSET = utf8mb4;

-- 3. goal_milestones (relation of Goal)
CREATE TABLE IF NOT EXISTS `goal_milestones` (
  `id`         VARCHAR(191) NOT NULL,
  `goalId`     VARCHAR(191) NOT NULL,
  `title`      VARCHAR(191) NULL,
  `sortOrder`  INT NOT NULL DEFAULT 0,
  `isAchieved` TINYINT(1) NOT NULL DEFAULT 0,
  `achievedAt` DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `goal_milestones_goalId_idx` (`goalId`),
  CONSTRAINT `goal_milestones_goalId_fkey`
    FOREIGN KEY (`goalId`) REFERENCES `goals` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARSET = utf8mb4;

-- 4. clinics.timezone (used by availability/professional slot generation)
ALTER TABLE `clinics` ADD COLUMN `timezone` VARCHAR(191) NULL;

-- 5. consent_forms.createdById → nullable (create route does not set it yet)
ALTER TABLE `consent_forms` MODIFY `createdById` VARCHAR(191) NULL;
