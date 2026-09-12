#!/usr/bin/env bash
#
# Delete the throwaway accounts that `pnpm test:live` makes.
#
# Select only the exact six-digit name/email pair used by the live fixture,
# and preserve any account that owns a commercial property.
set -euo pipefail

DATABASE=${1:-atheriam_live}

docker exec -i atheriam-postgres psql -U atheriam -d "$DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE smoke_cleanup ON COMMIT DROP AS
SELECT a.id AS account_id, c.id AS character_id
FROM accounts a JOIN characters c ON c.account_id = a.id
WHERE a.email_normalised ~ '^smoke[0-9]{6}@example[.]com$'
  AND c.name ~ '^Smoke[0-9]{6}$'
  AND a.email_normalised = lower(c.name) || '@example.com'
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.owner_id = c.id);
-- Reservations are free test records. Their host FK deliberately restricts
-- account deletion, so remove only this exact set of test hosts' reservations.
DELETE FROM lounge_bookings WHERE host_id IN (SELECT character_id FROM smoke_cleanup);
DELETE FROM accounts WHERE id IN (SELECT account_id FROM smoke_cleanup);
COMMIT;
SQL

echo "Smoke-test accounts removed from $DATABASE."
