/**
 * @file GeneratorSparkSynthesizer.ts
 * @description Stochastic electrical sparks synthesizer and sparking generator tracking.
 */

import { AudioContextManager } from '../core/AudioContextManager';
import { GENERATOR_AUDIO_MAX_DIST } from '../spatial/SpatialAudioService';

export class GeneratorSparkSynthesizer {
  public regressingGenerators: Set<string> = new Set();
  public sparkIntervalTimer: any = null;

  constructor(
    private contextManager: AudioContextManager,
    private getDamagedGainNode: (ctx: AudioContext) => GainNode,
    private getDamagedAudioState: () => { volume: number; dist: number }
  ) {}

  /**
   * Registra um gerador em regressão e inicia o agendador de estalos estocásticos.
   */
  public startGeneratorSparkingSound(genId: string): void {
    this.regressingGenerators.add(genId);
    if (!this.sparkIntervalTimer && this.contextManager.isEnabled()) {
      this.scheduleNextSpark();
    }
  }

  /**
   * Remove um gerador da lista de regressão e interrompe o timer se nenhum outro estiver regredindo.
   */
  public stopGeneratorSparkingSound(genId: string): void {
    this.regressingGenerators.delete(genId);
    if (this.regressingGenerators.size === 0 && this.sparkIntervalTimer) {
      clearTimeout(this.sparkIntervalTimer);
      this.sparkIntervalTimer = null;
    }
  }

  /**
   * Encerra todos os timers de faíscas estocásticas e limpa o conjunto de geradores.
   */
  public stopAllSparkingSounds(): void {
    this.regressingGenerators.clear();
    if (this.sparkIntervalTimer) {
      clearTimeout(this.sparkIntervalTimer);
      this.sparkIntervalTimer = null;
    }
  }

  public isGeneratorSparking(genId?: string): boolean {
    if (genId) return this.regressingGenerators.has(genId);
    return this.regressingGenerators.size > 0;
  }

  public scheduleNextSpark(): void {
    if (!this.contextManager.isEnabled() || this.regressingGenerators.size === 0) {
      this.sparkIntervalTimer = null;
      return;
    }

    const delay = Math.floor(100 + Math.random() * 180);
    this.sparkIntervalTimer = setTimeout(() => {
      if (this.regressingGenerators.size > 0 && this.contextManager.isEnabled()) {
        this.playStochasticSpark();
        this.scheduleNextSpark();
      } else {
        this.sparkIntervalTimer = null;
      }
    }, delay);
  }

  /**
   * Emite um estalo elétrico curto e agudo de ruído filtrado em passa-alta (faísca estocástica).
   */
  public playStochasticSpark(): void {
    if (!this.contextManager.isEnabled()) return;
    const { volume, dist } = this.getDamagedAudioState();
    if (volume <= 0.001 && dist >= GENERATOR_AUDIO_MAX_DIST) {
      return;
    }
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.025 + Math.random() * 0.02; // 25ms - 45ms

      const noise = ctx.createBufferSource();
      noise.buffer = this.contextManager.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(2200 + Math.random() * 1800, now);

      const gain = ctx.createGain();
      const vol = (0.10 + Math.random() * 0.10) * this.contextManager.getMasterVolume();
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const damagedBus = this.getDamagedGainNode(ctx);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(damagedBus);

      noise.start(now);
      noise.stop(now + duration);

      setTimeout(() => {
        try {
          noise.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch (_) {}
      }, (duration + 0.02) * 1000);
    } catch (_) {}
  }
}
