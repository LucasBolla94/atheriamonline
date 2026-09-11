/**
 * The Phaser scene that draws the world.
 *
 * What this file may do: draw what the server said, and turn what the player
 * does with the mouse and keyboard into intents.
 *
 * What this file may never do: decide that the player moved. The character on
 * screen slides towards the position in the last snapshot. If the server says
 * something different, the character slides there instead — that is a
 * correction, and it is meant to happen.
 *
 * Phase 1 draws flat coloured tiles rather than artwork. That is deliberate:
 * it keeps the walking skeleton honest, and it means no image enters the
 * repository before `docs/ASSETS.md` can record its licence.
 */
import Phaser from 'phaser';
import { MIN_STEP_INTERVAL_MS, TILE_SIZE_PX, type Direction } from '@atheriam/shared';
import type { MapPatch, PlayerView } from '@atheriam/protocol';
import { colorTokens, fontFamilyTokens, fontSizeTokens } from '../tokens/tokens.js';
import type { WorldConnection } from '../net/connection.js';

/** How quickly a character catches up with where the server says it is. */
const MOVE_LERP_PER_MS = 0.012;

/** Below this distance in pixels we simply snap, to avoid endless creeping. */
const SNAP_DISTANCE_PX = 0.5;

const TILE_COLORS: Readonly<Record<string, number>> = {
  '.': colorTokens.tileGrass,
  ',': colorTokens.tileRoad,
  '#': colorTokens.tileWall,
  '~': colorTokens.tileWater,
};

const KEY_DIRECTIONS: ReadonlyArray<readonly [string, Direction]> = [
  ['W', 'n'],
  ['S', 's'],
  ['A', 'w'],
  ['D', 'e'],
  ['UP', 'n'],
  ['DOWN', 's'],
  ['LEFT', 'w'],
  ['RIGHT', 'e'],
];

/** One character on screen: its body, its name, and where it is heading. */
interface Avatar {
  readonly container: Phaser.GameObjects.Container;
  targetPx: { x: number; y: number };
}

export interface WorldSceneData {
  readonly connection: WorldConnection;
  readonly map: MapPatch;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private connection!: WorldConnection;
  private mapPatch!: MapPatch;
  private avatars = new Map<string, Avatar>();
  private keys = new Map<Direction, Phaser.Input.Keyboard.Key[]>();
  private lastStepSentAtMs = 0;

  constructor() {
    super(WorldScene.KEY);
  }

  init(data: WorldSceneData): void {
    this.connection = data.connection;
    this.mapPatch = data.map;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(colorTokens.backdrop);
    this.drawMap();
    this.setUpCamera();
    this.setUpKeyboard();
    this.setUpPointer();
  }

  override update(_time: number, delta: number): void {
    this.pollKeyboard();
    this.syncAvatars();
    this.easeAvatars(delta);
  }

  // -- drawing ------------------------------------------------------------

  /**
   * The map never changes during Phase 1, so it is drawn once into a single
   * texture. Drawing a thousand rectangles every frame would be the easiest
   * way to miss the 60 fps target on a phone.
   */
  private drawMap(): void {
    const { width, height, rows } = this.mapPatch;
    const graphics = this.add.graphics();

    for (let y = 0; y < height; y += 1) {
      const row = rows[y];
      if (row === undefined) continue;
      for (let x = 0; x < width; x += 1) {
        const char = row[x] ?? '#';
        const base = TILE_COLORS[char] ?? colorTokens.tileWall;
        // A faint checker makes the grid readable without drawing gridlines.
        const shade = (x + y) % 2 === 0 ? base : this.lighten(base, char);
        graphics.fillStyle(shade, 1);
        graphics.fillRect(x * TILE_SIZE_PX, y * TILE_SIZE_PX, TILE_SIZE_PX, TILE_SIZE_PX);
      }
    }

    const texture = this.add.renderTexture(0, 0, width * TILE_SIZE_PX, height * TILE_SIZE_PX);
    texture.setOrigin(0, 0);
    texture.draw(graphics, 0, 0);
    texture.setDepth(0);
    graphics.destroy();
  }

  private lighten(base: number, char: string): number {
    if (char === '.') return colorTokens.tileGrassAlt;
    if (char === ',') return colorTokens.tileRoadAlt;
    return base;
  }

  private setUpCamera(): void {
    const worldWidth = this.mapPatch.width * TILE_SIZE_PX;
    const worldHeight = this.mapPatch.height * TILE_SIZE_PX;
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setRoundPixels(true);
  }

  // -- input --------------------------------------------------------------

  private setUpKeyboard(): void {
    const keyboard = this.input.keyboard;
    if (keyboard === null || keyboard === undefined) return;

    for (const [keyName, direction] of KEY_DIRECTIONS) {
      const key = keyboard.addKey(keyName);
      const existing = this.keys.get(direction) ?? [];
      existing.push(key);
      this.keys.set(direction, existing);
    }
  }

  private setUpPointer(): void {
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      // A drag is a camera gesture, not a walk order.
      if (pointer.getDistance() > TILE_SIZE_PX / 2) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.connection.walkTo({
        x: Math.floor(world.x / TILE_SIZE_PX),
        y: Math.floor(world.y / TILE_SIZE_PX),
      });
    });
  }

  /**
   * Held keys send one step intent at the speed the server allows. Sending
   * faster would only earn rejections, and enough of them would look like
   * flooding.
   */
  private pollKeyboard(): void {
    const nowMs = this.time.now;
    if (nowMs - this.lastStepSentAtMs < MIN_STEP_INTERVAL_MS) return;

    let horizontal: Direction | null = null;
    let vertical: Direction | null = null;

    for (const [direction, keys] of this.keys) {
      if (!keys.some((key) => key.isDown)) continue;
      if (direction === 'w' || direction === 'e') horizontal = direction;
      if (direction === 'n' || direction === 's') vertical = direction;
    }

    const combined = this.combine(vertical, horizontal);
    if (combined === null) return;

    this.connection.step(combined);
    this.lastStepSentAtMs = nowMs;
  }

  /** Two keys at once mean a diagonal, which is a single step, not two. */
  private combine(vertical: Direction | null, horizontal: Direction | null): Direction | null {
    if (vertical === null) return horizontal;
    if (horizontal === null) return vertical;
    if (vertical === 'n') return horizontal === 'w' ? 'nw' : 'ne';
    return horizontal === 'w' ? 'sw' : 'se';
  }

  // -- characters ---------------------------------------------------------

  /** Make the set of avatars on screen match the last snapshot. */
  private syncAvatars(): void {
    const you = this.connection.you;
    if (you === null) return;

    const seen = new Set<string>();
    this.updateAvatar(you, true);
    seen.add(you.id);

    for (const other of this.connection.others) {
      this.updateAvatar(other, false);
      seen.add(other.id);
    }

    for (const [id, avatar] of this.avatars) {
      if (seen.has(id)) continue;
      avatar.container.destroy();
      this.avatars.delete(id);
    }
  }

  private updateAvatar(view: PlayerView, isSelf: boolean): void {
    const targetPx = {
      x: view.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
      y: view.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
    };

    const existing = this.avatars.get(view.id);
    if (existing !== undefined) {
      existing.targetPx = targetPx;
      return;
    }

    const container = this.add.container(targetPx.x, targetPx.y);
    container.setDepth(isSelf ? 3 : 2);

    const body = this.add.circle(
      0,
      0,
      TILE_SIZE_PX * 0.34,
      isSelf ? colorTokens.self : colorTokens.other,
    );
    body.setStrokeStyle(2, colorTokens.backdrop, 0.8);

    const label = this.add.text(0, -TILE_SIZE_PX * 0.75, view.name, {
      fontFamily: fontFamilyTokens.ui,
      fontSize: `${fontSizeTokens.sm}px`,
      color: toHex(isSelf ? colorTokens.accent : colorTokens.text),
    });
    label.setOrigin(0.5, 0.5);

    container.add([body, label]);
    this.avatars.set(view.id, { container, targetPx });

    if (isSelf) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  /**
   * Slide each character towards where the server put it.
   *
   * This is presentation only. The character's real position is whatever the
   * last snapshot said; this just stops it teleporting ten times a second.
   */
  private easeAvatars(deltaMs: number): void {
    const t = Math.min(1, MOVE_LERP_PER_MS * deltaMs);
    for (const avatar of this.avatars.values()) {
      const { container, targetPx } = avatar;
      const dx = targetPx.x - container.x;
      const dy = targetPx.y - container.y;
      if (Math.abs(dx) < SNAP_DISTANCE_PX && Math.abs(dy) < SNAP_DISTANCE_PX) {
        container.setPosition(targetPx.x, targetPx.y);
        continue;
      }
      container.setPosition(container.x + dx * t, container.y + dy * t);
    }
  }
}

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
