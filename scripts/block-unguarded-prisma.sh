#!/usr/bin/env bash
# PreToolUse(Bash) hook: block schema-mutating Prisma commands that bypass guard-db.
#
# The 40 duplicate shadow tables were created by an agent running `prisma db push`
# directly against the live WordPress database. npm scripts alone don't help there —
# nothing stops `npx prisma db push` being typed straight into a shell. This hook does.
#
# Reads the tool-call JSON on stdin; exit 2 blocks the call and shows stderr to Claude.

set -uo pipefail

payload=$(cat)

# Extract .tool_input.command without assuming jq is present.
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  cmd=$(printf '%s' "$payload" | grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -1 | sed 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

[ -z "$cmd" ] && exit 0

# Only the executable part of the command can mutate a database. Heredoc bodies are
# data — a commit message that quotes `prisma db push` must not trip the guard (it
# did, on this very commit). Truncate at the first heredoc marker.
cmd=${cmd%%'<<'*}

# Anything routed through the guarded npm scripts is fine.
printf '%s' "$cmd" | grep -qE '(npm run|yarn|pnpm) db:(push|migrate|reset|guard)' && exit 0
# An explicit, deliberate override is the documented escape hatch.
printf '%s' "$cmd" | grep -q 'ALLOW_WP_SCHEMA_WRITE=' && exit 0

if printf '%s' "$cmd" | grep -qE 'prisma[[:space:]]+(db[[:space:]]+push|migrate[[:space:]]+(dev|reset))'; then
  cat >&2 <<'EOF'
BLOCKED: schema-mutating Prisma command without the WordPress-database guard.

DATABASE_URL points at the live WordPress database that KiviCare owns. A previous
`prisma db push` against it created 40 duplicate tables (clients, professionals,
sessions_booking, ...). See docs/architecture/shadow-tables-audit.md.

Use the guarded script instead:
    npm run db:push        # or db:migrate / db:reset

To change one of OUR tables, write a scoped ALTER/CREATE for that table only and
apply it deliberately — do not push the whole schema.
EOF
  exit 2
fi

exit 0
