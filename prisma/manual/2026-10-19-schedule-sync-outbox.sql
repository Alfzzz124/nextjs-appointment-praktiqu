-- Outbox for external effects after a schedule move (calendar/telemed/reminders).
-- Apply by hand per environment; never `prisma db push` (shared WordPress database).
-- Written in the same InnoDB transaction as the schedule change, so a committed move
-- always leaves a visible pending job, and a rolled-back move leaves none.
-- Payload carries ids and schedule values only: no names, emails, phone numbers or tokens.
CREATE TABLE IF NOT EXISTS `wp_praktiqu_schedule_outbox` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `appointment_id`  BIGINT UNSIGNED NOT NULL,
  `kind`            VARCHAR(32)     NOT NULL DEFAULT 'schedule_moved',
  `payload`         TEXT            NOT NULL,
  `status`          VARCHAR(16)     NOT NULL DEFAULT 'pending',
  `attempts`        INT UNSIGNED    NOT NULL DEFAULT 0,
  `last_error`      VARCHAR(500)    NULL,
  `actor`           VARCHAR(64)     NOT NULL,
  `request_id`      VARCHAR(64)     NOT NULL,
  `next_attempt_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at`         DATETIME        NULL,
  PRIMARY KEY (`id`),
  KEY `outbox_due_idx` (`status`, `next_attempt_at`),
  KEY `outbox_appt_idx` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
