# Atheriam — Progress

This file says **where the project is right now** and **what happens next**.
We work on **one phase at a time**. A phase is only "done" when every box in it
is ticked and `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass.

Last updated: 2026-09-13

---

## Current phase

**Fractional-zoom terrain seam fix — published 2026-09-13 (`c878a0f`).**
An extruded terrain atlas prevents neighbouring-texture colour bleed. The
Canvas ground renderer joins adjacent rectangles on shared screen-pixel edges
to avoid fractional-rectangle antialiasing gaps. See D-082. Typecheck, lint and
350 unit tests passed. A dedicated real-engine browser regression passed both
Canvas and WebGL across seven zoom levels and two camera positions, including
four chunk boundaries. All 12 in-game browser checks passed across desktop
and mobile profiles, including houses, five public venues and wide zoom.
City and mobile lounge screenshots were inspected. The production client build
passed and was published. All six focused live checks passed (46 seconds),
covering wide zoom, chat controls and lounge reservations in both profiles.
Six smoke accounts and two test reservations were removed. The client matches
the build and HTTPS health answers. The previous client is backed up at
`/var/backups/atheriam/terrain-seams-20260913T003511Z.tar.gz`.

**Viewport terrain and movement improvement — published 2026-09-13, 00:15 UTC (`fae4053`).**
Protocol v13 streams terrain for the actual camera, including zoom, window size
and facade margins. Nearby chunks draw first, independent art loads concurrently,
and movement easing/walk frames are consistent with elapsed time and travel.
The reproduced wide-screen ground gap fell from 27.67% to 0% sampled unknown
terrain. Typecheck, lint, 350 unit tests, 174 integration tests and 55 browser
cases passed (one intentional mobile keyboard skip). See D-081 and
[BROWSER_GAME_PERFORMANCE.md](BROWSER_GAME_PERFORMANCE.md). The full production
build passed, API/world/client were published together, and all 22 live browser
cases passed, including the wide zoom regression in both profiles. The 20 smoke
accounts and their two reservations were removed; HTTPS health and published
client/build equality were checked. Pre-release database and client backups are
in `/var/backups/atheriam/map-view-20260913T000914Z/`.

**Chat keyboard hotfix — published 2026-09-12, 23:37 UTC (`e107faf`).**
WASD now types normally in fields. Enter opens/focuses chat; the next Enter sends
nonempty text and folds it, restoring character controls. Empty Enter just
closes; Escape closes without sending. Repeated Enter and IME confirmation are
ignored. Focus is restored correctly when reopening the folded input. See D-080.

The regression reproduced the old capture bug with real keys: `wasd WASD`
became only a space. The ten existing chat browser cases passed. The two new
desktop/mobile cases initially caught a test comparison mixing innerText with
textContent; using innerText consistently fixed that assertion. Both then passed
on the same built client, including typing/cursor editing, no movement while
typing, message delivery, empty close, reopen, Escape and resumed WASD movement.
Typecheck, lint, all 341 unit tests and the production client build passed.

The frontend was backed up to
`/var/backups/atheriam/chat-controls-20260912T233659Z.tar.gz`, published and checked
against the build. Both focused **live** keyboard checks passed (15.6 seconds),
and HTTPS health answers. The two smoke accounts were removed. No database
migration or backend restart was needed. The earlier full release record follows.

**Contemporary city release — PUBLISHED AND VERIFIED.** Live at
https://atheriam.online, with game entry at https://atheriam.online/play/.
The 160 × 160 city contains a central square, park, ten saleable commercial
properties and five municipal buildings. Residents can configure/decorate their
businesses, sell inventory items for Crowns, and reserve invite-only lounge rooms.
The public website, modern pixel residents, walk/wave/sit animation and responsive
game interface are published.

Final evidence: 341 unit tests, 174 integration tests, a full browser regression
with the four failing scenarios corrected/rechecked in a 14-pass run, and **18
passing live checks**. Two mobile keyboard cases are intentionally inapplicable.
Typecheck, lint and production build passed. Backup restoration and post-migration
comparison verified existing accounts, items and ledger records. Services are
active and published files match the build. All phase commits are pushed on
`feat/contemporary-city-v1`; see [CONTEMPORARY_CITY_PLAN.md](CONTEMPORARY_CITY_PLAN.md)
for the acceptance matrix, actual run history, backup location and limitations.

Next: community playtest and physical-phone performance checks. The earlier
production baseline below is retained as history, not current release evidence.

## Previous production baseline

**V1.0 visual redesign — PUBLISHED AND VERIFIED.** The redesigned game is live at
https://atheriam.online: accounts, a city, chat and moderation, money and
items, trading, and a house each.

The redesign adds six persistent resident looks with directional walk cycles,
original town and furniture art, detailed terrain, a new login and registration
screen, and a responsive HUD with touch movement. Asset processing happens
before release, keeping large source images out of the gameplay loading path.

Typecheck and lint pass. There are 275 passing unit tests, 109 passing integration
tests and 66 passing browser scenarios, run in groups (two device-specific cases
are intentionally skipped on the other device). This includes appearance
persistence and observation by another player, desktop and touch movement,
chat, safety controls, inventory, trading, houses and portrait/tablet resizing.
`pnpm build` also completed successfully. The production client is ready in
`apps/client/dist`; reviewed screenshots are retained under `docs/design`.

Published on 2026-09-12 at 04:32 UTC with the standard `scripts/deploy.sh`
workflow, including dependency verification, typecheck, lint, all 275 unit tests
and production build. Migration 0005 adds the saved appearance with default zero.
The API, world and Caddy services are active.

All **16 live browser checks passed** against https://atheriam.online, including
HTTPS, registration, movement, chat, houses, trading, saved appearance after a
reload and portrait touch controls. Reviewed live screenshots are in
`docs/design/live-*.png`. The published directory matches `apps/client/dist`;
HTTPS checks confirmed the new entry script and art are the built files.
The 14 temporary Smoke accounts were removed after validation.

The pre-release database backup is
`/var/backups/atheriam/atheriam-2026-09-12-0430.sql.gz`.

Real-phone performance (Q-001) and a community playtest remain follow-up
validation; browser emulation cannot answer those questions.

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

### Phase 6 — Trading — DONE

- [x] Escrow-based trade: everything offered leaves its owner at once
- [x] Both sides confirm, and any change takes both agreements away
- [x] One transaction for the whole swap, inside the second confirmation, so
      there is no moment where both have agreed and nothing has happened
- [x] Everything comes back on cancel, on logout, or after ten idle minutes
- [x] A trade window that shows both sides and who has agreed
- [x] Tests that try the oldest trick there is — agree, then swap the good
      item — and fail if it works

### Phase 7 — Houses — DONE

- [x] House interiors, one per player, made the first time they ask
- [x] Each house is its own world: its own crowd, and chat that does not carry
      out into the street
- [x] Place, turn and pick up furniture — which moves the item instance and
      never copies it, proven by a test that moves one stool twenty times
- [x] Access: nobody, the people you have welcomed, or anybody

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

## Forgetting your password

The login form has **I have forgotten my password**. The player types their
address, the server emails a link, and the link lets them choose a new one. It
works once and lasts an hour, and using it logs out every device that was
signed in to that account.

This needs a mailbox to send from. On the live server the settings are in
`/etc/atheriam/atheriam.env`:

```
SMTP_HOST=smtp.ionos.co.uk
SMTP_PORT=465
SMTP_USER=support@bolla.network
SMTP_PASSWORD=…            (never written down anywhere else)
MAIL_FROM=Atheriam <support@bolla.network>
```

To put the password in without it appearing on screen or in any history:

```
read -rsp "Password: " P && echo && \
  echo "SMTP_PASSWORD=$P" | sudo tee -a /etc/atheriam/atheriam.env >/dev/null && \
  unset P && sudo systemctl restart atheriam-api
```

Until that is set, asking for a link answers "Password reset is not set up on
this server yet" — which is honest, and better than a message that never
arrives.

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

To **trade**, click somebody's name in the chat and choose _Offer to trade_.
Everything either of you puts on the table leaves your hands straight away,
and comes back if the trade is called off. Nothing is swapped until you both
agree — and if either of you changes anything, you both have to agree again.

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

`pnpm test:live` also leaves a few throwaway accounts behind, called
`Smoke…`; `scripts/remove-smoke-accounts.sh` removes those.

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
