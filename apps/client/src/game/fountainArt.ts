/** Original pixel-drawn municipal fountain: one shared six-frame texture. */
export function fountainAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64 * 6;
  canvas.height = 64;
  const c = canvas.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  for (let frame = 0; frame < 6; frame++) {
    c.save();
    c.translate(frame * 64, 0);
    // Stepped stone basin, with a dark front face and an inset turquoise pool.
    rect(10, 56, 44, 6, '#a4aba5');
    rect(4, 38, 56, 18, '#626f72');
    rect(8, 32, 48, 28, '#849693');
    rect(14, 28, 36, 30, '#849693');
    rect(4, 36, 56, 14, '#e1dfcc');
    rect(8, 32, 48, 22, '#e1dfcc');
    rect(14, 28, 36, 28, '#e1dfcc');
    rect(10, 36, 44, 14, '#327f8a');
    rect(16, 32, 32, 22, '#327f8a');
    rect(12, 38, 40, 10, '#55b6ba');
    rect(18, 34, 28, 18, '#55b6ba');
    // Integer-pixel highlights move through a closed loop; the basin stays still.
    for (let i = 0; i < 4; i++) {
      const step = (frame + i * 2) % 6;
      rect(16 + i * 8, 39 + (i % 2) * 7, 2 + step, 2, '#a5e0cf');
    }
    rect(28, 31, 8, 12, '#d9d9c6');
    rect(26, 29, 12, 4, '#f2ead4');
    rect(30, 12, 4, 19, '#b9eee2');
    rect(32, 14, 2, 16, '#f0fff0');
    rect(26, 10, 12, 4, '#c8f3e6');
    rect(22, 14, 4, 4, '#9cddd8');
    rect(38, 14, 4, 4, '#9cddd8');
    const drop = frame * 2;
    rect(20, 20 + drop, 2, 4, '#d4fff0');
    rect(42, 20 + ((drop + 6) % 12), 2, 4, '#d4fff0');
    c.restore();
  }
  return canvas;
}
