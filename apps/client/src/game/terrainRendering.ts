import type Phaser from 'phaser';

export const TERRAIN_MARGIN = 1;
export const TERRAIN_SPACING = 2;

/** Duplicate edge texels so minification cannot sample another terrain tile. */
export function extrudeTerrainAtlas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const size = 32;
  out.width = (source.width / size) * (size + TERRAIN_SPACING);
  out.height = (source.height / size) * (size + TERRAIN_SPACING);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < source.height / size; y++)
    for (let x = 0; x < source.width / size; x++)
      for (const dy of [-1, 0, 1])
        for (const dx of [-1, 0, 1]) {
          const width = dx === 0 ? size : 1;
          const height = dy === 0 ? size : 1;
          ctx.drawImage(
            source,
            x * size + (dx === 1 ? size - 1 : 0),
            y * size + (dy === 1 ? size - 1 : 0),
            width,
            height,
            x * (size + 2) + (dx === -1 ? 0 : dx === 0 ? 1 : size + 1),
            y * (size + 2) + (dy === -1 ? 0 : dy === 0 ? 1 : size + 1),
            width,
            height,
          );
        }
  return out;
}

type GroundRenderer = (
  renderer: Phaser.Renderer.Canvas.CanvasRenderer,
  layer: Phaser.Tilemaps.TilemapLayer,
  camera: Phaser.Cameras.Scene2D.Camera,
) => void;

/** Ground has unrotated, unflipped tiles. Round shared screen edges, not widths. */
export function installGroundCanvasRenderer(layer: Phaser.Tilemaps.TilemapLayer): void {
  const original = (layer as typeof layer & { renderCanvas: GroundRenderer }).renderCanvas;
  const renderCanvas: GroundRenderer = (renderer, ground, camera) => {
    // Phaser 3.90 exposes these renderer fields but omits them from Camera types.
    const renderCamera = camera as typeof camera & {
      rotation: number;
      matrix: Phaser.GameObjects.Components.TransformMatrix;
    };
    if (renderCamera.rotation !== 0 || ground.rotation !== 0) {
      original.call(ground, renderer, ground, camera);
      return;
    }
    const ctx = renderer.currentContext;
    const matrix = renderCamera.matrix;
    const originX = ground.x - camera.scrollX * ground.scrollFactorX;
    const originY = ground.y - camera.scrollY * ground.scrollFactorY;
    ctx.save();
    // Camera clipping is already active. Draw directly in screen pixels so
    // fractional transforms cannot antialias the boundary of each rectangle.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const tile of ground.cull(camera)) {
      const set = ground.gidMap[tile.index];
      if (!set?.image) continue;
      const source = set.getTileTextureCoordinates(tile.index) as { x: number; y: number } | null;
      if (!source) continue;
      const left = Math.round(matrix.a * (originX + tile.pixelX * ground.scaleX) + matrix.e);
      const top = Math.round(matrix.d * (originY + tile.pixelY * ground.scaleY) + matrix.f);
      const right = Math.round(
        matrix.a * (originX + (tile.pixelX + set.tileWidth) * ground.scaleX) + matrix.e,
      );
      const bottom = Math.round(
        matrix.d * (originY + (tile.pixelY + set.tileHeight) * ground.scaleY) + matrix.f,
      );
      ctx.globalAlpha = camera.alpha * ground.alpha * tile.alpha;
      ctx.drawImage(
        set.image.getSourceImage() as HTMLCanvasElement,
        source.x,
        source.y,
        set.tileWidth,
        set.tileHeight,
        left,
        top,
        right - left,
        bottom - top,
      );
    }
    ctx.restore();
  };
  Object.assign(layer, { renderCanvas });
}
