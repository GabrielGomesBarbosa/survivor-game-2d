/**
 * @file FootstepSynthesizer.ts
 * @description Procedural Web Audio synthesizer for Survivor and Killer footsteps.
 */

import { AudioContextManager } from '../core/AudioContextManager';

export class FootstepSynthesizer {
  constructor(private contextManager: AudioContextManager) {}

  /**
   * Sintetiza o passo do Survivor com ruído filtrado em passa-faixa (980Hz-1250Hz) e leve pulso tonal.
   */
  public playSurvivorFootstep(isRunning: boolean = false): void {
    if (!this.contextManager.isEnabled()) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.08; // ~80ms

      // Ruído filtrado: passa-faixa centrado em 980Hz-1250Hz (Q = 1.9)
      const noiseBuffer = this.contextManager.getNoiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isRunning ? 1250 : 980, now);
      filter.Q.setValueAtTime(1.9, now);

      const noiseGain = ctx.createGain();
      const nVol = isRunning ? 0.28 : 0.24;
      noiseGain.gain.setValueAtTime(0.001, now);
      noiseGain.gain.linearRampToValueAtTime(nVol, now + 0.006);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.contextManager.masterGain);

      // Leve pulso tonal de contato
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isRunning ? 110 : 90, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + duration);

      oscGain.gain.setValueAtTime(0.001, now);
      oscGain.gain.linearRampToValueAtTime(isRunning ? 0.20 : 0.16, now + 0.006);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.contextManager.masterGain);

      noise.start(now);
      noise.stop(now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  /**
   * Sintetiza o passo pesado do Killer com filtro duplo (lowpass 450Hz + pico 650Hz), corpo sub-grave e rumble residual.
   */
  public playKillerFootstep(volumeScale: number = 1): void {
    if (!this.contextManager.isEnabled() || volumeScale <= 0) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.095; // ~95ms

      // 1. Ruído de impacto com filtro duplo: lowpass em 450Hz e pico ressonante em 650Hz
      const noiseBuffer = this.contextManager.getNoiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const lowpassFilter = ctx.createBiquadFilter();
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.setValueAtTime(450, now);
      lowpassFilter.Q.setValueAtTime(2.0, now);

      const peakFilter = ctx.createBiquadFilter();
      peakFilter.type = 'peaking';
      peakFilter.frequency.setValueAtTime(650, now);
      if (peakFilter.gain?.setValueAtTime) {
        peakFilter.gain.setValueAtTime(6, now);
      }

      const noiseGain = ctx.createGain();
      const nVol = 0.38 * Math.min(1, volumeScale);
      noiseGain.gain.setValueAtTime(0.001, now);
      noiseGain.gain.linearRampToValueAtTime(nVol, now + 0.008);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(lowpassFilter);
      lowpassFilter.connect(peakFilter);
      peakFilter.connect(noiseGain);
      noiseGain.connect(this.contextManager.masterGain);

      // 2. Impacto pesado sub-grave audível (queda de 115Hz para 35Hz)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(35, now + duration);

      const oVol = 0.42 * Math.min(1, volumeScale);
      oscGain.gain.setValueAtTime(0.001, now);
      oscGain.gain.linearRampToValueAtTime(oVol, now + 0.008);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.contextManager.masterGain);

      // 3. Rumble grave de reverberação residual do impacto (~110ms)
      const rumbleOsc = ctx.createOscillator();
      const rumbleGain = ctx.createGain();
      rumbleOsc.type = 'sine';
      rumbleOsc.frequency.setValueAtTime(55, now);
      rumbleOsc.frequency.exponentialRampToValueAtTime(28, now + 0.11);

      const rVol = 0.22 * Math.min(1, volumeScale);
      rumbleGain.gain.setValueAtTime(0.001, now);
      rumbleGain.gain.linearRampToValueAtTime(rVol, now + 0.01);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      rumbleOsc.connect(rumbleGain);
      rumbleGain.connect(this.contextManager.masterGain);

      noise.start(now);
      noise.stop(now + duration);
      osc.start(now);
      osc.stop(now + duration);
      rumbleOsc.start(now);
      rumbleOsc.stop(now + 0.11);
    } catch (_) {}
  }
}
