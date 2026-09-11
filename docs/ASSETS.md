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

**Phase 1 uses no image files at all.** The world is drawn with flat coloured
rectangles from the design tokens in `apps/client/src/tokens/tokens.ts`. That
is a deliberate choice: the walking skeleton proves the game works before any
art exists, and nothing can slip into the repository unrecorded.

Real artwork arrives in Phase 3, and the first row of this table is written on
the same day as the first `.png`.
