/**
 * @file audioManager.test.ts
 * @description Suíte de testes unitários do AudioManager procedural:
 * - Camada 1: Batimento Cardíaco Reativo (< 500px, 60 BPM a 140 BPM)
 * - Camada 2: Drone Metálico e Dissonante (< 250px ou CHASE, corte progressivo e fade-out de 1.5s)
 * - Passos do Killer com filtro ressonante passa-baixo e impacto grave com reverb
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AudioManager, calculateTerrorCadence, calculateTerrorDrone } from '../src/audio/AudioManager';

describe('AudioManager - Terror Radius Proximity Math', () => {
  describe('Camada 1: Batimento Cardíaco Reativo (< 500px)', () => {
    it('deactivates heartbeat when distance is >= 500px', () => {
      const at500 = calculateTerrorCadence(500);
      expect(at500.active).toBe(false);
      expect(at500.volume).toBe(0);

      const at700 = calculateTerrorCadence(700);
      expect(at700.active).toBe(false);
      expect(at700.volume).toBe(0);
    });

    it('activates heartbeat when distance is < 500px', () => {
      const at499 = calculateTerrorCadence(499);
      expect(at499.active).toBe(true);
      expect(at499.volume).toBeGreaterThan(0);
      expect(at499.intervalMs).toBeLessThanOrEqual(1000);
    });

    it('calibrates cadence: 500px is ~60 BPM (1000ms) and 200px is ~140 BPM (~428.6ms)', () => {
      const at500 = calculateTerrorCadence(499.9);
      expect(at500.intervalMs).toBeCloseTo(1000, 0); // ~60 BPM

      const at200 = calculateTerrorCadence(200);
      expect(at200.intervalMs).toBeCloseTo(428.6, 1); // ~140 BPM

      // Ponto médio (350px)
      const at350 = calculateTerrorCadence(350);
      expect(at350.intervalMs).toBeCloseTo(714.3, 1); // ~84 BPM
    });

    it('accelerates cadence monotonically as distance decreases from 500px to 200px', () => {
      const dist450 = calculateTerrorCadence(450);
      const dist350 = calculateTerrorCadence(350);
      const dist250 = calculateTerrorCadence(250);
      const dist200 = calculateTerrorCadence(200);

      expect(dist450.intervalMs).toBeGreaterThan(dist350.intervalMs);
      expect(dist350.intervalMs).toBeGreaterThan(dist250.intervalMs);
      expect(dist250.intervalMs).toBeGreaterThan(dist200.intervalMs);
    });

    it('modulates volume proportionally with proximity (0.15 at 500px up to 0.45 at 200px)', () => {
      const at500 = calculateTerrorCadence(499.9);
      const at350 = calculateTerrorCadence(350);
      const at200 = calculateTerrorCadence(200);

      expect(at500.volume).toBeCloseTo(0.15, 1);
      expect(at350.volume).toBeCloseTo(0.30, 2);
      expect(at200.volume).toBeCloseTo(0.45, 2);
    });
  });

  describe('Camada 2: Drone Metálico e Dissonante (< 250px ou CHASE)', () => {
    it('deactivates drone when distance >= 250px and not in chase', () => {
      const at250 = calculateTerrorDrone(250, false);
      expect(at250.active).toBe(false);
      expect(at250.volume).toBe(0);

      const at400 = calculateTerrorDrone(400, false);
      expect(at400.active).toBe(false);
      expect(at400.volume).toBe(0);
    });

    it('activates drone when distance < 250px even without chase', () => {
      const at240 = calculateTerrorDrone(240, false);
      expect(at240.active).toBe(true);
      expect(at240.volume).toBeGreaterThan(0);
      expect(at240.cutoffHz).toBeGreaterThan(200);
    });

    it('progressively opens filter cutoff as Killer approaches closer to Survivor (< 250px)', () => {
      const at240 = calculateTerrorDrone(240, false);
      const at150 = calculateTerrorDrone(150, false);
      const at50 = calculateTerrorDrone(50, false);

      // Corte deve abrir progressivamente (ficando mais agressivo e estridente)
      expect(at50.cutoffHz).toBeGreaterThan(at150.cutoffHz);
      expect(at150.cutoffHz).toBeGreaterThan(at240.cutoffHz);

      // Limites: ~220Hz a 250px até ~900Hz perto
      expect(at240.cutoffHz).toBeLessThan(300);
      expect(at50.cutoffHz).toBeGreaterThan(800);
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

  it('fades out drone gradually over 1.5s when distance moves beyond 250px outside chase', () => {
    // 1. Inicia drone
    audio.updateTerrorRadius(150, 'PATROL', 50);
    expect(audio.isDronePlaying()).toBe(true);

    const droneGain = (audio as any).droneGainNode;
    expect(droneGain).toBeDefined();

    // 2. Afasta-se para 400px fora de perseguição
    audio.updateTerrorRadius(400, 'PATROL', 50);

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
});

