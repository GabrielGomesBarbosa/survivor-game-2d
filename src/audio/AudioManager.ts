/**
 * @file AudioManager.ts
 * @description Gerenciador de áudio procedural singleton baseado na Web Audio API nativa.
 * Sintetiza efeitos sonoros em tempo real sem assets externos:
 * - Passos de Survivor (ruído filtrado de ~60ms) e Killer (impacto grave ressonante de ~80ms com reverb/rumble)
 * - Som contínuo e rítmico de reparo de gerador (ferramenta mecânica modulada por LFO)
 * - Estrondo de explosão de gerador com queda exponencial de frequência
 * - Raio de Terror de Duas Camadas:
 *   1) Batimento Cardíaco Reativo ("lub-dub" a 55Hz e 50Hz acelerando de 60 BPM a 140 BPM para distâncias < 500px)
 *   2) Drone Sombrio Dissonante (osciladores desafinados a 80Hz e 83Hz com filtro lowpass progressivo para distâncias < 250px ou CHASE)
 */

import { TERROR_RADIUS_MAX } from '../config/constants';
export { TERROR_RADIUS_MAX };

/**
 * Calcula a cadência e intensidade do batimento cardíaco (Camada 1) a partir da distância até o Killer.
 * @param distanceToKiller Distância euclidiana em pixels entre Survivor e Killer.
 * @returns { intervalMs: number; volume: number; active: boolean }
 */
export function calculateTerrorCadence(distanceToKiller: number): {
  intervalMs: number;
  volume: number;
  active: boolean;
} {
  if (distanceToKiller >= TERROR_RADIUS_MAX) {
    return { intervalMs: 1100, volume: 0, active: false };
  }
  const minThreshold = 100;
  const maxThreshold = TERROR_RADIUS_MAX;
  const clamped = Math.max(minThreshold, Math.min(maxThreshold, distanceToKiller));
  const t = (clamped - minThreshold) / (maxThreshold - minThreshold); // 0 (<= 100px) a 1 (800px)

  // 800px: ~55 BPM (intervalo de 1100ms) | 100px: ~150 BPM (intervalo de 400ms)
  const intervalMs = 400 + t * (1100 - 400);
  // Volume proporcional: ganho suave de 0.08 no limiar de 800px até 0.45 em proximidade imediata
  const volume = 0.45 - t * (0.45 - 0.08);

  return { intervalMs, volume, active: true };
}

/**
 * Calcula os parâmetros de corte e ganho do Drone Dissonante (Camada 2).
 * @param distanceToKiller Distância euclidiana em pixels até o Killer.
 * @param isChase Indica se o Killer está em perseguição ativa (CHASE).
 * @returns { active: boolean; cutoffHz: number; volume: number }
 */
export function calculateTerrorDrone(
  distanceToKiller: number,
  isChase: boolean = false
): {
  active: boolean;
  cutoffHz: number;
  volume: number;
} {
  if (!isChase && distanceToKiller >= 250) {
    return { active: false, cutoffHz: 200, volume: 0 };
  }

  if (isChase) {
    // Durante perseguição ativa, máxima agressividade e corte mais aberto
    const clampedDist = Math.max(40, Math.min(500, distanceToKiller));
    const t = (clampedDist - 40) / 460;
    const cutoffHz = 1200 - t * 350; // 850Hz a 1200Hz
    const volume = 0.28 - t * 0.08;  // 0.20 a 0.28
    return { active: true, cutoffHz, volume };
  }

  // Distância < 250px fora de perseguição
  const clampedDist = Math.max(40, Math.min(250, distanceToKiller));
  const t = (clampedDist - 40) / (250 - 40); // 0 (40px) a 1 (250px)
  // O corte (cutoff) abre progressivamente conforme o Killer cola no Survivor (220Hz -> 900Hz)
  const cutoffHz = 900 - t * (900 - 220);
  const volume = 0.25 - t * (0.25 - 0.08);

  return { active: true, cutoffHz, volume };
}

export class AudioManager {
  private static instance: AudioManager | null = null;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = true;
  private volume: number = 0.7;

  // Buffer compartilhado de ruído branco para passos e texturas de impacto
  private noiseBuffer: AudioBuffer | null = null;

  // Estado do som contínuo de reparo
  private isRepairingSoundActive: boolean = false;
  private repairOscillator: OscillatorNode | null = null;
  private repairLfo: OscillatorNode | null = null;
  private repairGainNode: GainNode | null = null;

  // Camada 1: Batimento Cardíaco (Heartbeat)
  private terrorRadiusActive: boolean = false;
  private heartbeatAccumulator: number = 0;

  // Camada 2: Drone Metálico e Dissonante
  private isDroneActive: boolean = false;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGainNode: GainNode | null = null;
  private droneFadeTimeout: any = null;

  // Efeito de Chute e Regressão de Geradores (Faíscas Estocásticas)
  private regressingGenerators: Set<string> = new Set();
  private sparkIntervalTimer: any = null;

  private constructor() {
    this.setupAudioUnlock();
  }

  /**
   * Retorna a instância singleton do AudioManager.
   */
  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Configura o desbloqueio seguro do AudioContext no primeiro gesto do usuário (clique ou tecla).
   */
  private setupAudioUnlock(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.resumeContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /**
   * Obtém ou inicializa o AudioContext com tratamento defensivo para ambientes headless / SSR.
   */
  public getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
          this.masterGain.connect(this.ctx.destination);
        } catch (_) {
          this.ctx = null;
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Força a retomada do AudioContext caso esteja em estado 'suspended'.
   */
  public resumeContext(): void {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  /**
   * Habilita ou desabilita todos os efeitos sonoros.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopGeneratorRepairSound();
      this.stopTerrorRadius();
      this.stopAllSparkingSounds();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Ajusta o volume geral mestre (0 a 1).
   */
  public setMasterVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public getMasterVolume(): number {
    return this.volume;
  }

  /**
   * Gera ou recupera um buffer estático de 1 segundo de ruído branco.
   */
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const bufferSize = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  // =========================================================================
  // 1. PASSOS DO SURVIVOR (Pulso de ~60ms de ruído filtrado com pitch médio/baixo)
  // =========================================================================
  public playSurvivorFootstep(isRunning: boolean = false): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.06; // ~60ms

      // Ruído filtrado
      const noiseBuffer = this.getNoiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isRunning ? 380 : 280, now);
      filter.Q.setValueAtTime(1.4, now);

      const noiseGain = ctx.createGain();
      const nVol = isRunning ? 0.20 : 0.14;
      noiseGain.gain.setValueAtTime(nVol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

      // Leve pulso tonal de contato
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isRunning ? 90 : 75, now);
      osc.frequency.exponentialRampToValueAtTime(36, now + duration);

      oscGain.gain.setValueAtTime(isRunning ? 0.16 : 0.11, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);

      noise.start(now);
      noise.stop(now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  // =========================================================================
  // 2. PASSOS DO KILLER (Filtro ressonante passa-baixo mais pesado e impacto grave com reverb)
  // =========================================================================
  public playKillerFootstep(volumeScale: number = 1): void {
    if (!this.enabled || volumeScale <= 0) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.085; // ~85ms

      // 1. Ruído grave com filtro ressonante passa-baixo (lowpass com Q elevado = impacto oco de bota pesada)
      const noiseBuffer = this.getNoiseBuffer(ctx);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, now);
      filter.Q.setValueAtTime(3.8, now);

      const noiseGain = ctx.createGain();
      const nVol = 0.32 * Math.min(1, volumeScale);
      noiseGain.gain.setValueAtTime(nVol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

      // 2. Impacto pesado sub-grave (queda de 95Hz para 24Hz)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(24, now + duration);

      const oVol = 0.40 * Math.min(1, volumeScale);
      oscGain.gain.setValueAtTime(oVol, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);

      // 3. Rumble grave de reverberação residual do impacto (~110ms)
      const rumbleOsc = ctx.createOscillator();
      const rumbleGain = ctx.createGain();
      rumbleOsc.type = 'sine';
      rumbleOsc.frequency.setValueAtTime(44, now);
      rumbleOsc.frequency.exponentialRampToValueAtTime(22, now + 0.11);

      const rVol = 0.18 * Math.min(1, volumeScale);
      rumbleGain.gain.setValueAtTime(rVol, now);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      rumbleOsc.connect(rumbleGain);
      rumbleGain.connect(this.masterGain);

      noise.start(now);
      noise.stop(now + duration);
      osc.start(now);
      osc.stop(now + duration);
      rumbleOsc.start(now);
      rumbleOsc.stop(now + 0.11);
    } catch (_) {}
  }

  // =========================================================================
  // 3. REPARO DE GERADOR (Zumbido contínuo e rítmico simulando catraca mecânica)
  // =========================================================================
  public startGeneratorRepairSound(): void {
    if (!this.enabled || this.isRepairingSoundActive) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      this.isRepairingSoundActive = true;
      const now = ctx.currentTime;

      // Nó de ganho principal do reparo
      this.repairGainNode = ctx.createGain();
      this.repairGainNode.gain.setValueAtTime(0.001, now);
      this.repairGainNode.gain.linearRampToValueAtTime(0.18, now + 0.05);

      // Oscilador base (som metálico de ferramenta a ~175Hz)
      this.repairOscillator = ctx.createOscillator();
      this.repairOscillator.type = 'sawtooth';
      this.repairOscillator.frequency.setValueAtTime(175, now);

      // Filtro bandpass metálico
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(720, now);
      bandpass.Q.setValueAtTime(3.2, now);

      // LFO modulador de amplitude (~9.5Hz para simular batidas rítmicas de chave mecânica)
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
      this.repairGainNode.connect(this.masterGain);

      this.repairOscillator.start(now);
      this.repairLfo.start(now);
    } catch (_) {
      this.stopGeneratorRepairSound();
    }
  }

  public stopGeneratorRepairSound(): void {
    if (!this.isRepairingSoundActive) return;
    this.isRepairingSoundActive = false;

    if (this.repairGainNode && this.ctx) {
      try {
        const now = this.ctx.currentTime;
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

  // =========================================================================
  // 4. EXPLOSÃO DO GERADOR (Queda de frequência em onda senoidal/triangular grave)
  // =========================================================================
  public playGeneratorExplosion(): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.70; // 700ms

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(22, now + duration);

      oscGain.gain.setValueAtTime(0.42, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);

      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);

      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'lowpass';
      nFilter.frequency.setValueAtTime(750, now);
      nFilter.frequency.exponentialRampToValueAtTime(70, now + duration);

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.35, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + duration);
      noise.start(now);
      noise.stop(now + duration);
    } catch (_) {}
  }

  // =========================================================================
  // 5. RAIO DE TERROR DE DUAS CAMADAS (Batimentos Cardíacos + Drone Dissonante)
  // =========================================================================

  /**
   * Atualiza as duas camadas do Raio de Terror em tempo real:
   * - Camada 1: Batimentos Cardíacos "lub-dub" (55Hz / 50Hz) para distâncias < 500px.
   * - Camada 2: Drone Dissonante (80Hz e 83Hz desafinados) para distâncias < 250px ou CHASE com corte dinâmico.
   * @param distanceToKiller Distância euclidiana em pixels até o Killer.
   * @param killerState Estado atual da IA do Killer ('CHASE', 'PATROL', etc.).
   * @param deltaMs Delta time em milissegundos do frame atual.
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

    if (!this.enabled) {
      this.stopTerrorRadius();
      return;
    }

    // -------------------------------------------------------------
    // Camada 1: Batimento Cardíaco Reativo (< TERROR_RADIUS_MAX)
    // -------------------------------------------------------------
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

    // -------------------------------------------------------------
    // Camada 2: Drone Metálico e Dissonante (< 250px ou CHASE)
    // -------------------------------------------------------------
    const droneParams = calculateTerrorDrone(distanceToKiller, isChase);
    this.updateDroneLayer(droneParams);
  }

  /**
   * Atualiza dinamicamente os osciladores desafinados e o filtro lowpass do Drone.
   */
  private updateDroneLayer(params: { active: boolean; cutoffHz: number; volume: number }): void {
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;

    if (params.active) {
      if (this.droneFadeTimeout) {
        clearTimeout(this.droneFadeTimeout);
        this.droneFadeTimeout = null;
      }

      if (!this.droneGainNode || !this.droneOsc1 || !this.droneOsc2 || !this.droneFilter) {
        // Inicializa par de osciladores desafinados (80Hz e 83Hz) gerando batimento acústico de tensão
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
        this.droneGainNode.connect(this.masterGain);

        this.droneOsc1.start(now);
        this.droneOsc2.start(now);
        this.isDroneActive = true;
      } else {
        // Modula suavemente o corte do filtro e o volume conforme a proximidade
        this.droneFilter.frequency.setTargetAtTime(params.cutoffHz, now, 0.1);
        this.droneGainNode.gain.setTargetAtTime(params.volume, now, 0.1);
        this.isDroneActive = true;
      }
    } else {
      // Se não houver perseguição e distância >= 250px, fade-out gradual em 1.5s
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
  private cleanupDroneNodes(): void {
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

  /**
   * Encerra imediatamente tanto o batimento cardíaco quanto o drone dissonante.
   */
  public stopTerrorRadius(): void {
    this.terrorRadiusActive = false;
    this.heartbeatAccumulator = 0;
    this.stopTerrorDrone(true);
  }

  /**
   * Interrompe o drone dissonante de forma imediata ou com fade-out.
   */
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
   * Sintetiza o clássico par de batimentos cardíacos ("lub-dub" a 55Hz e 50Hz com envelope suave).
   * @param volume Volume modulado pela proximidade.
   */
  private playHeartbeatPair(volume: number): void {
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;

      // 1. Batimento "LUB" (primeiro pulso grave senoidal a 55Hz descendo suavemente para 45Hz)
      const lubOsc = ctx.createOscillator();
      const lubGain = ctx.createGain();
      lubOsc.type = 'sine';
      lubOsc.frequency.setValueAtTime(55, now);
      lubOsc.frequency.exponentialRampToValueAtTime(45, now + 0.085);

      lubGain.gain.setValueAtTime(0.001, now);
      lubGain.gain.linearRampToValueAtTime(volume * 0.95, now + 0.01);
      lubGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      lubOsc.connect(lubGain);
      lubGain.connect(this.masterGain);

      lubOsc.start(now);
      lubOsc.stop(now + 0.085);

      // 2. Batimento "DUB" (segundo pulso grave senoidal a 50Hz descendo para 40Hz ~130ms depois)
      const dubTime = now + 0.130;
      const dubOsc = ctx.createOscillator();
      const dubGain = ctx.createGain();
      dubOsc.type = 'sine';
      dubOsc.frequency.setValueAtTime(50, dubTime);
      dubOsc.frequency.exponentialRampToValueAtTime(40, dubTime + 0.075);

      dubGain.gain.setValueAtTime(0.001, dubTime);
      dubGain.gain.linearRampToValueAtTime(volume * 0.78, dubTime + 0.01);
      dubGain.gain.exponentialRampToValueAtTime(0.001, dubTime + 0.075);

      dubOsc.connect(dubGain);
      dubGain.connect(this.masterGain);

      dubOsc.start(dubTime);
      dubOsc.stop(dubTime + 0.075);
    } catch (_) {}
  }

  // =========================================================================
  // 7. CHUTE DE GERADOR & REGRESSÃO CONTÍNUA (Impacto metálico e estalos estocásticos)
  // =========================================================================

  /**
   * Sintetiza o impacto do chute metálico do Killer no gerador:
   * - Oscilador triangular com sweep rápido de 110Hz para 40Hz em 120ms
   * - Pulso de ruído com filtro passa-faixa (bandpass) simula impacto direto em chapa metálica
   */
  public playGeneratorKickSound(): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.12; // 120ms

      // 1. Impacto grave do chute (sweep rápido de 110Hz para 40Hz em 120ms)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + duration);

      oscGain.gain.setValueAtTime(0.48 * this.volume, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);

      // 2. Pulso de ruído com filtro passa-faixa (bandpass) para chapa metálica vibrando
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);

      const bpFilter = ctx.createBiquadFilter();
      bpFilter.type = 'bandpass';
      bpFilter.frequency.setValueAtTime(850, now);
      bpFilter.Q.setValueAtTime(3.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.38 * this.volume, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(bpFilter);
      bpFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

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

  /**
   * Registra um gerador em regressão e inicia o loop de estalos elétricos estocásticos.
   * @param genId Identificador do gerador
   */
  public startGeneratorSparkingSound(genId: string): void {
    this.regressingGenerators.add(genId);
    if (!this.sparkIntervalTimer && this.enabled) {
      this.scheduleNextSpark();
    }
  }

  /**
   * Remove um gerador da lista de regressão e interrompe os estalos se não houver mais nenhum regredindo.
   * @param genId Identificador do gerador
   */
  public stopGeneratorSparkingSound(genId: string): void {
    this.regressingGenerators.delete(genId);
    if (this.regressingGenerators.size === 0) {
      if (this.sparkIntervalTimer) {
        clearTimeout(this.sparkIntervalTimer);
        this.sparkIntervalTimer = null;
      }
    }
  }

  /**
   * Limpa todos os geradores em regressão e para os estalos.
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

  private scheduleNextSpark(): void {
    if (!this.enabled || this.regressingGenerators.size === 0) {
      this.sparkIntervalTimer = null;
      return;
    }

    // Intervalo estocástico aleatório entre 100ms e 280ms
    const delay = Math.floor(100 + Math.random() * 180);
    this.sparkIntervalTimer = setTimeout(() => {
      if (this.regressingGenerators.size > 0 && this.enabled) {
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
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.025 + Math.random() * 0.02; // 25ms - 45ms

      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(2200 + Math.random() * 1800, now);

      const gain = ctx.createGain();
      const vol = (0.10 + Math.random() * 0.10) * this.volume;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

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

  /**
   * Efeito sonoro procedural de corte no ar (whoosh de lâmina):
   * Pulso curto de ruído com filtro passa-faixa ou passa-alta modulado rapidamente.
   */
  public playAttackSwingSound(): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.16; // 160ms

      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.5, now);
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(320, now + duration);

      const gain = ctx.createGain();
      const vol = 0.45 * this.volume;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

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
   * Efeito sonoro procedural de impacto de ataque no Survivor:
   * Impacto seco e carnoso combinando onda grave triangular e ruído de corte filtrado.
   */
  public playAttackHitSound(): void {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const duration = 0.22; // 220ms

      // 1. Componente carnoso grave (impacto de golpe)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.14);

      const oscGain = ctx.createGain();
      const oscVol = 0.65 * this.volume;
      oscGain.gain.setValueAtTime(oscVol, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.18);

      // 2. Componente de corte da lâmina (ruído rasgante)
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(900, now);
      noiseFilter.frequency.linearRampToValueAtTime(400, now + 0.10);
      noiseFilter.Q.setValueAtTime(1.8, now);

      const noiseGain = ctx.createGain();
      const noiseVol = 0.50 * this.volume;
      noiseGain.gain.setValueAtTime(noiseVol, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.masterGain);

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
