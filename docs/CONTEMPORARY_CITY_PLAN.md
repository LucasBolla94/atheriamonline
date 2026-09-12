# Contemporary city release

Owner scope: redesign the game and public website for contemporary social city
life, starting with one city, ten saleable commercial properties and five public
buildings. Preserve all existing accounts and possessions.

## Delivery phases

- [x] Record the new product requirements and publish a feature branch retaining
  the complete existing history.
- [ ] Shared city/building definitions, 160 × 160 layout, walkable plaza, park,
  lake and correct entrances; reachability and exact inventory tests.
- [x] Persistent cities/properties, atomic Crown purchases, ownership and
  business configuration; concurrency, idempotency and conservation tests.
- [ ] Public and business interiors, environment editing, directory and item
  listings/sales; authoritative permissions and inventory conservation.
- [ ] Lounge bookings/invitations, expiry and removal, isolated chat, capacity
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
