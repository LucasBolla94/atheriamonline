# Contemporary city release

Owner scope: redesign the game and public website for contemporary social city
life, starting with one city, ten saleable commercial properties and five public
buildings. Preserve all existing accounts and possessions.

## Delivery phases

- [x] Record the new product requirements and publish a feature branch retaining
  the complete existing history.
- [ ] Shared city/building definitions, 160 × 160 layout, walkable plaza, park,
  lake and correct entrances; reachability and exact inventory tests.
- [ ] Persistent cities/properties, atomic Crown purchases, ownership and
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
