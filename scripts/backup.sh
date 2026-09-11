#!/usr/bin/env bash
#
# Back up the Atheriam database.
#
# Writes one compressed dump per night into /var/backups/atheriam and keeps the
# last fourteen. The dump is written to a temporary name first and moved into
# place at the end, so a backup that was interrupted is never mistaken for a
# good one.
set -euo pipefail

KEEP=14
DIRECTORY=/var/backups/atheriam
CONTAINER=atheriam-postgres
DATABASE=atheriam_live
STAMP=$(date +%Y-%m-%d-%H%M)
FINAL="$DIRECTORY/atheriam-$STAMP.sql.gz"

# The directory belongs to the service user and is created by the deployment,
# because /var/backups itself is root's. Saying so plainly beats a permission
# error at half past three in the morning.
if [ ! -d "$DIRECTORY" ]; then
  echo "$DIRECTORY does not exist. Run scripts/deploy.sh, which creates it." >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump -U atheriam --clean --if-exists "$DATABASE" \
  | gzip -9 > "$FINAL.part"
mv "$FINAL.part" "$FINAL"

# An empty dump is worse than no dump, because it looks like one.
if [ "$(stat -c%s "$FINAL")" -lt 1000 ]; then
  echo "The backup is suspiciously small. Keeping it, but something is wrong." >&2
  exit 1
fi

# Keep the newest, delete the rest.
ls -1t "$DIRECTORY"/atheriam-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "Backed up to $FINAL ($(du -h "$FINAL" | cut -f1))."
