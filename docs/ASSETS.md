# Atheriam — Assets

Every image, sound and font used in the game is recorded here, with its
licence. This is not paperwork for its own sake: the rule in `docs/SPEC.md`
section 12 is that an asset with an unknown or NonCommercial licence is never
used, and this file is how we prove it.

## The rule, in plain words

Before a file goes into the repository, write a row in the table below. It
needs:

- the file, as a path in this repository;
- who made it;
- where it came from (a link);
- the licence, which must allow **commercial use and modification**;
- the date it was added.

If you cannot fill in all five, the file does not go in. There are no
temporary exceptions and no placeholders "just for now".

Licences that are fine: CC0, CC-BY (with attribution given below), and anything
made specifically for this project.
Licences that are not: NonCommercial (NC), NoDerivatives (ND), "free for
personal use", anything unlabelled, and anything taken from another game.

## Assets in use

| File         | Author | Source | Licence | Added |
| ------------ | ------ | ------ | ------- | ----- |
| _(none yet)_ |        |        |         |       |

**The game uses no image files at all.** Every phase is finished and the
table above is still empty, which is worth being plain about rather than
quietly leaving a promise in a document.

The whole world — ground, walls, water, trees, market stalls, furniture and
the people themselves — is drawn with flat colours taken from the design
tokens in `apps/client/src/tokens/tokens.ts`. The ground is painted at one
pixel per tile and scaled up, which is only possible _because_ the tiles are
flat colours (see D-056).

That was a deliberate choice at the start — the game had to work before any
art existed, and nothing could slip into the repository unrecorded — and it
has held all the way through. It is also the honest state of things: the game
is playable and it looks like coloured squares.

Artwork is therefore the first thing to add that is not on the phase list.
When it arrives:

- the first row of the table above is written on the same day as the first
  `.png`, with all five columns filled in;
- `drawChunk` in `apps/client/src/game/WorldScene.ts` goes back to drawing at
  full size, or to a tilemap, because the one-pixel-per-tile trick only works
  for flat colour;
- nothing is taken from, traced from or renamed out of another game, which is
  a rule in `docs/SPEC.md` section 2 and not a preference.
