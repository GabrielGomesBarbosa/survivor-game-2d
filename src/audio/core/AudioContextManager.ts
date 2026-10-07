/**
 * @file AudioContextManager.ts
 * @description Lazy AudioContext lifecycle manager, autoplay unlocking, and master gain controls.
 */

export class AudioContextManager {
  public ctx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  public noiseBuffer: AudioBuffer | null = null;
  private enabled: boolean = true;
  private volume: number = 0.7;

  private onUnlockCallbacks: (() => void)[] = [];
  private onEnabledChangeCallbacks: ((enabled: boolean) => void)[] = [];
  private onVolumeChangeCallbacks: ((vol: number) => void)[] = [];

  constructor() {
    this.setupAudioUnlock();
  }

  /**
   * Registra callback executado quando o AudioContext transiciona para 'running'.
   */
  public onAudioUnlocked(cb: () => void): () => void {
    this.onUnlockCallbacks.push(cb);
    if (this.isContextRunning()) {
      try {
        cb();
      } catch (_) {}
    }
    return () => {
      this.onUnlockCallbacks = this.onUnlockCallbacks.filter((c) => c !== cb);
    };
  }

  /**
   * Informa se o AudioContext está inicializado e em execução ('running').
   */
  public isContextRunning(): boolean {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  /**
   * Configura o desbloqueio seguro do AudioContext nos primeiros gestos do usuário.
   */
  private setupAudioUnlock(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.resumeContext();
    };

    const events = ['pointerdown', 'keydown', 'mousedown', 'touchstart', 'click'];
    events.forEach((evt) => {
      window.addEventListener(evt, unlock, { passive: true });
    });
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
   * Assegura que o AudioContext está inicializado e em execução ('running').
   */
  public ensureContextRunning(): Promise<void> {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      return ctx.resume().then(() => {
        this.onUnlockCallbacks.forEach((cb) => {
          try { cb(); } catch (_) {}
        });
      }).catch(() => {});
    }
    if (ctx && ctx.state === 'running') {
      this.onUnlockCallbacks.forEach((cb) => {
        try { cb(); } catch (_) {}
      });
    }
    return Promise.resolve();
  }

  /**
   * Força a retomada do AudioContext caso esteja em estado 'suspended'.
   */
  public resumeContext(): void {
    this.ensureContextRunning();
  }

  /**
   * Registra listener para alteração de ativação/desativação geral.
   */
  public onEnabledChange(cb: (enabled: boolean) => void): void {
    this.onEnabledChangeCallbacks.push(cb);
  }

  /**
   * Registra listener para alteração de volume mestre.
   */
  public onVolumeChange(cb: (volume: number) => void): void {
    this.onVolumeChangeCallbacks.push(cb);
  }

  /**
   * Habilita ou desabilita todos os efeitos sonoros.
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.onEnabledChangeCallbacks.forEach((cb) => {
      try { cb(enabled); } catch (_) {}
    });
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
    this.onVolumeChangeCallbacks.forEach((cb) => {
      try { cb(this.volume); } catch (_) {}
    });
  }

  public getMasterVolume(): number {
    return this.volume;
  }

  /**
   * Gera ou recupera um buffer estático de 1 segundo de ruído branco.
   */
  public getNoiseBuffer(ctx: AudioContext): AudioBuffer {
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
}
