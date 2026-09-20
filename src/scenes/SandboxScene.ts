import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import survivorMeta from '../assets/survivor.json';
import generatorMeta from '../assets/generator.json';
import { WORLD_WIDTH, WORLD_HEIGHT, GENERATOR_DEFS } from '../config/constants';
import { MapBuilder, MapData } from '../map/MapBuilder';
import { Player } from '../entities/Player';
import { Killer } from '../entities/Killer';
import { Generator } from '../entities/Generator';
import { SkillCheckSystem, SkillCheckResult } from '../systems/SkillCheckSystem';
import { SoundFX } from '../systems/SoundFX';
import { TelemetryHUD } from '../ui/TelemetryHUD';
import { RepairPromptUI } from '../ui/RepairPromptUI';
import { DebugPanel } from '../ui/DebugPanel';

/**
 * @class SandboxScene
 * @description Orchestrator scene connecting environment, Player, Killer AI,
 * DBD generators, Skill Check QTE, telemetry HUD, and debug controls with zero regressions.
 */
export class SandboxScene extends Phaser.Scene {
  private mapData!: MapData;
  private easystar!: EasyStar.js;
  private player!: Player;
  private killer!: Killer;
  private generators: Generator[] = [];
  private activeNearbyGen: Generator | null = null;
  private isRepairing = false;
  private repairStaggerTimer = 0;

  // Systems and UI
  private skillCheck!: SkillCheckSystem;
  private repairPrompt!: RepairPromptUI;
  private telemetryHud!: TelemetryHUD;
  public debugPanel!: DebugPanel;

  // Inputs
  private keyE!: Phaser.Input.Keyboard.Key;
  private activeKeys: Set<string> = new Set();

  constructor() {
    super('SandboxScene');
  }

  preload(): void {
    this.load.spritesheet('survivor', 'assets/survivor.png', {
      frameWidth: survivorMeta.frameWidth, frameHeight: survivorMeta.frameHeight
    });
    this.load.spritesheet('generator', 'assets/generator.png', {
      frameWidth: generatorMeta.frameWidth, frameHeight: generatorMeta.frameHeight
    });
  }

  create(): void {
    // 1. Map & EasyStar A*
    this.mapData = MapBuilder.build(this);
    this.easystar = this.mapData.easystar;

    // 2. Debug Panel
    this.debugPanel = new DebugPanel({
      onPlayerScaleOrHitboxChanged: (s, r) => { this.player.updateHitbox(r, s); this.killer.updateHitbox(r, s); },
      onAnimFrameRateChanged: (k, fps) => { const a = this.anims.get(k); if (a) a.frameRate = fps; },
      onPhysicsDebugToggled: (show) => {
        this.physics.world.drawDebug = show;
        if (!show && this.physics.world.debugGraphic) this.physics.world.debugGraphic.clear();
      },
      onCameraZoomChanged: (zoom) => this.cameras.main.setZoom(zoom),
      onTestSkillCheck: () => this.skillCheck.startSkillCheck((res) => this.onSkillCheckResult(res)),
      onCompleteAllGenerators: () => {
        this.generators.forEach((g) => g.complete());
        this.telemetryHud.showNotification('⚡ TODOS OS GERADORES RESTAURADOS (DEBUG)!', false);
      },
      onResetAllGenerators: () => {
        this.generators.forEach((g) => g.reset());
        this.telemetryHud.showNotification('🔄 Progresso de todos os geradores resetado!', false);
      },
      onResetDefaults: () => {
        const s = this.debugPanel.settings;
        this.player.updateHitbox(s.hitboxRadius, s.playerScale);
        this.killer.updateHitbox(s.hitboxRadius, s.playerScale);
        this.cameras.main.setZoom(s.cameraZoom);
        this.physics.world.drawDebug = s.showPhysicsDebug;
      }
    });

    // 3. Animations
    [
      { key: 'walk', start: 0, end: 3, rate: this.debugPanel.settings.walkAnimFrameRate },
      { key: 'run', start: 4, end: 7, rate: this.debugPanel.settings.runAnimFrameRate }
    ].forEach(({ key, start, end, rate }) => {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('survivor', { start, end }),
        frameRate: rate,
        repeat: -1
      });
    });

    // 4. Entities & Systems
    this.player = new Player(this, 1280, 960, this.debugPanel.settings);
    this.killer = new Killer(this, 1280, 224, this.debugPanel.settings, this.easystar, this.mapData.navGrid, this.mapData.walls, this.mapData.obstacles);
    this.generators = GENERATOR_DEFS.map((def) => new Generator(this, def, this.mapData.obstacles));
    this.skillCheck = new SkillCheckSystem(this);
    this.repairPrompt = new RepairPromptUI(this);
    this.telemetryHud = new TelemetryHUD(this);

    // 5. Physics Colliders & Anti-Tunneling Bounds
    [this.mapData.walls, this.mapData.obstacles].forEach((group) => {
      this.physics.add.collider(this.player.sprite, group);
      this.physics.add.collider(this.killer.sprite, group);
    });
    this.physics.add.overlap(this.killer.sprite, this.player.sprite, () => {
      this.killer.handlePlayerCollision(this.player, this.debugPanel.settings, () => this.telemetryHud.showAttackAlert());
    });
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, (_: number, d: number) => {
      this.player.postUpdate(d, this.mapData.navGrid); this.killer.postUpdate(d, this.mapData.navGrid); this.updateTelemetry();
    });

    // 6. Camera & World Bounds
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.drawDebug = this.debugPanel.settings.showPhysicsDebug;
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
    this.cameras.main.setZoom(this.debugPanel.settings.cameraZoom);

    // 7. Inputs
    if (this.input.keyboard) this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    window.addEventListener('keydown', (e) => this.activeKeys.add(e.code), true);
    window.addEventListener('keyup', (e) => this.activeKeys.delete(e.code), true);
    window.addEventListener('resize', () => this.scale.refresh());
  }

  update(_time: number, delta: number): void {
    this.handleGeneratorInteraction(delta);
    this.player.update(delta, this.isRepairing, this.debugPanel.settings);
    this.killer.update(delta, this.player, this.generators.filter((g) => !g.isCompleted), this.debugPanel.settings);
    this.skillCheck.update(
      delta, this.isRepairing, this.debugPanel.settings.skillCheckFrequency,
      this.repairStaggerTimer <= 0, (res) => this.onSkillCheckResult(res)
    );
  }

  /**
   * Manages repair proximity prompt [E], progress increase, and key release logic
   */
  private handleGeneratorInteraction(delta: number): void {
    if (this.repairStaggerTimer > 0) {
      this.repairStaggerTimer -= delta;
      this.repairPrompt.show('💥 SISTEMA EM CURTO-CIRCUITO...', 0, false, true);
      return;
    }

    let closestGen: Generator | null = null;
    let closestDist = Infinity;
    for (const gen of this.generators) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, gen.x, gen.y);
      if (dist <= gen.interactionRadius && dist < closestDist) {
        closestDist = dist;
        closestGen = gen;
      }
    }
    this.activeNearbyGen = closestGen;

    if (!closestGen || closestGen.isCompleted) {
      if (this.isRepairing) this.stopRepairing();
      this.repairPrompt.hide();
      return;
    }

    const isPressingE = Boolean(this.keyE?.isDown || this.activeKeys.has('KeyE'));
    if (isPressingE) {
      if (!this.isRepairing) {
        this.isRepairing = true;
        this.skillCheck.resetTimer(this.debugPanel.settings.skillCheckFrequency);
      }
      const repairRate = 100 / Math.max(1, this.debugPanel.settings.generatorRepairTime);
      const isComplete = closestGen.addProgress(repairRate * (delta / 1000));
      this.repairPrompt.show(`🔧 REPARANDO... [E] Manter Pressionado (${closestGen.roomName})`, closestGen.progress, true);

      if (isComplete) {
        this.stopRepairing();
        const completed = this.generators.filter((g) => g.isCompleted).length;
        this.telemetryHud.showNotification(
          completed === this.generators.length
            ? '🏆 TODOS OS 3 GERADORES FORAM RESTAURADOS!'
            : `⚡ ${closestGen.name} restaurado! (${completed}/3)`,
          false
        );
      }
    } else {
      if (this.isRepairing) this.stopRepairing();
      closestGen.updateVisuals(false);
      this.repairPrompt.show(`[E] Reparar ${closestGen.name} (${closestGen.roomName})`, closestGen.progress, false);
    }
  }

  private stopRepairing(): void {
    this.isRepairing = false;
    if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
      this.activeNearbyGen.updateVisuals(false);
    }
    if (this.skillCheck.isActive) {
      this.skillCheck.cancelSkillCheck(true);
    }
  }

  private onSkillCheckResult(result: SkillCheckResult): void {
    if (result === 'GREAT' || result === 'GOOD') {
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.activeNearbyGen.addProgress(result === 'GREAT' ? 5 : 1.5);
      }
    } else {
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.activeNearbyGen.explode();
        this.repairStaggerTimer = 1400;
        this.isRepairing = false;
        this.skillCheck.triggerNoiseAlert(this.activeNearbyGen.x, this.activeNearbyGen.y);
        this.killer.alertToNoise(this.activeNearbyGen.x, this.activeNearbyGen.y);
        this.telemetryHud.showNotification('💥 O Assassino foi alertado da explosão do gerador!', true);
      } else {
        SoundFX.playExplosion();
        this.cameras.main.shake(300, 0.01);
      }
    }
    this.skillCheck.resetTimer(this.debugPanel.settings.skillCheckFrequency);
  }

  private updateTelemetry(): void {
    const fps = Math.round(this.game.loop.actualFps);
    const distToKiller = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y);
    const killerDistStr = `${Math.round(distToKiller)}px`;

    const mon = this.debugPanel.monitorState;
    mon.currentSpeed = this.player.currentSpeed;
    mon.isMoving = this.player.isMoving;
    mon.isSprinting = this.player.isSprinting;
    mon.rotationDeg = `${Math.round(Phaser.Math.RadToDeg(this.player.rotation))}°`;
    mon.playerScale = `${this.debugPanel.settings.playerScale.toFixed(2)}x`;
    mon.hitboxPixels = `${Math.round(this.debugPanel.settings.hitboxRadius * 2 * this.debugPanel.settings.playerScale)}px`;
    mon.playerX = this.player.x.toFixed(1);
    mon.playerY = this.player.y.toFixed(1);
    mon.killerState = this.killer.state;
    mon.killerDist = killerDistStr;
    mon.fps = fps;

    const completedCount = this.generators.filter((g) => g.isCompleted).length;
    this.telemetryHud.update(fps, this.killer.state, killerDistStr, completedCount, this.generators.length);
  }
}
