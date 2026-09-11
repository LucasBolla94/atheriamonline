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
import { WorldScene, type WorldSceneData } from './WorldScene.js';

export interface CreateGameOptions {
  readonly parent: HTMLElement;
  readonly connection: WorldConnection;
  readonly world: WorldInfo;
}

export function createGame(options: CreateGameOptions): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: options.parent,
    backgroundColor: colorTokens.backdrop,
    pixelArt: true,
    scale: {
      // The canvas fills whatever space the interface gives it, which is what
      // makes a phone in landscape work without a second layout.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [WorldScene],
  });

  const sceneData: WorldSceneData = { connection: options.connection, world: options.world };
  game.scene.start(WorldScene.KEY, sceneData);
  return game;
}
