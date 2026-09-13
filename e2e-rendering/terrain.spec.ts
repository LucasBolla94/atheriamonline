import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type Phaser from '../apps/client/node_modules/phaser';
import type * as TerrainRendering from '../apps/client/src/game/terrainRendering.js';

const root = new URL('../', import.meta.url);
const rendererCode = ts.transpileModule(
  readFileSync(new URL('apps/client/src/game/terrainRendering.ts', root), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

for (const renderer of ['CANVAS', 'WEBGL'] as const) {
  test(`${renderer} terrain has no seams at fractional zoom and chunk boundaries`, async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({
      path: new URL('apps/client/node_modules/phaser/dist/phaser.js', root).pathname,
    });
    await page.addScriptTag({
      content: `window.terrainRendering = {}; (function(exports) { ${rendererCode} })(window.terrainRendering);`,
    });
    const results = await page.evaluate(async (renderer) => {
      const fixture = window as unknown as {
        Phaser: typeof Phaser;
        terrainRendering: typeof TerrainRendering;
      };
      const P = fixture.Phaser;
      const state: { scene?: Phaser.Scene } = {};
      const game = new P.Game({
        type: P[renderer],
        width: 800,
        height: 600,
        pixelArt: true,
        antialias: false,
        roundPixels: true,
        backgroundColor: '#ff00ff',
        render: { preserveDrawingBuffer: true },
        scene: {
          create(this: Phaser.Scene) {
            // Blue neighbours expose UV bleed; magenta background exposes gaps.
            const atlas = document.createElement('canvas');
            atlas.width = 128;
            atlas.height = 64;
            const ctx = atlas.getContext('2d')!;
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 0, 128, 64);
            ctx.fillStyle = '#8eaf68';
            ctx.fillRect(32, 0, 32, 32);
            this.textures.addCanvas('ground', fixture.terrainRendering.extrudeTerrainAtlas(atlas));
            const map = this.make.tilemap({ tileWidth: 32, tileHeight: 32, width: 64, height: 64 });
            const set = map.addTilesetImage(
              'ground',
              'ground',
              32,
              32,
              fixture.terrainRendering.TERRAIN_MARGIN,
              fixture.terrainRendering.TERRAIN_SPACING,
            )!;
            for (let y = 0; y < 2; y++)
              for (let x = 0; x < 2; x++) {
                const layer = map.createBlankLayer(
                  `floor:${x}:${y}`,
                  set,
                  x * 1024,
                  y * 1024,
                  32,
                  32,
                )!;
                layer.fill(1);
                fixture.terrainRendering.installGroundCanvasRenderer(layer);
              }
            state.scene = this;
          },
        },
      });
      while (!state.scene) await new Promise((resolve) => setTimeout(resolve, 20));
      const scene = state.scene;
      const results: { zoom: number; offset: number; badPixels: number }[] = [];
      for (const offset of [0, 0.37])
        for (const zoom of [2.2, 1, 0.9, 0.81, 0.729, 0.6561, 0.6]) {
          scene.cameras.main.setZoom(zoom).setScroll(603 + offset, 591 + offset);
          await new Promise<void>((resolve) =>
            game.events.once(P.Core.Events.POST_RENDER, resolve),
          );
          let data: Uint8Array | Uint8ClampedArray;
          if (renderer === 'CANVAS')
            data = game.canvas.getContext('2d')!.getImageData(0, 0, 800, 600).data;
          else {
            const gl = (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl;
            data = new Uint8Array(800 * 600 * 4);
            gl.readPixels(0, 0, 800, 600, gl.RGBA, gl.UNSIGNED_BYTE, data);
          }
          let badPixels = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] !== 142 || data[i + 1] !== 175 || data[i + 2] !== 104) badPixels++;
          results.push({ zoom, offset, badPixels });
        }
      game.destroy(true);
      return results;
    }, renderer);
    for (const result of results) expect(result.badPixels, JSON.stringify(result)).toBe(0);
  });
}
