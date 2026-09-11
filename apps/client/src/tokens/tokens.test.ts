import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colorTokens, fontSizeTokens, radiusTokens, spaceTokens, toCssColor } from './tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8');

function cssValue(name: string): string | undefined {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim();
}

describe('toCssColor', () => {
  it('pads short colours so they stay six digits', () => {
    expect(toCssColor(0x000000)).toBe('#000000');
    expect(toCssColor(0x0000ff)).toBe('#0000ff');
    expect(toCssColor(0xc9a227)).toBe('#c9a227');
  });
});

describe('the two copies of the tokens agree', () => {
  // Phaser needs numbers and CSS needs strings, so the values exist twice.
  // If they ever drift, the game and the interface stop looking like one
  // product — and nobody notices until a screenshot looks wrong.
  const sharedColors: Array<[keyof typeof colorTokens, string]> = [
    ['backdrop', 'color-backdrop'],
    ['surface', 'color-surface'],
    ['surfaceRaised', 'color-surface-raised'],
    ['border', 'color-border'],
    ['text', 'color-text'],
    ['textMuted', 'color-text-muted'],
    ['accent', 'color-accent'],
    ['accentText', 'color-accent-text'],
    ['danger', 'color-danger'],
  ];

  it.each(sharedColors)('colour %s matches --%s', (tokenName, cssName) => {
    expect(cssValue(cssName)).toBe(toCssColor(colorTokens[tokenName]));
  });

  const sharedSpaces: Array<[keyof typeof spaceTokens, string]> = [
    ['xs', 'space-xs'],
    ['sm', 'space-sm'],
    ['md', 'space-md'],
    ['lg', 'space-lg'],
    ['xl', 'space-xl'],
  ];

  it.each(sharedSpaces)('spacing %s matches --%s', (tokenName, cssName) => {
    expect(cssValue(cssName)).toBe(`${spaceTokens[tokenName]}px`);
  });

  const sharedFontSizes: Array<[keyof typeof fontSizeTokens, string]> = [
    ['sm', 'font-size-sm'],
    ['md', 'font-size-md'],
    ['lg', 'font-size-lg'],
    ['xl', 'font-size-xl'],
  ];

  it.each(sharedFontSizes)('font size %s matches --%s', (tokenName, cssName) => {
    expect(cssValue(cssName)).toBe(`${fontSizeTokens[tokenName]}px`);
  });

  it('radii match', () => {
    expect(cssValue('radius-sm')).toBe(`${radiusTokens.sm}px`);
    expect(cssValue('radius-md')).toBe(`${radiusTokens.md}px`);
    expect(cssValue('radius-pill')).toBe(`${radiusTokens.pill}px`);
  });
});
