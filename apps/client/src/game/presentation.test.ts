import { expect, it } from 'vitest';
import { movementBlend, terrainViewForCamera } from './presentation.js';

it('keeps the same visual catch-up over equal elapsed time at different frame rates', () => {
  const positions = [30, 60, 144].map((fps) => {
    let x = 0;
    for (let frame = 0; frame < fps; frame++) x += (32 - x) * movementBlend(1000 / fps);
    return x;
  });
  expect(positions[0]).toBeCloseTo(positions[1]!, 10);
  expect(positions[1]).toBeCloseTo(positions[2]!, 10);
  expect(movementBlend(-1)).toBe(0);
  expect(movementBlend(10_000)).toBeLessThanOrEqual(1);
});

it('covers wide zoom-out views plus facades instead of assuming a fixed 24-tile radius', () => {
  const view = terrainViewForCamera(
    { x: 400, y: 1500, width: 2560 / 0.6, height: 1440 / 0.6 },
    { x: 80, y: 85 },
    { width: 160, height: 160 },
  );
  expect(view.radiusX).toBeGreaterThanOrEqual(76);
  expect(view.radiusY).toBeGreaterThanOrEqual(59);
});

it('covers the far edge of a camera clamped away from the player', () => {
  const view = terrainViewForCamera(
    { x: 0, y: 0, width: 3200, height: 1800 },
    { x: 1, y: 1 },
    { width: 160, height: 160 },
  );
  expect(view.radiusX).toBeGreaterThanOrEqual(107);
  expect(view.radiusY).toBeGreaterThanOrEqual(75.25);
});

it('bounds giant viewport requests and clips empty space outside small rooms', () => {
  expect(
    terrainViewForCamera(
      { x: -100, y: -100, width: 1e9, height: 1e9 },
      { x: 1, y: 1 },
      { width: 10000, height: 10000 },
    ),
  ).toEqual({ radiusX: 256, radiusY: 256 });
  const room = terrainViewForCamera(
    { x: -2000, y: -1000, width: 5000, height: 3000 },
    { x: 7, y: 6 },
    { width: 14, height: 12 },
  );
  expect(room).toEqual({ radiusX: 16, radiusY: 28 });
});
