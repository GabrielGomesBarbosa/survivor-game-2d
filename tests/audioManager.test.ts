/**
 * @file audioManager.test.ts
 * @description Suíte de testes unitários do AudioManager procedural:
 * - Camada 1: Batimento Cardíaco Reativo (< 500px, 60 BPM a 140 BPM)
 * - Camada 2: Drone Metálico e Dissonante (< 250px ou CHASE, corte progressivo e fade-out de 1.5s)
 * - Passos do Killer com filtro ressonante passa-baixo e impacto grave com reverb
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AudioManager,
  calculateTerrorCadence,
  calculateTerrorDrone,
  calculateDamagedGeneratorAudioVolume,
  GENERATOR_AUDIO_MAX_DIST,
  GENERATOR_AUDIO_MIN_DIST
} from '../src/audio/AudioManager';

describe('AudioManager - Terror Radius Proximity Math', () => {
  describe('Camada 1: Batimento Cardíaco Reativo (< 1920px / 32m)', () => {
    it('deactivates heartbeat when distance is >= 1920px', () => {
      const at1920 = calculateTerrorCadence(1920);
      expect(at1920.active).toBe(false);
      expect(at1920.volume).toBe(0);

      const at2000 = calculateTerrorCadence(2000);
      expect(at2000.active).toBe(false);
      expect(at2000.volume).toBe(0);
    });

    it('activates heartbeat when distance is < 1920px', () => {
      const at1919 = calculateTerrorCadence(1919);
      expect(at1919.active).toBe(true);
      expect(at1919.volume).toBeGreaterThan(0);
      expect(at1919.intervalMs).toBeLessThanOrEqual(1100);

      // At 1720px, heartbeat is active with calm cadence (~1014ms)
      const at1720 = calculateTerrorCadence(1720);
      expect(at1720.active).toBe(true);
      expect(at1720.intervalMs).toBeCloseTo(1014, 0); // ~59 BPM
      expect(at1720.volume).toBeGreaterThan(0.1);
    });

    it('calibrates cadence: 1920px is ~55 BPM (1100ms) and 300px (< 5m) is ~150 BPM (400ms)', () => {
      const at1920 = calculateTerrorCadence(1919.9);
      expect(at1920.intervalMs).toBeCloseTo(1100, 0); // ~55 BPM

      const at300 = calculateTerrorCadence(300);
      expect(at300.intervalMs).toBeCloseTo(400, 1); // ~150 BPM

      // Ponto intermediário (1110px: t = 0.5 -> 750ms / 80 BPM)
      const at1110 = calculateTerrorCadence(1110);
      expect(at1110.intervalMs).toBeCloseTo(750, 1); // ~80 BPM
    });

    it('accelerates cadence monotonically as distance decreases from 1920px to 300px', () => {
      const dist1800 = calculateTerrorCadence(1800);
      const dist1200 = calculateTerrorCadence(1200);
      const dist600 = calculateTerrorCadence(600);
      const dist300 = calculateTerrorCadence(300);

      expect(dist1800.intervalMs).toBeGreaterThan(dist1200.intervalMs);
      expect(dist1200.intervalMs).toBeGreaterThan(dist600.intervalMs);
      expect(dist600.intervalMs).toBeGreaterThan(dist300.intervalMs);
    });

    it('modulates volume proportionally with proximity (0.08 at 1920px up to 0.45 at 300px)', () => {
      const at1920 = calculateTerrorCadence(1919.9);
      const at1110 = calculateTerrorCadence(1110);
      const at300 = calculateTerrorCadence(300);

      expect(at1920.volume).toBeCloseTo(0.08, 1);
      expect(at1110.volume).toBeCloseTo(0.265, 2);
      expect(at300.volume).toBeCloseTo(0.45, 2);
    });
  });

  describe('Camada 2: Drone Metálico e Dissonante (< 1920px / 32m ou CHASE)', () => {
    it('deactivates drone when distance >= 1920px and not in chase', () => {
      const at1920 = calculateTerrorDrone(1920, false);
      expect(at1920.active).toBe(false);
      expect(at1920.volume).toBe(0);

      const at2000 = calculateTerrorDrone(2000, false);
      expect(at2000.active).toBe(false);
      expect(at2000.volume).toBe(0);
    });

    it('activates drone across the full 32m radius (< 1920px) even without chase', () => {
      const at1800 = calculateTerrorDrone(1800, false);
      expect(at1800.active).toBe(true);
      expect(at1800.volume).toBeGreaterThan(0);
      expect(at1800.cutoffHz).toBeGreaterThanOrEqual(180);
    });

    it('progressively opens filter cutoff as Killer approaches closer to Survivor (< 1920px -> < 120px)', () => {
      const at1200 = calculateTerrorDrone(1200, false);
      const at400 = calculateTerrorDrone(400, false);
      const at80 = calculateTerrorDrone(80, false);

      // Corte deve abrir progressivamente (ficando mais agressivo e estridente)
      expect(at400.cutoffHz).toBeGreaterThan(at1200.cutoffHz);
      expect(at80.cutoffHz).toBeGreaterThan(at400.cutoffHz);

      // Limites: corte aberto a 950Hz e volume máximo de 0.26 para < 120px (< 2m)
      expect(at80.cutoffHz).toBe(950);
      expect(at80.volume).toBe(0.26);
    });

    it('activates drone immediately during CHASE regardless of distance with high aggression cutoff', () => {
      const chaseFar = calculateTerrorDrone(450, true);
      expect(chaseFar.active).toBe(true);
      expect(chaseFar.cutoffHz).toBeGreaterThanOrEqual(850);
      expect(chaseFar.volume).toBeGreaterThan(0.18);

      const chaseMelee = calculateTerrorDrone(60, true);
      expect(chaseMelee.active).toBe(true);
      expect(chaseMelee.cutoffHz).toBeGreaterThan(1100);
    });
  });

  describe('Espacialização: Atenuação de Áudio de Motor Danificado (10m = 600px)', () => {
    it('defines constant limits: max radius 10.0m (600px) and min full volume radius 1.5m (90px)', () => {
      expect(GENERATOR_AUDIO_MAX_DIST).toBe(600);
      expect(GENERATOR_AUDIO_MIN_DIST).toBe(90);
    });

    it('returns volume = 0 when distance >= GENERATOR_AUDIO_MAX_DIST (600px)', () => {
      expect(calculateDamagedGeneratorAudioVolume(600)).toBe(0);
      expect(calculateDamagedGeneratorAudioVolume(650)).toBe(0);
      expect(calculateDamagedGeneratorAudioVolume(1200)).toBe(0);
      expect(calculateDamagedGeneratorAudioVolume(Infinity)).toBe(0);
    });

    it('returns volume = 1.0 when distance <= GENERATOR_AUDIO_MIN_DIST (90px)', () => {
      expect(calculateDamagedGeneratorAudioVolume(90)).toBe(1.0);
      expect(calculateDamagedGeneratorAudioVolume(50)).toBe(1.0);
      expect(calculateDamagedGeneratorAudioVolume(0)).toBe(1.0);
    });

    it('linearly attenuates volume across interval [90px, 600px]', () => {
      // Ponto médio exato: 90 + (600 - 90) / 2 = 345px -> volume 0.5
      expect(calculateDamagedGeneratorAudioVolume(345)).toBeCloseTo(0.5, 3);

      const v150 = calculateDamagedGeneratorAudioVolume(150);
      const v300 = calculateDamagedGeneratorAudioVolume(300);
      const v450 = calculateDamagedGeneratorAudioVolume(450);

      expect(v150).toBeGreaterThan(v300);
      expect(v300).toBeGreaterThan(v450);
    });
  });
});

describe('AudioManager - Singleton State & Controls', () => {
  let audio: AudioManager;

  beforeEach(() => {
    audio = AudioManager.getInstance();
    audio.setEnabled(true);
    audio.setMasterVolume(0.7);
  });

  it('maintains singleton pattern integrity across multiple calls', () => {
    const a1 = AudioManager.getInstance();
    const a2 = AudioManager.getInstance();
    expect(a1).toBe(a2);
  });

  it('updates and reports enabled / disabled state', () => {
    expect(audio.isEnabled()).toBe(true);

    audio.setEnabled(false);
    expect(audio.isEnabled()).toBe(false);

    audio.setEnabled(true);
    expect(audio.isEnabled()).toBe(true);
  });

  it('updates and clamps master volume between 0 and 1', () => {
    audio.setMasterVolume(0.45);
    expect(audio.getMasterVolume()).toBeCloseTo(0.45);

    audio.setMasterVolume(-0.5);
    expect(audio.getMasterVolume()).toBe(0);

    audio.setMasterVolume(1.8);
    expect(audio.getMasterVolume()).toBe(1);
  });
});

describe('AudioManager - Headless / Node.js Environment Safety', () => {
  let audio: AudioManager;

  beforeEach(() => {
    audio = AudioManager.getInstance();
    audio.setEnabled(true);
  });

  it('executes all audio triggers without throwing in headless Node environment', () => {
    expect(() => {
      audio.playSurvivorFootstep(false);
      audio.playSurvivorFootstep(true);
      audio.playKillerFootstep();
      audio.playKillerFootstep(0.5);
      audio.startGeneratorRepairSound();
      audio.stopGeneratorRepairSound();
      audio.playGeneratorExplosion();
      audio.updateTerrorRadius(450, 'PATROL', 16.6);
      audio.updateTerrorRadius(200, 'CHASE', 16.6);
      audio.updateTerrorRadius(600, 'STANDBY', 16.6);
      audio.stopTerrorRadius();
      audio.stopTerrorDrone(true);
      audio.resumeContext();
      audio.ensureContextRunning();
    }).not.toThrow();
  });
});

describe('AudioManager - Mock Web Audio API Node Generation', () => {
  let mockCtx: any;
  let audio: AudioManager;

  beforeEach(() => {
    const createdNodes: any = {
      oscillators: [],
      gains: [],
      filters: [],
      sources: []
    };

    const createMockParam = (defaultVal = 0) => ({
      value: defaultVal,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn()
    });

    mockCtx = {
      currentTime: 10.0,
      sampleRate: 44100,
      state: 'running',
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createBuffer: vi.fn(() => ({
        sampleRate: 44100,
        getChannelData: vi.fn(() => new Float32Array(44100))
      })),
      createBufferSource: vi.fn(() => {
        const src = {
          buffer: null,
          loop: false,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
        createdNodes.sources.push(src);
        return src;
      }),
      createGain: vi.fn(() => {
        const gain = {
          gain: createMockParam(1),
          connect: vi.fn(),
          disconnect: vi.fn()
        };
        createdNodes.gains.push(gain);
        return gain;
      }),
      createOscillator: vi.fn(() => {
        const osc = {
          type: 'sine',
          frequency: createMockParam(440),
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
        createdNodes.oscillators.push(osc);
        return osc;
      }),
      createBiquadFilter: vi.fn(() => {
        const filter = {
          type: 'lowpass',
          frequency: createMockParam(1000),
          Q: createMockParam(1),
          gain: createMockParam(0),
          connect: vi.fn(),
          disconnect: vi.fn()
        };
        createdNodes.filters.push(filter);
        return filter;
      })
    };

    audio = AudioManager.getInstance();
    (audio as any).ctx = mockCtx;
    (audio as any).masterGain = mockCtx.createGain();
  });

  afterEach(() => {
    audio.stopTerrorRadius();
    (audio as any).ctx = null;
    (audio as any).masterGain = null;
    (audio as any).noiseBuffer = null;
  });

  it('synthesizes survivor footstep with bandpass noise filter and low tone oscillator', () => {
    audio.playSurvivorFootstep(false);

    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
    expect(mockCtx.createOscillator).toHaveBeenCalled();
  });

  it('synthesizes killer footstep with resonant lowpass filter (Q=3.8) and sub-bass rumble', () => {
    audio.playKillerFootstep(1.0);

    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
    // Killer footstep creates triangle impact osc AND sine rumble osc (2 oscillators)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('manages continuous generator repair sound with LFO modulation', () => {
    expect(audio.isRepairSoundPlaying()).toBe(false);

    audio.startGeneratorRepairSound();
    expect(audio.isRepairSoundPlaying()).toBe(true);
    expect(mockCtx.createOscillator).toHaveBeenCalled();

    const oscCount = mockCtx.createOscillator.mock.calls.length;
    audio.startGeneratorRepairSound();
    expect(mockCtx.createOscillator.mock.calls.length).toBe(oscCount);

    audio.stopGeneratorRepairSound();
    expect(audio.isRepairSoundPlaying()).toBe(false);
  });

  it('synthesizes generator explosion impact boom and noise blast', () => {
    audio.playGeneratorExplosion();

    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
  });

  it('triggers Layer 1 Heartbeat ("lub-dub" at 55Hz and 50Hz) when distance < 500px', () => {
    expect(audio.isTerrorRadiusActive()).toBe(false);

    // Distância de 400px: ativa Camada 1
    audio.updateTerrorRadius(400, 'PATROL', 100);
    expect(audio.isTerrorRadiusActive()).toBe(true);

    // Passa tempo para acumular e disparar batimento duplo
    audio.updateTerrorRadius(400, 'PATROL', 950);
    // Cada batimento duplo ("lub-dub") cria 2 osciladores senoidais
    expect(mockCtx.createOscillator).toHaveBeenCalled();
  });

  it('triggers Layer 2 Drone with detuned oscillators (80Hz and 83Hz) when distance < 250px', () => {
    expect(audio.isDronePlaying()).toBe(false);

    audio.updateTerrorRadius(200, 'PATROL', 50);

    expect(audio.isDronePlaying()).toBe(true);
    // Cria osc1 (80Hz) e osc2 (83Hz)
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
  });

  it('triggers Layer 2 Drone immediately in CHASE even if distance >= 250px', () => {
    audio.updateTerrorRadius(400, 'CHASE', 50);
    expect(audio.isDronePlaying()).toBe(true);
  });

  it('fades out drone gradually over 1.5s when distance moves beyond 1920px (32m) outside chase', () => {
    // 1. Inicia drone
    audio.updateTerrorRadius(150, 'PATROL', 50);
    expect(audio.isDronePlaying()).toBe(true);

    const droneGain = (audio as any).droneGainNode;
    expect(droneGain).toBeDefined();

    // 2. Afasta-se para 2000px fora de perseguição (além do raio de 32m / 1920px)
    audio.updateTerrorRadius(2000, 'PATROL', 50);

    // Deve ter agendado linearRampToValueAtTime com tempo + 1.5s
    expect(droneGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      expect.closeTo(mockCtx.currentTime + 1.5, 0.1)
    );
    expect(audio.isDronePlaying()).toBe(false);
  });

  it('silences both heartbeat and drone when stopTerrorRadius is called', () => {
    audio.updateTerrorRadius(150, 'CHASE', 50);
    expect(audio.isTerrorRadiusActive()).toBe(true);
    expect(audio.isDronePlaying()).toBe(true);

    audio.stopTerrorRadius();
    expect(audio.isTerrorRadiusActive()).toBe(false);
    expect(audio.isDronePlaying()).toBe(false);
  });

  it('synthesizes heavy metallic generator kick sound', () => {
    audio.playGeneratorKickSound();

    // Kick creates triangle oscillator (110Hz -> 40Hz) and bandpass noise
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
  });

  it('manages stochastic sparking sounds on generator regression start and stop', () => {
    expect(audio.isGeneratorSparking('gen_1')).toBe(false);

    audio.startGeneratorSparkingSound('gen_1');
    expect(audio.isGeneratorSparking('gen_1')).toBe(true);

    audio.startGeneratorSparkingSound('gen_2');
    expect(audio.isGeneratorSparking('gen_2')).toBe(true);

    audio.stopGeneratorSparkingSound('gen_1');
    expect(audio.isGeneratorSparking('gen_1')).toBe(false);
    expect(audio.isGeneratorSparking('gen_2')).toBe(true);

    audio.stopAllSparkingSounds();
    expect(audio.isGeneratorSparking('gen_2')).toBe(false);
  });

  it('spatializes damaged generator audio with distance attenuation roll-off', () => {
    audio.startGeneratorSparkingSound('gen_1');
    expect(audio.isDamagedMotorPlaying()).toBe(true);

    // 1. Distância distante (700px >= 600px): volume = 0
    const volFar = audio.updateDamagedGeneratorAudio(700);
    expect(volFar).toBe(0);
    expect(audio.getDamagedGeneratorVolume()).toBe(0);

    // 2. Distância muito próxima (50px <= 90px): volume = 1.0
    const volNear = audio.updateDamagedGeneratorAudio(50);
    expect(volNear).toBe(1.0);
    expect(audio.getDamagedGeneratorVolume()).toBe(1.0);

    // 3. Ponto médio (345px): volume = 0.5
    const volMid = audio.updateDamagedGeneratorAudio(345);
    expect(volMid).toBeCloseTo(0.5, 2);
    expect(audio.getDamagedGeneratorVolume()).toBeCloseTo(0.5, 2);

    // 4. Sobrecarga com 4 coordenadas euclidianas (listenerX, listenerY, genX, genY)
    // dist = 50px (dx = 0, dy = 50) <= 90px -> 1.0
    const volCoords = audio.updateDamagedGeneratorAudio(100, 100, 100, 150);
    expect(volCoords).toBe(1.0);

    // 5. Encerrar todos os geradores silencia e desliga o motor
    audio.stopAllSparkingSounds();
    expect(audio.isDamagedMotorPlaying()).toBe(false);
    expect(audio.getDamagedGeneratorVolume()).toBe(0);
  });

  it('synthesizes whoosh slicing sound on attack swing', () => {
    audio.playAttackSwingSound();

    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('synthesizes visceral punch and slicing impact sound on attack hit', () => {
    audio.playAttackHitSound();

    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
    expect(mockCtx.createBiquadFilter).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('resumes context on ensureContextRunning when suspended', async () => {
    mockCtx.state = 'suspended';
    await audio.ensureContextRunning();
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('reports correct running status via isContextRunning', () => {
    mockCtx.state = 'running';
    expect(audio.isContextRunning()).toBe(true);

    mockCtx.state = 'suspended';
    expect(audio.isContextRunning()).toBe(false);
  });

  it('triggers onAudioUnlocked callback when context resumes', async () => {
    mockCtx.state = 'suspended';
    const unlockedCallback = vi.fn();
    const unsubscribe = audio.onAudioUnlocked(unlockedCallback);

    expect(unlockedCallback).not.toHaveBeenCalled();

    await audio.ensureContextRunning();
    expect(unlockedCallback).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('schedules nodes even when context is suspended so audio plays upon resume', () => {
    mockCtx.state = 'suspended';
    vi.clearAllMocks();

    audio.playSurvivorFootstep(false);
    audio.playKillerFootstep(1.0);
    audio.startGeneratorRepairSound();
    audio.playGeneratorExplosion();
    audio.updateTerrorRadius(400, 'PATROL', 16.6);

    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createBufferSource).toHaveBeenCalled();
  });
});

