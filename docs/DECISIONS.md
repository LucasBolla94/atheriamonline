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

## D-028 — You can see further than you can hear

**Date:** 2026-09-11
**Decision:** Chat carries 12 tiles. A player can be seen at 24.
**Why:** If everybody heard everybody they could see, the square would be one
conversation that nobody can follow. A shorter radius means walking closer to
somebody is how you join their conversation, which is the whole point of a
social world that happens in a place.
**Cost to change:** None. It is one number in `@atheriam/shared`.

## D-029 — Chat is limited by a bucket of tokens, not by a delay

**Date:** 2026-09-11
**Decision:** A player holds five chat tokens and earns one back every two
seconds. Running out earns a refusal the client explains; it never disconnects
anybody.
**Why:** A flat "one message per second" makes ordinary conversation feel
broken — people really do type three short lines in a row — while barely
slowing a script down. A bucket allows the burst and stops the flood.
Disconnecting would punish a slow connection as if it were an attack.
**Cost to change:** None. Two numbers.

## D-030 — Blocking is one-way, silent, and enforced on the server

**Date:** 2026-09-11
**Decision:** Blocking somebody stops their words being **sent** to you. They
are never told. The world server filters at the point of delivery, so the
blocked person's remarks never reach the browser at all.
**Why:** Filtering in the browser would mean the words were still delivered,
and anybody running a modified client would still see them — which makes the
feature a decoration rather than a protection. Telling the blocked person is
how a block turns into an argument, and the person doing the blocking is the
one who needs protecting.
**Cost to change:** Low, but the server-side half is not negotiable.

## D-031 — A punishment and its audit entry are written together

**Date:** 2026-09-11
**Decision:** Every moderator action writes the change and a `moderation_log`
row in one database transaction. The log is append-only.
**Why:** A mute that is not in the log did not happen, and a log entry without
the mute is a lie. Writing them separately means that, one day, a crash
between the two leaves a player silenced with no record of who did it or why.
Moderation nobody can audit is moderation nobody should trust — including the
moderators, who need the record when they are accused of something.
**Cost to change:** High, and deliberately so.

## D-032 — The API tells the world server when something changes, over Redis

**Date:** 2026-09-11
**Decision:** The API publishes kick, mute and block commands to a Redis
channel that the world server listens on. The durable change is written to
PostgreSQL first; the message is a nudge, not the truth.
**Why:** A ban that only takes effect at next login takes effect precisely when
it matters least. Going through Redis keeps the two servers from calling each
other directly, which is what lets there be more than one world server later.
Because the database row is written first, losing the message costs promptness
and nothing else — so a moderator's action must never fail because a cache was
unavailable.
**Cost to change:** Low. One channel and three message shapes.

## D-033 — Moderator routes answer 404 to everybody else

**Date:** 2026-09-11
**Decision:** A request to `/api/moderation/*` from an account that is not a
moderator gets "not found", not "forbidden". Whether an account is a moderator
is read from the database on every request, never cached in the session.
**Why:** "You are not allowed here" also says "here is a door worth
attacking". Reading the badge every time means taking it away takes effect at
once, rather than whenever that person next logs in — which is the moment you
would most want it gone.
**Cost to change:** None.

## D-034 — The ground is drawn one chunk per frame

**Date:** 2026-09-11
**Decision:** Chunks that arrive are put in a queue, and the client draws at
most one of them per frame.
**Why:** Walking into a new part of the city can bring three or four chunks at
once, and each one is a thousand tiles painted into a texture. Doing them all
in one frame is a visible stutter — measured at nearly half a second in the
browser tests. Spread over four frames it is invisible, and by the time the
player has walked far enough to see the new ground, it is there.
**Cost to change:** None. It is a queue and a `shift()`.

## D-035 — Frame rate is not asserted in the browser tests; blocking is

**Date:** 2026-09-11
**Decision:** The browser tests do not measure frames per second. They measure
long tasks — any single piece of work holding the main thread — and only on
the phone-sized run.
**Why:** This machine has no GPU, so a headless browser rasterises in
software: a desktop-sized canvas costs about a tenth of a second per frame
whatever is drawn on it. A frame-rate test here would measure the software
rasteriser, pass or fail for reasons unrelated to the game, and teach us to
ignore it. Long tasks are honest: they catch work we do, which is the part we
control. The 60 fps target in `docs/SPEC.md` section 11 still stands and still
needs measuring on a real phone — that is written down in
`docs/OPEN_QUESTIONS.md` rather than pretended about here.
**Cost to change:** None.

## D-036 — The sign-up form scrolls, because a phone in landscape is short

**Date:** 2026-09-11
**Decision:** The screen behind the sign-up panel scrolls, even though the
body never does, and the panel sits at the top rather than centred on a short
screen.
**Why:** A phone held sideways is under 400 pixels tall and the create-account
form is taller than that. Without this the tick box and the button below it
cannot be reached at all, which is the same as the game not existing on a
phone. A browser test now fills the form and clicks the button at phone size,
so it cannot come back.
**Cost to change:** None.

## D-037 — A snapshot is a difference, not a picture

**Date:** 2026-09-11
**Decision:** A snapshot names only the people who have moved or just come
into view, plus the ids of people who have left it. Anybody not mentioned is
where the client already thinks they are. A tick in which nothing near a
player changed sends that player nothing at all.
**Why:** The load test measured it. A hundred and fifty players in one square
cost **144 kB a second each**, almost all of it repeating that people were
standing still. Sending differences halved that in the same pathological
test — and in an ordinary square, where most people are not moving, it costs
nothing at all. The worst round trip fell from 126 ms to 58 ms at the same
time, because the server was doing less work per tick.
**Cost to change:** Medium. It is the protocol, and the client now builds the
crowd up over time rather than replacing it.

## D-038 — Production runs as two systemd services behind Caddy

**Date:** 2026-09-11
**Decision:** The API and the world server run as ordinary systemd services on
the host, as the `ubuntu` user, listening on 127.0.0.1 only. Caddy is the one
thing the internet can reach. PostgreSQL and Redis stay in Docker, also on
127.0.0.1. `scripts/deploy.sh` sets all of it up and is safe to run again.
**Why:** Fewer moving parts than putting the servers in containers too, and
the failure modes are the ones a person already knows: `systemctl status`,
`journalctl -u`. The owner is not a developer, so one script that can be run
twice beats a runbook. The servers listen on the loopback because there is no
reason for anything else to reach them.
**Cost to change:** Low. The units are twenty lines each.

## D-039 — The database is not on the internet, and neither is anything else

**Date:** 2026-09-11
**Decision:** PostgreSQL and Redis publish to 127.0.0.1 rather than to every
address, the database password was replaced with a generated one, and the
firewall allows only SSH, HTTP and HTTPS.
**Why:** They were listening on 0.0.0.0 on a machine with a public IP, which
meant the whole internet could reach PostgreSQL — with the password from the
example settings file. That is the single worst thing that was true of this
project. It is fixed three ways at once because any one of them could be
undone by accident.
**Cost to change:** None, and it should not be changed.

## D-040 — Every night, the database is backed up; nothing else is

**Date:** 2026-09-11
**Decision:** A systemd timer dumps `atheriam_live` at 03:30 and keeps
fourteen nights in `/var/backups/atheriam`. A dump under a kilobyte is
reported as a failure.
**Why:** The code, the map and the client can all be built again from git.
Accounts, characters, blocks, reports and the moderation log cannot. Fourteen
nights is long enough that a problem noticed on a Monday can be undone back to
the Monday before. An empty backup is worse than no backup, because it looks
like one — hence the size check.
**Cost to change:** None. Two numbers in one script.

## D-041 — Money is a bigint from the database to the screen, and a string on the wire

**Date:** 2026-09-11
**Decision:** An amount is `bigint` minor units in the database, in the
servers, and in `@atheriam/economy`. Over HTTP it travels as a **string**, and
the browser shows it as text without ever turning it into a number.
**Why:** JSON has no integer type — every number in it is a double, and a
double cannot hold every value a `bigint` can. Sending money as a JSON number
would quietly round large amounts at the one point in the system where nobody
is looking. A string cannot be arithmetic'd by accident either, which is the
second reason: the browser has no business doing sums with money.
**Cost to change:** High, and there is no reason to.

## D-042 — Repeating a request is made safe by a unique index, not by a check

**Date:** 2026-09-11
**Decision:** Every movement of money carries an idempotency key, and that key
has a unique index on the `transfers` table. Asking twice writes once.
**Why:** A check in code — "have we done this already?" — is a race: two
requests can both look, both see nothing, and both pay. The database is the
only thing that can answer that question for two transactions at once. There
is a test that fires five identical requests at the same moment and checks the
purse afterwards.
**Cost to change:** None, and doing so would reintroduce the race.

## D-043 — A balance is summed from the ledger, under an advisory lock

**Date:** 2026-09-11
**Decision:** A balance is `SUM(amount)` over an account's rows. Before a
movement is written, the transaction takes a PostgreSQL advisory lock on each
account involved, in sorted order.
**Why:** A `balance` column would be faster and would be wrong eventually —
and wrong quietly, with nothing to compare it against. Summing means the
ledger is the only truth, and the books can always be checked. The lock is
what stops the same Crown being spent twice by two requests that both read the
balance before either wrote: sorted order is what stops two such transfers
deadlocking against each other.
**Cost to change:** Low. A cached balance can be added later as a cache, with
a job that checks it against the ledger — which is what `docs/SPEC.md` section
9 already describes.

## D-044 — An item's holder is one pair of columns, so two places cannot be expressed

**Date:** 2026-09-11
**Decision:** `item_instances` has one `holder_kind` and one `holder_id`.
Moving an item is an `UPDATE` whose `WHERE` clause names where it was.
**Why:** "An item is in exactly one place" is a rule in `docs/SPEC.md` section
3.4, and the cheapest way to keep a rule is to make breaking it
unrepresentable. There is no join table that could hold two rows, and no
insert anywhere that copies an instance. Naming the old holder in the `WHERE`
makes the check and the move a single statement, so two people cannot both
take the same item: the loser updates nothing and is told so.
**Cost to change:** High. It is the shape of the table and the reason to trust
it.

## D-045 — Money is created in exactly two places, and the welcome repairs itself

**Date:** 2026-09-11
**Decision:** New money comes only from a welcome purse (50 Crowns, once per
character) and a daily reward (10 Crowns, once per character per day), both
minted from `system:mint` with a key that says who and when. The welcome is
attempted again on every login.
**Why:** `docs/SPEC.md` section 9 allows money to be created only by a named,
audited operation, and the fewer of those there are the easier the economy is
to reason about. Retrying the welcome on login costs one indexed lookup and
means a gift that failed once is put right by the player simply coming back,
rather than by somebody noticing.
**Cost to change:** Low. They are two functions in `gifts.ts`.

## D-046 — The browser tests run on ports of their own

**Date:** 2026-09-11
**Decision:** The browser tests start the API on 3101, the world server on
3102 and the client on 5273, and the client is told where to find them.
**Why:** The live game runs on this same machine on 3001 and 3002. The tests
first refused to start because the port was taken — and the worse outcome was
the one that nearly happened instead: the browser tests quietly driving the
real servers and making test accounts in the real city.
**Cost to change:** None.

## D-047 — Everything on the trading table has already left its owner

**Date:** 2026-09-11
**Decision:** Offering an item moves it to the trade there and then; offering
money moves it into `escrow:trade:<id>` in the ledger there and then. Taking
an offer back, cancelling, or simply walking away moves it all back.
**Why:** It is the only way a swap can be safe. If offers were only intentions,
somebody could offer the same item to two people, or spend the money they had
promised, and one of the two trades would fail at the last moment. With escrow
the question "do they still have it?" cannot be asked, because they do not: it
is on the table.
**Cost to change:** High. It is the reason to trust a trade.

## D-048 — Any change takes both agreements away

**Date:** 2026-09-11
**Decision:** Adding or removing anything, by either side, sets both
confirmations back to false.
**Why:** This is the oldest trick there is: agree, then swap the good item for
a worthless one while the other person is reaching for the button. There is an
integration test that performs exactly that trick and a browser test that does
it in two real windows.
**Cost to change:** None, and it must not be.

## D-049 — The swap happens inside the second confirmation

**Date:** 2026-09-11
**Decision:** The whole swap — every item and both sides' money — happens in
the same database transaction as the second person's confirmation.
**Why:** Any other arrangement leaves a moment where both have agreed and
nothing has happened, and that moment is where a crash costs somebody their
things. In one transaction there is no such moment: either everybody has
swapped or nobody has, and a failure anywhere leaves both people holding
exactly what they started with.
**Cost to change:** High.

## D-050 — The API nudges; the browser asks

**Date:** 2026-09-11
**Decision:** When a trade changes, the API publishes a nudge that the world
server passes to the other player over their existing socket. The nudge
carries no detail: the browser then asks the API for the trade.
**Why:** Polling was the alternative, and at one request every second or two
per player it would have swamped both the rate limits and the server for
something that happens rarely. Sending the trade itself down the socket was
the other alternative, and it would have made the world server a second source
of truth about money — the two would eventually disagree, and the one holding
the money should win. A nudge has neither problem.
**Cost to change:** Low. The mechanism is general and is the obvious way to
tell a player about anything else that changes.

## D-051 — A trade nobody touches for ten minutes calls itself off

**Date:** 2026-09-11
**Decision:** A trade with no activity for ten minutes is cancelled, and
everything goes back. Logging out cancels any trade too.
**Why:** Somebody who closes the tab half way through would otherwise leave
both people unable to trade with anybody else, and their belongings on a table
nobody is sitting at. Ten minutes is longer than a real conversation about a
stool and shorter than anybody would wait.
**Cost to change:** None. It is one constant.

## D-052 — A house is its own world, not a corner of the city

**Date:** 2026-09-11
**Decision:** The world server keeps one `World` per place: the city, and the
inside of every house somebody is currently standing in. A house's world is
made when the first person walks in and forgotten when the last one leaves.
**Why:** Everything that already worked in the city — interest management,
chat radius, snapshots, the speed limit — works inside a house without a
single rule being written twice, because a house is the same kind of thing as
the city, only smaller. The alternative was a "room id" threaded through every
one of those rules, which is the same feature with more places to get it
wrong. An empty house costs nothing at all.
**Cost to change:** Medium, but there is no reason to.

## D-053 — Houses are entered from the interface, not through a door in the street

**Date:** 2026-09-11
**Decision:** "Go home" and "Call on them at home" are buttons. There is no
house door in the city that leads to a particular player's house.
**Why:** There are six houses drawn in the residential streets and there will
be thousands of players. Any mapping between the two would be a lie — either
most players' houses are unreachable, or the streets fill with doors nobody
can walk between. Making it a deliberate action keeps the city honest about
what it is: a place people meet, with private space reached from anywhere.
**Cost to change:** Low. If the city ever has a district where each house does
belong to somebody, walking through its door becomes another way to call the
same code.

## D-054 — "Welcomed" is a list, not a friendship

**Date:** 2026-09-11
**Decision:** A house door is open to nobody, to the people on a list the
owner keeps, or to anybody. The list is one-way and needs nobody's agreement.
**Why:** `docs/SPEC.md` section 10 asks for nobody / friends / everyone.
Friendship is a feature of its own — requests, acceptance, removal, and what
it means elsewhere in the game — and a house does not need one to be useful. A
list the owner writes is the same three settings with none of that, and it can
become a friends list later without the door having to change.
**Cost to change:** Low.

## D-055 — A room that fits on the screen is centred, with no camera bounds

**Date:** 2026-09-11
**Decision:** When the whole place fits on screen — which a house does and the
city never will — the camera stops following the player, drops its bounds and
centres on the room. Pinching to zoom does nothing there.
**Why:** Found by a test that put a stool in the middle of a room and was told
"nothing can stand there". Camera bounds smaller than the camera itself get
clamped back to the corner, so the room was drawn in the top-left while the
game believed it was centred — and a tap in the middle of the screen landed on
tile 20,9, outside a room that is fourteen tiles wide. Without bounds there is
nothing to clamp and the centring holds.
**Cost to change:** None.

## D-056 — The ground is painted one pixel per tile and then blown up

**Date:** 2026-09-11
**Decision:** A chunk is drawn into a 32x32 pixel texture — one pixel per
tile — and that texture is scaled up thirty-two times. The renderer is in
pixel-art mode, so it scales without smoothing.
**Why:** Every tile is one flat colour, so painting them at full size means
writing a million pixels to say what a thousand can. Measured on this machine,
drawing a chunk at full size took over a tenth of a second and a burst of them
took 400 ms; at one pixel per tile the same picture comes out identical — the
screenshots before and after are indistinguishable — for a thousandth of the
work. Ground the player has walked away from now has its texture deleted too,
which matters on a phone.
**Cost to change:** Low, and it stops being an optimisation the moment tiles
stop being flat colours — real artwork would go back to a full-size texture.

## D-057 — A small original pixel-art set for V1.0

**Date:** 2026-09-12
**Decision:** Use original generated resident and town artwork with a consistent
warm palette. Ship six complete resident looks, rather than a combinatorial
wardrobe. Three resident source sheets each have four directions and six walk
frames; three alternate clothing dyes complete the catalogue. See
`ART_PROMPTS.md` and `ASSETS.md` for provenance and reproduction.
**Why:** The owner requested a full redesign and specifically prioritised simple
art with good animation. A bounded set keeps clothing, silhouette and movement
coherent. Studying social-world design principles is permitted by the owner's
request and the updated specification; no commercial-game assets are used.
**Cost to change:** Additional looks need their complete directional cycles.
Independent clothing layers and separate gestures are later work.

## D-058 — Bake sprites before release; share the terrain atlas

**Date:** 2026-09-12
**Decision:** Keep source sheets but export compact, aligned transparent atlases
with `scripts/bake-art.mjs`. The browser loads these exports. Terrain uses Phaser
tilemap layers and one shared small atlas, superseding D-056's flat-colour renderer.
**Why:** Processing multi-megabyte source sheets on entry caused a visible delay.
The exported resident sheets are about 48 kB each. Shared terrain avoids allocating
a million-pixel canvas for each streamed chunk. Chunk creation remains queued.
**Cost to change:** Re-bake and visually inspect whenever source artwork changes.
This is not a claim of measured performance on a physical phone.

## D-059 — Appearance is durable, additive and independent of the economy

**Date:** 2026-09-12
**Decision:** Store a catalogue index from zero to five on the character, with
zero as the default for existing accounts. Authenticated API requests update only
the player's own character and publish a world command. Snapshot comparison
includes appearance, so a stationary neighbour sees the new look. House
transitions carry it with the player.
**Why:** The owner asked for working characters, not a local visual preview.
An additive optional protocol field lets old clients ignore appearance safely.
Appearance selection does not mint items, charge money or alter movement.
**Cost to change:** A larger or modular catalogue needs a new validated schema.

## D-060 — Mobile gets visible movement buttons and a resizing stage

**Date:** 2026-09-12
**Decision:** Keep tap-to-walk and pinch controls, add a press-and-hold direction
pad for touch devices, and support portrait as well as landscape. Observe the
stage size so rotating a phone updates the canvas and camera. Dialogs suspend
movement shortcuts, and Enter does not steal keyboard activation from controls.
**Why:** Walking and chatting must be discoverable and usable together. Testing
found a stale canvas size after changing orientation; observing the actual stage
fixes it. Browser emulation verifies layout and intents; physical-device and
community testing remain explicit follow-up work.
**Cost to change:** Low; the controls send the same authoritative intents.

## D-061 — Spend less rendering work behind a dialog

**Date:** 2026-09-12
**Decision:** Refresh the covered Phaser world at five frames per second while
a dialog is open. Resume the normal loop automatically when it closes. React,
network traffic and the authoritative world simulation continue normally.
**Why:** The desktop trade tests reached their time limit while HTTP operations
were returning successfully in under 200 ms. Two software-rendered cities kept
consuming rendering time behind the trade panels. Reducing covered-world work
also avoids wasting a phone's rendering budget while someone uses a menu.
**Cost to change:** Low. A covered scene can be up to 200 ms behind the latest
snapshot; the visible walking scene keeps the normal frame target.

## D-062 — Cottage doors match the south-facing artwork

**Date:** 2026-09-12
**Decision:** Both public cottage rows have their walkable doorway on the south
wall, where the new art shows its front steps. Add short approaches and a lane
below the southern row.
**Why:** The old schematic map gave the lower row north-facing doors, which did
not match the new cottage image. The city reachability test and an entrance
regression test cover the resulting paths. Private owned houses are unaffected.
**Cost to change:** A north-facing building variant would need matching art and
the same explicit collision alignment.

## D-063 — Capture review pictures explicitly, retain DOM and network traces

**Date:** 2026-09-12
**Decision:** Playwright retains DOM snapshots, source and network traces on
failure, but does not continuously record screenshots of the game canvas.
Design and live visual-review tests still save explicit screenshots.
**Why:** This machine renders browser graphics in software. The recorded desktop
trade trace showed multi-second browser actions while API operations succeeded
in milliseconds. Continuous canvas image recording adds work unrelated to a
player's input. Assertions, time limits and production behaviour are unchanged.
**Cost to change:** Switch trace screenshots on for a specific visual diagnosis;
the ordinary failure trace still contains the DOM and HTTP evidence.

## D-057 — A forgotten password is recovered by a one-time emailed link

**Date:** 2026-09-12
**Decision:** The player asks for a link; the server sends one that works once
and expires in an hour. Only a **hash** of the token is stored, in Redis. Using
the link changes the password and **ends every session** on the account.
**Why:** Each part answers a way this goes wrong. Storing only a hash means
somebody who reads a Redis backup finds nothing usable — the token exists only
in the email and the player's browser. Working once means a forwarded email is
not a second key. An hour means an old message in a mailbox is not a key at
all. Ending every session matters most: a person resetting their password is
quite often doing it because somebody else is logged in as them, and leaving
that session alive would defeat the whole exercise.
**Cost to change:** Low for the timings, high for the rest.

## D-058 — "I have forgotten my password" answers the same way every time

**Date:** 2026-09-12
**Decision:** The route returns the same status and the same body whether the
address has an account, has no account, or is not an address at all.
**Why:** Any difference turns it into a way of asking "does this person play
Atheriam?" — which is nobody's business but theirs, and is worth more to
somebody with a list of addresses than it looks. The only case that answers
differently is the server being unable to send at all, which is about the
server and says nothing about any account.
**Cost to change:** None, and it must not be.

## D-059 — Email goes to a file in development, and never in production

**Date:** 2026-09-12
**Decision:** With `MAIL_OUTBOX` set, messages are appended to that file as
JSON instead of being sent. The setting is ignored when `NODE_ENV=production`.
**Why:** It is how a browser test can follow a real reset link without a
mailbox — the test reads the file the server wrote, exactly as a person would
read their inbox — and how somebody working on the game can see what the email
says without sending themselves anything. Ignoring it in production is the
important half: an outbox nobody reads is a password reset that silently never
arrives, which is worse than a route that says plainly it is not set up.
**Cost to change:** None.


## D-064 — A contemporary city with a fixed first property supply

**Date:** 2026-09-12
**Decision:** Follow the owner's new setting and 15-building requirement: five
public venues and ten purchasable commercial properties in a 160 × 160 city.
Keep private homes and existing property/items intact. Use stable city and
building IDs for future expansion. Crowns remain the currency; property sales
are in-game only. Initial reservations are free with bounded durations and quotas.
**Why:** This implements the owner's business/community direction while retaining
existing residents' possessions and the authoritative economy guarantees.
**Cost to change:** Future cities add definitions and persistent rows. Price and
booking policies are explicit configuration rather than client authority.
