#!/bin/bash
# Encounter migration — Phase E0 audit, run ON THE STAGING SERVER.
#
#   bash encounter-E0-staging-audit.sh
#
# READ ONLY: every query is a SELECT. Nothing is created, altered or deleted.
#
# Credentials are read from the app's own .htaccess (SetEnv DATABASE_URL), so no
# password is typed, echoed, or left in shell history. They are passed to mysql
# through a 0600 defaults file that is deleted on exit — not on the command line,
# where `ps` would expose them.
#
# Answers the three gates in docs/architecture/encounter-migration-plan.md §4.

set -uo pipefail

DOCROOTS=(
  "$HOME/staging2.praktiqu.com"
  "$HOME/appointment.praktiqu.com"
)

# --- locate DATABASE_URL --------------------------------------------------
DB_URL=""
for d in "${DOCROOTS[@]}"; do
  [ -f "$d/.htaccess" ] || continue
  line=$(grep -aiE '^[[:space:]]*SetEnv[[:space:]]+DATABASE_URL' "$d/.htaccess" 2>/dev/null | tail -1)
  [ -n "$line" ] || continue
  DB_URL=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*SetEnv[[:space:]]+DATABASE_URL[[:space:]]+//; s/^"//; s/"[[:space:]]*$//')
  echo "Using DATABASE_URL from $d/.htaccess"
  break
done

if [ -z "$DB_URL" ]; then
  echo "ERROR: no 'SetEnv DATABASE_URL' found in:" >&2
  printf '  %s/.htaccess\n' "${DOCROOTS[@]}" >&2
  echo "Find it with:  grep -ri DATABASE_URL ~/ --include=.htaccess" >&2
  exit 1
fi

# --- parse mysql://user:pass@host:port/dbname ------------------------------
rest=${DB_URL#mysql://}
creds=${rest%%@*}
hostpart=${rest#*@}

DB_USER=${creds%%:*}
DB_PASS=${creds#*:}
hostport=${hostpart%%/*}
DB_HOST=${hostport%%:*}
DB_PORT=${hostport#*:}; [ "$DB_PORT" = "$DB_HOST" ] && DB_PORT=3306
DB_NAME=${hostpart#*/}
DB_NAME=${DB_NAME%%\?*}

# Passwords in a URL are percent-encoded; mysql needs the real bytes.
urldecode() { printf '%b' "${1//%/\\x}"; }
DB_PASS=$(urldecode "$DB_PASS")

echo "Database: $DB_NAME on $DB_HOST:$DB_PORT as $DB_USER"
echo

# --- credentials via a private defaults file, never argv -------------------
CNF=$(mktemp) || exit 1
chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT INT TERM
cat > "$CNF" <<EOF
[client]
user=$DB_USER
password=$DB_PASS
host=$DB_HOST
port=$DB_PORT
EOF

run() { mysql --defaults-extra-file="$CNF" --table -e "$1" "$DB_NAME" 2>&1; }

echo "=== STEP 1 — which tables exist ==========================================="
echo "(wp_kc_custom_field_data is the one decision D1 depends on)"
run "
SELECT table_name, table_rows AS estimated_rows, engine
  FROM information_schema.tables
 WHERE table_schema = '$DB_NAME'
   AND table_name IN ('session_notes','intervention_plans','recommendation_items',
                      'wp_kc_patient_encounters','wp_kc_medical_history','wp_kc_prescription',
                      'wp_kc_medical_problems','wp_kc_patient_encounters_template',
                      'wp_kc_patient_encounters_template_mapping',
                      'wp_kc_custom_fields','wp_kc_custom_field_data')
 ORDER BY table_name;"

echo
echo "=== STEP 2 — exact row counts (missing tables are skipped) ================"
run "
SET SESSION group_concat_max_len = 1000000;
SET @sql = (SELECT GROUP_CONCAT(
       CONCAT('SELECT ''', table_name, ''' AS tbl, COUNT(*) AS rows_total FROM \`', table_name, '\`')
       ORDER BY table_name SEPARATOR ' UNION ALL ')
  FROM information_schema.tables
 WHERE table_schema = '$DB_NAME'
   AND table_name IN ('session_notes','intervention_plans','recommendation_items',
                      'wp_kc_patient_encounters','wp_kc_medical_history','wp_kc_prescription',
                      'wp_kc_medical_problems','wp_kc_custom_fields','wp_kc_custom_field_data'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;"

echo
echo "=== STEP 3 — id shape of our own rows ====================================="
echo "(cuid rows point at the retired shadow table and cannot become encounters)"
run "
SELECT 'session_notes' AS tbl,
       CASE WHEN sessionId REGEXP '^[0-9]+\$' THEN 'numeric' ELSE 'cuid_or_other' END AS id_shape,
       COUNT(*) AS rows_total
  FROM session_notes GROUP BY id_shape
 UNION ALL
SELECT 'intervention_plans',
       CASE WHEN sessionId REGEXP '^[0-9]+\$' THEN 'numeric' ELSE 'cuid_or_other' END,
       COUNT(*)
  FROM intervention_plans GROUP BY id_shape;"

echo
echo "=== STEP 4 — is KiviCare's encounter feature already in use? =============="
run "
SELECT type, COUNT(*) AS rows_total FROM wp_kc_medical_history GROUP BY type ORDER BY rows_total DESC;"
run "
SELECT status, COUNT(*) AS rows_total FROM wp_kc_patient_encounters GROUP BY status;"

echo
echo "Done. Nothing was modified."
