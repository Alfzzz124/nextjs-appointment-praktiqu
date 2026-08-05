-- Encounter migration — Phase E0 audit (READ ONLY)
--
-- Target: staging database `praktiqu_wp314`. Every statement is a SELECT.
-- Nothing is created, altered or deleted.
--
-- Answers the three gates in docs/architecture/encounter-migration-plan.md §4
-- before any code is written.
--
-- The database name is hard-coded and every table name is qualified, so it does
-- not matter which database phpMyAdmin has selected. An earlier version relied on
-- DATABASE() and failed with "#1109 Unknown table 'session_notes' in
-- information_schema" when run from the wrong tab.
--
-- Run STEP 1 and STEP 2 first. STEP 3 only matters if STEP 2 shows rows.

-- ===========================================================================
-- STEP 1 — which tables exist at all?
--
-- The gate that matters: `wp_kc_custom_fields_data` is ABSENT from the local
-- database. Decision D1 stores recommendation-item completion state in it. If it
-- is missing here too, D1 falls back to a small PraktiQU-owned side table.
--
-- Cannot fail: it reads the catalogue, not the tables themselves.
-- `table_rows` is InnoDB's estimate — treat STEP 2 as the real count.
-- ===========================================================================
SELECT table_name,
       table_rows AS estimated_rows,
       engine,
       table_collation
  FROM information_schema.tables
 WHERE table_schema = 'praktiqu_wp314'
   AND table_name IN (
       -- ours, the ones being retired
       'session_notes',
       'intervention_plans',
       'recommendation_items',
       -- KiviCare's, the ones taking over
       'wp_kc_patient_encounters',
       'wp_kc_medical_history',
       'wp_kc_prescription',
       'wp_kc_medical_problems',
       'wp_kc_patient_encounters_template',
       'wp_kc_patient_encounters_template_mapping',
       -- the D1 gate
       'wp_kc_custom_fields',
       'wp_kc_custom_fields_data'
   )
 ORDER BY table_name;

-- ===========================================================================
-- STEP 2 — exact row counts, skipping tables that do not exist.
--
-- Built dynamically from the catalogue, so a missing table is simply absent from
-- the result instead of aborting the batch. Run all four lines together.
--
-- Zero across our three tables means phase E6 (the migration script) disappears
-- from the plan entirely.
-- ===========================================================================
SET SESSION group_concat_max_len = 1000000;

SET @sql = (
  SELECT GROUP_CONCAT(
           CONCAT("SELECT '", table_name, "' AS tbl, COUNT(*) AS rows_total FROM `praktiqu_wp314`.`", table_name, "`")
           ORDER BY table_name
           SEPARATOR ' UNION ALL '
         )
    FROM information_schema.tables
   WHERE table_schema = 'praktiqu_wp314'
     AND table_name IN (
         'session_notes',
         'intervention_plans',
         'recommendation_items',
         'wp_kc_patient_encounters',
         'wp_kc_medical_history',
         'wp_kc_prescription',
         'wp_kc_medical_problems',
         'wp_kc_custom_fields',
         'wp_kc_custom_fields_data'
     )
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ===========================================================================
-- STEP 3 — only if STEP 2 showed rows in session_notes / intervention_plans.
--
-- `sessionId` is an unconstrained string column. Rows still holding a cuid point
-- at the old `appointments` shadow table and have no encounter to become — they
-- must be reported, never silently dropped. Rows holding digits are migratable.
-- ===========================================================================

-- 3a. Shape of the ids we hold.
SELECT 'session_notes' AS tbl,
       CASE WHEN sessionId REGEXP '^[0-9]+$' THEN 'numeric' ELSE 'cuid_or_other' END AS id_shape,
       COUNT(*) AS rows_total
  FROM `praktiqu_wp314`.`session_notes`
 GROUP BY id_shape
 UNION ALL
SELECT 'intervention_plans',
       CASE WHEN sessionId REGEXP '^[0-9]+$' THEN 'numeric' ELSE 'cuid_or_other' END,
       COUNT(*)
  FROM `praktiqu_wp314`.`intervention_plans`
 GROUP BY id_shape;

-- 3b. Of the numeric ones, do the appointments they name still exist?
--     A row whose appointment is gone cannot be migrated either.
SELECT COUNT(*) AS notes_with_live_appointment
  FROM `praktiqu_wp314`.`session_notes` sn
  JOIN `praktiqu_wp314`.`wp_kc_appointments` a
    ON a.id = CAST(sn.sessionId AS UNSIGNED)
 WHERE sn.sessionId REGEXP '^[0-9]+$';

-- ===========================================================================
-- STEP 4 — context: is KiviCare's encounter feature already in use here?
--
-- If clinicians already write encounters, our writes join existing data rather
-- than starting an empty table, which raises the stakes on the E1 hook work.
-- Safe to skip if STEP 1 showed these tables absent.
-- ===========================================================================
SELECT type, COUNT(*) AS rows_total
  FROM `praktiqu_wp314`.`wp_kc_medical_history`
 GROUP BY type
 ORDER BY rows_total DESC;

SELECT status, COUNT(*) AS rows_total
  FROM `praktiqu_wp314`.`wp_kc_patient_encounters`
 GROUP BY status;
