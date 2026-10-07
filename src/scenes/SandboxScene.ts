import Phaser from 'phaser';
import EasyStar from 'easystarjs';
import survivorMeta from '../assets/survivor.json';
import generatorMeta from '../assets/generator.json';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../config/constants';
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
import { GeneratorPlacer } from '../editor/GeneratorPlacer';
import { CameraController } from '../controllers/CameraController';
import { AcousticWaveVisualizer } from '../services/AcousticWaveVisualizer';
import { GeneratorLifecycleManager } from '../services/GeneratorLifecycleManager';
import { calculateEdgeToEdgeDistance, pixelsToMeters, formatCurrentTile, GeneratorSpawnCandidate, ActiveGeneratorData } from '../utils/gameLogic';

/**
 * @class SandboxScene
 * @description Lean orchestrator scene coordinating gameplay entities, systems, and UI services.
 */
export class SandboxScene extends Phaser.Scene {
  private mapData!: MapData;
  private easystar!: EasyStar.js;
  private player!: Player;
  private killer!: Killer;
  private cameraCtrl!: CameraController;
  private waveVisualizer!: AcousticWaveVisualizer;
  private generatorLifecycle!: GeneratorLifecycleManager;

  private activeNearbyGen: Generator | null = null;
  private isRepairing = false;
  private repairStaggerTimer = 0;
  private isMatchWon = false;

  private skillCheck!: SkillCheckSystem;
  private repairPrompt!: RepairPromptUI;
  private telemetryHud!: TelemetryHUD;
  public debugPanel!: DebugPanel;
  private generatorPlacer!: GeneratorPlacer;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private activeKeys: Set<string> = new Set();

  public get hud(): TelemetryHUD { return this.telemetryHud; }
  public get isSpectatorMode(): boolean { return !this.player.isActive || !this.debugPanel.settings.survivorActive; }
  public get generators(): Generator[] { return this.generatorLifecycle.generators; }

  constructor() { super('SandboxScene'); }

  preload(): void {
    this.load.spritesheet('survivor', 'assets/survivor.png', { frameWidth: survivorMeta.frameWidth, frameHeight: survivorMeta.frameHeight });
    this.load.spritesheet('generator', 'assets/generator.png', { frameWidth: generatorMeta.frameWidth, frameHeight: generatorMeta.frameHeight });
  }

  create(): void {
    this.mapData = MapBuilder.build(this);
    this.easystar = this.mapData.easystar;

    this.debugPanel = new DebugPanel({
      onPlayerScaleOrHitboxChanged: (s, r) => { this.player.updateHitbox(r, s); this.killer.updateHitbox(r, s); },
      onAnimFrameRateChanged: (k, fps) => { const a = this.anims.get(k); if (a) a.frameRate = fps; },
      onPhysicsDebugToggled: (s) => { this.physics.world.drawDebug = s; if (!s && this.physics.world.debugGraphic) this.physics.world.debugGraphic.clear(); },
      onCameraZoomChanged: (z) => this.cameraCtrl.setZoom(z),
      onFreeCamToggled: (en) => {
        this.cameraCtrl.setFreeCam(en, this.player.sprite);
        this.telemetryHud.showNotification(en ? '📷 Modo Câmara Livre ativo: arraste o mapa com o rato!' : '🎯 Câmara centrada no Survivor!', false);
      },
      onTogglePlacerMode: (en) => this.generatorPlacer.setActive(en),
      onTogglePlacerSnap: (sn) => { this.generatorPlacer.snapToGrid = sn; this.telemetryHud.showNotification(`🧲 Snap ao Grid: ${sn ? 'ATIVADO (32px)' : 'DESATIVADO (Livre)'}`, false); },
      onCyclePlacerRotation: () => this.generatorPlacer.cycleRotation(),
      onCopyCandidatesJson: () => this.generatorPlacer.copyCandidatesJson(),
      onClearCandidates: () => this.generatorPlacer.clearCandidates(),
      onTestSkillCheck: () => this.skillCheck.startSkillCheck((res) => this.onSkillCheckResult(res)),
      onCompleteAllGenerators: () => {
        this.generatorLifecycle.completeAll();
        const c = this.generatorLifecycle.completedCount, req = this.debugPanel.settings.generatorRequiredTarget;
        if (c >= req && !this.isMatchWon) this.triggerVictory(c, req);
        else this.telemetryHud.showNotification('⚡ TODOS OS GERADORES RESTAURADOS (DEBUG)!', false);
      },
      onResetAllGenerators: () => {
        this.isMatchWon = false; this.generatorLifecycle.resetAll();
        this.telemetryHud.showNotification('🔄 Progresso de todos os geradores resetado!', false);
      },
      onShuffleGenerators: () => this.spawnRandomGenerators(),
      onLoadFullPool: () => this.loadFullCandidatePool(),
      onClearAllGenerators: () => this.clearAllGenerators(true, true),
      onSurvivorActiveToggled: (act) => {
        this.player.setActiveState(act);
        if (!act) { if (this.isRepairing) this.stopRepairing(); AudioManager.getInstance().stopTerrorRadius(); this.telemetryHud.stopHeartbeatVisual(); }
        this.telemetryHud.showNotification(act ? '👤 Survivor reativado no mapa!' : '👁️ Modo Espectador ativo: Survivor invisível e intangível.', false);
      },
      onGeneratorTargetsChanged: () => this.updateTelemetry(),
      onAudioSettingsChanged: (en, vol) => { AudioManager.getInstance().setEnabled(en); AudioManager.getInstance().setMasterVolume(vol); },
      onTerrorHeartbeatVisualToggled: (en) => { if (!en) this.telemetryHud.stopHeartbeatVisual(); },
      onResetDefaults: () => this.handleResetDefaults()
    });

    [{ key: 'walk', start: 0, end: 3, rate: this.debugPanel.settings.walkAnimFrameRate },
     { key: 'run', start: 4, end: 7, rate: this.debugPanel.settings.runAnimFrameRate }].forEach(({ key, start, end, rate }) => {
      this.anims.create({ key, frames: this.anims.generateFrameNumbers('survivor', { start, end }), frameRate: rate, repeat: -1 });
    });

    this.player = new Player(this, 2560, 1920, this.debugPanel.settings);
    this.killer = new Killer(this, 2560, 736, this.debugPanel.settings, this.easystar, this.mapData.navGrid, this.mapData.walls, this.mapData.obstacles);
    this.killer.attackCallbacks = { onAttackHit: () => {
      this.telemetryHud.showAttackAlert(); this.cameras.main.flash(260, 220, 20, 20); this.cameras.main.shake(180, 0.005);
    }};

    this.skillCheck = new SkillCheckSystem(this);
    this.repairPrompt = new RepairPromptUI(this);
    this.telemetryHud = new TelemetryHUD(this);
    this.generatorPlacer = new GeneratorPlacer({
      scene: this, navGrid: this.mapData.navGrid, onNotify: (msg, alert) => this.telemetryHud.showNotification(msg, alert)
    });
    this.generatorPlacer.setActive(this.debugPanel.settings.editorMode);
    this.generatorPlacer.snapToGrid = this.debugPanel.settings.placerSnapToGrid;

    this.waveVisualizer = new AcousticWaveVisualizer({
      scene: this, isEnabled: () => Boolean(this.debugPanel?.settings?.showSoundWaves)
    });

    this.generatorLifecycle = new GeneratorLifecycleManager({
      scene: this, obstacles: this.mapData.obstacles, getBaseNavGrid: () => this.mapData.baseNavGrid,
      onNavGridUpdated: (navGrid, weightedGrid) => {
        this.mapData.navGrid = navGrid; this.easystar.setGrid(weightedGrid); this.killer.updateNavGrid(navGrid, weightedGrid);
        if (this.generatorPlacer) this.generatorPlacer.navGrid = navGrid;
      },
      getZoom: () => this.cameraCtrl?.currentZoom || 1.0, onUiZoomScale: (z) => this.updateUiZoomScale(z),
      onNotification: (msg, alert) => this.telemetryHud.showNotification(msg, alert),
      onBeforeClearAll: () => { this.isMatchWon = false; if (this.isRepairing) this.stopRepairing(); this.activeNearbyGen = null; this.repairPrompt.hide(); },
      onGeneratorsSpawned: () => { this.isMatchWon = false; }
    });

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

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.drawDebug = this.debugPanel.settings.showPhysicsDebug;

    this.cameraCtrl = new CameraController({
      scene: this, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
      getFreeCam: () => this.debugPanel.settings.freeCam,
      setFreeCam: (en) => { this.debugPanel.settings.freeCam = en; this.debugPanel.saveSettingsToStorage(); },
      getPlacerActive: () => Boolean(this.generatorPlacer?.isActive),
      isSpaceDown: () => Boolean(this.keySpace?.isDown || this.activeKeys.has('Space')),
      onPanActivated: () => this.telemetryHud.showNotification('📷 Câmara Livre (Pan) ativada!', false),
      onZoomChanged: (z) => { this.debugPanel.settings.cameraZoom = z; this.debugPanel.saveSettingsToStorage(); },
      onUiZoomScale: (z) => this.updateUiZoomScale(z)
    });
    this.cameraCtrl.setup(this.player.sprite, this.debugPanel.settings.cameraZoom);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      AudioManager.getInstance().ensureContextRunning();
      const panRes = this.cameraCtrl.handlePointerDown(pointer);
      if (panRes.handled) return;
      if (pointer.rightButtonDown() && this.generatorPlacer?.isActive) { this.generatorPlacer.handlePointerDown(pointer); return; }
      if (panRes.canPlaceGenerator && this.generatorPlacer?.isActive) { this.generatorPlacer.handlePointerDown(pointer); }
      else if (panRes.isLeftClick && this.debugPanel.settings.manualKillerControl && this.killer && !this.cameraCtrl.isPanningCamera) { this.killer.performAttack(this.player); }
    });

    if (this.input.keyboard) {
      this.keyE = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
      this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }
    window.addEventListener('keydown', (e) => {
      AudioManager.getInstance().ensureContextRunning();
      if (e.code === 'Space') e.preventDefault();
      this.activeKeys.add(e.code);
    }, true);
    window.addEventListener('keyup', (e) => this.activeKeys.delete(e.code), true);
    window.addEventListener('resize', () => this.scale.refresh());

    if (this.generatorLifecycle.initFromStorage()) {
      this.telemetryHud.showNotification(`🔄 Setup restaurado do LocalStorage: ${this.generatorLifecycle.totalCount} geradores recuperados.`, false);
    }

    const audio = AudioManager.getInstance();
    audio.setEnabled(this.debugPanel.settings.audioEnabled);
    audio.setMasterVolume(this.debugPanel.settings.masterVolume);
    this.telemetryHud.setAudioPromptVisible(!audio.isContextRunning());
    audio.onAudioUnlocked(() => this.telemetryHud.setAudioPromptVisible(false));
    if (typeof document !== 'undefined') document.getElementById('hud-audio-prompt')?.addEventListener('click', () => audio.ensureContextRunning());
  }

  update(_time: number, delta: number): void {
    if (this.generatorPlacer?.isActive) this.generatorPlacer.update(this.input.activePointer);
    this.generatorLifecycle.update(delta, Boolean(this.debugPanel.settings.showKillerVision || this.debugPanel.settings.showPhysicsDebug));
    this.handleGeneratorInteraction(delta);
    this.player.update(delta, this.isRepairing, this.debugPanel.settings);
    if (this.keySpace && Phaser.Input.Keyboard.JustDown(this.keySpace) && this.debugPanel.settings.manualKillerControl) {
      this.killer.performAttack(this.player);
    }
    this.killer.update(delta, this.player, this.generatorLifecycle.uncompletedGenerators, this.debugPanel.settings);
    this.skillCheck.update(delta, this.isRepairing, this.debugPanel.settings.skillCheckFrequency, this.repairStaggerTimer <= 0, (r) => this.onSkillCheckResult(r));

    const audio = AudioManager.getInstance();
    this.waveVisualizer.updateFootsteps(delta, {
      player: this.player, killer: this.killer, survivorActive: Boolean(this.debugPanel.settings.survivorActive),
      runNoiseRadius: this.debugPanel.settings.runNoiseRadius, walkNoiseRadius: this.debugPanel.settings.walkNoiseRadius,
      onNoiseEmitted: (n) => this.events.emit('noise-emitted', n)
    }, audio);

    if (this.isRepairing && this.activeNearbyGen && !this.activeNearbyGen.isCompleted) audio.startGeneratorRepairSound();
    else audio.stopGeneratorRepairSound();

    const isSpec = this.isSpectatorMode;
    const isSurv = this.player.isActive && this.debugPanel.settings.survivorActive && !isSpec;
    const lx = isSurv ? this.player.x : (this.cameras.main.scrollX + this.cameras.main.width / 2);
    const ly = isSurv ? this.player.y : (this.cameras.main.scrollY + this.cameras.main.height / 2);
    this.generatorLifecycle.updateDamagedAudio(lx, ly, audio);

    const terrorDist = isSpec ? Infinity : Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y);
    audio.updateTerrorRadius(terrorDist, isSpec ? 'STANDBY' : this.killer.state, delta);
    this.hud.updateHeartbeatVisual(terrorDist, isSpec, this.debugPanel.settings.terrorHeartbeatVisual);
  }

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

    const isPressingE = Boolean(this.keyE?.isDown || this.activeKeys.has('KeyE'));
    const res = this.generatorLifecycle.handleInteraction(
      this.player.x, this.player.y, isPressingE, delta,
      this.debugPanel.settings.generatorRepairTime, this.repairPrompt, this.isRepairing,
      () => this.skillCheck.resetTimer(this.debugPanel.settings.skillCheckFrequency),
      (msg) => this.telemetryHud.showNotification(msg, false)
    );
    this.activeNearbyGen = res.activeNearbyGen;
    this.isRepairing = res.isRepairing;

    if (res.justCompletedGen) {
      this.stopRepairing();
      const completed = this.generatorLifecycle.completedCount;
      const req = this.debugPanel.settings.generatorRequiredTarget;
      if (completed >= req && !this.isMatchWon) this.triggerVictory(completed, req);
      else this.telemetryHud.showNotification(`⚡ ${res.justCompletedGen.name} restaurado! (${completed}/${req} - meta da partida)`, false);
    }
  }

  private stopRepairing(): void {
    this.isRepairing = false;
    AudioManager.getInstance().stopGeneratorRepairSound();
    if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) this.activeNearbyGen.updateVisuals(false);
    if (this.skillCheck.isActive) this.skillCheck.cancelSkillCheck(true);
    this.generatorLifecycle.persistActiveGenerators();
  }

  public spawnSoundWave(x: number, y: number, radiusM: number, color = 0x00ffff, duration = 900): void {
    this.waveVisualizer.spawnSoundWave(x, y, radiusM, color, duration);
  }

  private onSkillCheckResult(result: SkillCheckResult): void {
    if (result === 'GREAT' || result === 'GOOD') {
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) this.activeNearbyGen.addProgress(result === 'GREAT' ? 5 : 1.5);
    } else {
      AudioManager.getInstance().playGeneratorExplosion(); AudioManager.getInstance().stopGeneratorRepairSound();
      if (this.activeNearbyGen && !this.activeNearbyGen.isCompleted) {
        const gen = this.activeNearbyGen;
        gen.explode(); this.repairStaggerTimer = 1400; this.isRepairing = false;
        this.generatorLifecycle.persistActiveGenerators();
        this.skillCheck.triggerNoiseAlert(gen.x, gen.y); this.killer.alertToNoise(gen.x, gen.y, gen);
        this.telemetryHud.showNotification('💥 O Assassino foi alertado da explosão do gerador!', true);
        this.spawnSoundWave(gen.x, gen.y, 36.0, 0xff5522, 800);
        this.events.emit('noise-emitted', { x: gen.x, y: gen.y, radiusInMeters: 36.0, source: 'generator' });
      } else {
        SoundFX.playExplosion(); this.cameras.main.shake(300, 0.01);
      }
    }
    this.skillCheck.resetTimer(this.debugPanel.settings.skillCheckFrequency);
  }

  private triggerVictory(completed: number, required: number): void {
    this.isMatchWon = true;
    SoundFX.playVictory();
    this.cameras.main.flash(500, 40, 180, 255);
    this.telemetryHud.showVictoryAlert(completed, required);
  }

  private handleResetDefaults(): void {
    const s = this.debugPanel.settings;
    this.player.updateHitbox(s.hitboxRadius, s.playerScale); this.killer.updateHitbox(s.hitboxRadius, s.playerScale);
    this.player.setActiveState(s.survivorActive); this.cameraCtrl.setZoom(s.cameraZoom);
    this.physics.world.drawDebug = s.showPhysicsDebug; this.cameraCtrl.setFreeCam(s.freeCam, this.player.sprite);
    this.generatorPlacer.setActive(s.editorMode); this.generatorPlacer.snapToGrid = s.placerSnapToGrid;
    AudioManager.getInstance().setEnabled(s.audioEnabled); AudioManager.getInstance().setMasterVolume(s.masterVolume);
    if (!s.terrorHeartbeatVisual) this.telemetryHud.stopHeartbeatVisual();
  }

  private updateTelemetry(): void {
    const fps = Math.round(this.game.loop.actualFps);
    const pRad = this.debugPanel.settings.hitboxRadius * this.debugPanel.settings.playerScale;
    const centerDist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.killer.x, this.killer.y);
    const effDist = calculateEdgeToEdgeDistance(centerDist, pRad, pRad * 1.28);
    const distM = pixelsToMeters(effDist);

    const mon = this.debugPanel.monitorState;
    mon.currentSpeed = pixelsToMeters(this.player.currentSpeed, 2);
    mon.isMoving = this.player.isMoving;
    mon.isSprinting = this.player.isSprinting;
    mon.rotationDeg = `${Math.round(Phaser.Math.RadToDeg(this.player.rotation))}°`;
    mon.playerScale = `${this.debugPanel.settings.playerScale.toFixed(2)}x`;
    mon.hitboxPixels = `${Math.round(pRad * 2)}px`;
    mon.playerX = this.player.x.toFixed(1);
    mon.playerY = this.player.y.toFixed(1);
    mon.currentTile = formatCurrentTile(this.player.x, this.player.y);
    mon.killerState = this.killer.state;
    mon.killerDist = `${distM.toFixed(1)}m (${Math.round(effDist)}px)`;
    mon.fps = fps;

    this.telemetryHud.update(fps, this.killer.state, `${distM.toFixed(1)}m`, this.generatorLifecycle.completedCount, this.generatorLifecycle.totalCount, this.debugPanel.settings.generatorRequiredTarget);
    this.telemetryHud.updateRadiusLegend(this.debugPanel.settings);
  }

  private updateUiZoomScale(zoom: number): void {
    this.generatorLifecycle?.updateZoomScale(zoom);
    this.repairPrompt?.updateZoomScale(zoom);
    this.generatorPlacer?.updateZoomScale(zoom);
    this.telemetryHud?.updateZoomScale(zoom);
  }

  public refreshNavGridAndEasyStar(): void { this.generatorLifecycle.refreshNavGrid(); }
  public instantiateGeneratorsFromCandidates(c: Array<GeneratorSpawnCandidate | ActiveGeneratorData>, p = true): void { this.generatorLifecycle.instantiateGeneratorsFromCandidates(c, p); }
  public spawnRandomGenerators(n?: number): void { this.generatorLifecycle.spawnRandomGenerators(n, this.debugPanel?.settings?.generatorTotalTarget); }
  public loadFullCandidatePool(): void { this.generatorLifecycle.loadFullCandidatePool(); }
  public clearAllGenerators(n = true, c = true): void { this.generatorLifecycle.clearAllGenerators(n, c); }
  public persistActiveGenerators(): void { this.generatorLifecycle.persistActiveGenerators(); }
}
