# Atheriam — Progress

This file says **where the project is right now** and **what happens next**.
We work on **one phase at a time**. A phase is only "done" when every box in it
is ticked and `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass.

Last updated: 2026-09-11

---

## Current phase

**Phase 5 — Items and the ledger** — done. **The game is live at
https://atheriam.online.**
Next up: **Phase 6 — Trading**, then **Phase 7 — Houses**.

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

### Phase 4 — Talking — DONE

- [x] Local chat with a radius (12 tiles), delivered by the world server
- [x] Rate limiting (a bucket of tokens), mute, block, report
- [x] Chat bubbles in the client, and a chat log you can scroll
- [x] Moderation audit log, written in the same transaction as the punishment
- [x] Moderator routes: mute, unmute, kick, ban, unban, and the report queue

### Phase 5 — Items and the ledger — DONE

- [x] `packages/economy`: money as bigint minor units, the double-entry
      ledger, and what makes repeating a request safe
- [x] Item definitions and item instances, with one holder each
- [x] Inventory and purse in the interface, opened from the readout
- [x] Money enters the world in two places only: a welcome purse and a daily
      reward, both minted and audited
- [x] Conservation tests: the whole ledger always sums to zero, five identical
      requests pay once, two payments racing from one purse leave it at zero
      and only one of them lands, and an item moved thirty times is still one
      item

### Phase 6 — Trading

- [ ] Escrow-based trade, both sides confirm
- [ ] One transaction for the whole swap, full rollback on failure
- [ ] Trade UI

### Phase 7 — Houses

- [ ] House interiors, one per player
- [ ] Place and rotate furniture (moves the instance, never copies)
- [ ] Access control: nobody / friends / everyone

### Phase 8 — Mobile and polish — DONE

- [x] Landscape layout, touch controls, pinch zoom
- [x] The sign-up form can be reached on a screen under 400 pixels tall
- [x] The chat folds away so it does not cover the city on a small screen
- [x] Safe-area insets, so nothing hides behind a notch
- [x] Performance pass: the ground is drawn once per chunk and at most one
      chunk per frame, and a browser test fails if anything blocks the main
      thread for a tenth of a second — but 60 fps on a real phone is still
      unmeasured here, see Q-001
- [x] Accessibility pass: every control reachable by keyboard (tested), touch
      targets at least 44 pixels, reduced motion respected, the chat log
      announced to a screen reader

### Phase 9 — Production — DONE

- [x] Caddy reverse proxy + TLS for atheriam.online, certificate from Let's
      Encrypt, renewed automatically
- [x] `scripts/deploy.sh`: one command, safe to run again, does everything
- [x] The two servers run as systemd services and come back after a reboot
- [x] The database and cache listen on 127.0.0.1 only, with a generated
      password, and the firewall allows only SSH, HTTP and HTTPS
- [x] A nightly backup of the database, keeping fourteen nights
- [x] Logs: the servers to journald, Caddy to /var/log/caddy, rolled at 20 MB
- [x] Load test with 150 simulated players, which found a real problem — see
      below — and then measured the fix
- [x] `pnpm test:live`: a browser smoke test against the real site

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

## The game is live

**https://atheriam.online** — on a computer or on a phone held sideways.

Everything below is about running it on your own machine. To put a change on
the live site, run `./scripts/deploy.sh` and then `pnpm test:live` to check it
worked.

## Trying the game on your own machine

Real accounts, a real city, and people to talk to.

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
you can walk into.

Press **Enter** to talk, or use the box in the bottom-left corner. Only people
within about twelve tiles hear you, so walk closer to join a conversation.

You start with **50 Crowns** and three things to your name. Click **Purse** in
the readout to see them, and to collect ten Crowns once a day.

Click somebody's name in the chat to **stop hearing them** (they are never
told) or to **report them** to a moderator.

### Making yourself a moderator

```
SEED_MODERATOR_EMAIL=you@example.com \
SEED_MODERATOR_PASSWORD='a long password you chose' \
SEED_MODERATOR_NAME=Aldric \
SEED_MODERATOR_DOB=1990-05-04 \
pnpm db:seed
```

### How many people can it hold?

Measured on this machine, with 150 pretend players walking around one square —
which is far worse than anything real, because real players spread out:

| What                            | Result         |
| ------------------------------- | -------------- |
| Players who got in              | 150 of 150     |
| Slowest time to get in          | 1.8 seconds    |
| Round trip, typical             | 3 ms           |
| Round trip, worst one in 20     | 34 ms          |
| Sent to each player             | 58 kB a second |
| Memory used by the world server | 61 MB          |

The city refuses player 201 with "The city is full right now" — see Q-006.

To run it yourself: `PLAYERS=150 node scripts/load-test.mjs`, then
`scripts/remove-load-test-accounts.sh` to tidy up after it.

### What a moderator can do

There is no moderator screen yet — these are web addresses the browser asks
for while you are logged in as a moderator. Each one needs a reason, and every
one of them is written down forever in the audit log.

| What                     | Where                          | What you send               |
| ------------------------ | ------------------------------ | --------------------------- |
| See the reports waiting  | `GET /api/moderation/reports`  | nothing                     |
| See what moderators did  | `GET /api/moderation/log`      | nothing                     |
| Stop somebody talking    | `POST /api/moderation/mute`    | `name`, `reason`, `minutes` |
| Let them talk again      | `POST /api/moderation/unmute`  | `name`, `reason`            |
| Throw them out for now   | `POST /api/moderation/kick`    | `name`, `reason`            |
| Ban the account          | `POST /api/moderation/ban`     | `name`, `reason`            |
| Lift a ban               | `POST /api/moderation/unban`   | `name`, `reason`            |
| Decide a report is empty | `POST /api/moderation/dismiss` | `reportId`, `reason`        |

A mute, a kick and a ban all take effect **immediately**, even for somebody who
is standing in the city at that moment.
