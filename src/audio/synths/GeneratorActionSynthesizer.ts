/**
 * @file GeneratorActionSynthesizer.ts
 * @description Repair continuous sound, explosion blast, and kick impact sounds.
 */

import { AudioContextManager } from '../core/AudioContextManager';

export class GeneratorActionSynthesizer {
  private isRepairingSoundActive: boolean = false;
  private repairOscillator: OscillatorNode | null = null;
  private repairLfo: OscillatorNode | null = null;
  private repairGainNode: GainNode | null = null;

  constructor(private contextManager: AudioContextManager) {}

  public startGeneratorRepairSound(): void {
    if (!this.contextManager.isEnabled() || this.isRepairingSoundActive) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      this.isRepairingSoundActive = true;
      const now = ctx.currentTime;

      this.repairGainNode = ctx.createGain();
      this.repairGainNode.gain.setValueAtTime(0.001, now);
      this.repairGainNode.gain.linearRampToValueAtTime(0.18, now + 0.05);

      this.repairOscillator = ctx.createOscillator();
      this.repairOscillator.type = 'sawtooth';
      this.repairOscillator.frequency.setValueAtTime(175, now);

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(720, now);
      bandpass.Q.setValueAtTime(3.2, now);

      this.repairLfo = ctx.createOscillator();
      this.repairLfo.type = 'square';
      this.repairLfo.frequency.setValueAtTime(9.5, now);

      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.08, now);

      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(0.12, now);

      this.repairLfo.connect(lfoGain);
      lfoGain.connect(modGain.gain);

      this.repairOscillator.connect(bandpass);
      bandpass.connect(modGain);
      modGain.connect(this.repairGainNode);
      this.repairGainNode.connect(this.contextManager.masterGain);

      this.repairOscillator.start(now);
      this.repairLfo.start(now);
    } catch (_) {
      this.stopGeneratorRepairSound();
    }
  }

  public stopGeneratorRepairSound(): void {
    if (!this.isRepairingSoundActive) return;
    this.isRepairingSoundActive = false;

    const ctx = this.contextManager.getContext();
    if (this.repairGainNode && ctx) {
      try {
        const now = ctx.currentTime;
        this.repairGainNode.gain.cancelScheduledValues(now);
        this.repairGainNode.gain.setValueAtTime(this.repairGainNode.gain.value, now);
        this.repairGainNode.gain.linearRampToValueAtTime(0.001, now + 0.05);

        const osc = this.repairOscillator;
        const lfo = this.repairLfo;
        const gain = this.repairGainNode;

        setTimeout(() => {
          try {
            osc?.stop();
            osc?.disconnect();
            lfo?.stop();
            lfo?.disconnect();
            gain?.disconnect();
          } catch (_) {}
        }, 60);
      } catch (_) {}
    }

    this.repairOscillator = null;
    this.repairLfo = null;
    this.repairGainNode = null;
  }

  public isRepairSoundPlaying(): boolean {
    return this.isRepairingSoundActive;
  }

  public playGeneratorExplosion(): void {
    if (!this.contextManager.isEnabled()) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.70;

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(22, now + duration);

      oscGain.gain.setValueAtTime(0.42, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.contextManager.masterGain);

      const noise = ctx.createBufferSource();
      noise.buffer = this.contextManager.getNoiseBuffer(ctx);

      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.setValueAtTime(750, now);
      nFilter.frequency.exponentialRampToValueAtTime(70, now + duration);

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.35, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.contextManager.masterGain);

      osc.start(now);
      osc.stop(now + duration);
      noise.start(now);
      noise.stop(now + duration);
    } catch (_) {}
  }

  public playGeneratorKickSound(): void {
    if (!this.contextManager.isEnabled()) return;
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.12;

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + duration);

      const vol = this.contextManager.getMasterVolume();
      oscGain.gain.setValueAtTime(0.48 * vol, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.contextManager.masterGain);

      const noise = ctx.createBufferSource();
      noise.buffer = this.contextManager.getNoiseBuffer(ctx);

      const bpFilter = ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(850, now);
      bpFilter.Q.setValueAtTime(3.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.38 * vol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(bpFilter);
      bpFilter.connect(noiseGain);
      noiseGain.connect(this.contextManager.masterGain);

      osc.start(now);
      osc.stop(now + duration + 0.02);
      noise.start(now);
      noise.stop(now + duration + 0.02);

      setTimeout(() => {
        try {
          osc.disconnect();
          oscGain.disconnect();
          noise.disconnect();
          bpFilter.disconnect();
          noiseGain.disconnect();
        } catch (_) {}
      }, (duration + 0.05) * 1000);
    } catch (_) {}
  }
}
