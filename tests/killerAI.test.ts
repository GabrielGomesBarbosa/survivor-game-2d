import { describe, it, expect, beforeEach } from 'vitest';
import {
  GeneratorPatrolManager,
  MAJOR_FACILITY_ROOMS,
  getGeneratorStandOffPoint,
  calculateEdgeToEdgeDistance,
  evaluateKillerAiState
} from '../src/utils/gameLogic';

describe('Killer AI - Patrol Cycle & Generator Inspection (Anti-Regression)', () => {
  let manager: GeneratorPatrolManager;

  beforeEach(() => {
    manager = new GeneratorPatrolManager();
  });

  it('excludes completed generators (100% or isCompleted) from active patrol cycle', () => {
    const mixedGenerators = [
      { name: 'Gerador A (Usina)', x: 2240, y: 960, progress: 40, isCompleted: false },
      { name: 'Gerador B (Enfermaria)', x: 320, y: 960, progress: 100, isCompleted: true },
      { name: 'Gerador C (Manutenção)', x: 1280, y: 1664, progress: 100, isCompleted: false }, // 100% progress
      null,
      undefined
    ];

    const active = manager.filterActiveGenerators(mixedGenerators);

    // Apenas Gerador A deve estar ativo
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Gerador A (Usina)');
    expect(active[0].x).toBe(2240);
    expect(active[0].y).toBe(960);
  });

  it('cycles through incomplete generators in round-robin order', () => {
    const gens = [
      { name: 'Gerador A', x: 2240, y: 960, progress: 0, isCompleted: false },
      { name: 'Gerador B', x: 320, y: 960, progress: 20, isCompleted: false },
      { name: 'Gerador C', x: 1280, y: 1664, progress: 50, isCompleted: false }
    ];

    const first = manager.getNextDestination(gens);
    expect(first?.name).toBe('Gerador A');

    const second = manager.getNextDestination(gens);
    expect(second?.name).toBe('Gerador B');

    const third = manager.getNextDestination(gens);
    expect(third?.name).toBe('Gerador C');

    // Volta ciclicamente para o primeiro
    const fourth = manager.getNextDestination(gens);
    expect(fourth?.name).toBe('Gerador A');
  });

  it('calculates stand-off waypoints outside the 76x88 solid collider but inside the 95px yellow interaction zone', () => {
    const gen = { x: 2240, y: 960 };
    const standOff = getGeneratorStandOffPoint(gen);

    const dist = Math.hypot(standOff.x - gen.x, standOff.y - gen.y);

    // Deve estar dentro do raio amarelo de 95px
    expect(dist).toBeLessThanOrEqual(95);

    // Deve estar estritamente fora da caixa sólida de 76x88px (half-extents 38x44px)
    const insideBox = Math.abs(standOff.x - gen.x) <= 38 && Math.abs(standOff.y - gen.y) <= 44;
    expect(insideBox).toBe(false);
  });

  it('selects walkable stand-off candidate closest to incoming position', () => {
    const gen = { x: 1000, y: 1000 };
    // Killer approaching from the North (y < 1000)
    const killerPos = { x: 1000, y: 500 };

    const isWalkable = (_x: number, y: number) => y !== 928; // Supondo que Norte está bloqueado

    const standOff = getGeneratorStandOffPoint(gen, killerPos, isWalkable, 72);

    // Como Norte (y = 928) não é walkable, deve selecionar outro candidato válido
    expect(standOff.y).not.toBe(928);
    const dist = Math.hypot(standOff.x - gen.x, standOff.y - gen.y);
    expect(dist).toBeCloseTo(72);
  });

  it('detects arrival at safe distance from generator to avoid pushing solid collider', () => {
    // Distância <= 110px é considerada segura para parar e inspecionar
    expect(manager.hasReachedSafeDistance(105, 110)).toBe(true);
    expect(manager.hasReachedSafeDistance(110, 110)).toBe(true);
    expect(manager.hasReachedSafeDistance(115, 110)).toBe(false);
    expect(manager.hasReachedSafeDistance(250, 110)).toBe(false);
  });

  it('transitions patrol target after inspection duration completes', () => {
    const gens = [
      { name: 'Gerador A', x: 2240, y: 960, progress: 0, isCompleted: false },
      { name: 'Gerador B', x: 320, y: 960, progress: 0, isCompleted: false }
    ];

    // 1. Inicia ronda no Gerador A
    const target1 = manager.getNextDestination(gens);
    expect(target1?.name).toBe('Gerador A');

    // 2. Chega no Gerador A e inicia inspeção configurável (ex: 2500ms)
    manager.startInspection(2500);
    expect(manager.isInspecting).toBe(true);
    expect(manager.inspectTimer).toBe(2500);

    // 3. Durante a inspeção (ex: 1000ms passados), não termina e gera offset de olhar ao redor
    const step1 = manager.tickInspection(1000);
    expect(step1.isComplete).toBe(false);
    expect(manager.isInspecting).toBe(true);
    expect(manager.inspectTimer).toBe(1500);
    expect(typeof step1.lookOffset).toBe('number');

    // 4. Passa os 1500ms restantes: inspeção deve ser concluída
    const step2 = manager.tickInspection(1500);
    expect(step2.isComplete).toBe(true);
    expect(manager.isInspecting).toBe(false);
    expect(manager.inspectTimer).toBe(0);

    // 5. Após inspeção concluída, solicita compulsoriamente o próximo gerador da ronda (Gerador B)
    const nextTarget = manager.getNextDestination(gens);
    expect(nextTarget?.name).toBe('Gerador B');
  });

  it('immediately interrupts inspection if player is spotted or noise alert fires', () => {
    manager.startInspection(2500);
    expect(manager.isInspecting).toBe(true);

    // Interrupção externa (ex: perseguição ou explosão)
    manager.interruptInspection();
    expect(manager.isInspecting).toBe(false);
    expect(manager.inspectTimer).toBe(0);

    const check = manager.tickInspection(500);
    expect(check.isComplete).toBe(false);
  });

  it('switches to major room patrol once all generators are completed', () => {
    const allCompletedGens = [
      { name: 'Gerador A', x: 2240, y: 960, progress: 100, isCompleted: true },
      { name: 'Gerador B', x: 320, y: 960, progress: 100, isCompleted: true }
    ];

    const roomTarget = manager.getNextDestination(allCompletedGens, MAJOR_FACILITY_ROOMS);
    expect(roomTarget).not.toBeNull();
    expect(roomTarget?.type).toBe('room');
    expect(MAJOR_FACILITY_ROOMS.map((r) => r.name)).toContain(roomTarget?.name);
  });
});

describe('Player vs Killer Edge-to-Edge Distance Telemetry (Surface Separation)', () => {
  const playerRadius = 66.25; // 53px * 1.25
  const killerRadius = 84.8;  // playerRadius * 1.28
  const sumRadii = playerRadius + killerRadius; // 151.05px

  it('reports exactly 0px when player and killer are in physical contact (tangent surfaces)', () => {
    const centerDist = sumRadii; // 151.05px
    const edgeDist = calculateEdgeToEdgeDistance(centerDist, playerRadius, killerRadius);
    expect(edgeDist).toBe(0);
    expect(Math.round(edgeDist)).toBe(0);
  });

  it('strictly clamps to 0px during micro-overlaps or collision penetration (never negative)', () => {
    // 5px de sobreposição (distância menor que a soma dos raios)
    const centerDist = sumRadii - 5; // 146.05px
    const edgeDist = calculateEdgeToEdgeDistance(centerDist, playerRadius, killerRadius);
    expect(edgeDist).toBe(0);
    expect(Math.round(edgeDist)).toBe(0);

    // Entidades ocupando mesmo centro
    const zeroCenter = calculateEdgeToEdgeDistance(0, playerRadius, killerRadius);
    expect(zeroCenter).toBe(0);
  });

  it('accurately reports positive surface separation when entities are apart', () => {
    // 300px centro a centro -> 300 - 151.05 = 148.95px
    const centerDist = 300;
    const edgeDist = calculateEdgeToEdgeDistance(centerDist, playerRadius, killerRadius);
    expect(edgeDist).toBeCloseTo(148.95);
    expect(Math.round(edgeDist)).toBe(149);

    // 100px além da borda
    const centerDist100 = sumRadii + 100;
    const edgeDist100 = calculateEdgeToEdgeDistance(centerDist100, playerRadius, killerRadius);
    expect(edgeDist100).toBeCloseTo(100);
    expect(Math.round(edgeDist100)).toBe(100);
  });
});

describe('Killer Bot (IA Ativa) - State Transition & Offline Mode', () => {
  it('switches state to DESATIVADO when killerAiEnabled is false regardless of previous state', () => {
    expect(evaluateKillerAiState('PATROL', false)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('CHASE', false)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('INSPECTING', false)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('DESATIVADO', false)).toBe('DESATIVADO');
  });

  it('resumes regular PATROL state when bot is re-enabled from DESATIVADO', () => {
    expect(evaluateKillerAiState('DESATIVADO', true)).toBe('PATROL');
  });

  it('preserves active FSM states when bot remains enabled', () => {
    expect(evaluateKillerAiState('PATROL', true)).toBe('PATROL');
    expect(evaluateKillerAiState('CHASE', true)).toBe('CHASE');
    expect(evaluateKillerAiState('INSPECTING', true)).toBe('INSPECTING');
  });
});

