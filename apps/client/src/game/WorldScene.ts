/**
 * The Phaser scene that draws the world.
 *
 * What this file may do: draw what the server said, and turn what the player
 * does with the mouse, the keyboard or a finger into intents.
 *
 * What this file may never do: decide that the player moved. The character on
 * screen slides towards the position in the last snapshot. If the server says
 * something different, the character slides there instead — that is a
 * correction, and it is meant to happen.
 *
 * The map arrives in 32x32 chunks and can be taken away again, so nothing here
 * assumes the whole city is known. A chunk we have not been given is drawn as
 * darkness, because that is honestly what the client knows about it.
 */
import Phaser from 'phaser';
import {
  CHUNK_SIZE_TILES,
  MIN_STEP_INTERVAL_MS,
  TILE_SIZE_PX,
  type Direction,
} from '@atheriam/shared';
import type { PlayerView, WorldInfo } from '@atheriam/protocol';
import { colorTokens, fontFamilyTokens, fontSizeTokens, spaceTokens } from '../tokens/tokens.js';
import type { HeldChunk, WorldConnection } from '../net/connection.js';

/** How quickly a character catches up with where the server says it is. */
const MOVE_LERP_PER_MS = 0.012;

/** Below this distance in pixels we simply snap, to avoid endless creeping. */
const SNAP_DISTANCE_PX = 0.5;

/** How far the camera may be zoomed out and in, on a pinch or a wheel. */
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.2;

/** How long a speech bubble stays on screen. */
const BUBBLE_LIFETIME_MS = 6_000;

/** How wide a bubble may get before the text wraps, in pixels. */
const BUBBLE_WIDTH_PX = 180;

/**
 * One colour per kind of ground, and a second, slightly different one so the
 * grid reads without drawing lines on it.
 */
const TILE_COLORS: Readonly<Record<string, readonly [number, number]>> = {
  '.': [colorTokens.tileGrass, colorTokens.tileGrassAlt],
  ',': [colorTokens.tileRoad, colorTokens.tileRoadAlt],
  p: [colorTokens.tilePavement, colorTokens.tilePavementAlt],
  b: [colorTokens.tileBridge, colorTokens.tileBridgeAlt],
  d: [colorTokens.tileFloor, colorTokens.tileFloorAlt],
  '+': [colorTokens.tileDoor, colorTokens.tileDoor],
  s: [colorTokens.tileShore, colorTokens.tileShoreAlt],
  '#': [colorTokens.tileWall, colorTokens.tileWallAlt],
  '~': [colorTokens.tileWater, colorTokens.tileWaterAlt],
  T: [colorTokens.tileTree, colorTokens.tileTree],
  F: [colorTokens.tileFence, colorTokens.tileFence],
  M: [colorTokens.tileStall, colorTokens.tileStall],
  W: [colorTokens.tileWell, colorTokens.tileWell],
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
  /** The speech bubble above this character, while they have one. */
  bubble: Phaser.GameObjects.Container | null;
  bubbleUntilMs: number;
}

export interface WorldSceneData {
  readonly connection: WorldConnection;
  readonly world: WorldInfo;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private connection!: WorldConnection;
  private world!: WorldInfo;
  private avatars = new Map<string, Avatar>();
  /** One drawn square of ground per chunk we hold, by `cx:cy`. */
  private chunkImages = new Map<string, Phaser.GameObjects.RenderTexture>();
  private drawnChunkRevision = -1;
  private shownChatRevision = 0;
  private keys = new Map<Direction, Phaser.Input.Keyboard.Key[]>();
  private lastStepSentAtMs = 0;

  constructor() {
    super(WorldScene.KEY);
  }

  init(data: WorldSceneData): void {
    this.connection = data.connection;
    this.world = data.world;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(colorTokens.tileUnknown);
    this.setUpCamera();
    this.setUpKeyboard();
    this.setUpPointer();
  }

  override update(time: number, delta: number): void {
    this.pollKeyboard();
    this.syncChunks();
    this.syncAvatars();
    this.syncBubbles(time);
    this.easeAvatars(delta);
  }

  // -- the ground ---------------------------------------------------------

  /**
   * Make the ground on screen match the chunks the connection holds.
   *
   * This runs every frame but does nothing at all unless a chunk has arrived
   * or been dropped, which is what the revision counter is for.
   */
  private syncChunks(): void {
    if (this.connection.chunkRevision === this.drawnChunkRevision) return;
    this.drawnChunkRevision = this.connection.chunkRevision;

    for (const [key, chunk] of this.connection.chunks) {
      if (this.chunkImages.has(key)) continue;
      this.chunkImages.set(key, this.drawChunk(chunk));
    }

    for (const [key, image] of this.chunkImages) {
      if (this.connection.chunks.has(key)) continue;
      image.destroy();
      this.chunkImages.delete(key);
    }
  }

  /**
   * Draw one chunk into a single texture.
   *
   * A chunk is a thousand tiles. Drawing them as a thousand rectangles every
   * frame is the easiest way to miss the 60 fps target on a phone, so they are
   * drawn once, here, and then moved around as one image.
   */
  private drawChunk(chunk: HeldChunk): Phaser.GameObjects.RenderTexture {
    const size = CHUNK_SIZE_TILES * TILE_SIZE_PX;
    const graphics = this.add.graphics();

    for (let y = 0; y < CHUNK_SIZE_TILES; y += 1) {
      const row = chunk.rows[y];
      if (row === undefined) continue;
      for (let x = 0; x < CHUNK_SIZE_TILES; x += 1) {
        const char = row[x] ?? '#';
        const pair = TILE_COLORS[char] ?? TILE_COLORS['#'];
        const [base, alt] = pair ?? [colorTokens.tileUnknown, colorTokens.tileUnknown];
        graphics.fillStyle((x + y) % 2 === 0 ? base : alt, 1);
        graphics.fillRect(x * TILE_SIZE_PX, y * TILE_SIZE_PX, TILE_SIZE_PX, TILE_SIZE_PX);
      }
    }

    const texture = this.add.renderTexture(chunk.cx * size, chunk.cy * size, size, size);
    texture.setOrigin(0, 0);
    texture.draw(graphics, 0, 0);
    texture.setDepth(0);
    graphics.destroy();
    return texture;
  }

  private setUpCamera(): void {
    this.cameras.main.setBounds(
      0,
      0,
      this.world.width * TILE_SIZE_PX,
      this.world.height * TILE_SIZE_PX,
    );
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
      // While two fingers are down the player is pinching, not tapping.
      if (this.input.pointer2.isDown) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.connection.walkTo({
        x: Math.floor(world.x / TILE_SIZE_PX),
        y: Math.floor(world.y / TILE_SIZE_PX),
      });
    });

    // Pinch to zoom on a phone, wheel to zoom on a desktop. Both are clamped,
    // so nobody can zoom far enough out to see the whole city at once.
    this.input.addPointer(1);
    this.input.on(
      Phaser.Input.Events.POINTER_MOVE,
      (_pointer: Phaser.Input.Pointer, _x: number, _y: number) => {
        const [first, second] = [this.input.pointer1, this.input.pointer2];
        if (!first.isDown || !second.isDown) return;

        const current = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
        const previous = Phaser.Math.Distance.Between(
          first.prevPosition.x,
          first.prevPosition.y,
          second.prevPosition.x,
          second.prevPosition.y,
        );
        if (previous === 0) return;
        this.setZoom(this.cameras.main.zoom * (current / previous));
      },
    );

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        this.setZoom(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1));
      },
    );
  }

  private setZoom(value: number): void {
    this.cameras.main.setZoom(Phaser.Math.Clamp(value, MIN_ZOOM, MAX_ZOOM));
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
    this.avatars.set(view.id, { container, targetPx, bubble: null, bubbleUntilMs: 0 });

    if (isSelf) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  // -- speech -------------------------------------------------------------

  /**
   * Put a bubble over whoever just spoke, and take away the ones that have had
   * their turn.
   *
   * Like the ground, this does nothing at all unless something has changed —
   * the revision counter is what makes that cheap to check every frame.
   */
  private syncBubbles(nowMs: number): void {
    if (this.connection.chatRevision !== this.shownChatRevision) {
      // Only the remarks that arrived since the last frame, so a long history
      // is never replayed over the city.
      const fresh = this.connection.chatRevision - this.shownChatRevision;
      const log = this.connection.chatLog;
      for (const entry of log.slice(Math.max(0, log.length - fresh))) {
        this.showBubble(entry.from, entry.text, nowMs);
      }
      this.shownChatRevision = this.connection.chatRevision;
    }

    for (const avatar of this.avatars.values()) {
      if (avatar.bubble === null) continue;
      if (nowMs < avatar.bubbleUntilMs) continue;
      avatar.bubble.destroy();
      avatar.bubble = null;
    }
  }

  /** One bubble per speaker: saying something again replaces what was there. */
  private showBubble(speakerId: string, text: string, nowMs: number): void {
    const avatar = this.avatars.get(speakerId);
    if (avatar === undefined) return;

    avatar.bubble?.destroy();

    const label = this.add.text(0, 0, text, {
      fontFamily: fontFamilyTokens.ui,
      fontSize: `${fontSizeTokens.md}px`,
      color: toHex(colorTokens.text),
      wordWrap: { width: BUBBLE_WIDTH_PX },
      align: 'center',
    });
    label.setOrigin(0.5, 1);

    const padding = spaceTokens.sm;
    const background = this.add.rectangle(
      0,
      -label.height / 2,
      label.width + padding * 2,
      label.height + padding,
      colorTokens.surface,
      0.92,
    );
    background.setStrokeStyle(1, colorTokens.border, 1);

    const bubble = this.add.container(avatar.container.x, avatar.container.y - TILE_SIZE_PX, [
      background,
      label,
    ]);
    bubble.setDepth(5);

    avatar.bubble = bubble;
    avatar.bubbleUntilMs = nowMs + BUBBLE_LIFETIME_MS;
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

    // A bubble belongs to a character, so it follows them rather than hanging
    // in the air where they were standing when they spoke.
    for (const avatar of this.avatars.values()) {
      avatar.bubble?.setPosition(avatar.container.x, avatar.container.y - TILE_SIZE_PX);
    }
  }
}

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
