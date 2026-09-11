/**
 * Design tokens: the only place a colour, a size or a font is decided.
 *
 * The rule from `docs/SPEC.md`: the interface is styled **only** through these
 * tokens. A component never writes `#3b2f2f` or `12px` of its own. When the
 * look of the game changes, it changes here and nowhere else.
 *
 * The same values exist twice on purpose:
 *  - `tokens.css` for React, which wants CSS custom properties;
 *  - this file for Phaser, which wants numbers.
 * `tokens.test.ts` checks the two never drift apart.
 */

/** Colours, as the numbers Phaser needs. */
export const colorTokens = {
  /** The page behind everything. */
  backdrop: 0x14110f,
  /** Panels and dialogs. */
  surface: 0x241f1b,
  surfaceRaised: 0x342c26,
  /** The line around a panel. */
  border: 0x4a3f36,
  /** Ordinary text. */
  text: 0xf2e9dd,
  /** Text that matters less. */
  textMuted: 0xa89880,
  /** The kingdom's colour, used for anything the player should act on. */
  accent: 0xc9a227,
  accentText: 0x1a1510,
  /** Something went wrong. */
  danger: 0xb4472e,

  // World tiles: one colour per kind of ground, matching the alphabet in
  // `@atheriam/shared`. These are flat colours, not artwork — no image enters
  // the repository before `docs/ASSETS.md` can record its licence.
  tileGrass: 0x3f5137,
  tileGrassAlt: 0x445839,
  tileRoad: 0x6b5c45,
  tileRoadAlt: 0x73644b,
  tileWall: 0x2b2521,
  tileWallAlt: 0x332c27,
  tileWater: 0x2c4a5c,
  tileWaterAlt: 0x315265,
  tilePavement: 0x6e6862,
  tilePavementAlt: 0x77716a,
  tileShore: 0x8a7c5f,
  tileShoreAlt: 0x93856a,
  tileBridge: 0x7a5f3c,
  tileBridgeAlt: 0x836745,
  tileFloor: 0x6b4f34,
  tileFloorAlt: 0x74573b,
  tileDoor: 0x9c6b35,
  tileTree: 0x2f4326,
  tileFence: 0x5a4630,
  tileStall: 0x8c4a3a,
  tileWell: 0x4a4440,
  /** Ground we have not been sent. Drawn as the night outside the walls. */
  tileUnknown: 0x0d0b0a,

  /** Your own character. */
  self: 0xc9a227,
  /** Everyone else. */
  other: 0xd8d2c8,
} as const;

/** Spacing, in pixels, on a 4-pixel rhythm. */
export const spaceTokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

/** Type sizes, in pixels. */
export const fontSizeTokens = {
  sm: 12,
  md: 14,
  lg: 18,
  xl: 28,
} as const;

export const radiusTokens = {
  sm: 4,
  md: 8,
  pill: 999,
} as const;

export const fontFamilyTokens = {
  ui: "'Segoe UI', Roboto, system-ui, -apple-system, sans-serif",
} as const;

/** A colour token as the `#rrggbb` string that CSS wants. */
export function toCssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
