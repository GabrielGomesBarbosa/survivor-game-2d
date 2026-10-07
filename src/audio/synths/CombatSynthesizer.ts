/**
 * @file CombatSynthesizer.ts
 * @description Procedural Web Audio synthesizer for Killer attack swings and impacts.
 */

import { AudioContextManager } from '../core/AudioContextManager';

export class CombatSynthesizer {
  constructor(private contextManager: AudioContextManager) {}

  /**
   * Efeito sonoro procedural de corte no ar (whoosh de lâmina).
   */
  public playAttackSwingSound(): void {
    if (!this.contextManager.isEnabled()) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.16;

      const noise = ctx.createBufferSource();
      noise.buffer = this.contextManager.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.5, now);
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(320, now + duration);

      const gain = ctx.createGain();
      const vol = 0.45 * this.contextManager.getMasterVolume();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.contextManager.masterGain);

      noise.start(now);
      noise.stop(now + duration);

      setTimeout(() => {
        try {
          noise.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch (_) {}
      }, (duration + 0.05) * 1000);
    } catch (_) {}
  }

  /**
   * Efeito sonoro procedural de impacto de ataque no Survivor.
   */
  public playAttackHitSound(): void {
    if (!this.contextManager.isEnabled()) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.22;

      // 1. Componente carnoso grave
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.14);

      const oscGain = ctx.createGain();
      const oscVol = 0.65 * this.contextManager.getMasterVolume();
      oscGain.gain.setValueAtTime(oscVol, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(oscGain);
      oscGain.connect(this.contextManager.masterGain);
      osc.start(now);
      osc.stop(now + 0.18);

      // 2. Componente de corte da lâmina
      const noise = ctx.createBufferSource();
      noise.buffer = this.contextManager.getNoiseBuffer(ctx);

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(900, now);
      noiseFilter.frequency.linearRampToValueAtTime(400, now + 0.10);
      noiseFilter.Q.setValueAtTime(1.8, now);

      const noiseGain = ctx.createGain();
      const noiseVol = 0.50 * this.contextManager.getMasterVolume();
      noiseGain.gain.setValueAtTime(noiseVol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.contextManager.masterGain);

      noise.start(now);
      noise.stop(now + duration);

      setTimeout(() => {
        try {
          osc.disconnect();
          oscGain.disconnect();
          noise.disconnect();
          noiseFilter.disconnect();
          noiseGain.disconnect();
        } catch (_) {}
      }, (duration + 0.05) * 1000);
    } catch (_) {}
  }
}
