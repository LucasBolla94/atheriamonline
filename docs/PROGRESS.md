# Atheriam — Progress

This file says **where the project is right now** and **what happens next**.
We work on **one phase at a time**. A phase is only "done" when every box in it
is ticked and `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass.

Last updated: 2026-09-11

---

## Current phase

**Phase 3 — The city** — done.
Next up: **Phase 4 — Talking**.

## Phase list

### Phase 0 — Foundations — DONE

Goal: an empty but real project that installs, builds, type-checks and tests.

- [x] Write `docs/SPEC.md` (the source of truth)
- [x] Write `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`
- [x] pnpm workspace with `apps/` and `packages/`
- [x] TypeScript `strict` shared config
- [x] ESLint + Prettier
- [x] Vitest running with one real test
- [x] `infra/docker-compose.yml` with PostgreSQL and Redis
- [x] `.env.example` and `.gitignore`
- [x] `pnpm install` / `typecheck` / `lint` / `test` all green

### Phase 1 — Walking skeleton — DONE

Goal: one player can open the site and walk on a tiny map, with the server in
charge.

- [x] `packages/protocol`: message types + zod schemas
- [x] `apps/world`: ws server, 10 Hz tick, positions in memory
- [x] `apps/client`: Phaser scene drawing a tile map, WASD + click to move
- [x] Client sends intents only; server sends corrections
- [x] Playwright test: page loads, character moves

### Phase 2 — Accounts — DONE

- [x] `apps/api` (Fastify) with health route
- [x] `packages/db`: Drizzle schema + migrations for accounts
- [x] Sign up / log in, argon2id passwords, 18+ age gate
- [x] Redis sessions, HttpOnly cookies
- [x] Short-lived WebSocket ticket
- [x] Character created on first login, position saved on logout

### Phase 3 — The city — DONE

- [x] Chunked map format (32x32 tiles) and a map loader
- [x] Original hand-made starter district — 128x128 tiles, walled, with a
      square, a market, a park and a lake, and two streets of houses
- [x] Chunk streaming and interest management: a player is sent only the
      chunks they can see, and is told when to forget one
- [x] Collision from the map, server-side validation
- [x] A test walks the whole city and fails if any tile is unreachable

### Phase 4 — Talking

- [ ] Local chat with a radius, delivered by the world server
- [ ] Rate limiting, mute, block, report
- [ ] Chat bubbles in the client
- [ ] Moderation audit log

### Phase 5 — Items and the ledger

- [ ] `packages/economy`: money type, double-entry ledger, idempotency
- [ ] Item definitions and item instances
- [ ] Inventory UI
- [ ] Conservation tests (money and items can never be created or lost)

### Phase 6 — Trading

- [ ] Escrow-based trade, both sides confirm
- [ ] One transaction for the whole swap, full rollback on failure
- [ ] Trade UI

### Phase 7 — Houses

- [ ] House interiors, one per player
- [ ] Place and rotate furniture (moves the instance, never copies)
- [ ] Access control: nobody / friends / everyone

### Phase 8 — Mobile and polish

- [ ] Landscape layout, touch controls, pinch zoom
- [ ] Performance pass: 60 fps on a mid-range phone
- [ ] Accessibility pass on the UI

### Phase 9 — Production

- [ ] Caddy reverse proxy + TLS for atheriam.online
- [ ] Deployment, backups, log collection
- [ ] Load test with many simulated players

---

## How to run the project (for the owner)

Open a terminal in the project folder and run these, in order.

1. Install the tools the project needs:
   ```
   pnpm install
   ```
2. Start the database and cache (needs Docker running):
   ```
   docker compose -f infra/docker-compose.yml up -d
   ```
3. Start the game in development mode:
   ```
   pnpm dev
   ```
4. To check the code is healthy:
   ```
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
5. To check the parts that need a real database:
   ```
   pnpm test:integration
   ```
6. To test it in a real browser (slower, needs the browser downloaded once
   with `pnpm exec playwright install chromium`):
   ```
   pnpm test:e2e
   ```

## Trying the game right now

Phase 3 is playable: real accounts, and a real city to walk around.

First, once:

```
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
```

Then start all three parts at once:

```
pnpm dev
```

Open http://localhost:5173, choose **Create an account**, and fill in the
form. You need to be 18 or over. Open a second browser window and make a
second account to see two people in the same place.

Click a tile to walk there, or use WASD. On a phone, tap a tile and pinch to
zoom. Your position is saved when you log out, so you come back where you left.

You start on the Crown Square, by the well. North-west is the park and its
lake, north-east the market, and south of the square are two streets of houses
you can walk into. There is no chat yet — that is Phase 4.

### Making yourself a moderator

```
SEED_MODERATOR_EMAIL=you@example.com \
SEED_MODERATOR_PASSWORD='a long password you chose' \
SEED_MODERATOR_NAME=Aldric \
SEED_MODERATOR_DOB=1990-05-04 \
pnpm db:seed
```
