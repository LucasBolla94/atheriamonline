# Atheriam Online

A browser multiplayer social world set in an original medieval kingdom-city.
Top-down 2D tiles, one continuous open world, for adults (18+).

**Site:** https://atheriam.online — live, on desktop and on a phone in
landscape.

---

## Running it on the server

```bash
./scripts/deploy.sh    # build, install, restart, check. Safe to run again.
pnpm test:live         # drive a real browser against the real site
```

The two servers run as systemd services (`atheriam-api`, `atheriam-world`)
behind Caddy, which holds the HTTPS certificate. PostgreSQL and Redis run in
Docker and listen on this machine only. The database is backed up every night
to `/var/backups/atheriam`, keeping fourteen nights.

```bash
systemctl status atheriam-api atheriam-world caddy
journalctl -u atheriam-world -f
```

---

## Where to read first

| File                                               | What it is for                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [`docs/SPEC.md`](docs/SPEC.md)                     | The source of truth. What the game is and the rules it must obey. |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)             | Where the project is right now and what happens next.             |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)           | Decisions taken, why, and what they would cost to change.         |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Questions waiting for the owner.                                  |

## Getting started

You need **Node.js 22 or newer** and **pnpm**.

1. Install the project's dependencies:
   ```bash
   pnpm install
   ```
2. Copy the example settings file and fill it in:
   ```bash
   cp .env.example .env
   ```
3. Start the database and cache (needs Docker):
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
4. Create the tables:
   ```bash
   pnpm db:migrate
   ```
5. Run everything in development mode:
   ```bash
   pnpm dev
   ```

Then open http://localhost:5173 and create an account. You must be 18 or over.

## Checking the code is healthy

```bash
pnpm typecheck        # TypeScript, strict mode
pnpm lint             # ESLint
pnpm test             # Vitest — runs anywhere, needs nothing installed
```

All three must pass before any change is finished. Two slower suites cover
what those cannot:

```bash
pnpm test:integration  # against a real PostgreSQL and Redis
pnpm test:e2e          # a real browser, desktop and phone-sized
```

## How the project is arranged

```
apps/
  client/    the browser game (Phaser + Vite + React)
  world/     the live world server (WebSocket)          — positions in memory
  api/       the HTTP API (Fastify)                     — accounts, money, items
packages/
  protocol/  the messages the client and servers exchange
  db/        the database schema and migrations
  economy/   money, the double-entry ledger, idempotency
  shared/    small helpers used by everything
infra/
  docker-compose.yml   PostgreSQL and Redis for local development
  caddy/               the production reverse proxy
docs/                  the documents listed above
```

## The rules that never bend

- The **server decides everything**. The browser only asks.
- Player positions live in **memory**, never a database write per step.
- Money is a **double-entry ledger** in whole minor units. No floating point.
- An item exists in **exactly one place**. Items are never copied.
- **No blockchain, no crypto, no private keys.**
- **No assets or names taken from any commercial game**, and no asset with an
  unclear or NonCommercial licence.
- **No secrets in the repository.**
- **Passwords are argon2id hashes**, and the game is **18+**, checked against a
  recorded date of birth.
