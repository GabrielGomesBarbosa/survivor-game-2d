import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import survivorMeta from '../assets/survivor.json';
import generatorMeta from '../assets/generator.json';
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE } from '../config/constants';
import { MapBuilder, MapData } from '../map/MapBuilder';
import { Player } from '../entities/Player';
import { Killer } from '../entities/Killer';
import { Generator } from '../entities/Generator';
import { SkillCheckSystem, SkillCheckResult } from '../systems/SkillCheckSystem';
import { SoundFX } from '../systems/SoundFX';
import { AudioManager } from '../audio/AudioManager';
import { TelemetryHUD } from '../ui/TelemetryHUD';
import { RepairPromptUI } from '../ui/RepairPromptUI';
import { DebugPanel } from '../ui/DebugPanel';
import {
  calculateEdgeToEdgeDistance,
  pixelsToMeters,
  formatCurrentTile,
  evaluateCameraPanState,
  getMappedCandidatePool,
  selectRandomCandidates,
  candidateToGeneratorDef,
  updateNavGridWithGenerators,
  buildAiWeightedGrid,
  GeneratorSpawnCandidate,
  ActiveGeneratorData,
  saveActiveGeneratorsToStorage,
  loadActiveGeneratorsFromStorage,
  clearActiveGeneratorsFromStorage
} from '../utils/gameLogic';
import { GeneratorPlacer } from '../editor/GeneratorPlacer';



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
  private isMatchWon = false;
  private survivorFootstepTimer = 0;
  private killerFootstepTimer = 0;

  // Systems and UI
  private skillCheck!: SkillCheckSystem;
  private repairPrompt!: RepairPromptUI;
  private telemetryHud!: TelemetryHUD;
  public debugPanel!: DebugPanel;
  private generatorPlacer!: GeneratorPlacer;

  public get hud(): TelemetryHUD {
    return this.telemetryHud;
  }

  public get isSpectatorMode(): boolean {
    return !this.player.isActive || !this.debugPanel.settings.survivorActive;
  }

  // Inputs & Pan Navigation
  private keyE!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private activeKeys: Set<string> = new Set();
  private isPanningCamera = false;


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
      onCameraZoomChanged: (zoom) => {
        this.cameras.main.setZoom(zoom);
        this.updateUiZoomScale(zoom);
      },
      onFreeCamToggled: (enabled) => {
        if (enabled) {
          this.cameras.main.stopFollow();
          this.telemetryHud.showNotification('📷 Modo Câmara Livre ativo: arraste o mapa com o rato!', false);
        } else {
          this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);
          this.telemetryHud.showNotification('🎯 Câmara centrada no Survivor!', false);
        }
      },
      onTogglePlacerMode: (enabled) => {
        this.generatorPlacer.setActive(enabled);
      },
      onTogglePlacerSnap: (snap) => {
        this.generatorPlacer.snapToGrid = snap;
        this.telemetryHud.showNotification(`🧲 Snap ao Grid: ${snap ? 'ATIVADO (32px)' : 'DESATIVADO (Livre)'}`, false);
      },
      onCyclePlacerRotation: () => {
        this.generatorPlacer.cycleRotation();
      },
      onCopyCandidatesJson: () => {
        this.generatorPlacer.copyCandidatesJson();
      },
      onClearCandidates: () => {
        this.generatorPlacer.clearCandidates();
      },
      onTestSkillCheck: () => this.skillCheck.startSkillCheck((res) => this.onSkillCheckResult(res)),
      onCompleteAllGenerators: () => {
        this.generators.forEach((g) => g.complete());
        this.persistActiveGenerators();
        const completed = this.generators.length;
        const required = this.debugPanel.settings.generatorRequiredTarget;
        if (completed >= required && !this.isMatchWon) {
          this.isMatchWon = true;
          SoundFX.playVictory();
          this.cameras.main.flash(500, 40, 180, 255);
          this.telemetryHud.showVictoryAlert(completed, required);
        } else {
          this.telemetryHud.showNotification('⚡ TODOS OS GERADORES RESTAURADOS (DEBUG)!', false);
        }
      },
      onResetAllGenerators: () => {
        this.isMatchWon = false;
        this.generators.forEach((g) => g.reset());
        this.persistActiveGenerators();
        this.telemetryHud.showNotification('🔄 Progresso de todos os geradores resetado!', false);
      },
      onShuffleGenerators: () => this.spawnRandomGenerators(),
      onLoadFullPool: () => this.loadFullCandidatePool(),
      onClearAllGenerators: () => this.clearAllGenerators(true, true),
      onSurvivorActiveToggled: (active: boolean) => {
        this.player.setActiveState(active);
        if (!active) {
          if (this.isRepairing) this.stopRepairing();
          AudioManager.getInstance().stopTerrorRadius();
          this.telemetryHud.stopHeartbeatVisual();
        }
        this.telemetryHud.showNotification(
          active ? '👤 Survivor reativado no mapa!' : '👁️ Modo Espectador ativo: Survivor invisível e intangível.',
          false
        );
      },
      onGeneratorTargetsChanged: () => {
        this.updateTelemetry();
      },
      onAudioSettingsChanged: (enabled, vol) => {
        AudioManager.getInstance().setEnabled(enabled);
        AudioManager.getInstance().setMasterVolume(vol);
      },
      onTerrorHeartbeatVisualToggled: (enabled: boolean) => {
        if (!enabled) {
          this.telemetryHud.stopHeartbeatVisual();
        }
      },
      onResetDefaults: () => {
        const s = this.debugPanel.settings;
        this.player.updateHitbox(s.hitboxRadius, s.playerScale);
        this.killer.updateHitbox(s.hitboxRadius, s.playerScale);
        this.player.setActiveState(s.survivorActive);
        this.cameras.main.setZoom(s.cameraZoom);
        this.updateUiZoomScale(s.cameraZoom);
        this.physics.world.drawDebug = s.showPhysicsDebug;
        if (!s.freeCam) {
          this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);
        }
        this.generatorPlacer.setActive(s.editorMode);
        this.generatorPlacer.snapToGrid = s.placerSnapToGrid;
        AudioManager.getInstance().setEnabled(s.audioEnabled);
        AudioManager.getInstance().setMasterVolume(s.masterVolume);
        if (!s.terrorHeartbeatVisual) {
          this.telemetryHud.stopHeartbeatVisual();
        }
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
    this.player = new Player(this, 2560, 1920, this.debugPanel.settings);
    this.killer = new Killer(this, 2560, 736, this.debugPanel.settings, this.easystar, this.mapData.navGrid, this.mapData.walls, this.mapData.obstacles);
    this.generators = [];
    this.skillCheck = new SkillCheckSystem(this);
    this.repairPrompt = new RepairPromptUI(this);
    this.telemetryHud = new TelemetryHUD(this);
    this.generatorPlacer = new GeneratorPlacer({
      scene: this,
      navGrid: this.mapData.navGrid,
      onNotify: (msg, isAlert) => this.telemetryHud.showNotification(msg, isAlert)
    });
    this.generatorPlacer.setActive(this.debugPanel.settings.editorMode);
    this.generatorPlacer.snapToGrid = this.debugPanel.settings.placerSnapToGrid;

    // 5. Physics Colliders & Anti-Tunneling Bounds
    [this.mapData.walls, this.mapData.obstacles].forEach((group) => {
      this.physics.add.collider(this.player.sprite, group);
      this.physics.add.collider(this.killer.sprite, group);
    });
    this.physics.add.collider(this.killer.sprite, this.player.sprite, () => {
      this.killer.handlePlayerCollision(this.player, this.debugPanel.settings, () => this.telemetryHud.showAttackAlert());
    });
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, (_: number, d: number) => {
      this.player.postUpdate(d, this.mapData.navGrid); this.killer.postUpdate(d, this.mapData.navGrid); this.updateTelemetry();
    });

    // 6. Camera & World Bounds
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.drawDebug = this.debugPanel.settings.showPhysicsDebug;
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    if (this.debugPanel.settings.freeCam) {
      this.cameras.main.stopFollow();
    } else {
      this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
    }
    this.cameras.main.setZoom(this.debugPanel.settings.cameraZoom);
    this.updateUiZoomScale(this.debugPanel.settings.cameraZoom);

    // 6.1 Navegação de Câmara Livre via Drag do Mouse (Pan) e Posicionamento de Spawns
    const executeCameraPan = (pointer: Phaser.Input.Pointer) => {
      const zoom = this.cameras.main.zoom || 1.0;
      const dx = (pointer.x - pointer.prevPosition.x) / zoom;
      const dy = (pointer.y - pointer.prevPosition.y) / zoom;
      this.cameras.main.scrollX -= dx;
      this.cameras.main.scrollY -= dy;
    };

    const isMiddleButton = (pointer: Phaser.Input.Pointer): boolean => {
      return Boolean(
        pointer.middleButtonDown() ||
        (pointer.buttons & 4) !== 0 ||
        (pointer.isDown && pointer.button === 1)
      );
    };

    const isLeftButton = (pointer: Phaser.Input.Pointer): boolean => {
      return Boolean(
        pointer.leftButtonDown() ||
        (pointer.buttons & 1) !== 0 ||
        (pointer.isDown && pointer.button === 0)
      );
    };

    const isSpaceKeyDown = (): boolean => {
      return Boolean(this.keySpace?.isDown || this.activeKeys.has('Space'));
    };

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const isSpace = isSpaceKeyDown();
      const isMiddle = isMiddleButton(pointer);
      const isLeft = isLeftButton(pointer);

      const panState = evaluateCameraPanState(
        isMiddle,
        isSpace,
        isLeft,
        this.debugPanel.settings.freeCam,
        Boolean(this.generatorPlacer?.isActive)
      );

      if (panState.shouldPan) {
        this.isPanningCamera = true;
        pointer.prevPosition.x = pointer.x;
        pointer.prevPosition.y = pointer.y;
        if (!this.debugPanel.settings.freeCam) {
          this.debugPanel.settings.freeCam = true;
          this.cameras.main.stopFollow();
          this.debugPanel.saveSettingsToStorage();
          this.telemetryHud.showNotification('📷 Câmara Livre (Pan) ativada!', false);
        }
        return;
      }

      // RMB: Remover candidato existente
      if (pointer.rightButtonDown() && this.generatorPlacer?.isActive) {
        this.generatorPlacer.handlePointerDown(pointer);
        return;
      }

      // LMB: Posicionar gerador apenas se panState.canPlaceGenerator for verdadeiro
      if (panState.canPlaceGenerator && this.generatorPlacer?.isActive) {
        this.generatorPlacer.handlePointerDown(pointer);
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const isSpace = isSpaceKeyDown();
      const isMiddle = isMiddleButton(pointer);
      const isLeft = isLeftButton(pointer);

      const panState = evaluateCameraPanState(
        isMiddle,
        isSpace,
        isLeft,
        this.debugPanel.settings.freeCam,
        Boolean(this.generatorPlacer?.isActive)
      );

      if (panState.shouldPan || (this.isPanningCamera && (isMiddle || (isSpace && isLeft)))) {
        executeCameraPan(pointer);
      }
    });

    this.input.on('pointerup', () => {
      this.isPanningCamera = false;
    });

    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any, _deltaX: number, deltaY: number) => {
      if (this.debugPanel.settings.freeCam || this.generatorPlacer?.isActive) {
        const step = deltaY > 0 ? -0.05 : 0.05;
        const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom + step, 0.3, 1.5);
        this.cameras.main.setZoom(newZoom);
        this.debugPanel.settings.cameraZoom = Number(newZoom.toFixed(2));
        this.debugPanel.saveSettingsToStorage();
        this.updateUiZoomScale(newZoom);
      }
    });

    // 7. Inputs
    if (this.input.keyboard) {
      this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
    // Previne comportamento nativo de autoscroll do navegador com botão do meio (scroll click)
    window.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    // Previne scroll de página nativo ao segurar Espaço no navegador
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.activeKeys.add(e.code);
    }, true);
    window.addEventListener('keyup', (e) => this.activeKeys.delete(e.code), true);
    window.addEventListener('resize', () => this.scale.refresh());

    // 7. Restauração do Setup Ativo via LocalStorage (Resistência ao F5)
    const savedActiveGens = loadActiveGeneratorsFromStorage();
    if (savedActiveGens && savedActiveGens.length > 0) {
      this.instantiateGeneratorsFromCandidates(savedActiveGens, false);
      this.telemetryHud.showNotification(
        `🔄 Setup restaurado do LocalStorage: ${savedActiveGens.length} geradores ativos recuperados.`,
        false
      );
    }

    // 8. Inicialização do AudioManager a partir das configurações salvas
    const audio = AudioManager.getInstance();
    audio.setEnabled(this.debugPanel.settings.audioEnabled);
    audio.setMasterVolume(this.debugPanel.settings.masterVolume);
  }

  update(_time: number, delta: number): void {
    if (this.generatorPlacer?.isActive) {
      this.generatorPlacer.update(this.input.activePointer);
    }

    // 1. Atualização contínua de regressão e faíscas em todos os geradores ativos
    for (const gen of this.generators) {
      gen.update(delta);
    }

    this.handleGeneratorInteraction(delta);
    this.player.update(delta, this.isRepairing, this.debugPanel.settings);
    this.killer.update(delta, this.player, this.generators.filter((g) => !g.isCompleted), this.debugPanel.settings);
    this.skillCheck.update(
      delta, this.isRepairing, this.debugPanel.settings.skillCheckFrequency,
      this.repairStaggerTimer <= 0, (res) => this.onSkillCheckResult(res)
    );

    // ==========================================
    // EFEITOS SONOROS PROCEDURAIS (AudioManager)
    // ==========================================
    const audio = AudioManager.getInstance();

    // 1. Passos cadenciados do Survivor sincronizados à locomoção
    if (
      this.player.isActive &&
      this.debugPanel.settings.survivorActive &&
      this.player.isMoving &&
      this.player.currentSpeed > 5
    ) {
      this.survivorFootstepTimer += delta;
      const survivorCadence = this.player.isSprinting ? 270 : 380;
      if (this.survivorFootstepTimer >= survivorCadence) {
        this.survivorFootstepTimer = 0;
        audio.playSurvivorFootstep(this.player.isSprinting);
      }
    } else {
      this.survivorFootstepTimer = 0;
    }

    // 2. Passos pesados cadenciados do Killer
    if (this.killer.isMoving) {
      this.killerFootstepTimer += delta;
      const killerCadence = this.killer.state === 'CHASE' ? 330 : 440;
      if (this.killerFootstepTimer >= killerCadence) {
        this.killerFootstepTimer = 0;
        const distToPlayer = (this.player.isActive && this.debugPanel.settings.survivorActive)
          ? Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y)
          : 0;
        const volScale = distToPlayer > 1200 ? 0 : Math.max(0.1, 1 - distToPlayer / 1200);
        audio.playKillerFootstep(volScale);
      }
    } else {
      this.killerFootstepTimer = 0;
    }

    // 3. Som contínuo de manutenção / reparo de gerador
    if (this.isRepairing && this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
      audio.startGeneratorRepairSound();
    } else {
      audio.stopGeneratorRepairSound();
    }

    // 4. Raio de Terror de Duas Camadas (Heartbeat < 500px + Drone Dissonante < 250px ou CHASE)
    const isSpectator = this.isSpectatorMode;
    const terrorDist = isSpectator
      ? Infinity
      : Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y);
    const killerState = isSpectator ? 'STANDBY' : this.killer.state;

    audio.updateTerrorRadius(terrorDist, killerState, delta);

    // 5. Feedback Visual do Raio de Terror (Coração Pulsante & Vinheta)
    this.hud.updateHeartbeatVisual(
      terrorDist,
      isSpectator,
      this.debugPanel.settings.terrorHeartbeatVisual
    );
  }

  /**
   * Manages repair proximity prompt [E], progress increase, and key release logic
   */
  private handleGeneratorInteraction(delta: number): void {
    if (!this.player.isActive || !this.debugPanel.settings.survivorActive) {
      if (this.isRepairing) this.stopRepairing();
      this.repairPrompt.hide();
      return;
    }

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

      // Se o gerador estiver regredindo, consertar por >= 0.2s (200ms) estabiliza a máquina
      if (closestGen.isRegressing) {
        const stabilized = closestGen.onRepairTick(delta);
        if (stabilized) {
          this.telemetryHud.showNotification('🔧 Gerador estabilizado! Regressão interrompida.', false);
        }
      }

      const repairRate = 100 / Math.max(1, this.debugPanel.settings.generatorRepairTime);
      const isComplete = closestGen.addProgress(repairRate * (delta / 1000));
      const promptLabel = closestGen.isRegressing
        ? `⚡ ESTABILIZANDO... [E] Manter Pressionado (${closestGen.roomName})`
        : `🔧 REPARANDO... [E] Manter Pressionado (${closestGen.roomName})`;
      this.repairPrompt.show(promptLabel, closestGen.progress, true, false, closestGen.isRegressing);

      if (isComplete) {
        this.stopRepairing();
        const completed = this.generators.filter((g) => g.isCompleted).length;
        const required = this.debugPanel.settings.generatorRequiredTarget;

        if (completed >= required && !this.isMatchWon) {
          this.isMatchWon = true;
          SoundFX.playVictory();
          this.cameras.main.flash(500, 40, 180, 255);
          this.telemetryHud.showVictoryAlert(completed, required);
        } else {
          this.telemetryHud.showNotification(
            `⚡ ${closestGen.name} restaurado! (${completed}/${required} - meta da partida)`,
            false
          );
        }
      }
    } else {
      if (this.isRepairing) this.stopRepairing();
      closestGen.repairAccumulatedTime = 0;
      closestGen.updateVisuals(false);
      if (closestGen.isRegressing) {
        this.repairPrompt.show(
          `⚠️ [E] Reparar ${closestGen.name} (EM REGRESSÃO)`,
          closestGen.progress,
          false,
          false,
          true
        );
      } else {
        this.repairPrompt.show(`[E] Reparar ${closestGen.name} (${closestGen.roomName})`, closestGen.progress, false);
      }
    }
  }

  private stopRepairing(): void {
    this.isRepairing = false;
    AudioManager.getInstance().stopGeneratorRepairSound();
    if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
      this.activeNearbyGen.updateVisuals(false);
    }
    if (this.skillCheck.isActive) {
      this.skillCheck.cancelSkillCheck(true);
    }
    this.persistActiveGenerators();
  }

  private onSkillCheckResult(result: SkillCheckResult): void {
    if (result === 'GREAT' || result === 'GOOD') {
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.activeNearbyGen.addProgress(result === 'GREAT' ? 5 : 1.5);
      }
    } else {
      AudioManager.getInstance().playGeneratorExplosion();
      AudioManager.getInstance().stopGeneratorRepairSound();
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        this.activeNearbyGen.explode();
        this.repairStaggerTimer = 1400;
        this.isRepairing = false;
        this.persistActiveGenerators();
        this.skillCheck.triggerNoiseAlert(this.activeNearbyGen.x, this.activeNearbyGen.y);
        this.killer.alertToNoise(this.activeNearbyGen.x, this.activeNearbyGen.y, this.activeNearbyGen);
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
    const centerDist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y);
    const playerRadius = this.debugPanel.settings.hitboxRadius * this.debugPanel.settings.playerScale;
    const killerRadius = playerRadius * 1.28;
    const effectiveDist = calculateEdgeToEdgeDistance(centerDist, playerRadius, killerRadius);
    const distMeters = pixelsToMeters(effectiveDist);
    const killerDistStr = `${distMeters.toFixed(1)}m`;

    const mon = this.debugPanel.monitorState;
    mon.currentSpeed = Number(pixelsToMeters(this.player.currentSpeed).toFixed(1));
    mon.isMoving = this.player.isMoving;
    mon.isSprinting = this.player.isSprinting;
    mon.rotationDeg = `${Math.round(Phaser.Math.RadToDeg(this.player.rotation))}°`;
    mon.playerScale = `${this.debugPanel.settings.playerScale.toFixed(2)}x`;
    mon.hitboxPixels = `${Math.round(this.debugPanel.settings.hitboxRadius * 2 * this.debugPanel.settings.playerScale)}px`;
    mon.playerX = this.player.x.toFixed(1);
    mon.playerY = this.player.y.toFixed(1);
    mon.currentTile = formatCurrentTile(this.player.x, this.player.y);
    mon.killerState = this.killer.state;
    mon.killerDist = `${distMeters.toFixed(1)}m (${Math.round(effectiveDist)}px)`;
    mon.fps = fps;

    const completedCount = this.generators.filter((g) => g.isCompleted).length;
    const totalGens = this.generators.length;
    const requiredGens = this.debugPanel?.settings.generatorRequiredTarget ?? 5;
    this.telemetryHud.update(fps, this.killer.state, killerDistStr, completedCount, totalGens, requiredGens);
  }

  /**
   * Propaga o novo nível de zoom para elementos de UI flutuantes e prompts,
   * assegurando tamanho aparente legível e estável na tela.
   */
  private updateUiZoomScale(zoom: number): void {
    if (this.generators) {
      this.generators.forEach((g) => g.updateZoomScale(zoom));
    }
    if (this.repairPrompt) {
      this.repairPrompt.updateZoomScale(zoom);
    }
    if (this.generatorPlacer) {
      this.generatorPlacer.updateZoomScale(zoom);
    }
    if (this.telemetryHud) {
      this.telemetryHud.updateZoomScale(zoom);
    }
  }

  /**
   * Atualiza a malha de navegação (navGrid) e os pesos do EasyStar A*
   * tratando os geradores ativos como obstáculos sólidos intransponíveis.
   */
  public refreshNavGridAndEasyStar(): void {
    const activeGens = this.generators.map((g) => ({
      x: g.x,
      y: g.y,
      rotation: g.rotation
    }));

    this.mapData.navGrid = updateNavGridWithGenerators(
      this.mapData.baseNavGrid,
      activeGens,
      TILE_SIZE
    );

    const weightedGrid = buildAiWeightedGrid(this.mapData.navGrid);
    this.easystar.setGrid(weightedGrid);
    this.killer.updateNavGrid(this.mapData.navGrid);

    if (this.generatorPlacer) {
      this.generatorPlacer.navGrid = this.mapData.navGrid;
    }
  }

  /**
   * Instancia uma lista de candidatos como geradores funcionais ativos na cena.
   */
  public instantiateGeneratorsFromCandidates(
    candidates: Array<GeneratorSpawnCandidate | ActiveGeneratorData>,
    persist: boolean = true
  ): void {
    this.clearAllGenerators(false, false);
    this.isMatchWon = false;
    const zoom = this.cameras.main.zoom || 1.0;

    candidates.forEach((cand, idx) => {
      const def = candidateToGeneratorDef(cand, idx);
      const gen = new Generator(this, def, this.mapData.obstacles);
      if ('progress' in cand && typeof cand.progress === 'number') {
        gen.progress = Math.min(100, Math.max(0, cand.progress));
        if (gen.progress >= 100 || ('isCompleted' in cand && cand.isCompleted)) {
          gen.isCompleted = true;
          gen.setFrame(2);
        } else if (gen.progress > 0) {
          gen.setFrame(1);
        }
        if ('isRegressing' in cand && cand.isRegressing && !gen.isCompleted && gen.progress > 0) {
          gen.isRegressing = true;
          AudioManager.getInstance().startGeneratorSparkingSound(gen.id);
        }
        gen.updateVisuals(false);
      }
      gen.updateZoomScale(zoom);
      this.generators.push(gen);
    });

    this.refreshNavGridAndEasyStar();
    this.updateUiZoomScale(zoom);

    if (persist) {
      this.persistActiveGenerators();
    }
  }

  /**
   * Sorteia até N geradores a partir do pool de candidatos e os instancia no mapa.
   */
  public spawnRandomGenerators(count?: number): void {
    this.isMatchWon = false;
    const targetCount = count ?? (this.debugPanel?.settings.generatorTotalTarget || 8);
    const pool = getMappedCandidatePool();
    if (pool.length === 0) {
      this.telemetryHud.showNotification('⚠️ Nenhum candidato a gerador disponível no pool.', true);
      return;
    }
    const chosen = selectRandomCandidates(pool, targetCount);
    this.instantiateGeneratorsFromCandidates(chosen);
    this.telemetryHud.showNotification(`🎲 ${chosen.length} geradores sorteados e instanciados no mapa!`, false);
  }

  /**
   * Carrega e instancia todos os candidatos cadastrados no pool (validação integral).
   */
  public loadFullCandidatePool(): void {
    this.isMatchWon = false;
    const pool = getMappedCandidatePool();
    if (pool.length === 0) {
      this.telemetryHud.showNotification('⚠️ Nenhum candidato a gerador disponível no pool.', true);
      return;
    }
    this.instantiateGeneratorsFromCandidates(pool);
    this.telemetryHud.showNotification(`📦 Pool completo (${pool.length} geradores) instanciado no mapa!`, false);
  }

  /**
   * Remove e destrói todos os geradores ativos da cena, retornando o Killer para STANDBY.
   */
  public clearAllGenerators(notify: boolean = true, clearStorage: boolean = true): void {
    this.isMatchWon = false;
    if (this.isRepairing) {
      this.stopRepairing();
    }
    this.activeNearbyGen = null;
    this.repairPrompt.hide();

    this.generators.forEach((g) => g.destroy());
    this.generators = [];
    AudioManager.getInstance().stopAllSparkingSounds();
    this.refreshNavGridAndEasyStar();

    if (clearStorage) {
      clearActiveGeneratorsFromStorage();
    }

    if (notify) {
      this.telemetryHud.showNotification('🧹 Todos os geradores foram removidos. Killer em STANDBY.', false);
    }
  }

  /**
   * Serializa e persiste o estado dos geradores ativos atuais no localStorage
   * para assegurar resiliência a recarregamento de página (F5).
   */
  public persistActiveGenerators(): void {
    if (!this.generators) return;
    const data: ActiveGeneratorData[] = this.generators.map((g) => ({
      id: g.id,
      name: g.name,
      roomName: g.roomName,
      x: g.x,
      y: g.y,
      rotation: g.rotation,
      progress: Math.floor(g.progress),
      isCompleted: g.isCompleted,
      isRegressing: g.isRegressing
    }));
    saveActiveGeneratorsToStorage(data);
  }
}

