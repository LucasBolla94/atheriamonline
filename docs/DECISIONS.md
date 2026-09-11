# Atheriam — Decisions

Decisions taken **without asking the owner**, so they are not silently lost.
Each one says what was chosen, why, and what it would cost to change later.

---

## D-001 — Tile size is 32x32 pixels

**Date:** 2026-09-11
**Decision:** One tile is 32 by 32 pixels at 1x zoom.
**Why:** It is the common size for top-down 2D, gives good detail on desktop and
stays readable on a phone in landscape, and keeps the maths simple.
**Cost to change:** Medium. All art would have to be redrawn or rescaled.

## D-002 — Chunks are 32x32 tiles

**Date:** 2026-09-11
**Decision:** The map is streamed in blocks of 32 by 32 tiles (1024 x 1024 px).
**Why:** Small enough to load fast, large enough that a player rarely crosses
more than one boundary per second.
**Cost to change:** Low, as long as it is changed before any map is drawn.

## D-003 — Simulation tick is 10 Hz

**Date:** 2026-09-11
**Decision:** The world server advances the simulation every 100 ms.
**Why:** A social walking game does not need a fighting game's precision. 10 Hz
keeps bandwidth and CPU low while still feeling smooth once the client smooths
movement between ticks.
**Cost to change:** Low. It is one constant.

## D-004 — Passwords use argon2id

**Date:** 2026-09-11
**Decision:** Password hashing is argon2id, not bcrypt.
**Why:** It is the current recommendation and resists GPU attacks better.
**Cost to change:** Medium. Old hashes would have to be upgraded on next login.

## D-005 — The currency is the "Crown", 100 minor units to 1

**Date:** 2026-09-11
**Decision:** One in-game currency, stored as BIGINT in hundredths.
**Why:** One currency keeps the economy understandable. Integer minor units make
rounding errors impossible.
**Cost to change:** High once players hold money.

## D-006 — Two servers: `world` and `api`

**Date:** 2026-09-11
**Decision:** Live play (movement, chat) runs in a separate process from durable
operations (accounts, money, items).
**Why:** They have opposite needs. The world server must never block on the
database; the api server must always be transactional. Splitting them also lets
us run many world servers later.
**Cost to change:** High. It shapes the whole codebase, which is why it is
decided now.

## D-007 — pnpm is installed for the current user only

**Date:** 2026-09-11
**Decision:** On this machine pnpm was installed with `npm i -g pnpm` using a
user-level prefix (`~/.npm-global`), because `corepack enable` needs root.
**Why:** Avoids needing administrator rights to work on the project.
**Cost to change:** None. It is a machine setup detail, not a project decision.

## D-008 — Development scripts run through `tsx`

**Date:** 2026-09-11
**Decision:** `pnpm dev` runs the servers with `tsx watch`, not with
`node --experimental-strip-types`.
**Why:** The Node build installed on this machine is not compiled with
TypeScript support, so Node cannot run a `.ts` file directly. `tsx` works on
every Node build and also gives us reliable file watching.
**Cost to change:** None. Production still runs plain compiled JavaScript from
`dist/`, so `tsx` is a development-only tool.

## D-009 — TypeScript project references, one build per package

**Date:** 2026-09-11
**Decision:** Each package and app has its own `tsconfig.json` that extends
`tsconfig.base.json`, and the root `tsconfig.json` only lists references.
`pnpm typecheck` runs `tsc --build`.
**Why:** It makes the dependency direction explicit (an app may depend on a
package, never the other way round), and it means a change in one package only
rebuilds what actually depends on it.
**Cost to change:** Low.

## D-010 — Extra-strict TypeScript settings

**Date:** 2026-09-11
**Decision:** On top of `strict`, we enable `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnusedLocals`,
`noUnusedParameters` and `verbatimModuleSyntax`.
**Why:** These catch exactly the kind of bug that is expensive in a game with an
economy: an array lookup that is actually undefined, an optional field that is
silently set to undefined, a function that forgets to return on one path.
**Cost to change:** Low now, high later. Turning them on after the code exists
means fixing hundreds of errors at once, which is why they are on from day one.

## D-011 — Phase 1 draws flat colours, not artwork

**Date:** 2026-09-11
**Decision:** The world is drawn with coloured rectangles from the design
tokens. No image file exists in the repository yet.
**Why:** It proves the game loop works before any art exists, and it means no
asset can enter the project before `docs/ASSETS.md` can record its licence.
**Cost to change:** None. The tile colours are already named `tileGrass`,
`tileRoad` and so on, so artwork replaces them without renaming anything.

## D-012 — The client asks "I want to be there", not "here is my route"

**Date:** 2026-09-11
**Decision:** Clicking a tile sends the destination. The server finds the path
and walks it one tile per tick.
**Why:** If the client sent a route, a modified client could send a route
through a wall. Asking only for a destination means there is nothing to cheat
with: the server is the only thing that has ever seen a path.
**Cost to change:** Low, but there is no reason to.

## D-013 — Design tokens exist twice, and a test keeps them honest

**Date:** 2026-09-11
**Decision:** Colours and sizes live in `tokens.css` for React and in
`tokens.ts` for Phaser, and `tokens.test.ts` fails if the two disagree.
**Why:** Phaser needs numbers and CSS needs strings, so one copy is not
possible. Two copies that drift apart is how the interface slowly stops
matching the game, and nobody notices until a screenshot looks wrong.
**Cost to change:** Low.

## D-014 — The client limits its own sending rate

**Date:** 2026-09-11
**Decision:** The browser sends at most 15 intents per second; the server
disconnects anyone above 40.
**Why:** The gap is deliberate. A stuck key or a fast-clicking player should
never be mistaken for an attack and kicked out of the game.
**Cost to change:** None. Both numbers are constants.

## D-015 — Phaser starts only once its container is visible

**Date:** 2026-09-11
**Decision:** The game is created in an effect that waits for the stage to be
on screen, not in the "welcome" handler.
**Why:** Phaser measures its parent when it starts. A hidden parent measures
zero, and the result is a 0x0 canvas that never recovers — the game simply
looks broken. This was a real bug, found by the browser tests.
**Cost to change:** None.

## D-016 — Docker is installed on this machine

**Date:** 2026-09-11
**Decision:** Docker and the Compose plugin were installed from Ubuntu's own
package repositories, and PostgreSQL 17 and Redis 7 now run as containers.
**Why:** Phase 2 needs a database, and this answered the question that was
open as Q-001. Using Ubuntu's packages rather than an added third-party
repository keeps the machine's updates in one place.
**Cost to change:** None. The compose file works with any Docker.

## D-017 — Accounts hold one character, and the database enforces it

**Date:** 2026-09-11
**Decision:** `characters.account_id` carries a unique index, so an account
cannot have two characters.
**Why:** It makes today's rules explicit rather than assumed, and dropping that
one index is the whole change needed if we ever allow more.
**Cost to change:** Low, by design.

## D-018 — Uniqueness is the database's job, not the code's

**Date:** 2026-09-11
**Decision:** Registration inserts and catches the unique-violation error,
rather than checking whether a name is free and then inserting it.
**Why:** Two people can register the same name in the same millisecond. A
check-then-insert lets both look, both see the name free, and both write. Only
the unique index sees both. There is a test for exactly this race.
**Cost to change:** None.

## D-019 — The WebSocket is opened with a ticket, never with the session cookie

**Date:** 2026-09-11
**Decision:** A logged-in player asks the API for a ticket, which lasts thirty
seconds and works once. The world server spends the ticket to learn who is
connecting.
**Why:** A WebSocket handshake does not get the protections a normal request
gets, and a long-lived session cookie used as a game credential is a large
thing to lose. A ticket that dies in half a minute is a small one. Spending it
is a single Redis command that reads and deletes at once, so two connections
racing on a stolen ticket cannot both win.
**Cost to change:** Medium — it is part of the protocol (version 2).

## D-020 — Two rate limits, not one

**Date:** 2026-09-11
**Decision:** Logging in and registering allow 10 requests a minute per IP
address. Everything else allows 300.
**Why:** A single limit has to be wrong in one direction or the other. A
household, an office or a mobile network puts many real players behind one
address, so a limit tight enough to stop password guessing locks out real
people. Splitting them lets the guessable routes be strict and the rest be
generous. The browser tests exposed this: they all come from one address, and
a single tight limit stopped the suite rather than an attacker.
**Cost to change:** None. Both are settings.

## D-021 — Unit tests and integration tests are separate commands

**Date:** 2026-09-11
**Decision:** `pnpm test` runs everything that needs nothing installed.
`pnpm test:integration` runs the tests that need a real PostgreSQL and Redis.
**Why:** The unit tests must stay instant and runnable anywhere. The things
only a real database can prove — a unique index catching a race, a transaction
rolling back, a ticket that works once — are worth a slower, separate command
rather than a fake that would prove nothing.
**Cost to change:** None.

## D-022 — The seed script has no default password

**Date:** 2026-09-11
**Decision:** `pnpm db:seed` does nothing unless told who the moderator is,
and it never changes an account that already exists.
**Why:** A seed script with a built-in password is a way in that nobody
remembers leaving open.
**Cost to change:** None.

## D-023 — One tile is one character, and the alphabet is shared

**Date:** 2026-09-11
**Decision:** A map is rows of text, one character per tile. What each
character means — grass, wall, water, a doorway — is defined once, in
`packages/shared/src/terrain.ts`, and read by the world server and the browser
alike. A character nobody recognises is treated as solid.
**Why:** The server decides what may be walked on and the client decides what
colour to paint; if those two lists ever disagreed, a player would see a floor
and be stopped by a wall. Having one table makes that disagreement impossible.
Treating the unknown as solid means a typo in a map blocks a tile instead of
quietly opening a hole in the city wall.
**Cost to change:** Low. Adding a kind of ground is one line in one table.

## D-024 — The starter district is drawn by code, not stored as a picture

**Date:** 2026-09-11
**Decision:** `apps/world/src/city.ts` draws the city with named functions —
walls, streets, the square, the market, the homes — and always produces exactly
the same tiles. There is no map file and nothing random.
**Why:** A 128-line wall of text cannot be reviewed or edited: widening a street
means counting characters on 128 rows. As code, a street is one line with a
name. "Always the same tiles" matters because two servers must build the same
city, and because the tests check the real map, not a sample of it.
**Cost to change:** Low now, higher once the city is large enough to want a map
editor — at which point this becomes the loader for whatever that editor saves.

## D-025 — The client is only ever given the ground it is standing near

**Date:** 2026-09-11
**Decision:** The world server streams the 32x32 chunks within the player's view
radius plus a margin, and sends an explicit "forget this one" when a player
walks away. The map is never sent whole.
**Why:** Three reasons, in order of importance. A modified client cannot read a
map it was never sent, so the city cannot be scraped by standing in the square.
Bandwidth then depends on how far a player can see, not on how big the world
is, so the city can grow without the traffic growing. And the margin is what
stops a chunk being sent, dropped and sent again while somebody paces across a
boundary.
**Cost to change:** Low. It is one function, `syncChunks`, and two messages.

## D-026 — The starter district is 128x128 tiles

**Date:** 2026-09-11
**Decision:** The city is four chunks by four chunks: 128 by 128 tiles, walled
on all four sides.
**Why:** It is the working assumption already written against Q-003, and it is
big enough that a player crosses several chunk boundaries walking across it —
which is what makes the streaming real rather than theoretical. It is small
enough that the whole map can be checked, tile by tile, in a millisecond.
**Cost to change:** Low. The city is drawn from one constant, and nothing in
the client or the protocol knows how big the world is until the server says so.

## D-027 — Every walkable tile must be reachable, and a test proves it

**Date:** 2026-09-11
**Decision:** A test floods the whole city from the spawn point and fails if a
single tile somebody could stand on cannot be walked to — using the same
diagonal rule the server enforces.
**Why:** A street drawn one tile short, a house with its door inside a wall, a
lake that swallows a road: all of them look fine on screen and are only found
by walking the entire city. A machine can do that in a millisecond, on every
change, forever.
**Cost to change:** None. It is a test.
