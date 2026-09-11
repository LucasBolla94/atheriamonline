# Atheriam — project memory

Browser multiplayer social world: original medieval kingdom-city, top-down 2D
tiles, continuous open world, adults 18+, English UI, desktop + mobile
(landscape). Domain: atheriam.online.

## Always

- `docs/SPEC.md` is the source of truth. Read it before any work.
- Current phase and next steps: `docs/PROGRESS.md`. Work one phase at a time.
- Decisions you make on your own go to `docs/DECISIONS.md`; questions for the
  owner go to `docs/OPEN_QUESTIONS.md`. Do not stop to ask.
- The owner is not a developer: write docs in plain, simple English with
  step-by-step instructions.

## Non-negotiables

- Server-authoritative. Clients send intents only.
- Positions live in world-server memory; never write to the DB per step.
- Economy: double-entry ledger, BIGINT minor units, no floats, one DB
  transaction per operation, idempotency keys.
- An item instance is in exactly one place (inventory, house or trade escrow).
  Never copy items.
- No blockchain code. No private keys on the server.
- Never use or imitate assets/names/maps of Habbo, Tibia or any commercial
  game. Unknown or NonCommercial licenses are not used.
- UI lives in `apps/client/src/ui`, styled only via design tokens; no gameplay
  logic in UI.
- Never commit secrets. Never weaken tests or security to pass a check.

## Stack

TypeScript strict · pnpm workspaces · Phaser + Vite + React (client) ·
Node LTS + ws + Fastify (server) · PostgreSQL + Drizzle · Redis · zod ·
Vitest + Playwright · Docker Compose · Caddy.

## Commands (keep this list updated)

- `pnpm install` · `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test`
- `docker compose -f infra/docker-compose.yml up -d`
- `pnpm db:migrate` · `pnpm db:seed`

## Machine notes

- pnpm is installed per-user at `~/.npm-global/bin`; that path is on `PATH`
  via `~/.bashrc`.
- This machine's Node is not compiled with TypeScript support, so dev scripts
  run through `tsx`, not `node --experimental-strip-types`. See D-008.
- Docker is not installed yet. See Q-001.
- Playwright's browser system libraries are installed. Re-running
  `sudo npx playwright install-deps chromium` needs
  `DEBIAN_FRONTEND=noninteractive`, or apt stops on a prompt.
