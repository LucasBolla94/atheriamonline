#!/usr/bin/env bash
#
# Delete the throwaway accounts that `pnpm test:live` makes.
#
# Every one of them is called Smoke<digits> and uses an @example.com address,
# which is a domain reserved by the standards body and can never belong to a
# real player.
set -euo pipefail

DATABASE=${1:-atheriam_live}

docker exec atheriam-postgres psql -U atheriam -d "$DATABASE" -c \
  "DELETE FROM accounts WHERE email_normalised LIKE 'smoke%@example.com'"

echo "Smoke-test accounts removed from $DATABASE."
