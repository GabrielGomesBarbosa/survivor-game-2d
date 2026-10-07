import Phaser from 'phaser';
import { TILE_SIZE } from '../config/constants';
import { Generator } from '../entities/Generator';
import { AudioManager } from '../audio/AudioManager';
import {
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

export interface GeneratorLifecycleConfig {
  scene: Phaser.Scene;
  obstacles: Phaser.Physics.Arcade.StaticGroup;
  getBaseNavGrid: () => number[][];
  onNavGridUpdated: (navGrid: number[][], weightedGrid: number[][]) => void;
  getZoom: () => number;
  onUiZoomScale?: (zoom: number) => void;
  onNotification?: (msg: string, isAlert?: boolean) => void;
  onBeforeClearAll?: () => void;
  onGeneratorsSpawned?: () => void;
}

export interface GeneratorInteractionResult {
  isRepairing: boolean;
  activeNearbyGen: Generator | null;
  justCompletedGen?: Generator;
}

/**
 * @class GeneratorLifecycleManager
 * @description Manages generator instantiation, pooling, F5 LocalStorage persistence, navGrid synchronization, and repair interactions.
 */
export class GeneratorLifecycleManager {
  private config: GeneratorLifecycleConfig;
  private activeGenerators: Generator[] = [];

  constructor(config: GeneratorLifecycleConfig) {
    this.config = config;
  }

  public get generators(): Generator[] {
    return this.activeGenerators;
  }

  public get completedCount(): number {
    return this.activeGenerators.filter((g) => g.isCompleted).length;
  }

  public get totalCount(): number {
    return this.activeGenerators.length;
  }

  public get uncompletedGenerators(): Generator[] {
    return this.activeGenerators.filter((g) => !g.isCompleted);
  }

  public initFromStorage(): boolean {
    const saved = loadActiveGeneratorsFromStorage();
    if (saved && saved.length > 0) {
      this.instantiateGeneratorsFromCandidates(saved, false);
      return true;
    }
    return false;
  }

  public update(delta: number, showVisionDebug: boolean): void {
    for (const gen of this.activeGenerators) {
      gen.update(delta);
      gen.updateAudioRadiusZone(showVisionDebug);
    }
  }

  public updateZoomScale(zoom: number): void {
    this.activeGenerators.forEach((g) => g.updateZoomScale(zoom));
  }

  public updateDamagedAudio(lx: number, ly: number, audio: AudioManager): void {
    const closest = this.findClosestDamaged(lx, ly);
    if (closest) {
      audio.updateDamagedGeneratorAudio(lx, ly, closest.generator.x, closest.generator.y);
    } else {
      audio.updateDamagedGeneratorAudio(Infinity);
    }
  }

  public handleInteraction(
    px: number,
    py: number,
    isPressingE: boolean,
    delta: number,
    repairTime: number,
    promptUI: { show: (...args: any[]) => void; hide: () => void },
    isRepairingState: boolean,
    onSkillCheckReset?: () => void,
    onNotify?: (msg: string) => void
  ): GeneratorInteractionResult {
    const closest = this.findClosest(px, py);
    const gen = closest?.generator ?? null;

    if (!gen || gen.isCompleted) {
      promptUI.hide();
      return { isRepairing: false, activeNearbyGen: null };
    }

    if (isPressingE) {
      let isRepairing = isRepairingState;
      if (!isRepairing) {
        isRepairing = true;
        onSkillCheckReset?.();
      }
      if (gen.isRegressing && gen.onRepairTick(delta)) {
        onNotify?.('🔧 Gerador estabilizado! Regressão interrompida.');
      }
      const repairRate = 100 / Math.max(1, repairTime);
      const isComplete = gen.addProgress(repairRate * (delta / 1000));
      const label = gen.isRegressing
        ? `⚡ ESTABILIZANDO... [E] Manter Pressionado (${gen.roomName})`
        : `🔧 REPARANDO... [E] Manter Pressionado (${gen.roomName})`;
      promptUI.show(label, gen.progress, true, false, gen.isRegressing);

      return {
        isRepairing: isComplete ? false : isRepairing,
        activeNearbyGen: gen,
        justCompletedGen: isComplete ? gen : undefined
      };
    }

    gen.repairAccumulatedTime = 0;
    gen.updateVisuals(false);
    const label = gen.isRegressing
      ? `⚠️ [E] Reparar ${gen.name} (EM REGRESSÃO)`
      : `[E] Reparar ${gen.name} (${gen.roomName})`;
    promptUI.show(label, gen.progress, false, false, gen.isRegressing);
    return { isRepairing: false, activeNearbyGen: gen };
  }

  public refreshNavGrid(): void {
    const activeGens = this.activeGenerators.map((g) => ({
      x: g.x,
      y: g.y,
      rotation: g.rotation
    }));

    const navGrid = updateNavGridWithGenerators(
      this.config.getBaseNavGrid(),
      activeGens,
      TILE_SIZE
    );

    const weightedGrid = buildAiWeightedGrid(navGrid);
    this.config.onNavGridUpdated(navGrid, weightedGrid);
  }

  public instantiateGeneratorsFromCandidates(
    candidates: Array<GeneratorSpawnCandidate | ActiveGeneratorData>,
    persist: boolean = true
  ): void {
    this.clearAllGenerators(false, false);
    this.config.onGeneratorsSpawned?.();
    const zoom = this.config.getZoom();

    candidates.forEach((cand, idx) => {
      const def = candidateToGeneratorDef(cand, idx);
      const gen = new Generator(this.config.scene, def, this.config.obstacles);
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
      this.activeGenerators.push(gen);
    });

    this.refreshNavGrid();
    this.config.onUiZoomScale?.(zoom);

    if (persist) {
      this.persistActiveGenerators();
    }
  }

  public spawnRandomGenerators(count?: number, defaultTarget?: number): void {
    this.config.onGeneratorsSpawned?.();
    const targetCount = count ?? (defaultTarget || 8);
    const pool = getMappedCandidatePool();
    if (pool.length === 0) {
      this.config.onNotification?.('⚠️ Nenhum candidato a gerador disponível no pool.', true);
      return;
    }
    const chosen = selectRandomCandidates(pool, targetCount);
    this.instantiateGeneratorsFromCandidates(chosen);
    this.config.onNotification?.(`🎲 ${chosen.length} geradores sorteados e instanciados no mapa!`, false);
  }

  public loadFullCandidatePool(): void {
    this.config.onGeneratorsSpawned?.();
    const pool = getMappedCandidatePool();
    if (pool.length === 0) {
      this.config.onNotification?.('⚠️ Nenhum candidato a gerador disponível no pool.', true);
      return;
    }
    this.instantiateGeneratorsFromCandidates(pool);
    this.config.onNotification?.(`📦 Pool completo (${pool.length} geradores) instanciado no mapa!`, false);
  }

  public clearAllGenerators(notify: boolean = true, clearStorage: boolean = true): void {
    this.config.onBeforeClearAll?.();
    this.activeGenerators.forEach((g) => g.destroy());
    this.activeGenerators = [];
    AudioManager.getInstance().stopAllSparkingSounds();
    this.refreshNavGrid();

    if (clearStorage) {
      clearActiveGeneratorsFromStorage();
    }

    if (notify) {
      this.config.onNotification?.('🧹 Todos os geradores foram removidos. Killer em STANDBY.', false);
    }
  }

  public persistActiveGenerators(): void {
    if (!this.activeGenerators) return;
    const data: ActiveGeneratorData[] = this.activeGenerators.map((g) => ({
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

  public completeAll(): void {
    this.activeGenerators.forEach((g) => g.complete());
    this.persistActiveGenerators();
  }

  public resetAll(): void {
    this.activeGenerators.forEach((g) => g.reset());
    this.persistActiveGenerators();
  }

  public findClosest(x: number, y: number, maxRadius?: number): { generator: Generator; distance: number } | null {
    let closestGen: Generator | null = null;
    let closestDist = Infinity;
    for (const gen of this.activeGenerators) {
      const dist = Phaser.Math.Distance.Between(x, y, gen.x, gen.y);
      const limit = maxRadius !== undefined ? maxRadius : gen.interactionRadius;
      if (dist <= limit && dist < closestDist) {
        closestDist = dist;
        closestGen = gen;
      }
    }
    return closestGen ? { generator: closestGen, distance: closestDist } : null;
  }

  public findClosestDamaged(x: number, y: number): { generator: Generator; distance: number } | null {
    let closestDamagedGen: Generator | null = null;
    let closestDamagedDist = Infinity;
    for (const gen of this.activeGenerators) {
      if (gen.isRegressing && !gen.isCompleted) {
        const d = Phaser.Math.Distance.Between(x, y, gen.x, gen.y);
        if (d < closestDamagedDist) {
          closestDamagedDist = d;
          closestDamagedGen = gen;
        }
      }
    }
    return closestDamagedGen ? { generator: closestDamagedGen, distance: closestDamagedDist } : null;
  }
}
