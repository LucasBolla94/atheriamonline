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
  CITY_BUILDINGS,
  CITY_FURNITURE,
  VENUE_PROP_NAMES,
  publicVenue,
  STARTER_CITY,
  MIN_STEP_INTERVAL_MS,
  TILE_SIZE_PX,
  type Direction,
} from '@atheriam/shared';
import type { PlayerView, WorldInfo } from '@atheriam/protocol';
import { colorTokens, fontFamilyTokens, fontSizeTokens, spaceTokens } from '../tokens/tokens.js';
import type { HeldChunk, WorldConnection } from '../net/connection.js';
import { prepareArt, PROP_NAMES, BUILDING_NAMES } from './art.js';
import { fountainAtlas } from './fountainArt.js';
import { terrainAtlas, terrainIndex } from './terrainArt.js';
import { strings } from '../ui/strings.js';

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
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly label: Phaser.GameObjects.Text;
  facing: string;
  look: number;
  walkTime: number;
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
  floorStyle?: string;
  wallStyle?: string;
  /** What is standing in this house, if the player is in one. */
  furniture: ReadonlyArray<{
    id: string;
    definitionId: string;
    name: string;
    x: number;
    y: number;
    rotation: number;
  }>;
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
  private drawnFinish = '';
  private drawnFurnitureRevision = -1;
  private drawnRealmRevision = -1;
  private furniture: Phaser.GameObjects.Image[] = [];
  private ready = false;
  private groundMap!: Phaser.Tilemaps.Tilemap;
  private tileset!: Phaser.Tilemaps.Tileset;
  private props = new Map<string, Phaser.GameObjects.Image[]>();
  private destination: Phaser.GameObjects.Graphics | null = null;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private avatars = new Map<string, Avatar>();
  /** One drawn square of ground per chunk we hold, by `cx:cy`. */
  private chunkImages = new Map<string, Phaser.Tilemaps.TilemapLayer>();
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
    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, strings.hud.loadingArt, {
        fontFamily: fontFamilyTokens.ui,
        fontSize: `${fontSizeTokens.lg}px`,
        color: toHex(colorTokens.accentText),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100000);
    void prepareArt()
      .then((art) => {
        if (!this.sys.isActive()) return;
        art.residents.forEach((canvas, i) => {
          const key = `resident:${i}`;
          if (!this.textures.exists(key)) {
            const texture = this.textures.addCanvas(key, canvas)!;
            for (let frame = 0; frame < 24; frame++)
              texture.add(frame, 0, (frame % 6) * 32, Math.floor(frame / 6) * 48, 32, 48);
          }
        });
        if (!this.textures.exists('town')) {
          const texture = this.textures.addCanvas('town', art.props)!;
          PROP_NAMES.forEach((name, i) =>
            texture.add(name, 0, (i % 4) * 128, Math.floor(i / 4) * 128, 128, 128),
          );
        }
        if (!this.textures.exists('venue-props')) {
          const texture = this.textures.addCanvas('venue-props', art.venueProps)!;
          VENUE_PROP_NAMES.forEach((name, i) =>
            texture.add(name, 0, (i % 4) * 128, Math.floor(i / 4) * 192, 128, 192),
          );
        }
        if (!this.textures.exists('buildings')) {
          const texture = this.textures.addCanvas('buildings', art.buildings)!;
          BUILDING_NAMES.forEach((name, i) =>
            texture.add(name, 0, (i % 3) * 128, Math.floor(i / 3) * 128, 128, 128),
          );
        }
        if (!this.textures.exists('fountain')) {
          const texture = this.textures.addCanvas('fountain', fountainAtlas())!;
          for (let frame = 0; frame < 6; frame++) texture.add(frame, 0, frame * 64, 0, 64, 64);
        }
        if (!this.anims.exists('fountain-flow'))
          this.anims.create({
            key: 'fountain-flow',
            frames: this.anims.generateFrameNumbers('fountain', { start: 0, end: 5 }),
            frameRate: 8,
            repeat: -1,
          });
        if (!this.textures.exists('terrain')) this.textures.addCanvas('terrain', terrainAtlas());
        this.groundMap = this.make.tilemap({
          tileWidth: 32,
          tileHeight: 32,
          width: 32,
          height: 32,
        });
        this.tileset = this.groundMap.addTilesetImage('terrain', 'terrain', 32, 32)!;
        this.setUpCamera();
        this.setUpKeyboard();
        this.setUpPointer();
        this.scale.on(Phaser.Scale.Events.RESIZE, this.setUpCamera, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
          this.scale.off(Phaser.Scale.Events.RESIZE, this.setUpCamera, this);
        });
        this.ready = true;
        loading.destroy();
      })
      .catch(() => {
        if (this.sys.isActive()) loading.setText(strings.hud.artError);
      });
  }

  override update(time: number, delta: number): void {
    if (!this.ready) return;
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

    // Chunk coordinates can be identical in different realms. Never reuse city
    // ground or scenery just because a house also has a chunk called 0:0.
    for (const layer of this.chunkImages.values()) layer.destroy();
    this.chunkImages.clear();
    for (const props of this.props.values()) for (const prop of props) prop.destroy();
    this.props.clear();
    this.pendingChunks.length = 0;
    this.drawnChunkRevision = -1;
    this.destination?.destroy();
    this.destination = null;

    for (const avatar of this.avatars.values()) {
      avatar.bubble?.destroy();
      avatar.label.destroy();
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
    const finish =
      this.connection.realm === 'property'
        ? `${this.scenery.floorStyle}:${this.scenery.wallStyle}`
        : '';
    if (finish !== this.drawnFinish) {
      this.drawnFinish = finish;
      for (const layer of this.chunkImages.values()) layer.destroy();
      this.chunkImages.clear();
      for (const props of this.props.values()) for (const prop of props) prop.destroy();
      this.props.clear();
      this.pendingChunks.length = 0;
      this.drawnChunkRevision = -1;
    }
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
        // Dispose the chunk's tile layer and props; the small atlas is shared.
        for (const prop of this.props.get(key) ?? []) prop.destroy();
        this.props.delete(key);
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

  /** Read neighbouring streamed ground when locating a multi-tile decoration. */
  private tileAt(x: number, y: number): string {
    const key = `${Math.floor(x / 32)}:${Math.floor(y / 32)}`;
    return this.connection.chunks.get(key)?.rows[y % 32]?.[x % 32] ?? '';
  }

  private interiorTile(char: string): string {
    if (this.connection.realm === 'city' && char === 'o') return 'p';
    if (this.connection.realm !== 'property' && this.connection.realm !== 'booking') return char;
    const venue = publicVenue(this.connection.venueId);
    const floor = venue?.floor ?? this.scenery.floorStyle;
    const wall = venue?.wall ?? this.scenery.wallStyle;
    if (char === 'd' || char === 'o') return floor === 'stone' ? 'S' : floor === 'tile' ? 'L' : 'd';
    if (char === '#') return wall === 'teal' ? 'E' : wall === 'rose' ? 'R' : 'C';
    return char;
  }

  private drawChunk(chunk: HeldChunk): Phaser.Tilemaps.TilemapLayer {
    const ox = chunk.cx * 32,
      oy = chunk.cy * 32;
    const layer = this.groundMap.createBlankLayer(
      `ground:${chunkKeyOf(chunk)}:${this.drawnRealmRevision}`,
      this.tileset,
      ox * 32,
      oy * 32,
      32,
      32,
    )!;
    const tiles = chunk.rows.map((row, y) =>
      [...row].map((char, x) =>
        ox + x >= this.world.width || oy + y >= this.world.height
          ? -1
          : terrainIndex(this.interiorTile(char), ox + x, oy + y),
      ),
    );
    layer.putTilesAt(tiles, 0, 0);
    layer.setDepth(0);
    const props: Phaser.GameObjects.Image[] = [];
    const add = (name: string, x: number, y: number, w: number, h: number) => {
      const image = this.add
        .image(x, y, 'town', name)
        .setOrigin(0.5, 124 / 128)
        .setDisplaySize(w, h)
        .setDepth(100 + y);
      props.push(image);
      return image;
    };
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const char = chunk.rows[y]?.[x];
        const tx = ox + x,
          ty = oy + y;
        if (char === 'T') add('tree', tx * 32 + 16, ty * 32 + 24, 80, 80);
        if (char === 'W' && this.tileAt(tx + 1, ty) !== 'W' && this.tileAt(tx, ty + 1) !== 'W')
          props.push(
            this.add
              .sprite(tx * 32, (ty + 1) * 32, 'fountain', 0)
              .setOrigin(0.5, 1)
              .setDisplaySize(64, 64)
              .setDepth(100 + (ty + 1) * 32)
              .play('fountain-flow'),
          );
        if (char === 'M' && this.tileAt(tx - 1, ty) !== 'M' && this.tileAt(tx, ty + 1) !== 'M')
          add('stall', (tx + 2.5) * 32, ty * 32 + 24, 164, 128);
      }
    if (this.world.width === STARTER_CITY.size) {
      for (const building of CITY_BUILDINGS) {
        // Attach each facade to its entrance chunk; all dimensions come from
        // the same address definition used by collisions and property sales.
        if (
          Math.floor(building.entrance.x / 32) !== chunk.cx ||
          Math.floor(building.entrance.y / 32) !== chunk.cy
        )
          continue;
        const image = this.add
          .image(
            (building.x + building.width / 2) * 32,
            building.entrance.y * 32,
            'buildings',
            building.use,
          )
          .setOrigin(0.5, 1)
          .setDisplaySize(building.width * 32, building.width * 32)
          .setDepth(100 + building.entrance.y * 32);
        props.push(image);
      }
    }
    const venue = publicVenue(this.connection.venueId);
    const fixedProps = this.connection.realm === 'city' ? CITY_FURNITURE : (venue?.props ?? []);
    for (const item of fixedProps) {
      if (Math.floor(item.x / 32) !== chunk.cx || Math.floor(item.y / 32) !== chunk.cy) continue;
      const x = (item.x + item.width / 2) * 32;
      const y = (item.y + item.height) * 32;
      const width = item.width * 32;
      props.push(
        this.add
          .image(x, y, 'venue-props', item.art)
          .setOrigin(0.5, 188 / 192)
          .setDisplaySize(width, (width * 192) / 128)
          .setDepth(100 + y),
      );
    }
    this.props.set(chunkKeyOf(chunk), props);
    return layer;
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
    } else if (this.connection.venueId !== null) {
      // Short landscape screens need room below the doorway: clamping to the
      // room's bottom edge puts the resident behind the chat and action dock.
      camera.removeBounds();
    } else {
      camera.setBounds(0, 0, worldWidth, worldHeight);
    }

    camera.setRoundPixels(true);
    const self =
      this.connection.playerId === null ? undefined : this.avatars.get(this.connection.playerId);
    if (!this.roomFitsOnScreen && self !== undefined)
      camera.startFollow(self.container, true, 0.15, 0.15);
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

      this.destination?.destroy();
      this.destination = this.add.graphics().setDepth(1);
      this.destination.lineStyle(2, colorTokens.accent, 0.8);
      this.destination.strokeRoundedRect(tile.x * 32 + 4, tile.y * 32 + 4, 24, 24, 5);
      this.connection.walkTo(tile);
      const marker = this.destination;
      this.time.delayedCall(1600, () => {
        marker.destroy();
        if (this.destination === marker) this.destination = null;
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
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.matches('input, textarea, select') || active.isContentEditable)
    )
      return;
    if (document.querySelector('[role="dialog"]') !== null) return;
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
      avatar.bubble?.destroy();
      avatar.label.destroy();
      avatar.container.destroy();
      this.avatars.delete(id);
    }
  }

  private updateAvatar(view: PlayerView, isSelf: boolean): void {
    const targetPx = {
      x: view.x * TILE_SIZE_PX + TILE_SIZE_PX / 2,
      y: view.y * TILE_SIZE_PX + TILE_SIZE_PX / 2,
    };

    const look = view.appearance ?? 0;
    const existing = this.avatars.get(view.id);
    if (existing !== undefined) {
      existing.targetPx = targetPx;
      existing.facing = view.facing;
      if (existing.look !== look) {
        existing.look = look;
        existing.sprite.setTexture(`resident:${look}`, 1);
      }
      return;
    }
    const container = this.add.container(targetPx.x, targetPx.y);
    const shadow = this.add.ellipse(0, 1, 23, 9, 0x263c2c, 0.24);
    if (isSelf) shadow.setStrokeStyle(2, 0xffefb0, 0.95);
    const sprite = this.add.sprite(0, 3, `resident:${look}`, 1).setOrigin(0.5, 44 / 48);
    sprite.setScale(1.25);
    const label = this.add
      .text(targetPx.x, targetPx.y - 55, view.name, {
        fontFamily: fontFamilyTokens.ui,
        fontSize: `${fontSizeTokens.sm}px`,
        color: toHex(colorTokens.accentText),
        backgroundColor: toHex(isSelf ? colorTokens.accent : colorTokens.text),
        padding: { x: spaceTokens.sm, y: spaceTokens.xs },
      })
      .setOrigin(0.5, 1)
      .setDepth(20000);
    container.add([shadow, sprite]);
    this.avatars.set(view.id, {
      container,
      sprite,
      label,
      facing: view.facing,
      look,
      walkTime: 0,
      targetPx,
      bubble: null,
      bubbleUntilMs: 0,
    });
    if (isSelf && !this.roomFitsOnScreen)
      this.cameras.main.startFollow(container, true, 0.15, 0.15);
  }

  // -- furniture ----------------------------------------------------------

  /**
   * Draw what is standing in the house.
   *
   * Furniture uses the original prop atlas. Floor coverings rotate flat on
   * the ground; upright props use mirrored and narrow side representations.
   */
  private syncFurniture(): void {
    if (this.scenery.revision === this.drawnFurnitureRevision) return;
    this.drawnFurnitureRevision = this.scenery.revision;

    for (const piece of this.furniture) piece.destroy();
    this.furniture = [];
    for (const piece of this.scenery.furniture) {
      const name = PROP_NAMES.find((key) => key === piece.definitionId) ?? 'oak-stool';
      const flat = name === 'rush-mat' || name === 'wool-rug';
      const x = piece.x * 32 + 16,
        y = piece.y * 32 + 24;
      const image = this.add
        .image(x, y, 'town', name)
        .setOrigin(0.5, flat ? 0.5 : 124 / 128)
        .setDisplaySize(32, 32);
      if (flat) image.setAngle(piece.rotation);
      else {
        image.setFlipX(piece.rotation === 180 || piece.rotation === 270);
        if (piece.rotation === 90 || piece.rotation === 270) image.setDisplaySize(24, 32);
      }
      image.setDepth(flat ? 1 : 100 + y);
      this.furniture.push(image);
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

    const bubble = this.add.container(avatar.container.x, avatar.container.y - 78, [
      background,
      label,
    ]);
    bubble.setDepth(30000);
    bubble.setSize(background.width, background.height);

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
    const t = this.reducedMotion ? 1 : Math.min(1, MOVE_LERP_PER_MS * deltaMs);
    for (const avatar of this.avatars.values()) {
      const { container, targetPx } = avatar;
      const dx = targetPx.x - container.x,
        dy = targetPx.y - container.y;
      const moving = Math.abs(dx) >= SNAP_DISTANCE_PX || Math.abs(dy) >= SNAP_DISTANCE_PX;
      if (moving) {
        container.setPosition(container.x + dx * t, container.y + dy * t);
        avatar.walkTime += deltaMs;
      } else {
        container.setPosition(targetPx.x, targetPx.y);
        avatar.walkTime = 0;
      }
      const direction = avatar.facing.startsWith('n')
        ? 3
        : avatar.facing.startsWith('s')
          ? 0
          : avatar.facing === 'w'
            ? 1
            : 2;
      avatar.sprite.setFrame(direction * 6 + (moving ? Math.floor(avatar.walkTime / 100) % 6 : 1));
      container.setDepth(100 + container.y);
      avatar.label.setPosition(Math.round(container.x), Math.round(container.y - 51));
      avatar.bubble?.setPosition(Math.round(container.x), Math.round(container.y - 78));
    }
    // Stack nearby nameplates without shifting the resident or their shadow.
    const labels: Phaser.GameObjects.Text[] = [];
    for (const avatar of [...this.avatars.values()].sort((a, b) => a.container.y - b.container.y)) {
      let y = avatar.label.y;
      for (const other of labels.slice(-10)) {
        if (
          Math.abs(avatar.label.x - other.x) < (avatar.label.width + other.width) / 2 + 4 &&
          Math.abs(y - other.y) < 20
        )
          y = other.y - 21;
      }
      avatar.label.y = y;
      labels.push(avatar.label);
    }
    // Speech stays above nearby nameplates, and later bubbles stack above it.
    const occupied = labels.map((label) => ({
      x: label.x,
      width: label.width,
      top: label.y - label.height,
      bottom: label.y,
    }));
    for (const avatar of this.avatars.values()) {
      const bubble = avatar.bubble;
      if (bubble === null) continue;
      let bottom = avatar.label.y - avatar.label.height - spaceTokens.sm;
      for (let pass = 0; pass <= occupied.length; pass++) {
        const obstacle = occupied.find(
          (rect) =>
            Math.abs(bubble.x - rect.x) < (bubble.width + rect.width) / 2 + spaceTokens.xs &&
            bottom > rect.top - spaceTokens.sm &&
            bottom - bubble.height < rect.bottom + spaceTokens.sm,
        );
        if (obstacle === undefined) break;
        bottom = obstacle.top - spaceTokens.sm;
      }
      bubble.y = bottom - spaceTokens.xs;
      occupied.push({ x: bubble.x, width: bubble.width, top: bottom - bubble.height, bottom });
    }
    const self =
      this.connection.playerId === null ? undefined : this.avatars.get(this.connection.playerId);
    if (self !== undefined)
      for (const props of this.props.values())
        for (const prop of props) {
          const covers =
            Math.abs(prop.x - self.container.x) < prop.displayWidth * 0.4 &&
            self.container.y < prop.y &&
            self.container.y > prop.y - prop.displayHeight;
          prop.setAlpha(covers ? 0.38 : 1);
        }
  }
}

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function chunkKeyOf(chunk: HeldChunk): string {
  return `${chunk.cx}:${chunk.cy}`;
}
