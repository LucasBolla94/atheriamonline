# Contemporary building art

Built-in image generation, 2026-09-12. Original project art, no external reference.
Source: `apps/client/public/art/central-buildings-source.png`.
The first output had a gradient background; an image-tool edit replaced only
the background with magenta. `scripts/bake-buildings.mjs` extracts transparency
and prepares six 128-pixel sprites, thumbnails and their runtime atlas.

Generation prompt:

Use case: stylized-concept. Asset type: original pixel art BUILDING SPRITE SHEET for contemporary top-down 2D social browser game Atheriam. Exactly SIX isolated small modern buildings in a strict 3 columns by 2 rows grid, 1536x1024 canvas, each object centered in its own 512x512 cell with generous clear margins. True transparent background, preserve alpha, no scene or terrain or shadows extending beyond each sprite. Same orthographic top-down 3/4 camera for every building: horizontal straight facade faces south toward bottom of sheet, rectangular roof visible above it, never diamond/isometric footprint. Buildings have clean simple chunky pixel clusters and limited shading, dark blue-green outlines, charming original indie pixel art, contemporary flat roofs and broad storefront windows. Doors centered on bottom-facing facade, all building corners fully visible. TOP ROW left: cream civic city hall with compact clock and teal glass double doors. Middle: lilac creative studio with roof skylights and art display windows. Right: pale blue events hall with a coral roof-edge banner. BOTTOM ROW left: coral neighborhood café/lounge with striped cream awning, large central entrance, two small planters. Middle: teal market hall with cream canopy and glass windows. Right: simple sand-colored two-storey commercial storefront with flat roof and teal door/windows. Buildings only, no people, no text, no labels, no scenery, no watermark, no medieval architecture, no copied commercial-game assets. Clean production sheet, exactly six separate sprites, absolutely no overlap or crop.

Edit: preserve all six buildings and their grid positions; replace all background
outside their silhouettes with flat RGB 255,0,255, removing background gradients
and ground shadows. No changes to building geometry or details.
