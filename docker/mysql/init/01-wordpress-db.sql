-- Create the WordPress database (runs automatically on first MySQL start)
-- PraktiQU reads from here to sync WordPress users.

CREATE DATABASE IF NOT EXISTS `wordpress`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Grant PraktiQU user access to the wordpress database
-- (so PraktiQU can SELECT from wp_users for identity sync)
GRANT ALL PRIVILEGES ON `wordpress`.* TO 'praktiqu'@'%';
FLUSH PRIVILEGES;
