/**
 * @file GeneratorAudioSynthesizer.ts
 * @description Orchestrates generator audio synthesis: repair actions, damaged motor loop, and stochastic sparking.
 */

import { AudioContextManager } from '../core/AudioContextManager';
import { calculateDamagedGeneratorAudioVolume } from '../spatial/SpatialAudioService';
import { GeneratorActionSynthesizer } from './GeneratorActionSynthesizer';
import { GeneratorSparkSynthesizer } from './GeneratorSparkSynthesizer';

export * from './GeneratorActionSynthesizer';
export * from './GeneratorSparkSynthesizer';

export class GeneratorAudioSynthesizer {
  public damagedGeneratorGainNode: GainNode | null = null;
  public damagedMotorOscillator: OscillatorNode | null = null;
  public damagedMotorLfo: OscillatorNode | null = null;
  public currentDamagedGeneratorDist: number = Infinity;
  public currentDamagedGeneratorVolume: number = 0;
  public isDamagedAudioPlaying: boolean = false;

  public readonly actionSynth: GeneratorActionSynthesizer;
  public readonly sparkSynth: GeneratorSparkSynthesizer;

  constructor(private contextManager: AudioContextManager) {
    this.actionSynth = new GeneratorActionSynthesizer(this.contextManager);
    this.sparkSynth = new GeneratorSparkSynthesizer(
      this.contextManager,
      (ctx) => this.getDamagedGainNode(ctx),
      () => ({ volume: this.currentDamagedGeneratorVolume, dist: this.currentDamagedGeneratorDist })
    );

    this.contextManager.onVolumeChange((vol) => {
      const ctx = this.contextManager.getContext();
      if (this.damagedGeneratorGainNode && ctx) {
        const targetGain = Math.max(0.0001, this.currentDamagedGeneratorVolume * 0.40 * vol);
        this.damagedGeneratorGainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
      }
    });

    this.contextManager.onEnabledChange((enabled) => {
      if (!enabled) {
        this.stopGeneratorRepairSound();
        this.stopAllSparkingSounds();
      }
    });
  }

  // Delegações de ações mecânicas
  public startGeneratorRepairSound(): void { this.actionSynth.startGeneratorRepairSound(); }
  public stopGeneratorRepairSound(): void { this.actionSynth.stopGeneratorRepairSound(); }
  public isRepairSoundPlaying(): boolean { return this.actionSynth.isRepairSoundPlaying(); }
  public playGeneratorExplosion(): void { this.actionSynth.playGeneratorExplosion(); }
  public playGeneratorKickSound(): void { this.actionSynth.playGeneratorKickSound(); }

  // Motor danificado & Barramento espacial
  public getDamagedGainNode(ctx: AudioContext): GainNode {
    if (!this.damagedGeneratorGainNode) {
      this.damagedGeneratorGainNode = ctx.createGain();
      const vol = this.contextManager.getMasterVolume();
      const initialGain = Math.max(0.0001, this.currentDamagedGeneratorVolume * 0.40 * vol);
      this.damagedGeneratorGainNode.gain.setValueAtTime(initialGain, ctx.currentTime);
      if (this.contextManager.masterGain) {
        this.damagedGeneratorGainNode.connect(this.contextManager.masterGain);
      }
    }
    return this.damagedGeneratorGainNode;
  }

  public startDamagedMotorLoop(): void {
    if (!this.contextManager.isEnabled() || this.isDamagedAudioPlaying) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      this.isDamagedAudioPlaying = true;
      const now = ctx.currentTime;
      const damagedBus = this.getDamagedGainNode(ctx);

      this.damagedMotorOscillator = ctx.createOscillator();
      this.damagedMotorOscillator.type = 'sawtooth';
      this.damagedMotorOscillator.frequency.setValueAtTime(58, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(260, now);
      filter.Q.setValueAtTime(2.2, now);

      this.damagedMotorLfo = ctx.createOscillator();
      this.damagedMotorLfo.type = 'sawtooth';
      this.damagedMotorLfo.frequency.setValueAtTime(8.5, now);

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.06, now);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.18, now);

      this.damagedMotorLfo.connect(lfoGain);
      lfoGain.connect(oscGain.gain);

      this.damagedMotorOscillator.connect(filter);
      filter.connect(oscGain);
      oscGain.connect(damagedBus);

      this.damagedMotorOscillator.start(now);
      this.damagedMotorLfo.start(now);
    } catch (_) {
      this.stopDamagedMotorLoop();
    }
  }

  public stopDamagedMotorLoop(): void {
    this.isDamagedAudioPlaying = false;
    if (this.damagedMotorOscillator) {
      try {
        this.damagedMotorOscillator.stop();
        this.damagedMotorOscillator.disconnect();
      } catch (_) {}
      this.damagedMotorOscillator = null;
    }
    if (this.damagedMotorLfo) {
      try {
        this.damagedMotorLfo.stop();
        this.damagedMotorLfo.disconnect();
      } catch (_) {}
      this.damagedMotorLfo = null;
    }
  }

  private resetDamagedAudio(): void {
    this.stopDamagedMotorLoop();
    this.currentDamagedGeneratorDist = Infinity;
    this.currentDamagedGeneratorVolume = 0;
    const ctx = this.contextManager.getContext();
    if (this.damagedGeneratorGainNode && ctx) {
      try {
        const now = ctx.currentTime;
        this.damagedGeneratorGainNode.gain.cancelScheduledValues(now);
        this.damagedGeneratorGainNode.gain.setValueAtTime(this.damagedGeneratorGainNode.gain.value, now);
        this.damagedGeneratorGainNode.gain.linearRampToValueAtTime(0.0001, now + 0.05);
      } catch (_) {}
    }
  }

  // Faíscas estocásticas
  public startGeneratorSparkingSound(genId: string): void {
    if (this.currentDamagedGeneratorDist === Infinity) {
      this.currentDamagedGeneratorDist = 0;
      this.currentDamagedGeneratorVolume = 1.0;
    }
    this.sparkSynth.startGeneratorSparkingSound(genId);
    if (!this.isDamagedAudioPlaying && this.contextManager.isEnabled()) {
      this.startDamagedMotorLoop();
    }
  }

  public stopGeneratorSparkingSound(genId: string): void {
    this.sparkSynth.stopGeneratorSparkingSound(genId);
    if (!this.sparkSynth.isGeneratorSparking()) {
      this.resetDamagedAudio();
    }
  }

  public stopAllSparkingSounds(): void {
    this.sparkSynth.stopAllSparkingSounds();
    this.resetDamagedAudio();
  }

  public isGeneratorSparking(genId?: string): boolean {
    return this.sparkSynth.isGeneratorSparking(genId);
  }

  public isDamagedMotorPlaying(): boolean {
    return this.isDamagedAudioPlaying;
  }

  public getDamagedGeneratorVolume(): number {
    return this.currentDamagedGeneratorVolume;
  }

  public getDamagedGeneratorDistance(): number {
    return this.currentDamagedGeneratorDist;
  }

  public updateDamagedGeneratorAudio(
    listenerXOrDist: number,
    listenerY?: number,
    genX?: number,
    genY?: number
  ): number {
    let dist: number;
    if (listenerY !== undefined && genX !== undefined && genY !== undefined) {
      dist = Math.hypot(listenerXOrDist - genX, listenerY - genY);
    } else {
      dist = listenerXOrDist;
    }

    if (!this.contextManager.isEnabled() || !this.sparkSynth.isGeneratorSparking() || !isFinite(dist)) {
      this.resetDamagedAudio();
      return 0;
    }

    const volume = calculateDamagedGeneratorAudioVolume(dist);
    this.currentDamagedGeneratorDist = dist;
    this.currentDamagedGeneratorVolume = volume;

    const ctx = this.contextManager.getContext();
    if (ctx) {
      const damagedBus = this.getDamagedGainNode(ctx);
      const now = ctx.currentTime;
      const vol = this.contextManager.getMasterVolume();
      const targetGain = Math.max(0.0001, volume * 0.40 * vol);
      try {
        damagedBus.gain.cancelScheduledValues(now);
        damagedBus.gain.setValueAtTime(damagedBus.gain.value, now);
        damagedBus.gain.linearRampToValueAtTime(targetGain, now + 0.05);
      } catch (_) {}
    }

    return volume;
  }
}
