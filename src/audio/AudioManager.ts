/**
 * @file AudioManager.ts
 * @description Lightweight facade orchestrating specialized audio sub-services and synthesizers.
 */

import { AudioContextManager } from './core/AudioContextManager';
import { FootstepSynthesizer } from './synths/FootstepSynthesizer';
import { TerrorSynthesizer } from './synths/TerrorSynthesizer';
import { GeneratorAudioSynthesizer } from './synths/GeneratorAudioSynthesizer';
import { CombatSynthesizer } from './synths/CombatSynthesizer';

export * from './spatial/SpatialAudioService';
export * from './core/AudioContextManager';
export * from './synths/FootstepSynthesizer';
export * from './synths/TerrorSynthesizer';
export * from './synths/GeneratorAudioSynthesizer';
export * from './synths/CombatSynthesizer';

export class AudioManager {
  private static instance: AudioManager | null = null;

  public readonly contextManager: AudioContextManager;
  public readonly footstepSynth: FootstepSynthesizer;
  public readonly terrorSynth: TerrorSynthesizer;
  public readonly generatorSynth: GeneratorAudioSynthesizer;
  public readonly combatSynth: CombatSynthesizer;

  private constructor() {
    this.contextManager = new AudioContextManager();
    this.footstepSynth = new FootstepSynthesizer(this.contextManager);
    this.terrorSynth = new TerrorSynthesizer(this.contextManager);
    this.generatorSynth = new GeneratorAudioSynthesizer(this.contextManager);
    this.combatSynth = new CombatSynthesizer(this.contextManager);
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  // Compatibilidade com injeção de mocks nos testes unitários
  public get ctx(): AudioContext | null { return this.contextManager.ctx; }
  public set ctx(c: AudioContext | null) { this.contextManager.ctx = c; }
  public get masterGain(): GainNode | null { return this.contextManager.masterGain; }
  public set masterGain(g: GainNode | null) { this.contextManager.masterGain = g; }
  public get noiseBuffer(): AudioBuffer | null { return this.contextManager.noiseBuffer; }
  public set noiseBuffer(b: AudioBuffer | null) { this.contextManager.noiseBuffer = b; }
  public get droneGainNode(): GainNode | null { return this.terrorSynth.droneGainNode; }

  // Ciclo de vida e controles do contexto
  public onAudioUnlocked(cb: () => void): () => void { return this.contextManager.onAudioUnlocked(cb); }
  public isContextRunning(): boolean { return this.contextManager.isContextRunning(); }
  public getContext(): AudioContext | null { return this.contextManager.getContext(); }
  public ensureContextRunning(): Promise<void> { return this.contextManager.ensureContextRunning(); }
  public resumeContext(): void { this.contextManager.resumeContext(); }
  public setEnabled(enabled: boolean): void { this.contextManager.setEnabled(enabled); }
  public isEnabled(): boolean { return this.contextManager.isEnabled(); }
  public setMasterVolume(vol: number): void { this.contextManager.setMasterVolume(vol); }
  public getMasterVolume(): number { return this.contextManager.getMasterVolume(); }

  // Locomoção e passos
  public playSurvivorFootstep(isRunning: boolean = false): void {
    this.footstepSynth.playSurvivorFootstep(isRunning);
  }
  public playKillerFootstep(volumeScale: number = 1): void {
    this.footstepSynth.playKillerFootstep(volumeScale);
  }

  // Ações de gerador
  public startGeneratorRepairSound(): void { this.generatorSynth.startGeneratorRepairSound(); }
  public stopGeneratorRepairSound(): void { this.generatorSynth.stopGeneratorRepairSound(); }
  public isRepairSoundPlaying(): boolean { return this.generatorSynth.isRepairSoundPlaying(); }
  public playGeneratorExplosion(): void { this.generatorSynth.playGeneratorExplosion(); }
  public playGeneratorKickSound(): void { this.generatorSynth.playGeneratorKickSound(); }

  // Raio de terror
  public updateTerrorRadius(
    distanceToKiller: number,
    killerState?: string | boolean | number,
    deltaMs: number = 16.6
  ): void {
    this.terrorSynth.updateTerrorRadius(distanceToKiller, killerState, deltaMs);
  }
  public stopTerrorRadius(): void { this.terrorSynth.stopTerrorRadius(); }
  public stopTerrorDrone(immediate: boolean = false): void { this.terrorSynth.stopTerrorDrone(immediate); }
  public isTerrorRadiusActive(): boolean { return this.terrorSynth.isTerrorRadiusActive(); }
  public isDronePlaying(): boolean { return this.terrorSynth.isDronePlaying(); }

  // Motor danificado e faíscas
  public startDamagedMotorLoop(): void { this.generatorSynth.startDamagedMotorLoop(); }
  public stopDamagedMotorLoop(): void { this.generatorSynth.stopDamagedMotorLoop(); }
  public startGeneratorSparkingSound(genId: string): void { this.generatorSynth.startGeneratorSparkingSound(genId); }
  public stopGeneratorSparkingSound(genId: string): void { this.generatorSynth.stopGeneratorSparkingSound(genId); }
  public stopAllSparkingSounds(): void { this.generatorSynth.stopAllSparkingSounds(); }
  public isGeneratorSparking(genId?: string): boolean { return this.generatorSynth.isGeneratorSparking(genId); }
  public isDamagedMotorPlaying(): boolean { return this.generatorSynth.isDamagedMotorPlaying(); }
  public getDamagedGeneratorVolume(): number { return this.generatorSynth.getDamagedGeneratorVolume(); }
  public getDamagedGeneratorDistance(): number { return this.generatorSynth.getDamagedGeneratorDistance(); }
  public updateDamagedGeneratorAudio(
    listenerXOrDist: number,
    listenerY?: number,
    genX?: number,
    genY?: number
  ): number {
    return this.generatorSynth.updateDamagedGeneratorAudio(listenerXOrDist, listenerY, genX, genY);
  }
  public playStochasticSpark(): void { this.generatorSynth.sparkSynth.playStochasticSpark(); }

  // Combate M1
  public playAttackSwingSound(): void { this.combatSynth.playAttackSwingSound(); }
  public playAttackHitSound(): void { this.combatSynth.playAttackHitSound(); }
}
