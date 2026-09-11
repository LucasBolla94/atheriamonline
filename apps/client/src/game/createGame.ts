/**
 * Starting and stopping Phaser.
 *
 * Kept apart from React so that the game is created exactly once, when the
 * player actually enters the world, and destroyed cleanly when they leave.
 */
import Phaser from 'phaser';
import type { WorldInfo } from '@atheriam/protocol';
import { colorTokens } from '../tokens/tokens.js';
import type { WorldConnection } from '../net/connection.js';
import { WorldScene, type HouseScenery, type WorldSceneData } from './WorldScene.js';

export interface CreateGameOptions {
  readonly parent: HTMLElement;
  readonly connection: WorldConnection;
  readonly world: WorldInfo;
  /** What the interface knows about the room: its furniture, and taps on it. */
  readonly scenery: HouseScenery;
}

export function createGame(options: CreateGameOptions): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    backgroundColor: colorTokens.backdrop,
    pixelArt: true,
    // Flat colours on a tile grid gain nothing from smoothing, and turning it
    // off is free performance on every device.
    antialias: false,
    roundPixels: true,
    scale: {
      // The canvas fills whatever space the interface gives it, which is what
      // makes a phone in landscape work without a second layout.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    fps: {
      target: 60,
      // Never try to catch up after the tab was in the background: a burst of
      // twenty frames at once is what makes a phone stutter on return.
      forceSetTimeOut: false,
      smoothStep: true,
    },
    // A long press on a phone should not open the browser's own menu over the
    // city, and a right click on a desktop should not either.
    disableContextMenu: true,
    scene: [WorldScene],
  });

  const sceneData: WorldSceneData = {
    connection: options.connection,
    world: options.world,
    scenery: options.scenery,
  };
  game.scene.start(WorldScene.KEY, sceneData);
  return game;
}
