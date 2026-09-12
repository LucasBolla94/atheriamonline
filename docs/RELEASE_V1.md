# Atheriam V1.0 — Visual release

Published and verified: 2026-09-12 at https://atheriam.online.
The standard deployment completed with checks enabled. See `PROGRESS.md` for
validation and backup details.

## What changed

- Original pixel-art residents replace the coloured circles. Their walk cycles
  have four drawn directions and six frames per direction. Diagonal walking
  continues to use the existing server rules.
- Three starting appearances can be chosen during registration. **Your look**
  offers all six complete looks, saves the choice and shows it to neighbours.
- The city has textured stone paths, wood floors, water, trees, wells, market
  stalls, cottages and planted islands around the square.
- Furniture has pictures in the house and inventory. Floor coverings rotate;
  upright objects use simple mirrored and narrow side representations.
- Login, registration, menus, portraits and navigation share the new cream,
  sandstone and green design.
- Touch devices have a direction pad as well as tap-to-walk. The canvas adapts
  when the screen rotates. Chat can be folded away when more walking space is
  wanted.

## Try it

1. Open https://atheriam.online and log in, or choose **Create an account**.
2. Walk with WASD / arrow keys on desktop. On a phone, tap a path or hold one
   of the four direction buttons.
3. Type into the chat box and press **Say**. People nearby receive the message.
4. Open **Your look**, select an appearance and press **Wear this look**.
   Reloading the page keeps it.
5. Open **Go home**, choose an item, close the panel and tap a floor tile to
   place it. Use **House** to manage the furniture and **Step outside** to
   return to the city.

Existing accounts, positions, money, belongings and houses remain in place.
Existing characters receive the first look until their owner changes it.

## Scope and validation limits

The artwork was generated for this project; prompts, source provenance and
regeneration instructions are in [ART_PROMPTS.md](ART_PROMPTS.md) and
[ASSETS.md](ASSETS.md). The welcome illustration is decorative scene art, not
a screenshot of the playable map. No commercial-game artwork is included.

This release uses complete looks, not separately interchangeable hair, skin
and clothing pieces. Sitting, waving and a larger wardrobe remain later work.
Browser tests cover desktop and mobile emulation. They do not establish
60 fps on physical phones or community approval of the style. The small adult
community playtest proposed in [DESIGN_V1_PLAN.md](DESIGN_V1_PLAN.md) is the
next way to evaluate those visual preferences.

## Verification

- Typecheck, lint and production build passed.
- 275 unit tests and 109 integration tests passed.
- 66 local browser scenarios passed across the test groups; two cases are
  intentionally skipped on the device they do not apply to.
- 16 live browser checks passed after publication.
- Production assets match the build, the appearance migration is present,
  and API, world and Caddy are active.
- Temporary test accounts were removed.

Actual live views: [login](design/live-desktop-login.png),
[city](design/live-desktop-city.png),
[portrait touch controls](design/live-mobile-landscape-city.png).
