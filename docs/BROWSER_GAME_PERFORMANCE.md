# Browser game rendering review — 2026-09-13

The owner reports disappearing terrain and buildings when zooming out. The goal
is to keep the existing zoom usable, improve terrain loading, and make the
resident animation consistent across frame rates.

## Research and observed cause

| Source                                                                                                            | Relevant guidance                                                                         | Application here                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Phaser cameras](https://docs.phaser.io/phaser/concepts/cameras)                                                  | Zoom changes the world area covered by a screen; camera bounds and world view matter      | Compute terrain coverage from the actual camera rectangle, including the displacement caused by bounds near map edges                                            |
| [Phaser tilemap layers](https://docs.phaser.io/api-documentation/3.90.0/class/tilemaps-tilemaplayer)              | Culling and padding control which existing tiles render near the viewport                 | Check streaming before changing culling: a renderer cannot draw terrain never received from the server                                                           |
| [MDN Canvas optimisation](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) | Reuse prepared artwork and avoid repeating expensive drawing preparation                  | Keep shared atlases and incremental chunk construction; start independent required atlas downloads together                                                      |
| [Snapshot interpolation](https://gafferongames.com/post/snapshot_interpolation/)                                  | Presentation can smooth authoritative network snapshots; buffering has a latency tradeoff | Retain authoritative positions, use frame-rate independent visual easing and advance walk frames by displayed travel distance; do not add speculative game state |

Installed Phaser source was inspected alongside the documentation, including
camera transforms and tilemap culling. The visible defect was reproduced with
the existing production client build on a 2560 × 1440 viewport at minimum zoom:
**27.672955974842767% of sampled canvas pixels were unknown terrain**. The saved
image shows wide missing strips on both sides of the city. Initial server
coverage was always 24 + 4 tiles, irrespective of the camera. This was a
streaming mismatch, not evidence that the artwork needed replacement.

## Implemented approach

- Protocol v13 adds a bounded terrain extent request. The client cannot supply
  a centre or realm. The server centres coverage on its authoritative resident
  and always uses the current realm's map. Player and chat visibility stay
  independent from terrain coverage.
- Extents include horizontal prop margin and twenty vertical tiles for tall
  facades. Camera rectangles are clipped to actual world boundaries. Requests
  are quantised to four-tile increments, deduplicated and sent at most once per
  300 ms. The server keeps only the latest pending request and applies changes
  at most once per 250 ms, including for a stationary player.
- Maximum requested radius is 256 tiles per axis. Actual map bounds limit this
  city to 25 chunks. Future larger maps retain a finite 17 × 17 chunk maximum.
- The server sends nearby chunks first. The client prioritises nearby drawing,
  discards queued chunks that are no longer held and still constructs at most
  one chunk each frame. Eviction disposes terrain and associated props.
- Independent resident, terrain-prop, furniture and building sheets load in
  parallel. They remain prepared once per page, with retry after loading errors.
- Exponential movement easing gives equal catch-up over equal time at different
  refresh rates. Walk frames follow displayed distance, reducing foot motion
  during the final settling of a stopped network position.

## Verification

Typecheck, lint, 350 unit tests and 174 database integration tests passed. The
wide minimum-zoom regression failed on the previous bundle and passed on the
new bundle: unknown sampled ground fell from 27.67% to 0%. The coverage test
uses a 2560 × 1440 viewport and wheel input in both browser profiles; it does
not measure a physical phone or pinch gestures. Other browser scenarios use
their configured desktop and phone viewport sizes. The browser regression
passed 55 cases, with one intentional keyboard-only
mobile skip. It covered movement, chat, social controls, houses, public venues
and protocol refresh. The complete production build passed and release
`fae4053` was published on
2026-09-13 at 00:15 UTC. All 22 live browser checks passed in two minutes,
including wide zoom coverage, chat controls, touch actions, reservations and
trade. The 20 smoke accounts and two test bookings were removed afterwards.
A database dump and previous client archive were saved before publishing in
`/var/backups/atheriam/map-view-20260913T000914Z/`; the dump archive table of
contents was verified. The deployed client matches the build and HTTPS health
answers. Temporary build/test swap was disabled and its file removed.

- [Before](design/map-performance/zoom-out-before.png)
- [After](design/map-performance/zoom-out-after.png)

## Follow-up measurement

Browser emulation and software rendering do not prove physical-phone frame
rates. A community device pass should record frame-time percentiles, long tasks,
network latency and memory while crossing chunk boundaries and meeting crowds.
Consider a small interpolation buffer only if measured network jitter warrants
its extra delay. Workers, terrain render textures and resolution caps need
profiling first; a blanket change can increase memory or reduce image quality.
No frame-rate or player-capacity promise is derived from VPS RAM alone.
