# Atheriam — Specification (Source of Truth)

This file is the source of truth for the project. If anything in the code or in
another document disagrees with this file, **this file wins**. Any change to the
product must be written here first.

Last updated: 2026-09-12

---

## 1. What we are building

Atheriam is a **browser-based multiplayer social world**.

- Setting: an **original medieval kingdom-city**. Everything (names, map, art,
  lore) is invented for this project.
- View: **top-down 2D**, drawn on a **tile grid**.
- World: **continuous and open**. There are no separate "rooms" that players
  load into. The city is one connected space, streamed in pieces as you walk.
- Players: **adults, 18+ only**.
- Language of the product: **English** (all in-game text and UI).
- Devices: **desktop browsers** and **mobile browsers in landscape**.
- Public address: **atheriam.online**

The heart of the game is **being around other people**: walking the city,
talking, decorating your own house, trading items, and taking part in the
player-run economy. It is a social world first, not a combat game.

## 2. What we are NOT building

These are hard limits. They are not opinions, they are rules.

- **No blockchain, no crypto, no wallets, no private keys on the server.**
  The in-game currency is a normal database number and nothing else.
- **No copying other games.** We never use, trace, re-draw, rename or "get
  inspired by" the assets, names, maps, item lists or room layouts of Habbo,
  Tibia, or any other commercial game.
- **No assets with an unknown or NonCommercial licence.** If we cannot point to
  a clear licence that allows commercial use, we do not ship the file. See
  section 12.
- **No gambling with real money**, no loot boxes sold for money.
- **No minors.** The product is 18+ and is presented that way.

## 3. Core rules that every feature must obey

These are the non-negotiables. They are repeated in `CLAUDE.md` because they
are easy to break by accident.

### 3.1 The server decides everything

The server is **authoritative**. The browser never decides what happened.

- The client sends **intents** only: "I want to walk to tile (12, 40)",
  "I want to say this", "I want to give this item to that player".
- The server validates the intent, applies it, and sends back the new state.
- If the client and the server disagree, the server is right and the client
  snaps to the server's version.
- We assume every client is hostile and modified. Nothing is trusted because
  "the client already checked it".

### 3.2 Movement lives in memory, not in the database

Player positions change many times per second. Writing that to PostgreSQL would
destroy the database.

- The **world server** keeps live positions in **process memory**.
- We **never** write a row per movement step.
- Positions are saved to the database only on meaningful events: logout,
  disconnect, and a slow periodic snapshot (see section 7).

### 3.3 Money is a double-entry ledger

The economy must be auditable and must never lose or invent money.

- Every amount is stored as **BIGINT in minor units** (like cents). There is
  **no floating point anywhere** in the economy.
- Every movement of money is **two ledger rows**: one debit and one credit,
  which sum to zero.
- Each economic operation happens in **exactly one database transaction**.
- Every economic request carries an **idempotency key**. Replaying the same key
  returns the original result and does not move money twice.
- A balance is derived from the ledger, not edited directly.

### 3.4 An item exists in exactly one place

- An item instance is in **one** of: a player's inventory, a house, or a trade
  escrow. Never two at once.
- We **never copy an item** to move it. We move the owning reference inside one
  transaction.
- Duplication bugs are treated as the most serious class of bug.

### 3.5 UI is only UI

- All React UI lives in `apps/client/src/ui`.
- UI is styled **only through design tokens**. No hardcoded colours, spacing or
  fonts in components.
- **No gameplay logic in UI components.** The UI reads state and sends intents.

### 3.6 Security and honesty

- **Never commit secrets.** Secrets come from environment variables.
- **Never weaken a test, a type, or a security check to make something pass.**
  If a check fails, either the code is wrong or the check is wrong, and we fix
  the real one.

## 4. Technology

| Layer                          | Choice                               |
| ------------------------------ | ------------------------------------ |
| Language                       | TypeScript, `strict` mode everywhere |
| Repo                           | pnpm workspaces (monorepo)           |
| Game rendering                 | Phaser                               |
| Client build                   | Vite                                 |
| Client UI                      | React                                |
| Server runtime                 | Node.js LTS                          |
| Realtime                       | `ws` (raw WebSocket)                 |
| HTTP API                       | Fastify                              |
| Database                       | PostgreSQL                           |
| DB access                      | Drizzle ORM                          |
| Cache / sessions / presence    | Redis                                |
| Validation                     | zod                                  |
| Unit + integration tests       | Vitest                               |
| Browser tests                  | Playwright                           |
| Local infrastructure           | Docker Compose                       |
| Production reverse proxy + TLS | Caddy                                |

## 5. Repository layout

```
atheriam/
  apps/
    client/            Phaser + Vite + React browser game
      src/
        game/          Phaser scenes, rendering, input
        net/           WebSocket client, intent sending
        ui/            React UI (ONLY place for UI)
        tokens/        Design tokens (colours, spacing, type)
    world/             Authoritative world server (ws) — positions in memory
    api/               Fastify HTTP API — auth, economy, items, admin
  packages/
    protocol/          Shared message types + zod schemas (client <-> server)
    db/                Drizzle schema, migrations, seed
    economy/           Ledger logic, money type, idempotency
    shared/            Small pure helpers shared by everything
  infra/
    docker-compose.yml Postgres + Redis for local development
    caddy/             Caddyfile for production
  docs/
    SPEC.md            This file — source of truth
    PROGRESS.md        Current phase and next steps
    DECISIONS.md       Decisions made without asking the owner
    OPEN_QUESTIONS.md  Questions waiting for the owner
```

## 6. How the pieces talk

```
Browser (Phaser + React)
   |  HTTPS  -> api    (Fastify): login, profile, economy, items
   |  WSS    -> world  (ws):      movement, chat, presence
                 |
                 +-- Redis:    sessions, presence, pub/sub between servers
                 +-- Postgres: durable truth (accounts, items, ledger, houses)
```

- The **api** server owns anything that must be durable and transactional.
- The **world** server owns anything that is live and fast (position, who is
  near whom, chat delivery).
- The two never write the same table for the same reason. When the world server
  needs a durable change, it asks the api server.

## 7. The world model

- The world is a grid of **tiles**. One tile is the unit of position.
- Tile size: **32 x 32 pixels** at 1x zoom.
- Coordinates are integers `(x, y)`. There is no free-floating position; a
  player is always on a tile or interpolating between two tiles for display.
- The world is divided into **chunks** of **32 x 32 tiles**. The client loads
  the chunks around the player and unloads the rest.
- **Interest management**: a player receives updates only about other players
  inside their view radius plus a margin.
- **Tick rate**: the world server runs a fixed simulation tick of **10 Hz**
  (every 100 ms). Movement is resolved on ticks.
- **Snapshots**: player position is persisted to Postgres on logout, on
  disconnect, and by a background job every **60 seconds** for online players.

Movement rules:

- A player may move one tile per step, in 8 directions.
- The server checks: is the target tile walkable, is it adjacent, has enough
  time passed since the last step (speed limit).
- Rejected intents produce a correction message; the client snaps back.

## 8. Accounts and safety

- Sign up with email + password. Passwords hashed with **argon2id**.
- **Age gate**: the account holder must confirm they are 18+ at sign-up, and the
  date of birth is stored. Under 18 cannot create an account.
- Sessions are opaque tokens stored in Redis, sent as `HttpOnly`, `Secure`,
  `SameSite=Lax` cookies.
- A forgotten password is recovered by **email**: the player asks for a link,
  the server sends one that works **once** and expires in **an hour**, and
  only a hash of its token is ever stored. The answer to "I have forgotten my
  password" is identical whether or not the address has an account, so the
  route cannot be used to ask who plays. Changing a password **ends every
  session** on that account, because somebody resetting a password may be
  doing it precisely to remove another person.
- The WebSocket connection is authenticated with a short-lived ticket issued by
  the api server; the raw session cookie is never used as a WS credential.
- Every player can **block** and **report** another player. Reports are stored
  and visible to moderators.
- Moderators can mute, kick and ban. Every moderation action is written to an
  audit log with the actor, the target, the reason and the time.
- Chat is rate-limited server-side.

## 9. The economy

**Currency:** one in-game currency called the **Crown**.
Stored as BIGINT minor units; 1 Crown = 100 minor units. Displayed as `1.00 c`.

**Accounts (ledger accounts, not player accounts):**

- `player:<id>` — a player's purse
- `system:mint` — where new money is created (a negative-going account)
- `system:sink` — where money is destroyed (fees, taxes)
- `escrow:trade:<id>` — money held during a trade

**Rules:**

- Every transfer writes two rows summing to zero, in one transaction, with an
  idempotency key.
- A player's balance = sum of their ledger rows. We may keep a cached balance,
  but the ledger is the truth and a job re-checks the cache.
- Money can only be created in `system:mint` and only by a named, audited
  operation (for example: a daily login reward).

**Items:**

- An **item definition** describes a kind of thing (name, art, stack rules).
- An **item instance** is one real object owned by exactly one holder.
- Trading is **escrow-based**: both players put items and money into the trade,
  both confirm, and the swap happens in a single transaction. If anything fails,
  everything returns to the owners.

## 10. Houses

- Every player may own one **house**: a private, owned interior space.
- A house has a floor plan of tiles and a list of placed item instances with a
  tile position and a rotation.
- Placing furniture moves the item instance from inventory to the house. It is
  still exactly one instance.
- The owner controls who may enter: nobody, friends, or everyone.

## 11. Client and controls

### V1.0 visual direction (2026-09-12)

The owner has requested a complete, playable pixel-art redesign. Use original,
simple animated residents, a warm sandstone/terracotta/green city, illustrated
login and registration, and a consistent mobile interface. Studying general
social-game design principles is allowed; production art must be original or
appropriately licensed, never copied from a commercial game. This clarifies
the inspiration wording in section 2 without allowing copied assets.

Residents have a saved choice of curated appearances, visible to everyone.
Walk cycles use four drawn directions for the existing eight-direction movement.
Art does not change movement authority, collision, money or item ownership.
Terrain is rendered from a shared detailed pixel atlas; upright objects and
characters are ordered by their ground position. Menus, chat and touch movement
must remain usable on mobile, including during viewport resizing.

- Desktop: click a tile to walk there; WASD / arrow keys to step; Enter to chat.
- Mobile (landscape): tap a tile to walk there; on-screen chat button; pinch to
  zoom within fixed limits.
- The client must stay playable at **60 fps** on a mid-range phone, and must
  never block the main thread for more than 16 ms in normal play.
- All UI text is in English and lives in a single strings file so it can be
  translated later.

## 12. Art and licences

- All art is either made for this project or taken from a source with a clear
  licence that allows **commercial use and modification** (for example CC0).
- Every asset is recorded in `docs/ASSETS.md` with: file, author, source URL,
  licence, and the date it was added.
- If a licence is unknown, or is NonCommercial, or forbids modification, the
  asset is **not used**. There are no exceptions and no "temporary" placeholders
  from unclear sources.

## 13. Quality gates

A change is only finished when all of these pass:

- `pnpm typecheck` — no TypeScript errors, `strict` on.
- `pnpm lint` — no lint errors.
- `pnpm test` — all Vitest tests pass.
- New behaviour has a test. Bug fixes have a test that fails before the fix.
- Economy and item-movement code additionally require a test that proves money
  and items are conserved.

## 14. Definitions

- **Intent** — a request from the client describing what the player wants.
- **Tick** — one step of the world simulation (100 ms).
- **Chunk** — a 32x32 block of tiles, the unit of map streaming.
- **Minor unit** — the smallest indivisible piece of currency (like a cent).
- **Idempotency key** — a unique string that makes a repeated request safe.
- **Escrow** — a temporary holding place during a trade.
