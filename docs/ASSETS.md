# Atheriam — Assets and provenance

Updated 2026-09-12. V1.0 uses original art generated for Atheriam with the built-in imagegen tool, plus original code-native terrain and UI pictograms. No Habbo, Tibia or other commercial-game artwork is included. Research references are documented in `DESIGN_V1_PLAN.md`; they are not shipping assets.

| Files under `apps/client/public/art/`                                                                                                                                                                     | Creator / source                                               | Usage and provenance                                                             | Added      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| `resident-source.png`                                                                                                                                                                                     | OpenAI imagegen, original Atheriam prompt                      | Generated for this project; prompt and edits in [ART_PROMPTS.md](ART_PROMPTS.md) | 2026-09-12 |
| `resident-ponytail-source.png`                                                                                                                                                                            | OpenAI imagegen, edit of the original resident                 | Same project source; original appearance variant                                 | 2026-09-12 |
| `resident-curly-source.png`                                                                                                                                                                               | OpenAI imagegen, edit of the original resident                 | Same project source; original appearance variant                                 | 2026-09-12 |
| `town-source.png`                                                                                                                                                                                         | OpenAI imagegen, original Atheriam object prompt               | Generated for this project; no external asset pack                               | 2026-09-12 |
| `welcome.png`                                                                                                                                                                                             | OpenAI imagegen, original Atheriam village illustration        | Generated for this project; decorative entry illustration                        | 2026-09-12 |
| `resident-0.png` through `resident-5.png`; `portrait-0.png` through `portrait-5.png`                                                                                                                      | Derived from the resident sources by the game's atlas pipeline | Aligned, chroma-keyed frames; three curated alternate dyes                       | 2026-09-12 |
| `town.png`; `tree.png`, `well.png`, `stall.png`, `cottage.png`, `oak-stool.png`, `rush-mat.png`, `clay-lamp.png`, `long-table.png`, `wool-rug.png`, `copper-pin.png`, `river-stone.png`, `brass-bell.png` | Derived from `town-source.png` by the game's atlas pipeline    | Runtime atlas and previews of the same twelve original objects                   | 2026-09-12 |

The editable terrain recipe is `apps/client/src/game/terrainArt.ts`; it creates the small shared terrain atlas. UI pictograms are original SVG paths in `apps/client/src/ui/Icon.tsx`. Fonts are the user's installed system fonts and Georgia/Times fallback; no font files are distributed. No sound files are currently distributed.

The generated PNGs are retained with their provenance; do not relabel them as hand-drawn human artwork or as CC0 stock assets. The welcome illustration is promotional scene art, not a screenshot of the game. The runtime city uses the documented tiles, objects and residents.

For future external assets, record file, author, original source URL, exact licence/usage terms and date before import. Commercial use and modification must be permitted. Keep required attribution discoverable from the game. Unknown and NonCommercial licences remain excluded. Paid packs must not be redistributed as stock source assets unless their terms explicitly permit that.

Reproduction commands and the final prompt set are in [ART_PROMPTS.md](ART_PROMPTS.md). Player-facing provenance is available at `/credits.html` from the login screen.

## Contemporary city hero — 2026-09-12

- File: `apps/client/public/art/central-hero.png`
- Author/source: original project artwork generated with OpenAI's built-in image
  tool; no external source image. Source URL: not applicable (project-created).
- Usage: project-generated promotional illustration; no third-party asset licence.
- Prompt and production notes: `docs/design/CONTEMPORARY_ART_PROMPTS.md`.
- This illustration is marketing artwork, not an actual gameplay screenshot.

## Contemporary building sprites — 2026-09-12

- Files: `central-buildings-source.png`, `central-buildings.png`, and
  `building-{hall,creative,events,lounge,market,shop}.png` in `apps/client/public/art`.
- Author/source: original project art generated and background-edited with the
  built-in OpenAI image tool. Source URL: not applicable (project-created).
- Usage: original project-generated assets; no external asset licence required.
- Prompt: `docs/design/BUILDING_ART_PROMPT.md`.
- Processing: `scripts/bake-buildings.mjs`, deterministic transparency extraction,
  bounding boxes and nearest-neighbour scaling for the game atlas.

The code-native terrain atlas also includes original pale-stone and studio-tile
floors and cream, teal and rose interior wall finishes. These are renderer-only
variants of the server's existing floor/wall tiles; they do not alter collision.
The contemporary central-city illustration is now also used on the account-entry
screen, replacing the medieval promotional image there.

## Contemporary public furniture — 2026-09-12

- Files: `apps/client/public/art/city-furniture-source.png` and `city-furniture.png`.
- Author/source: original project sprite sheet generated with OpenAI's built-in
  image tool, without external source images. Source URL: not applicable.
- Usage: project-generated artwork; not stock art, CC0, or hand-drawn human art.
- Twelve objects: plant, bench, sofa, coffee table, cafe counter, bookshelf,
  meeting table, office chair, desk, noticeboard, planter and lectern.
- Prompt and production notes: `docs/design/VENUE_ART_PROMPT.md`.
- Packaging: `node scripts/bake-venue-art.mjs` retains the original alpha,
  extracts complete silhouettes and scales with nearest-neighbour sampling into
  twelve 128×192 frames. Connected silhouette extraction avoids clipping a table
  which crossed the source sheet's nominal grid line into the chair cell.
- Permanent public scenery is defined in `packages/shared/src/venues.ts` and is
  separate from player-owned item instances. No inventory assets were replaced.

## Central Square furnishings and fountain — 2026-09-12

- Benches and planters reuse the original `city-furniture.png` atlas documented
  above; their outdoor placement is defined in `packages/shared/src/city.ts`.
- `apps/client/src/game/fountainArt.ts` is an original code-drawn pixel-art recipe
  created for Atheriam. It creates six transparent 64 × 64 frames of a stone
  fountain with turquoise water. No external image or asset pack is used.
- The client shares this atlas across streamed chunks and animates it at 8 fps.

## Contemporary residents and social poses — 2026-09-12

- Sources: `resident-modern-source.png`, `resident-modern-ponytail-source.png`,
  `resident-modern-curly-source.png` in `apps/client/public/art`.
- Author/tool: OpenAI imagegen, generated specifically for Atheriam from original
  prompts. No external art pack or commercial game reference; not CC0 stock art.
- Prompts and preparation: [MODERN_RESIDENT_PROMPTS.md](design/MODERN_RESIDENT_PROMPTS.md).
- Runtime: `resident-modern-0.png` through `resident-modern-5.png`, 192 × 288;
  matching `portrait-modern-0.png` through `portrait-modern-5.png`, 32 × 48.
- Each atlas has four six-frame walk rows, six wave frames and six seated idle
  frames. Three source identities receive one curated alternate clothing palette
  each. Skin/hair identity comes from the original generated sources.
- `scripts/bake-modern-residents.mjs` packages complete silhouettes, removes the
  uniform magenta key, uses nearest-neighbour scaling and checks frame bounds.
  The accepted generated sources stay unchanged on disk. Rejected checkerboard
  outputs are not runtime assets. Earlier medieval source/runtime images remain
  preserved as historical assets and are no longer selected by the contemporary client loader.
