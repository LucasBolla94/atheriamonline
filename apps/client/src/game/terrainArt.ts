/** Original code-native 32px terrain atlas. Shared textures, no per-chunk canvases. */
const CHARS = ['.', ',', 'p', 'b', 'd', '+', 's', '#', '~', 'T', 'F', 'M', 'W'];
export const terrainIndex = (char: string, x: number, y: number): number => {
  const base = Math.max(0, CHARS.indexOf(char));
  return base * 4 + (((Math.imul(x, 73) ^ Math.imul(y, 151)) >>> 0) % 4);
};

export function terrainAtlas(): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = 128;
  result.height = CHARS.length * 32;
  const c = result.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  CHARS.forEach((char, row) => {
    for (let variant = 0; variant < 4; variant++) {
      c.save();
      c.translate(variant * 32, row * 32);
      const grass = char === '.' || char === 'T' || char === 'F';
      const paving = char === 'p' || char === 'M' || char === 'W';
      rect(
        0,
        0,
        32,
        32,
        grass
          ? '#8eaf68'
          : paving
            ? '#d8c59d'
            : char === '~'
              ? '#66aeb2'
              : char === 's'
                ? '#c5c394'
                : '#c6ad7b',
      );
      if (grass) {
        for (let n = 0; n < 5; n++) {
          const x = (n * 17 + variant * 11) % 30,
            y = (n * 11 + variant * 7) % 29;
          rect(x, y, 2, 1, n % 2 ? '#7e9f5d' : '#a4bd7d');
          if (n === variant) rect(x + 1, y - 2, 1, 2, '#9ebb74');
        }
        if (variant === 3 && char === '.') {
          rect(23, 14, 2, 2, '#f3dfa0');
          rect(24, 16, 1, 2, '#708e52');
        }
      } else if (paving) {
        for (let yy = 0; yy < 32; yy += 8)
          for (let xx = -8; xx < 32; xx += 16) {
            const x = xx + (yy % 16 ? 8 : 0);
            rect(x, yy, 15, 7, (variant + yy + xx) % 3 ? '#e4d2ae' : '#ddcba6');
            rect(x + 1, yy + 1, 13, 1, '#ebdcbc');
          }
      } else if (char === 'd' || char === 'b' || char === '+') {
        rect(0, 0, 32, 32, '#ad7848');
        for (let yy = 0; yy < 32; yy += 8) {
          rect(0, yy, 32, 1, '#79543a');
          rect(0, yy + 1, 32, 1, '#cf9b62');
          rect((yy + variant * 9) % 32, yy, 1, 8, '#92613f');
          rect(5 + variant, yy + 5, 8, 1, '#b7834e');
        }
        if (char === '+') {
          rect(0, 0, 3, 32, '#614936');
          rect(29, 0, 3, 32, '#614936');
        }
      } else if (char === '#') {
        rect(0, 0, 32, 32, '#8b8873');
        for (let yy = 0; yy < 32; yy += 8)
          for (let xx = -8; xx < 32; xx += 16) {
            const x = xx + (yy % 16 ? 8 : 0);
            rect(x, yy, 14, 7, '#b6b19a');
            rect(x + 1, yy, 13, 2, '#cfccb3');
          }
      } else if (char === '~') {
        rect(3 + variant * 4, 9, 9, 1, '#91cac7');
        rect(15 - variant, 25, 11, 1, '#589fa8');
        rect(6 + variant, 10, 6, 1, '#79babc');
      } else {
        for (let n = 0; n < 8; n++)
          rect(
            (n * 13 + variant * 7) % 30,
            (n * 7 + variant * 11) % 31,
            2,
            1,
            char === 's' ? '#ded8aa' : '#d5bd8d',
          );
      }
      if (char === 'F') {
        rect(0, 13, 32, 3, '#977148');
        rect(5, 8, 4, 17, '#c29a61');
        rect(23, 8, 4, 17, '#c29a61');
      }
      c.restore();
    }
  });
  return result;
}
