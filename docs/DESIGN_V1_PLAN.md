# Atheriam V1.0 — Pixel art research and design plan

Date: 2026-09-12. The sections below preserve the initial research and proposal. The owner subsequently authorised implementation; the actual V1.0 scope is recorded here and in `PROGRESS.md`.

## Implementation update

The V1.0 redesign is published at https://atheriam.online. See [RELEASE_V1.md](RELEASE_V1.md) for the delivered scope and verification.

The client now uses original animated residents, terrain tiles and town objects, with a redesigned login, registration, HUD and touch controls. Six saved complete looks use three original resident sheets and three curated alternate clothing dyes. Registration offers the first three; all six are available from **Your look**. Each resident atlas contains 24 frames (six frames in each of four directions), in 32×48 cells. Existing eight-direction server movement is retained.

The initial modular wardrobe, separate sitting/waving animations and individual four-view furniture drawings are deferred. Upright furniture uses simple mirrored/narrow side representations; floor coverings rotate on the floor. There is no claim that these deliverables were validated by a player survey. The linked references informed design choices, not a promise of community acceptance.

Runtime images are baked in advance, rather than processing full source sheets on each phone. Production prompts and regeneration instructions are in [ART_PROMPTS.md](ART_PROMPTS.md); source and derived asset provenance are in [ASSETS.md](ASSETS.md). Browser validation covers desktop, mobile landscape and portrait resizing. Physical-device performance and a small community playtest remain follow-up validation.

The owner requested research into Habbo-like visual design and a practical plan for a simple pixel-art V1.0, then clarified the priority: **simpler art with good animation**. The recommendation is an original, welcoming medieval town with expressive, customisable human characters. Keep the existing square-grid view and put the first art effort into people, the arrival square and a furnished house. Reduce the initial wardrobe and detail density to protect animation quality.

This research reviewed the local rendering, character protocol and database, furniture catalogue, UI tokens and project documents, alongside the external sources linked below. It did not include a new play session, a player survey or a mobile performance measurement. Community acceptance remains untested.

## 1. Initial project audit (before implementation)

| Finding                                                                                    | Evidence                                                                    | Implication                                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Avatars are circles, with a colour distinction for yourself                                | `apps/client/src/game/WorldScene.ts`, `updateAvatar`                        | Faces, clothing, direction and animation will make a large visible difference.                              |
| The network already carries eight facing directions; the avatar renderer does not use them | `packages/protocol/src/messages.ts`, `playerViewSchema`; `updateAvatar`     | A first animated avatar can use the existing movement messages.                                             |
| Character appearance is not stored or sent                                                 | `packages/db/src/schema.ts`, `characters`; `playerViewSchema`               | A saved character editor requires database, API and protocol work, not just sprites.                        |
| Ground is a 32×32 texture enlarged to cover a 32×32-tile chunk                             | `WorldScene.ts`, `drawChunk`                                                | Detailed art requires a different ground renderer. Simply substituting colours with pictures will not work. |
| Yourself, other people and furniture have fixed drawing depths                             | `WorldScene.ts`, `updateAvatar`, `syncFurniture`                            | Tall sprites will need ordering by their ground contact point.                                              |
| Furniture is a rotated rectangle with a text label                                         | `WorldScene.ts`, `syncFurniture`                                            | Each object needs an image and appropriate directional views.                                               |
| Furniture API responses already include `definitionId`; the scene interface omits it       | `apps/client/src/net/api.ts`, `PlacedItem`; `WorldScene.ts`, `HouseScenery` | Carry that ID into the renderer; do not identify art by an English display name.                            |
| Phaser already enables `pixelArt`, disables antialiasing and rounds pixels                 | `apps/client/src/game/createGame.ts`                                        | Keep this foundation, then test camera zoom and movement for pixel stability.                               |
| Art files are absent and UI uses shared design tokens                                      | `docs/ASSETS.md`; `apps/client/src/tokens/`                                 | Establish a consistent art guide and asset registry before importing a catalogue.                           |

## 2. What the references contribute

These are comparative references, not proposed copies. The owner's request authorises studying Habbo. The proposed production art remains original; the existing specification's strict wording about commercial-game inspiration should be clarified when an actual visual direction is adopted.

| Reference                                                                                                     | Verified source facts                                                                                                                                                                           | Assessment for Atheriam                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Habbo / Sulake](https://www.sulake.com/habbo/)                                                               | The creator describes a colourful pixel-art social world with avatars and user-created rooms.                                                                                                   | Study how appearance and decorated spaces support identity and meeting people. Keep Atheriam's own proportions, clothes, objects, palette and interface.                           |
| [Modern Interiors / LimeZu](https://limezu.itch.io/moderninteriors)                                           | Provides modular furniture and a character generator with separate appearance choices. The complete-version terms allow commercial use and editing, require credit and restrict redistribution. | Useful reference for a coherent modular art pipeline. Its modern setting is not a ready-made medieval direction. No purchase is needed for this proposal.                          |
| [Universal LPC generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) | Provides modular character art, per-piece licences and downloadable credits. Its old sanderfrenken repository points to this maintained project.                                                | An alternative if production speed becomes the main constraint. Select a consistent subset and inspect each chosen piece's terms; the generator is not one uniform CC0 asset pack. |
| [Tiny Town / Kenney](https://kenney.nl/assets/tiny-town)                                                      | 16×16 tiles, 130 files, CC0 as listed on the asset page.                                                                                                                                        | Useful low-complexity environment option for a prototype. Scaling to the current 32-pixel grid does not automatically make its detail density match a new 32-pixel art set.        |
| [Sprout Lands / Cup Nooble](https://cupnooble.itch.io/sprout-lands-asset-pack)                                | A pastel farming pack with character animations. Its free version is non-commercial; premium terms permit commercial projects.                                                                  | Useful comparison for warmth and simple shapes. The free pack does not meet Atheriam's asset rules. Its cute farming presentation is also a different product tone.                |

The recommendation is **a small original character set plus an original matching environment kit**. Ready-made packs are alternatives if budget or artist availability requires a change. Mixing several packs would need deliberate repainting of proportions, lighting, outlines and palettes.

The sources establish what these products provide. The suitability judgements and the dimensions below are design proposals, not research findings about Atheriam's players.

## 3. Visual direction

Working description: **a welcoming medieval town where the people are the visual focus**.

- Keep the square-grid, top-down presentation. Show faces and the fronts of objects with a consistent slightly elevated view. Ground tiles stay square; there is no isometric coordinate conversion.
- Use broad, readable shapes: rounded hair silhouettes, simple tunics, aprons and boots. Avoid making every resident look like an armoured fighter. Additional clothing silhouettes can follow the initial release.
- Use warm stone, wood and linen; muted green terrain; blue water; restrained gold accents. Give clothing more contrast than the ground.
- Use a common upper-left light direction, coloured dark outlines and two or three shade steps per material. Avoid tiny texture noise.
- Keep ordinary UI and chat text in a readable screen font. Pixel art belongs in characters, scenery and icons; text does not need to become a sprite.
- Compare two original proportion studies: a compact expressive resident and a slightly taller resident. Put both on the same ground, at the same display scale, before choosing.

### Perspective decision

| Option                                             | Work introduced                                                                                               | V1.0 recommendation                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Existing view with new pixel art                   | Sprites, depth sorting, ground rendering, appearance data                                                     | Recommended; fits the current game structure.                                                            |
| Isometric presentation closer to Habbo's room view | New projection and inverse pointer mapping, camera bounds, object ordering, art angles and placement previews | A separate visual redesign. Server grid logic may be reusable, but the client work is materially larger. |

## 4. Character brief for the first prototype

Start with a **24×32-pixel visible character inside a 32×40-pixel transparent frame**, on the current 32×32-pixel logical tile. Treat this as a test size, not a permanent requirement. Give the head roughly one third of the visible height. Use simple colour clusters and few internal lines; do not add detail merely because a larger export permits it.

Anchor the feet at the existing tile centre. The image can extend into the tile above; its art size does not change the server's collision rules. Use a small contact shadow. Identify yourself with a ground marker and your name, so skin and clothing retain their chosen colours.

| Deliverable   | Initial scope                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Base body     | One common rig, with clothing options available to everyone                                       |
| Skin          | Six curated palette options, checked on light and dark ground                                     |
| Hair          | Three drawn silhouettes: short, long and curly/coily; bald uses no hair layer; four hair palettes |
| Clothing      | Two complete outfits: simple tunic and work apron; four clothing palettes                         |
| Facing        | Four drawn directions: north, south, east and west                                                |
| Idle          | Two subtle frames per direction; allow a still frame for reduced motion                           |
| Walk          | Six frames per direction, synchronised across body, clothing and hair                             |
| Starter looks | Six curated combinations for quick selection, followed by simple editing                          |

This is 32 animation slots per animated component before palette variants: 8 idle slots and 24 walking slots. Hair and clothes must line up in every slot. Palette swaps add variety cheaply; new silhouettes and outfits still require animation work. Fewer components keep the extra walk frames manageable.

Good animation means clear alternating foot contacts, a small opposing arm swing, a stable head silhouette and an intentional transition to rest. Start a walk promptly when confirmed movement is presented and stop it when the character settles. Use a restrained one-pixel vertical accent only if it improves the loop; do not bounce the label or shadow with the body. Test a starting playback rate around 8–10 animation frames per second, then tune cadence against the game's actual travel speed. That rate is a visual trial, not the server tick or display frame rate.

Keep the renderer's 60 fps goal and smooth positioning between server updates. A six-frame sprite loop can look good when movement and stopping are coherent; adding more drawings does not fix stutter, drifting feet or bad timing. Compare the loop in motion at actual size before approving it.

The server keeps eight-direction movement. For the first prototype map north-east/north-west to north-facing art and south-east/south-west to south-facing art. Test this in motion. If diagonals look poor, commission diagonal art before expanding the wardrobe. Do not change movement to hide an art limitation.

Draw asymmetric clothing and hair for both sides rather than assuming every image can be mirrored. Avoid arbitrary RGB recolouring in the first editor; curated palettes are easier to keep legible.

An animated wave is a useful later social addition, but it requires a shared emote event and rate limiting to be visible to other players. Sitting additionally needs occupancy and furniture behaviour. Neither should quietly enter a sprite-only task.

## 5. Environment and interface scope

The first playable sample should contain the arrival square, a short walk past a tree and a stall, and one furnished house. It should show several distinct residents together with chat bubbles. Finish this sample before drawing the whole city.

For V1.0, every existing map symbol needs an intentional visual treatment, including areas outside the sample. Keep the catalogue small:

- Ground: grass, road, pavement, bridge, floor and shore; edges and corners where those materials meet. Use only a few quiet variations per surface.
- Structures and props: wall, door, fence, tree, stall and well. Put tall parts above their ground base and keep navigable routes visually clear.
- Water: begin with a still tile and shoreline; a shared three-frame loop can follow if the measured performance budget allows it. Keep environmental movement slow so it does not compete with people.
- Furniture: draw the five existing furniture types—oak stool, rush mat, clay lamp, long table and wool rug—before adding new items.
- Inventory: eight matching icons cover the current five furniture types and three trinkets—copper pin, river stone and brass bell.
- UI: a small avatar preview, clearly labelled inventory/home/appearance actions, selection and destination feedback, and calmer chat bubbles. Keep controls reachable on a short landscape screen.

Directional furniture needs appropriate views for 0/90/180/270 degrees. A floor mat can often reuse rotated art; turning a drawn upright lamp sideways cannot stand in for a new view. Reuse symmetric views only where the object actually allows it.

The current furniture placement system does not define a multi-tile footprint. In particular, the long table's name does not make it occupy several server tiles. Keep its first representation within the supported footprint, or make larger footprints a separate gameplay change with placement tests.

Names and chat must remain readable around a crowd. Test overlap rather than permanently labelling every furniture object. Move descriptive furniture names into selection details where practical. Keep the game's English UI strings in `strings.ts` and styling in the shared tokens.

## 6. Implementation sequence

### A. Choose the proportions and art rules

Produce two original avatar studies, a palette sheet, a walk loop and the same small scene with each study. Review at actual desktop and mobile size, not just enlarged artwork. Select one direction after the first player sessions. Record the adopted direction in `SPEC.md`, the rationale in `DECISIONS.md`, and the new work in `PROGRESS.md` when implementation starts.

### B. Add animated characters with fixed starter looks

Introduce an asset preload step and a small sprite atlas. Extract avatar rendering from the large `WorldScene` into a focused module. Render from server positions and facing; use displacement and the existing interpolation for walking visuals. Stop the walk loop when movement stops or a correction completes.

Keep ground below the scene, then place people and upright props in a shared depth-sorted list using their foot/base Y coordinate and a stable tie-breaker. Do not put all furniture in one container beneath all avatars. Draw names and bubbles in a separate overlay, following their subjects. Phaser supports depth ordering within a [Layer](https://docs.phaser.io/phaser/concepts/gameobjects/layer) and exposes [depth components](https://docs.phaser.io/phaser/concepts/gameobjects/components).

### C. Persist and synchronise appearance

Add a validated, versioned appearance record with stable IDs for skin palette, hairstyle, hair palette, outfit and clothing palette. Supply a default for existing characters. The API should accept only catalogue values, persist the player's own appearance and notify the world server through the existing Redis link.

Extend the character protocol and update handling so a standing player changes appearance for observers immediately. The current snapshot signature only compares position and facing; both world revision invalidation and snapshot comparison must account for an appearance revision. Confirm appearance survives city/house transitions, reconnects and server restarts. Coordinate protocol compatibility during deployment.

Keep the first editor free and independent of item ownership. Tradable clothing would be a later economy feature. Build a bounded client cache of composed looks, generated when needed, with disposal when unused. Do not export every possible combination or regenerate textures every frame.

### D. Replace flat ground and furniture

Map the existing tile symbols to an atlas and benchmark a Phaser tilemap renderer for streamed chunks. Reuse the shared atlas instead of allocating a full-size canvas texture for every chunk. A 1024×1024 RGBA texture alone is about 4 MiB before additional overhead, so per-chunk texture baking needs a measured memory budget.

Retain bounded loading work and unloading. Resolve material edges consistently across chunk boundaries and after neighbouring chunks arrive. Separate walkability from decoration so a grass or paving variant cannot change server collision.

Carry furniture `definitionId` through `HouseScenery`, map IDs and rotations to sprite frames, and use the same catalogue for inventory previews. Tall trees and buildings may need split foreground pieces or a fade treatment when obscuring the local avatar. Test those cases in the sample scene.

### E. Polish, measure and stage the release

The current zoom is continuous between 0.6 and 2.2. Pixel-art configuration alone does not make fractional zoom pixel-perfect. Test the default scale, pinch zoom and camera movement for shimmer. Prefer a crisp default; evaluate settling to suitable zoom steps after gestures without making mobile navigation awkward.

Use a staging build with a render fallback before deployment. An appearance migration should be additive, keep old accounts usable and have a documented rollback path. Releasing art should not require resetting characters, money, inventory or houses.

## 7. Community validation

Recruit 12–20 adults from the intended audience: some familiar with Habbo-style social worlds, some new to them, with a mix of desktop and mobile users. No participants have been recruited or contacted as part of this research.

Show the two proportion studies in alternating order, with equal image scale and scene quality. Ask participants to identify their avatar in a crowd, choose a look, walk behind an object, talk and place an item. Ask what feels appealing, hard to read or out of place, and whether they would want to keep using that character. Avoid asking only which image is prettier.

Proposed decision thresholds, to agree before testing:

- At least 80% identify their avatar among ten characters within five seconds, using the intended self marker.
- At least 80% choose and save a look within two minutes without help.
- At least 75% rate the chosen character direction 4 or 5 out of 5 for wanting to use it.
- No unresolved blocker for reading chat, navigating or placing furniture on the tested phones.
- Review recurring comments about age, warmth, personal identity and similarity to other games before locking the art guide.

Record counts, devices and observed failures as well as percentages. This small group supplies directional feedback, not statistical proof of broad acceptance. Revise the prototype once and test again if the main concerns remain. Asset-store ratings are not evidence that Atheriam's community will accept a style.

## 8. Completion checks and effort

For each implementation stage run the required typecheck, lint and unit tests. Appearance persistence and access validation need integration tests. Use browser checks for walking/stopping, diagonal facing, appearance changes between two clients, occlusion, chat anchoring, house transitions, furniture rotation, missing-asset fallback and mobile controls. Re-run the existing economy/house/trade checks when changes touch their data flow.

Measure on real target hardware with 10, 30 and 50 visible animated avatars, while walking between chunks and opening UI. Test the server's supported population separately; the old server load test does not establish sprite-rendering performance. Record frame-time distributions, long stalls, texture counts and memory after repeated travel. Keep the existing 60 fps goal and investigate normal-play work exceeding the specification's 16 ms main-thread budget. Do not declare mobile performance from a desktop screenshot or average FPS alone.

Every shipping image needs the author, source, exact licence/usage terms and date in `ASSETS.md`, with credits accessible where required. Original art also needs recorded provenance and agreed usage rights. Save editable source files and reproducible atlas exports.

Planning estimate: **15–25 focused working days across art production and engineering**, assuming a small kit, one agreed direction, an available pixel artist and one feedback revision. This includes the saved appearance editor and environment work, not just the character drawing. The reduced wardrobe reserves effort for better animation rather than guaranteeing a shorter schedule. This is an initial estimate, not a delivery commitment or an artist quote; the first animated prototype should be used to revise it. Community scheduling and new gameplay are additional uncertainties.

| Stage                                        | Indicative effort | Reviewable result                                          |
| -------------------------------------------- | ----------------- | ---------------------------------------------------------- |
| Direction and first player feedback          | 2–3 days          | Two avatar studies and one selected art guide              |
| Animated avatar sample                       | 3–5 days          | Several residents walking and chatting in the sample scene |
| Appearance editor and persistence            | 4–6 days          | A saved look seen correctly by another player              |
| Small environment kit and existing furniture | 4–7 days          | Coherent city and house presentation                       |
| Mobile checks and final corrections          | 2–4 days          | Measured candidate build and recorded issues resolved      |

**First implementation milestone:** a reviewable scene with original animated residents, the well, a tree, a stall and a furnished house. This demonstrates the proposed V1.0 visual language before expanding production.
