#!/usr/bin/env bash
#
# Delete everything the load test made.
#
# Load-test accounts all use an @loadtest.invalid address — a domain that can
# never exist — so this can never touch a real player.
set -euo pipefail

DATABASE=${1:-atheriam_live}

docker exec atheriam-postgres psql -U atheriam -d "$DATABASE" -c \
  "DELETE FROM accounts WHERE email_normalised LIKE '%@loadtest.invalid'"

echo "Load-test accounts removed from $DATABASE."
