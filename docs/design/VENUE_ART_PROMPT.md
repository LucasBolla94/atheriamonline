# Public furniture sprite sheet

Built-in image generation, 2026-09-12. Original project artwork, no external
reference image. Generated source: `apps/client/public/art/city-furniture-source.png`.
Runtime atlas: `apps/client/public/art/city-furniture.png`.

Generation prompt:

Use case: stylized-concept. Asset type: ONE game-ready pixel-art furniture sprite atlas for an original contemporary social city game, top-down orthographic 3/4 view (camera looking down, front faces visible), absolutely no isometric diamond axes. Create a single landscape transparent PNG sprite sheet, ideally 1024x768, arranged as an exact evenly spaced 4-column by 3-row grid, 12 independent isolated objects, one centered object per cell with generous transparent margins. Each sprite should resemble crisp hand-authored 48-96 pixel furniture enlarged with nearest-neighbor edges: blocky pixels, small restrained palette, strong readable silhouettes, minimal tiny detail, consistent dark olive outlines and soft short contact shadows only. Warm cream, honey wood, sage green, teal and terracotta accents. ALL horizontal table/sofa/bench front edges exactly horizontal, vertical legs vertical. Row 1 left to right: a lush leafy indoor plant in a terracotta pot; a contemporary two-person honey-wood park bench with sage metal legs facing viewer; a cozy teal two-seat lounge sofa facing viewer; a low rectangular honey-wood coffee table with one tiny cup. Row 2 left to right: a modern cream and honey-wood cafe counter with a small espresso machine; an upright wood bookshelf of colorful books; a large oval honey-wood meeting table viewed from above/front, NO attached chairs; a single teal upholstered office chair facing viewer. Row 3 left to right: a cream desk with dark monitor and small keyboard; a freestanding sage-frame community noticeboard with colored blank papers; a low terracotta planter box of green foliage; a small contemporary wood lectern with a microphone. No room backgrounds, no people, no floors, no text, no labels, no grid lines, no logos or watermarks, no medieval decorations. Do not imitate any commercial game's artwork. Preserve genuine alpha transparency throughout the space around the sprites. This is one cohesive atlas, not a collage of different styles.

The tool returned a 1448×1086 PNG with alpha. The production packager uses
connected silhouettes rather than clipping blindly to grid cells: the meeting
table crosses one nominal cell boundary. This preserves the full table and avoids
including its edge in the office-chair frame. Small disconnected alpha noise is
excluded from frame bounds; the source PNG remains unchanged. All resampling
uses nearest-neighbour sampling and a consistent bottom anchor. No AI image edit
or external asset was required after generation.
