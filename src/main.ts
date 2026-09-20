import Phaser from 'phaser';
import { SandboxScene } from './scenes/SandboxScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  parent: 'game-container',
  backgroundColor: '#111217',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: true
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  autoFocus: true,
  disableContextMenu: true,
  input: {
    activePointers: 1,
    windowEvents: true
  },
  scene: [SandboxScene]
};

export const game = new Phaser.Game(config);
