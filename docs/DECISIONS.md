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
