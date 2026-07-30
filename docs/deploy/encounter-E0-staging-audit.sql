-- Encounter migration — Phase E0 audit (READ ONLY)
--
-- Run against the staging database `praktiqu_wp314` (phpMyAdmin, or mysql CLI).
-- Every statement here is a SELECT. Nothing is created, altered or deleted.
--
-- Purpose: answer the three gates in docs/architecture/encounter-migration-plan.md §4
-- before any code is written.

-- ---------------------------------------------------------------------------
-- Gate 1 — does the table decision D1 depends on actually exist here?
-- wp_kc_custom_field_data is MISSING from the local database. If it is missing
-- here too, completion state cannot live in it and D1 falls back to a side table.
-- ---------------------------------------------------------------------------
SELECT table_name, table_rows
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN (
       'wp_kc_custom_fields',
       'wp_kc_custom_field_data',
       'wp_kc_patient_encounters',
       'wp_kc_medical_history',
       'wp_kc_prescription',
       'wp_kc_medical_problems',
       'wp_kc_patient_encounters_template',
       'wp_kc_patient_encounters_template_mapping'
   )
 ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- Gate 2 — how much of our own data is there to migrate?
-- Zero across the board means phase E6 (migration script) is not needed at all.
-- ---------------------------------------------------------------------------
SELECT 'session_notes'        AS tbl, COUNT(*) AS rows_total FROM session_notes
UNION ALL SELECT 'intervention_plans',    COUNT(*) FROM intervention_plans
UNION ALL SELECT 'recommendation_items',  COUNT(*) FROM recommendation_items
UNION ALL SELECT 'wp_kc_patient_encounters', COUNT(*) FROM wp_kc_patient_encounters
UNION ALL SELECT 'wp_kc_medical_history',    COUNT(*) FROM wp_kc_medical_history
UNION ALL SELECT 'wp_kc_prescription',       COUNT(*) FROM wp_kc_prescription;

-- ---------------------------------------------------------------------------
-- Gate 3 — can the rows we have even be mapped?
-- sessionId is an unconstrained string. Rows still holding a cuid point at the
-- old `appointments` shadow table and have no encounter to become.
-- 'numeric' rows are migratable; 'cuid_or_other' rows must be reported, never
-- silently dropped.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN sessionId REGEXP '^[0-9]+$' THEN 'numeric' ELSE 'cuid_or_other' END AS id_shape,
       COUNT(*) AS rows_total
  FROM session_notes
 GROUP BY id_shape;

SELECT CASE WHEN sessionId REGEXP '^[0-9]+$' THEN 'numeric' ELSE 'cuid_or_other' END AS id_shape,
       COUNT(*) AS rows_total
  FROM intervention_plans
 GROUP BY id_shape;

-- Of the numeric ones, do the appointments they name still exist?
SELECT COUNT(*) AS notes_with_live_appointment
  FROM session_notes sn
  JOIN wp_kc_appointments a ON a.id = CAST(sn.sessionId AS UNSIGNED)
 WHERE sn.sessionId REGEXP '^[0-9]+$';

-- ---------------------------------------------------------------------------
-- Context — is the encounter feature in use on staging at all?
-- If KiviCare users already write encounters, our writes join existing data
-- rather than starting an empty table, and the E1 hook work matters more.
-- ---------------------------------------------------------------------------
SELECT type, COUNT(*) AS rows_total
  FROM wp_kc_medical_history
 GROUP BY type
 ORDER BY rows_total DESC;

SELECT status, COUNT(*) AS rows_total
  FROM wp_kc_patient_encounters
 GROUP BY status;
