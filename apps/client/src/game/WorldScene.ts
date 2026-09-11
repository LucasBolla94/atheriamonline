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

/**
 * What the interface tells the scene about the room it is drawing.
 *
 * Furniture comes from the API, not from the world server — the world server
 * only knows where the walls are. This is how the React side hands it over
 * without the scene having to know what an HTTP request is.
 */
export interface HouseScenery {
  /** What is standing in this house, if the player is in one. */
  furniture: ReadonlyArray<{ id: string; name: string; x: number; y: number; rotation: number }>;
  /** Goes up whenever the furniture changes, so the scene redraws it. */
  revision: number;
  /**
   * Called when the player taps a tile. Return true to swallow the tap, which
   * is what arranging furniture does instead of walking there.
   */
  onTileClick: ((x: number, y: number) => boolean) | null;
}

export interface WorldSceneData {
  readonly connection: WorldConnection;
  readonly world: WorldInfo;
  readonly scenery: HouseScenery;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private connection!: WorldConnection;
  private world!: WorldInfo;
  private scenery!: HouseScenery;
  private drawnFurnitureRevision = -1;
  private drawnRealmRevision = -1;
  private furniture: Phaser.GameObjects.Container | null = null;
  private avatars = new Map<string, Avatar>();
  /** One drawn square of ground per chunk we hold, by `cx:cy`. */
  private chunkImages = new Map<string, Phaser.GameObjects.Image>();
  /**
   * Chunks that have arrived but have not been drawn yet.
   *
   * Walking into a new part of the city can bring several chunks at once, and
   * each one is a thousand tiles painted into a texture. Doing all of them in
   * one frame is a visible stutter on a phone, so they are queued and drawn
   * one per frame — by the time the player has walked far enough to see the
   * new ground, it is there.
   */
  private readonly pendingChunks: HeldChunk[] = [];
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
    this.scenery = data.scenery;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(colorTokens.tileUnknown);
    this.setUpCamera();
    this.setUpKeyboard();
    this.setUpPointer();
  }

  override update(time: number, delta: number): void {
    this.pollKeyboard();
    this.syncRealm();
    this.syncChunks();
    this.syncFurniture();
    this.syncAvatars();
    this.syncBubbles(time);
    this.easeAvatars(delta);
  }

  /**
   * Notice that the player has walked into a house, or back out.
   *
   * The room is a different size, so the camera must be told; and every avatar
   * on screen belonged to the place they have just left.
   */
  private syncRealm(): void {
    if (this.connection.realmRevision === this.drawnRealmRevision) return;
    this.drawnRealmRevision = this.connection.realmRevision;

    const world = this.connection.world;
    if (world !== null) this.world = world;
    this.setUpCamera();

    for (const avatar of this.avatars.values()) {
      avatar.bubble?.destroy();
      avatar.container.destroy();
    }
    this.avatars.clear();
  }

  // -- the ground ---------------------------------------------------------

  /**
   * Make the ground on screen match the chunks the connection holds.
   *
   * This runs every frame but does nothing at all unless a chunk has arrived
   * or been dropped, which is what the revision counter is for.
   */
  private syncChunks(): void {
    if (this.connection.chunkRevision !== this.drawnChunkRevision) {
      this.drawnChunkRevision = this.connection.chunkRevision;

      for (const [key, chunk] of this.connection.chunks) {
        if (this.chunkImages.has(key)) continue;
        if (this.pendingChunks.some((queued) => chunkKeyOf(queued) === key)) continue;
        this.pendingChunks.push(chunk);
      }

      for (const [key, image] of this.chunkImages) {
        if (this.connection.chunks.has(key)) continue;
        image.destroy();
        // The texture goes with it: ground we have walked away from should not
        // still be costing memory on a phone.
        this.textures.remove(`chunk:${key}`);
        this.chunkImages.delete(key);
      }
    }

    // One chunk per frame, however many are waiting.
    const next = this.pendingChunks.shift();
    if (next === undefined) return;

    const key = chunkKeyOf(next);
    // It may have been taken away again while it sat in the queue.
    if (!this.connection.chunks.has(key)) return;
    if (this.chunkImages.has(key)) return;
    this.chunkImages.set(key, this.drawChunk(next));
  }

  /**
   * Draw one chunk, once, as one image.
   *
   * The trick here is the difference between a stutter and nothing at all.
   *
   * A chunk is 32x32 tiles and a tile is 32 pixels, so drawing it at full size
   * means painting a million pixels — over a tenth of a second on a machine
   * without a graphics card, which is a jolt every time somebody walks into
   * new ground.
   *
   * But every tile is one flat colour. So the chunk is painted at **one pixel
   * per tile** — a thousand pixels instead of a million — and then blown up
   * thirty-two times. The renderer is in pixel-art mode, so it scales without
   * smoothing: exactly the same squares, drawn a thousand times more cheaply.
   */
  private drawChunk(chunk: HeldChunk): Phaser.GameObjects.Image {
    const key = chunkTextureKey(chunk);
    if (this.textures.exists(key)) this.textures.remove(key);

    const canvas = this.textures.createCanvas(key, CHUNK_SIZE_TILES, CHUNK_SIZE_TILES);
    const context = canvas?.getContext() ?? null;

    if (canvas !== null && canvas !== undefined && context !== null) {
      const pixels = context.createImageData(CHUNK_SIZE_TILES, CHUNK_SIZE_TILES);
      const originX = chunk.cx * CHUNK_SIZE_TILES;
      const originY = chunk.cy * CHUNK_SIZE_TILES;

      for (let y = 0; y < CHUNK_SIZE_TILES; y += 1) {
        const row = chunk.rows[y];
        for (let x = 0; x < CHUNK_SIZE_TILES; x += 1) {
          // A chunk is always a full 32x32 square, so the one at an edge is
          // padded with stone. Drawing that padding would put a slab of wall
          // outside the world — very visible around a house, which is far
          // smaller than a single chunk. Nothing is drawn there instead.
          if (originX + x >= this.world.width || originY + y >= this.world.height) continue;

          const char = row?.[x] ?? '#';
          const pair = TILE_COLORS[char] ?? TILE_COLORS['#'];
          const [base, alt] = pair ?? [colorTokens.tileUnknown, colorTokens.tileUnknown];
          const colour = (x + y) % 2 === 0 ? base : alt;

          const at = (y * CHUNK_SIZE_TILES + x) * 4;
          pixels.data[at] = (colour >> 16) & 0xff;
          pixels.data[at + 1] = (colour >> 8) & 0xff;
          pixels.data[at + 2] = colour & 0xff;
          pixels.data[at + 3] = 255;
        }
      }

      context.putImageData(pixels, 0, 0);
      canvas.refresh();
    }

    const size = CHUNK_SIZE_TILES * TILE_SIZE_PX;
    const image = this.add.image(chunk.cx * size, chunk.cy * size, key);
    image.setOrigin(0, 0);
    image.setScale(TILE_SIZE_PX);
    image.setDepth(0);
    return image;
  }

  /**
   * True when the whole place fits on the screen at once — which a house does
   * and the city never will.
   */
  private get roomFitsOnScreen(): boolean {
    return (
      this.world.width * TILE_SIZE_PX <= this.scale.width &&
      this.world.height * TILE_SIZE_PX <= this.scale.height
    );
  }

  /**
   * Point the camera at the right thing.
   *
   * In the city the camera follows the player, because the city is far larger
   * than the screen. A house is smaller than the screen, so following would
   * push it into a corner and leave most of the window empty: the whole room
   * is centred instead, and the camera stays still.
   */
  private setUpCamera(): void {
    const camera = this.cameras.main;
    const worldWidth = this.world.width * TILE_SIZE_PX;
    const worldHeight = this.world.height * TILE_SIZE_PX;

    if (this.roomFitsOnScreen) {
      camera.stopFollow();
      camera.setZoom(1);
      // No bounds at all, and then centre it. Bounds smaller than the camera
      // get clamped back to the corner, which is what made a tap on the middle
      // of a house land on tile 20,9 — outside a room that is fourteen wide.
      camera.removeBounds();
      camera.centerOn(worldWidth / 2, worldHeight / 2);
    } else {
      camera.setBounds(0, 0, worldWidth, worldHeight);
    }

    camera.setRoundPixels(true);
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
      const tile = {
        x: Math.floor(world.x / TILE_SIZE_PX),
        y: Math.floor(world.y / TILE_SIZE_PX),
      };

      // Somebody arranging their house is pointing at a place to put a stool,
      // not asking to walk there.
      if (this.scenery.onTileClick?.(tile.x, tile.y) === true) return;

      this.connection.walkTo(tile);
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
    // Zooming a room that already fits on screen only moves it off the screen.
    if (this.roomFitsOnScreen) return;
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

    // Only in the city: a house is centred on screen and the camera stays put.
    if (isSelf && !this.roomFitsOnScreen) {
      this.cameras.main.startFollow(container, true, 0.12, 0.12);
    }
  }

  // -- furniture ----------------------------------------------------------

  /**
   * Draw what is standing in the house.
   *
   * Furniture is drawn as a plain block with its name on it, for the same
   * reason the ground is drawn as flat colour: no picture enters this
   * repository before `docs/ASSETS.md` can record its licence. The shape is
   * turned by its rotation, so turning something is visible.
   */
  private syncFurniture(): void {
    if (this.scenery.revision === this.drawnFurnitureRevision) return;
    this.drawnFurnitureRevision = this.scenery.revision;

    this.furniture?.destroy();
    this.furniture = null;
    if (this.scenery.furniture.length === 0) return;

    const container = this.add.container(0, 0);
    container.setDepth(1);

    for (const piece of this.scenery.furniture) {
      const centreX = piece.x * TILE_SIZE_PX + TILE_SIZE_PX / 2;
      const centreY = piece.y * TILE_SIZE_PX + TILE_SIZE_PX / 2;

      const block = this.add.rectangle(
        centreX,
        centreY,
        TILE_SIZE_PX * 0.8,
        TILE_SIZE_PX * 0.6,
        colorTokens.tileFloor,
      );
      block.setStrokeStyle(2, colorTokens.accent, 0.9);
      block.setAngle(piece.rotation);

      const label = this.add.text(centreX, centreY - TILE_SIZE_PX * 0.55, piece.name, {
        fontFamily: fontFamilyTokens.ui,
        fontSize: `${fontSizeTokens.sm}px`,
        color: toHex(colorTokens.textMuted),
      });
      label.setOrigin(0.5, 0.5);

      container.add([block, label]);
    }

    this.furniture = container;
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

function chunkKeyOf(chunk: HeldChunk): string {
  return `${chunk.cx}:${chunk.cy}`;
}

/** The name the drawn ground of one chunk is stored under. */
function chunkTextureKey(chunk: HeldChunk): string {
  return `chunk:${chunkKeyOf(chunk)}`;
}
