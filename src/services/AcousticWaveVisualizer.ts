import Phaser from 'phaser';
import { metersToPixels } from '../utils/mathUtils';
import { AudioManager } from '../audio/AudioManager';
import { TERROR_RADIUS_MAX } from '../config/constants';

export interface AcousticWaveVisualizerOptions {
  scene: Phaser.Scene;
  isEnabled: () => boolean;
  maxPoolSize?: number;
}

export interface FootstepCoordinationContext {
  player: {
    isActive: boolean;
    isMoving: boolean;
    isSprinting: boolean;
    currentSpeed: number;
    x: number;
    y: number;
  };
  killer: {
    isMoving: boolean;
    state: string;
    x: number;
    y: number;
  };
  survivorActive: boolean;
  runNoiseRadius?: number;
  walkNoiseRadius?: number;
  onNoiseEmitted: (noise: { x: number; y: number; radiusInMeters: number; source: string }) => void;
}

/**
 * @class AcousticWaveVisualizer
 * @description Manages pooled graphics instances, tween animations, and procedural footstep wave emission.
 */
export class AcousticWaveVisualizer {
  private scene: Phaser.Scene;
  private isEnabled: () => boolean;
  private maxPoolSize: number;
  private pool: Phaser.GameObjects.Graphics[] = [];
  private activeTweens: Map<Phaser.GameObjects.Graphics, Phaser.Tweens.Tween> = new Map();
  private survivorFootstepTimer = 0;
  private killerFootstepTimer = 0;

  constructor(options: AcousticWaveVisualizerOptions) {
    this.scene = options.scene;
    this.isEnabled = options.isEnabled;
    this.maxPoolSize = options.maxPoolSize ?? 25;
  }

  public spawnSoundWave(
    x: number,
    y: number,
    radiusInMeters: number,
    color: number = 0x00ffff,
    duration: number = 900
  ): void {
    if (!this.isEnabled()) return;

    const targetRadius = metersToPixels(radiusInMeters);
    const wave = this.acquireGraphics(x, y);

    const waveData = { progress: 0, alpha: 0.75 };
    const tween = this.scene.tweens.add({
      targets: waveData,
      progress: 1,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        wave.clear();
        const currentRadius = targetRadius * waveData.progress;
        wave.lineStyle(2.5, color, waveData.alpha);
        wave.strokeCircle(0, 0, currentRadius);
      },
      onComplete: () => {
        this.releaseGraphics(wave);
      }
    });

    this.activeTweens.set(wave, tween);
  }

  public updateFootsteps(delta: number, ctx: FootstepCoordinationContext, audio: AudioManager): void {
    if (ctx.player.isActive && ctx.survivorActive && ctx.player.isMoving && ctx.player.currentSpeed > 5) {
      this.survivorFootstepTimer += delta;
      const cadence = ctx.player.isSprinting ? 270 : 380;
      if (this.survivorFootstepTimer >= cadence) {
        this.survivorFootstepTimer = 0;
        audio.playSurvivorFootstep(ctx.player.isSprinting);
        const radius = ctx.player.isSprinting ? (ctx.runNoiseRadius ?? 14.0) : (ctx.walkNoiseRadius ?? 4.0);
        ctx.onNoiseEmitted({ x: ctx.player.x, y: ctx.player.y, radiusInMeters: radius, source: 'survivor' });
        this.spawnSoundWave(ctx.player.x, ctx.player.y, radius, 0x00ffff, 900);
      }
    } else {
      this.survivorFootstepTimer = 0;
    }

    if (ctx.killer.isMoving) {
      this.killerFootstepTimer += delta;
      const cadence = ctx.killer.state === 'CHASE' ? 330 : 440;
      if (this.killerFootstepTimer >= cadence) {
        this.killerFootstepTimer = 0;
        const dist = (ctx.player.isActive && ctx.survivorActive)
          ? Phaser.Math.Distance.Between(ctx.player.x, ctx.player.y, ctx.killer.x, ctx.killer.y)
          : 0;
        const vol = dist > TERROR_RADIUS_MAX ? 0 : Math.max(0.1, 1 - dist / TERROR_RADIUS_MAX);
        audio.playKillerFootstep(vol);
        this.spawnSoundWave(ctx.killer.x, ctx.killer.y, 14.0, 0xa855f7, 900);
        ctx.onNoiseEmitted({ x: ctx.killer.x, y: ctx.killer.y, radiusInMeters: 14.0, source: 'killer' });
      }
    } else {
      this.killerFootstepTimer = 0;
    }
  }

  private acquireGraphics(x: number, y: number): Phaser.GameObjects.Graphics {
    let wave: Phaser.GameObjects.Graphics;
    if (this.pool.length > 0) {
      wave = this.pool.pop()!;
      wave.setPosition(x, y);
      wave.setVisible(true);
      wave.setActive(true);
    } else {
      wave = this.scene.add.graphics({ x, y });
      wave.setDepth(7);
    }
    return wave;
  }

  private releaseGraphics(wave: Phaser.GameObjects.Graphics): void {
    this.activeTweens.delete(wave);
    wave.clear();
    if (this.pool.length < this.maxPoolSize) {
      wave.setVisible(false);
      wave.setActive(false);
      this.pool.push(wave);
    } else {
      wave.destroy();
    }
  }

  public clear(): void {
    this.activeTweens.forEach((tween, wave) => {
      tween.stop();
      wave.clear();
      wave.destroy();
    });
    this.activeTweens.clear();
    this.pool.forEach((wave) => wave.destroy());
    this.pool = [];
  }

  public destroy(): void {
    this.clear();
  }
}
