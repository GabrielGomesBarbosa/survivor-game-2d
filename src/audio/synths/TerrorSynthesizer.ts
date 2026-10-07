/**
 * @file TerrorSynthesizer.ts
 * @description Two-layer Terror Radius synthesizer: reactive heartbeat and dissonant metallic drone.
 */

import { AudioContextManager } from '../core/AudioContextManager';
import {
  TERROR_RADIUS_MAX,
  calculateTerrorCadence,
  calculateTerrorDrone
} from '../spatial/SpatialAudioService';

export class TerrorSynthesizer {
  public terrorRadiusActive: boolean = false;
  public heartbeatAccumulator: number = 0;

  public isDroneActive: boolean = false;
  public droneOsc1: OscillatorNode | null = null;
  public droneOsc2: OscillatorNode | null = null;
  public droneFilter: BiquadFilterNode | null = null;
  public droneGainNode: GainNode | null = null;
  public droneFadeTimeout: any = null;

  constructor(private contextManager: AudioContextManager) {}

  /**
   * Atualiza as duas camadas do Raio de Terror em tempo real.
   */
  public updateTerrorRadius(
    distanceToKiller: number,
    killerState?: string | boolean | number,
    deltaMs: number = 16.6
  ): void {
    let isChase = false;
    let effectiveDelta = deltaMs;

    if (typeof killerState === 'string') {
      isChase = killerState === 'CHASE';
    } else if (typeof killerState === 'boolean') {
      isChase = killerState;
    } else if (typeof killerState === 'number') {
      effectiveDelta = killerState;
    }

    if (!this.contextManager.isEnabled()) {
      this.stopTerrorRadius();
      return;
    }

    const ctx = this.contextManager.getContext();
    if (!ctx) return;

    // Camada 1: Batimento Cardíaco (< TERROR_RADIUS_MAX)
    if (distanceToKiller < TERROR_RADIUS_MAX) {
      this.terrorRadiusActive = true;
      const cadence = calculateTerrorCadence(distanceToKiller);

      this.heartbeatAccumulator += effectiveDelta;
      if (this.heartbeatAccumulator >= cadence.intervalMs) {
        this.heartbeatAccumulator = 0;
        this.playHeartbeatPair(cadence.volume);
      }
    } else {
      this.terrorRadiusActive = false;
      this.heartbeatAccumulator = 0;
    }

    // Camada 2: Drone Metálico Dissonante (até 1920px ou CHASE)
    const droneParams = calculateTerrorDrone(distanceToKiller, isChase);
    this.updateDroneLayer(droneParams);
  }

  /**
   * Atualiza dinamicamente os osciladores desafinados e o filtro lowpass do Drone.
   */
  public updateDroneLayer(params: { active: boolean; cutoffHz: number; volume: number }): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    const now = ctx.currentTime;

    if (params.active) {
      if (this.droneFadeTimeout) {
        clearTimeout(this.droneFadeTimeout);
        this.droneFadeTimeout = null;
      }

      if (!this.droneGainNode || !this.droneOsc1 || !this.droneOsc2 || !this.droneFilter) {
        this.droneOsc1 = ctx.createOscillator();
        this.droneOsc1.type = 'sawtooth';
        this.droneOsc1.frequency.setValueAtTime(80, now);

        this.droneOsc2 = ctx.createOscillator();
        this.droneOsc2.type = 'sawtooth';
        this.droneOsc2.frequency.setValueAtTime(83, now); // Desafinação de 3Hz

        this.droneFilter = ctx.createBiquadFilter();
        this.droneFilter.type = 'lowpass';
        this.droneFilter.frequency.setValueAtTime(params.cutoffHz, now);
        this.droneFilter.Q.setValueAtTime(1.8, now);

        this.droneGainNode = ctx.createGain();
        this.droneGainNode.gain.setValueAtTime(0.0001, now);
        this.droneGainNode.gain.linearRampToValueAtTime(params.volume, now + 0.35);

        this.droneOsc1.connect(this.droneFilter);
        this.droneOsc2.connect(this.droneFilter);
        this.droneFilter.connect(this.droneGainNode);
        this.droneGainNode.connect(this.contextManager.masterGain);

        this.droneOsc1.start(now);
        this.droneOsc2.start(now);
        this.isDroneActive = true;
      } else {
        this.droneFilter.frequency.setTargetAtTime(params.cutoffHz, now, 0.1);
        this.droneGainNode.gain.setTargetAtTime(params.volume, now, 0.1);
        this.isDroneActive = true;
      }
    } else {
      if (this.isDroneActive && this.droneGainNode) {
        this.isDroneActive = false;
        try {
          this.droneGainNode.gain.cancelScheduledValues(now);
          this.droneGainNode.gain.setValueAtTime(this.droneGainNode.gain.value, now);
          this.droneGainNode.gain.linearRampToValueAtTime(0.0001, now + 1.5);
        } catch (_) {}

        if (this.droneFadeTimeout) {
          clearTimeout(this.droneFadeTimeout);
        }
        this.droneFadeTimeout = setTimeout(() => {
          if (!this.isDroneActive) {
            this.cleanupDroneNodes();
          }
        }, 1550);
      }
    }
  }

  /**
   * Finaliza e desconecta os nós do drone.
   */
  public cleanupDroneNodes(): void {
    try {
      this.droneOsc1?.stop();
      this.droneOsc1?.disconnect();
      this.droneOsc2?.stop();
      this.droneOsc2?.disconnect();
      this.droneFilter?.disconnect();
      this.droneGainNode?.disconnect();
    } catch (_) {}

    this.droneOsc1 = null;
    this.droneOsc2 = null;
    this.droneFilter = null;
    this.droneGainNode = null;
    this.isDroneActive = false;
    this.droneFadeTimeout = null;
  }

  public stopTerrorRadius(): void {
    this.terrorRadiusActive = false;
    this.heartbeatAccumulator = 0;
    this.stopTerrorDrone(true);
  }

  public stopTerrorDrone(immediate: boolean = false): void {
    if (immediate) {
      if (this.droneFadeTimeout) {
        clearTimeout(this.droneFadeTimeout);
        this.droneFadeTimeout = null;
      }
      this.cleanupDroneNodes();
    } else {
      this.updateDroneLayer({ active: false, cutoffHz: 200, volume: 0 });
    }
  }

  public isTerrorRadiusActive(): boolean {
    return this.terrorRadiusActive;
  }

  public isDronePlaying(): boolean {
    return this.isDroneActive;
  }

  /**
   * Sintetiza o clássico par de batimentos cardíacos ("lub-dub" a 55Hz/50Hz).
   */
  public playHeartbeatPair(volume: number): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.contextManager.masterGain) return;

    try {
      const now = ctx.currentTime;
      const playTone = (freqStart: number, freqEnd: number, time: number, dur: number, vol: number, type: OscillatorType) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, time);
        osc.frequency.exponentialRampToValueAtTime(freqEnd, time + dur);
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(vol, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.connect(gain);
        gain.connect(this.contextManager.masterGain!);
        osc.start(time);
        osc.stop(time + dur);
      };

      // 1. LUB
      playTone(55, 45, now, 0.085, volume * 0.95, 'sine');
      playTone(110, 90, now, 0.085, volume * 0.20, 'triangle');

      // 2. DUB (~130ms depois)
      const dubTime = now + 0.130;
      playTone(50, 40, dubTime, 0.075, volume * 0.78, 'sine');
      playTone(100, 80, dubTime, 0.075, volume * 0.16, 'triangle');
    } catch (_) {}
  }
}
