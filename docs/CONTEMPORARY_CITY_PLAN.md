# Contemporary city release

Owner scope: redesign the game and public website for contemporary social city
life, starting with one city, ten saleable commercial properties and five public
buildings. Preserve all existing accounts and possessions.

## Delivery phases

- [x] Record the new product requirements and publish a feature branch retaining
  the complete existing history.
- [x] Shared city/building definitions, 160 × 160 layout, walkable plaza, park,
  lake and correct entrances; reachability and exact inventory tests.
- [x] Persistent cities/properties, atomic Crown purchases, ownership and
  business configuration; concurrency, idempotency and conservation tests.
- [x] Public and business interiors, environment editing, directory and item
  listings/sales; authoritative permissions and inventory conservation.
- [x] Lounge bookings/invitations, expiry and removal, isolated chat, capacity
  and booking conflicts; integration and multi-player browser tests.
- [ ] Original contemporary pixel assets, social animations, consistent game UI
  and complete responsive public landing page; visual review at mobile/desktop.
- [ ] Full unit/integration/browser gates, build, GitHub reviewable commits,
  backup, deployment and live verification; update release documentation.

## Acceptance evidence

Every phase records its actual commands and results here. A checked test alone
is not proof that a feature is reachable through the product UI. Final browser
coverage must use the same flows available to ordinary players, including errors,
refresh/reconnect and a second player. Visual review must inspect the actual
canvas and public site. Do not describe pending work as shipped.

## Baseline inspected

2026-09-12: clean worktree at c652fd5; local main had twelve commits not yet on
origin/main. Published the existing history on feat/contemporary-city-v1, without
rewriting main. Existing homes are separate realms, supporting reuse of movement
and local chat infrastructure. No production changes have been applied yet.


## Phase 1 evidence (layout foundation)

Shared definitions now contain the single 160 × 160 city and exactly fifteen
non-overlapping addresses, with five municipal venues and ten commercial sites.
The new authoritative terrain includes the square, fountain, lake, bridge and pier.
All walkable tiles are reachable from arrival, respecting diagonal corner rules.
Typecheck and lint passed; all 277 unit tests passed. Rendering/entrance interaction
is pending the client/interior phases, so this is not yet a playable release.


## Phase 2 evidence (durable ownership and HTTP)

Migration 0006 adds cities, properties and immutable initial-purchase receipts.
The API seeds fifteen addresses without resetting ownership/configuration.
Purchases serialize retries and property ownership, use the existing ledger
transaction, and bind request keys to buyer/address. Five city-owned venues are
unsaleable. Configuration checks the authenticated owner and validates fields.

Typecheck and lint passed. All 277 unit tests passed. A full integration run
passed 130 tests before the HTTP integration was added; the final focused property
suite passed all 14 tests (including four actual Fastify/session tests). Tests
cover concurrent buyers/retries, overdrafts across properties, insufficient
funds, receipt-failure rollback, conservation, startup persistence, bad client
payloads and unauthorized edits. Full integration will run again with the next
phase. These API capabilities still need the client and interior workflows.

## Client and public website milestone (2026-09-12)

The City guide now browses all fifteen addresses, filters municipal/available/owned
properties, reviews the Crown price and purse, purchases through the API, and
saves business name, description, access, publication and finish choices.
Unpublished business details are hidden from other residents. The public website
has original city art, discovery/creation sections, working FAQ and account links.
It is a separate HTML entry from `/play/`; its production build does not import
Phaser. Previously issued root password-reset links redirect to the game entry.
The game's fifteen footprints now render six original contemporary facade types.

Verification: typecheck, lint, production build and 277 unit tests passed. The
focused property integration suite passed 15 tests. Both City guide and public
website browser scenarios passed on desktop and mobile landscape (four cases,
2.1 minutes), covering insufficient funds, buying, business configuration and
reload persistence. Explicit labels fixed a select accessibility defect found
by the browser test. Mobile portrait website review also passed after adding
capture coverage. A later concurrent unit/browser run exceeded the desktop
account-entry wait; do not run the heavy suites concurrently on this 4 GB host.
A subsequent isolated runner terminated with SIGTERM and left its three test
servers running; that interrupted invocation is not counted as passing evidence.

Commits: 65181de (unpublished business privacy), 7bb511a (building sprites),
03ac774 (guide and public website), pushed on the feature branch.

## Still required before release

- Public/commercial interiors connected to actual entrances and directory entry.
- Property guest permissions, furniture editing and authoritative access updates.
- Item listing and purchase UI, inventory/money conservation and concurrent sales.
- Lounge reservation/invitation/expiry/capacity flows and private conversation.
- Contemporary resident outfits, sitting/waving, fountain, furniture and other
  environment details; modernize the still-medieval authentication art/copy.
- Complete game/website visual review and full integration/browser regression,
  including old recovery links, movement, chat, houses and moderation.
- Final production build, GitHub delivery, backup, deployment and live tests.

Nothing from this release has been deployed. Landing copy describes the intended
complete release and must not be published while the advertised features remain
unfinished. This milestone does not complete the owner's goal.

An isolated real-browser check subsequently passed on both desktop and portrait
mobile against the surviving test servers: page artwork, navigation, FAQ and
account-creation entry all worked with no browser errors and the same 15-second
visibility bound. Reviewed captures are retained in `docs/design/contemporary`.
The three orphaned test-server process groups were stopped after this check.

## Interior data foundation (2026-09-12)

Migration 0007 adds commercial guest lists. A shared 20 × 16 interior plan keeps
the doorway and arrival aisle undecorated. Interior reads enforce public/private/
invited access; only owners can edit guests or furniture. Edits lock the property
and move the existing item instance within one transaction, preventing concurrent
placements on the same tile. Existing house-holder storage also identifies the
commercial interior by its persistent UUID; no item copies are introduced.

Typecheck and lint passed. The property/interior integration suite passed all
22 cases, including repeated place/rotate/retrieve conservation, competing tile
placements, guest revocation and cross-owner refusals. Two floor-plan unit tests
passed. The initial conservation test exposed an incomplete test fixture reset
(the generic item holder has no character FK); truncating test item instances
fixed isolation while preserving the exact conservation assertions.

This data foundation still needs HTTP, realtime realm transitions and editor UI.

## Interior access and realtime milestone (2026-09-12)

Properties now have separate live worlds, each with its own map, occupants and
chat. The world server reads shared database permissions before admission and
rechecks occupants every five seconds as a fallback to immediate permission
nudges. Revoked guests return to their saved outdoor position. Admission reserves
outdoor capacity for indoor residents and rejects a second session of the same
character across realms. A disconnected player cannot be moved by a late access
response. Protocol version 8 carries the property identifier.

Authenticated HTTP routes expose interior views, requested entry, named guest
management and furniture placement/rotation/retrieval. Settings and guest changes
request a live permission refresh. Entry returns HTTP 202: the live realm message
is the confirmation of admission; an HTTP response alone does not prove entry.
The browser entry flow must wait for that message and handle a missing response.

Validation: all 287 unit tests passed, including eight new socket cases for
properties. All 24 focused property integration tests passed, including HTTP
invitation/revocation and actual item editing/conservation. Typecheck and lint
passed. HTTP testing caught swapped view arguments; correcting the route calls
restored the intended permission checks. Rotation validation uses the existing
0/90/180/270-degree convention, with a 90-degree HTTP regression assertion.

The client currently understands the protocol identifier but still needs the
property entrance/editor UI and rendered interior finishes. This milestone is
not a playable complete release and has not been deployed.

## Playable business interior milestone (2026-09-12)

The City guide now requests entry and waits for the authoritative realm change,
with a timeout message instead of treating HTTP acceptance as successful entry.
Nearby owned/public doorways also expose an entry action. Owners use their real
inventory to place, rotate and retrieve furniture and manage named invitations.
Visitors receive a read-only environment panel. Interior views refresh while
inside; stale reads are invalidated after edits, guest changes and realm changes.
The location badge names the business. Stone/tile floors and three wall colours
are rendered from the saved settings. Account entry uses contemporary city art
and copy. No production deployment has been made.

Browser evidence: the desktop purchase/decorate/leave case and two-player
invite/revoke case passed. Mobile purchase/decorate/leave passed, including a
new assertion that the environment action does not overlap directional controls.
The final focused mobile run passed both scenarios (1.8 minutes). A previous
mobile invitation run received a successful server response but did not reflect
it within the UI bound; the guest response now updates the list immediately and
invalidates older reads. The final run retains the same 15-second assertion.
Reviewed desktop/mobile interior captures are in docs/design/contemporary.

The first direct Playwright invocation reused an old test database without the
new migration. Running pnpm test:e2e prepared the isolated database correctly.
Two-player testing also found the old one-minute game-intent idle timeout; D-067
records the heartbeat fix. All 289 unit tests, typecheck, lint and production
build passed after the changes. Phaser remains a separate large game bundle;
the public site has a separate entry.

Still pending: a browser walkthrough of the outdoor public-building doorway,
public venue furnishings, booking rooms, item listings/sales, contemporary
resident/social animations and the final full regression/deployment gates.
The initial website copy must remain unpublished until those advertised features
are complete. This milestone does not complete the overall release.

## Business item sales milestone (2026-09-12)

Migration 0008 adds item listings and immutable sale receipts. An owner lists a
real inventory item at an exact Crown price; it moves to listing escrow until
bought or withdrawn. Creating a listing and buying both bind retry keys to the
original intent. Buying locks the business/listing, checks current entry access,
and transfers item plus full payment in one transaction. Withdrawing returns the
same item. Prices are immutable; a different price needs a new listing. See D-068.

The environment panel now opens a Shop. Owners choose an inventory item and
price, list it, or withdraw it. Visitors review the item, price and balance before
confirming. The shop refreshes listings and purses, including the seller's balance
when somebody else buys. Leaving the realm or disconnecting closes its shop.
The compact landscape confirmation keeps the price and full purchase button in
the viewport, checked by the final mobile browser test.

Verification: all 157 integration tests passed, including 13 shop cases covering
concurrent buyers/retries, cross-business overspending, cancellation races,
unauthorized changes, exact HTTP money strings and rollback after a forced receipt
failure. All 289 unit tests passed. Typecheck, lint and production build passed;
client typecheck/lint/build passed again after compacting the review layout.

The ordinary two-resident browser flow passed on desktop and mobile: buy a
business, configure/open it, reserve an item, refuse an unaffordable purchase,
withdraw/relist, buy at 12.50 Crowns, and inspect both balances and the buyer's
actual inventory. The final mobile rerun passed in 1.3 minutes, retaining the
15-second UI assertions and adding viewport checks. Initial desktop and final
mobile review captures are retained in docs/design/contemporary. Browser fixture
funding was written only to the guarded, isolated e2e ledger.

Still required for the full release: reservable lounge rooms/invitations/expiry,
public venue furnishing and entrance walkthrough, contemporary resident art and
social animations, final complete browser/visual regression and backed-up live
deployment. This milestone has not been deployed and does not complete the goal.

## Lounge reservation data milestone (2026-09-12)

Migration 0009 stores reservations and invitations. Reservation creation serializes
host limits and room conflicts, supports 30/60-minute meetings up to seven days
ahead, and binds retries including reserve-now requests. Cancelling releases the
interval; only the host can manage invitations/cancellation. Public availability
omits meeting titles and participant identities. Invitees see their own meetings
without the host's guest list. Shared admission checks reject early, expired,
cancelled and uninvited entry and return the room capacity plus hard end time.

All eight focused reservation integration tests passed, including concurrent
same-room requests, concurrent per-host limits, touching/overlapping intervals,
retry/cancellation, privacy and exact start/end admission boundaries. Typecheck,
lint and all 289 unit tests passed. D-069 records interval and deadline semantics.

This is a data foundation. HTTP routes, actual meeting realms, enforced live
capacity/expiry, the booking interface and multi-player browser verification are
still required. No booking UI or production booking feature is claimed yet.

## Live meeting room milestone (2026-09-12)

Each reservation now gets its own live realm. Entry is checked again by the world
server and requires standing inside Central Lounge. The three actual capacities
are enforced, including concurrent arrivals. Guests return to the lounge when
they leave, lose permission or reach the deadline. A full lounge sends them back
to their saved outdoor position. Chat remains inside the reservation.

The local end timestamp is checked each simulation tick, independently of any
pending database request. Permissions are rechecked every five seconds and after
a live nudge; failed or stalled reads close access, with a two-second timeout.
Responses from an earlier visit cannot evict a later visit. Empty meeting realms
are discarded. Protocol v9 carries meeting identity/end time, and the browser
clears the previous environment and drops the meeting metadata on departure.

Typecheck, lint and all 303 unit tests passed. Thirteen new real-socket scenarios
cover the lounge-only door, invalid admission, all three capacities, racing
arrivals, isolated chat, revocation, database failure/stall, local expiry, a full
lounge, disconnection during entry and a stale revocation response. A client
regression covers meeting metadata and environment clearing. All 165 integration
tests and the production build also passed. See D-070.

The HTTP booking routes, agenda/invitation interface, expiry warning and ordinary
multi-player browser flow are still pending. The world now understands meeting
commands, but the public product does not yet expose booking controls. No live
deployment has been made, and the overall contemporary release remains open.

## Meeting agenda and invitations milestone (2026-09-12)

The public lounge now opens a Meeting rooms panel. Residents can reserve now or
choose a local date/time, inspect room capacity and occupied intervals, and see
the meetings they host or are invited to. Hosts manage named invitations and
confirm cancellation. These controls remain reachable from inside a meeting.
Entry waits for the actual world realm confirmation; an HTTP request by itself
never displays a successful entrance. The room displays its end time and switches
to a warning during the final five minutes. Server clock offset drives the UI;
the world remains authoritative for admission and expiry. See D-071.

Authenticated HTTP routes expose the agenda, creation, invitations, cancellation
and entry. The server supplies the host identity, validates durations/timezones
and the seven-day window, binds retries, hides private meeting details from other
residents, and nudges live permission checks after invitation/cancellation changes.
Six new HTTP integration cases cover authentication, retries, invalid/spoofed
fields, conflicts, agenda privacy, entry authorization and cancellation nudges.
All 171 integration tests and 303 unit tests passed, as did typecheck, lint and
the production build.

The ordinary two-resident browser flow passed on desktop (3.3 minutes including
startup) and mobile landscape (1.7 minutes): enter the lounge, reserve a room,
invite, confirm guest visibility, enter, keep chat private from the lounge, talk
together, revoke the guest, invite again, and cancel with both returning to the
lounge. Product actions use the actual interface, without fixture booking edits.
The desktop run uses the visible chat send button after a keyboard-completion
observation timeout; message delivery itself had occurred. The final passing
flow retains 15-second assertions and action deadlines.

Captured desktop and mobile screens are kept in docs/design/contemporary. The
rooms are still bare and resident art still needs the contemporary redesign.
The initial mobile review identified an oversized central meeting notice; its
layout was moved to the top and the return label shortened to Lounge. The final
mobile rerun passed in 1.9 minutes, with an added full-viewport/top-quarter check
for the notice. Its updated captures were visually inspected; the final UI files
also passed lint.
The browser suite still needs explicit future-time/expiry-warning/deadline and
reconnect scenarios as part of the final release regression. Public furnishings,
social animations, remaining visual work and backed-up live deployment are also
pending. This milestone has not been deployed and does not complete the goal.

## Furnished public venues milestone (2026-09-12)

An original twelve-object pixel furniture atlas now furnishes all five public
buildings and the three meeting rooms. Central Lounge has a cafe counter and sofa
areas; Creative Hub has workstations; City Hall has a reception/waiting area;
Market Hall has counters; Events Hall has a lectern and audience benches. Studio,
Terrace and Boardroom have distinct furniture arrangements and visible seating
for 8, 12 and 16 people respectively. Actual sitting is still a following feature.

Shared venue definitions supply both furniture footprints and rendered scenery.
Furniture blocks movement, all floor areas connect to the entrance, and the
arrival/exit aisle is clear. Public fixtures are separate from player inventory
and cannot be taken or sold. Commercial and personal room editing stays intact.
Protocol v10 carries the venue identity, including the return from a meeting.
Original source, atlas, packaging script and prompt are recorded in ASSETS.md;
the public credits page now describes the contemporary setting correctly.

All 314 unit tests passed. New coverage checks all eight layouts, complete floor
reachability, matching visible seating/capacity, streamed furniture collision,
and correct lounge/meeting/return metadata. The full 171 integration tests passed.
The five physical public door approaches, entrances and exits passed on desktop
and mobile. The desktop test reported passed and retained a passed result, though
its command wrapper ended with signal 143 after cleanup; no test servers remained.
The subsequent combined mobile public-door and two-resident lounge suite exited
successfully with two passes in 2.4 minutes.

A new browser walkthrough reserves, enters, walks inside and cancels each of the
three meeting rooms. Its final desktop and mobile run passed (two cases, 1.1
minutes total). It holds movement input until an authoritative position change,
as the game's keyboard controls sample held keys. A visual review found that
clamping short-screen interior cameras to the south wall hid the avatar behind
chat. New public venue cameras now follow the resident without that clamp; final
meeting captures show the full resident clear of chat and the dock. Desktop
continues to centre rooms which fit on screen. Captures of all eight desktop
layouts and the three final mobile meeting views are retained for review.

Remaining work includes outdoor plaza furnishings/fountain, contemporary
resident art and synchronized sitting/waving; explicit booking future-time,
expiry-warning/deadline and reconnect browser cases; full regression/performance
and client-version reload checks; and backed-up deployment/live verification.
The standalone production build passed after a command-wrapper interruption.
The release is still in progress and this milestone has not been deployed.

### Central Square scenery milestone — 2026-09-12

The square now has six benches and four planters around its clear arrival area.
The old well has been replaced by an original pixel-drawn stone fountain with a
six-frame water loop. Outdoor furniture shares collision footprints between the
server and renderer; it uses the public venue furniture atlas. The fountain's
texture is generated once and its animation is local decoration.

All 315 unit tests, typecheck and lint passed. The new map check covers solid
furniture footprints and accessible fronts; existing checks still establish
complete walkable connectivity, a clear arrival area and all fifteen entrances.
Sitting interaction, contemporary residents and the remaining release gates
listed above are still pending. This change has not been deployed.

The five public-door walkthroughs passed on both desktop and mobile (two cases,
2.8 minutes). A separate square approach check passed on both devices (two cases,
49.6 seconds), including four individual northward touch steps on mobile.
Desktop and mobile arrival/approach captures were reviewed and retained under
`docs/design/contemporary`. The mobile close approach shows both fountain and
resident within the short landscape viewport.
The production build and final lint check also passed for this milestone.

### Social state and contemporary residents — work in progress, 2026-09-12

Server foundation commit `2a110c4` is published on the feature branch. Waves,
public seat occupancy, cooldowns and clearing on movement/departure are world
state, with snapshot coverage even when nobody moves. Protocol v11 carries the
pose. There are 325 passing unit tests, including eight new social rule checks,
a real-socket wave/expiry check and client pose replacement coverage. The later
seat alignment update also passed the focused 45-test social/venue/client group
and typecheck. Final complete release checks remain pending.

The client now contains six contemporary looks with directional walk, wave and
seated idle frames, matching portraits, and an Actions control. The individual
browser scenario successfully waved, sat and stood up. Its visual inspection
found the seated body below the bench surface; render anchors were subsequently
adjusted and bench slots moved inward from the armrests. The player's safe
standing tile stays unchanged. Final seated captures are still being reviewed.

The first browser pass caught missing pointer interaction on the portrait Actions
button; that was fixed with explicit pointer events and a minimum touch target.
Two-client visual tests are still being stabilized on this headless host. An
interrupted invocation was confirmed stopped and its orphan test services were
removed. Later traces showed completed non-navigation clicks waiting on a
navigation signal. The social tests now retain normal hit-target/actionability
checks and wait for the actual server pose, without the click's navigation wait
(see [Playwright click options](https://playwright.dev/docs/api/class-locator#locator-click)).
No passing two-browser result is claimed yet. This milestone is not deployed.


### Contemporary resident client milestone — 2026-09-12

Six original modern appearances now render four directional walking cycles,
waves and seated idle poses, with matching saved portraits. The portrait Actions
button exposes server-authoritative wave/sit/stand controls on desktop and touch.
Seat anchors place neighbours inside bench armrests, hide ground shadows while
seated and keep the bench visible. Magenta edge blends found in the first mobile
capture were removed in the deterministic atlas packaging step; original sources
remain unchanged. Final character chooser and mobile portrait captures were
visually reviewed and retained under `docs/design/contemporary`.

Typecheck, lint and all 332 unit tests passed, including seven renderer capability
cases. The game keeps hardware WebGL and uses native Canvas on known software
renderers or when WebGL is unavailable (D-075). Both individual and two-resident
social scenarios passed on desktop and mobile, covering wave observation/expiry,
two occupied seats, standing/releasing and reload. The final atlas revision also
passed all four social cases against the production client bundle.

The browser harness now builds and serves an isolated production client under
`.e2e-client`, with test-only API/world addresses. Deployment output is untouched.
Appearance change, peer observation, reload persistence and mobile portrait/tablet
controls passed on mobile in the grouped run. Desktop's reload exceeded the
15-second observation deadline in that run; the unchanged desktop scenario then
passed in isolation (47.5 seconds). Earlier dev-client runs also exceeded entry
deadlines. This host's intermittent loading delays remain recorded; neither a
clean full regression nor real-phone frame-rate performance is claimed.

Remaining release work includes explicit booking time/reconnect checks, client
protocol upgrade handling, full integration/browser regression, final build,
backup, deployment and live verification. Nothing here has been deployed.

The complete production build subsequently passed. Workspace builds now run in
sequence on this 4 GB host. An earlier concurrent build was killed with exit 137
while lint was incorrectly parsing the generated browser-test bundle. The isolated
output is now excluded from source lint/format checks, just like ordinary dist
output; source lint passed again.


### Reservation clock and reconnect browser coverage — 2026-09-12

The new ordinary-interface scenario creates a reservation for tomorrow, refuses
early entry, reloads and finds the same reservation, cancels it, then creates an
active meeting. Reloading inside that meeting returns the resident to the city
while preserving the booking; they can return through Central Lounge and enter
again. Both desktop and mobile cases passed (2.6 minutes including build/startup).

For the deadline portion, the already-created reservation is moved near the end
of its thirty-minute interval in the guarded `atheriam_e2e` database, before
renewed admission. The browser and world use real time: the UI shows the final
minute warning, the server removes the occupant at the actual deadline, the
warning disappears and the expired reservation leaves the agenda. No fake realm
messages, client clock fast-forward or shortened production duration are used.
Cleanup cancels only the test host's reservations, including after a failed case.
Initial fixture failures (a select locator and a reset room choice after reload)
were corrected before this passing run.

The first deadline capture preceded the scene's next frame and showed the lounge
under the new room heading. Visual captures now wait half a second after the
authoritative room/warning assertions, as the existing layout tests do. Final
settled desktop and mobile captures were reviewed and retained under
`docs/design/contemporary`. The revised desktop case passed in 1.1 minutes;
the isolated mobile case passed in 1.1 minutes (1.4 minutes including startup).
A grouped capture rerun was terminated externally with exit 143 before its
mobile completion; the absent runner was confirmed and only its orphan test
service groups were stopped before the successful isolated rerun.

The harness now compiles its production bundle before starting test services
(D-076), after a build with services already running was killed with SIGKILL.
The final preparations compiled successfully in about sixteen seconds. Full
release regression, protocol upgrade handling and backed-up deployment remain
pending.


### Compatible release entry — 2026-09-12

Protocol v12 checks compatibility at ticket issuance, socket admission and client
welcome. Legacy tabs receive an actionable API refresh message; current clients
show a Load the latest version button. Tickets are neither issued nor spent for
incompatible requests, no map is sent, and late packets cannot revive a closed
connection. See D-077. The load-test script sends the current protocol version.

All 338 unit tests passed, including old/future server rejection, server refusal
of legacy/mismatched joins without consuming the ticket, and client handling of
the refresh hint. All 174 integration tests passed, including authenticated HTTP
legacy/old/future requests, no issued ticket and unchanged valid-session access.
Typecheck passed. Six browser cases passed in 56.2 seconds on desktop/mobile: an
HTTP mismatch, an outgoing join mismatch and an incoming welcome mismatch all
show the notice, prevent a game canvas, and let the resident refresh into the
same account with 50 Crowns and the same three initial items. The first mobile
assertion incorrectly expected the compact dock to expose its hidden balance;
the final test opens the actual purse and checks both balance and inventory.

Browser preparation now rebuilds shared package exports before client compilation,
so it cannot silently use an older built protocol. Full browser regression,
production backup/deployment and live verification remain pending.

Final source lint and the complete production build also passed for v12.

### Full browser regression and touch correction — 2026-09-12

The 106-case desktop/mobile run completed with 100 passes, two intentionally
inapplicable mobile keyboard skips and four failures. Three desktop cases
(appearance, closed house and lounge invitations) exceeded action deadlines
during measured memory pressure on the 4 GB development host. A temporary 2 GB
swap file reduced memory stall pressure. The fourth failure exposed a real quick
tap being rejected inside the walking interval; D-078 adds one bounded pending
touch step without changing server speed rules.

The three touch scheduler unit cases, typecheck and lint passed. A fresh normal
browser invocation rebuilt the client and reran all four affected files on both
projects: **14 passed in 2.1 minutes**, including the unchanged square approach
assertions and all previously failing cases. This is a full regression followed
by a targeted correction/recheck, not a claim that the first run was all green.
Production publication and live checks remain pending.

### Live-check preparation

The live browser checks now use the public landing page and /play/ entry,
contemporary portraits, and an ordinary city-guide/reserve/enter/cancel flow.
There are nine scenarios on each device project. The new reservation check
cancels its own booking in cleanup if an assertion fails. These checks have not
yet run against the unpublished release.

Smoke account cleanup selects only matching six-digit fixture name/email pairs
and excludes commercial owners. It removes those hosts' free reservations in
the same transaction before deleting their accounts. Verification against an
isolated database with the current schema proved that the fixture and its
booking are removed, while an ordinary resident and booking, a mismatched
name/email pair and a commercial owner remain. The verification database was
removed afterwards. Shell syntax, source lint and typecheck passed.
