#!/usr/bin/env bash
#
# Put Atheriam on the internet, or update what is already there.
#
# Run it from the project folder:
#
#   ./scripts/deploy.sh
#
# It is safe to run again and again. The first run sets everything up; every
# run after that builds the current code and restarts the two servers.
#
# What it does, in order:
#   1. checks the code is healthy (types, lint, tests) unless told to skip
#   2. builds the servers and the browser client
#   3. makes sure the database and cache are running
#   4. creates /etc/atheriam/atheriam.env with fresh secrets, the first time
#   5. applies any new database migrations
#   6. installs the two services, the backup timer and Caddy
#   7. restarts everything and checks the site answers
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
DOMAIN=${ATHERIAM_DOMAIN:-atheriam.online}
ENV_FILE=/etc/atheriam/atheriam.env
CLIENT_DIRECTORY=/srv/atheriam/client
SKIP_TESTS=${SKIP_TESTS:-0}

export PATH="$HOME/.npm-global/bin:$PATH"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# Docker needs the group, and a shell opened before the user joined it does
# not have it yet.
docker_() {
  if docker ps >/dev/null 2>&1; then docker "$@"; else sg docker -c "docker $*"; fi
}

say "Checking the code is healthy"
if [ "$SKIP_TESTS" = "1" ]; then
  echo "Skipped, because SKIP_TESTS=1."
else
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm lint
  pnpm test
fi

say "Building the servers and the browser client"
pnpm build

say "Making sure the database and the cache are running"
docker_ compose -f infra/docker-compose.yml up -d

say "Settings"
if [ ! -f "$ENV_FILE" ]; then
  echo "First run: creating $ENV_FILE with new secrets."
  sudo mkdir -p /etc/atheriam

  # The database password already exists in the development .env, because that
  # is the same PostgreSQL. Reuse it rather than locking ourselves out.
  DB_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
  if [ -z "$DB_PASSWORD" ]; then
    echo "No POSTGRES_PASSWORD in .env — cannot reach the database." >&2
    exit 1
  fi

  sudo tee "$ENV_FILE" >/dev/null <<SETTINGS
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgres://atheriam:${DB_PASSWORD}@127.0.0.1:5432/atheriam_live
REDIS_URL=redis://127.0.0.1:6379/1
API_HOST=127.0.0.1
API_PORT=3001
WORLD_HOST=127.0.0.1
WORLD_PORT=3002
PUBLIC_ORIGIN=https://${DOMAIN}
SESSION_SECRET=$(openssl rand -hex 32)
GENERAL_RATE_LIMIT_PER_MINUTE=300
AUTH_RATE_LIMIT_PER_MINUTE=10
SETTINGS

  sudo chown root:ubuntu "$ENV_FILE"
  sudo chmod 640 "$ENV_FILE"
else
  echo "Already set up at $ENV_FILE — leaving it alone."
fi

say "Applying database migrations"
# The migration tool reads DATABASE_URL from the environment, and the live one
# is in the settings file rather than in .env.
set -a
# shellcheck disable=SC1090
. <(sudo cat "$ENV_FILE")
set +a
pnpm --filter @atheriam/db migrate

say "Publishing the browser client"
sudo mkdir -p "$CLIENT_DIRECTORY"
sudo rsync -a --delete "$ROOT/apps/client/dist/" "$CLIENT_DIRECTORY/"
sudo chown -R ubuntu:ubuntu /srv/atheriam

say "Making room for the backups"
sudo install -d -o ubuntu -g ubuntu -m 750 /var/backups/atheriam

say "Installing the services"
sudo cp infra/production/atheriam-api.service /etc/systemd/system/
sudo cp infra/production/atheriam-world.service /etc/systemd/system/
sudo cp infra/production/atheriam-backup.service /etc/systemd/system/
sudo cp infra/production/atheriam-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atheriam-backup.timer

say "Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed yet. Installing it."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor --batch --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
fi

sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile >/dev/null

say "Starting everything"
sudo systemctl restart atheriam-api atheriam-world
sudo systemctl enable atheriam-api atheriam-world
sudo systemctl reload-or-restart caddy
sudo systemctl enable caddy

say "Checking it answers"
sleep 3
for service in atheriam-api atheriam-world caddy; do
  if ! systemctl is-active --quiet "$service"; then
    echo "$service is not running. What it said:" >&2
    sudo journalctl -u "$service" -n 30 --no-pager >&2
    exit 1
  fi
  echo "$service is running."
done

if curl -fsS --max-time 10 http://127.0.0.1:3001/api/health >/dev/null; then
  echo "The API answers."
else
  echo "The API did not answer on 127.0.0.1:3001." >&2
  exit 1
fi

printf '\n\033[1mAtheriam is live at https://%s\033[0m\n' "$DOMAIN"
echo "If this is the first run, the HTTPS certificate takes a few seconds."
