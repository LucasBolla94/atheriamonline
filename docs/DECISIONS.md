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
