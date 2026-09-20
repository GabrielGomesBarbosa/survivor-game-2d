import { describe, it, expect, beforeEach } from 'vitest';
import {
  GeneratorPatrolManager,
  MAJOR_FACILITY_ROOMS,
  getGeneratorStandOffPoint,
  calculateEdgeToEdgeDistance,
  evaluateKillerAiState,
  buildAiWeightedGrid,
  isRayClearOnNavGrid,
  smoothPathNodes,
  calculateCurrentTile,
  formatCurrentTile
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

  it('dynamically selects patrol targets without repeating the generator just inspected', () => {
    const gens = [
      { name: 'Gerador A', x: 2240, y: 960, progress: 0, isCompleted: false },
      { name: 'Gerador B', x: 320, y: 960, progress: 20, isCompleted: false },
      { name: 'Gerador C', x: 1280, y: 1664, progress: 50, isCompleted: false }
    ];

    let lastGen: string | null = null;
    for (let i = 0; i < 30; i++) {
      const target = manager.getNextDestination(gens);
      expect(target).not.toBeNull();
      expect(target?.type).toBe('generator');
      if (lastGen !== null) {
        expect(target?.name).not.toBe(lastGen);
      }
      lastGen = target!.name;
    }
  });

  it('prioritizes generators with repair progress > 0% and least recently visited', () => {
    const freshManager = new GeneratorPatrolManager();
    const gens = [
      { name: 'Gerador A (0%)', x: 2240, y: 960, progress: 0, isCompleted: false },
      { name: 'Gerador B (75%)', x: 320, y: 960, progress: 75, isCompleted: false }
    ];

    freshManager.lastVisitedGenerator = 'Gerador A (0%)';
    const target = freshManager.getNextDestination(gens);
    expect(target?.name).toBe('Gerador B (75%)');
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

    // 1. Inicia ronda
    const target1 = manager.getNextDestination(gens);
    expect(target1).not.toBeNull();
    const firstGenName = target1!.name;
    expect(['Gerador A', 'Gerador B']).toContain(firstGenName);

    // 2. Chega no gerador e inicia inspeção configurável (ex: 2500ms)
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

    // 5. Após inspeção concluída, solicita compulsoriamente o próximo gerador da ronda (não pode repetir)
    const nextTarget = manager.getNextDestination(gens);
    expect(nextTarget?.name).not.toBe(firstGenName);
    expect(['Gerador A', 'Gerador B']).toContain(nextTarget?.name);
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

describe('Pathfinding Clearance & Raycast Smoothing (String Pulling)', () => {
  it('buildAiWeightedGrid marks wall-adjacent floor tiles as cost type 2 and center tiles as 0', () => {
    // 5x5 grid: border is wall (1), inside is floor (0)
    // [1, 1, 1, 1, 1]
    // [1, 0, 0, 0, 1]
    // [1, 0, 0, 0, 1]
    // [1, 0, 0, 0, 1]
    // [1, 1, 1, 1, 1]
    const navGrid = [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1]
    ];

    const weighted = buildAiWeightedGrid(navGrid);

    // Walls stay 1
    expect(weighted[0][0]).toBe(1);
    expect(weighted[0][2]).toBe(1);

    // Floor tiles touching walls (including diagonally) are 2
    expect(weighted[1][1]).toBe(2);
    expect(weighted[1][2]).toBe(2);
    expect(weighted[2][1]).toBe(2);
    expect(weighted[2][3]).toBe(2);

    // Center tile (2, 2) touches (1, 1), (1, 2) etc., which are floor (0), but does it touch any wall (1)?
    // In a 5x5 with border 1, tile (2, 2) neighbors are rows 1..3, cols 1..3. All of these except borders are 0.
    // Neighbors of (2,2):
    // (1,1)=0, (1,2)=0, (1,3)=0
    // (2,1)=0, (2,2)=0, (2,3)=0
    // (3,1)=0, (3,2)=0, (3,3)=0
    // So (2,2) touches NO wall tile (1)! It must be 0 (center corridor tile)!
    expect(weighted[2][2]).toBe(0);
  });

  it('isRayClearOnNavGrid verifies clearance margin against walls', () => {
    // 5x5 grid (320x320 px) with a single wall tile at (col 2, row 1) -> x: [128, 192], y: [64, 128]
    const navGrid = [
      [0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ];

    // Direct ray going through the wall should fail
    expect(isRayClearOnNavGrid(32, 96, 280, 96, navGrid, 0, 64)).toBe(false);

    // Ray well below the wall at row 3 (y = 224) should pass with margin 34
    // 224 - 34 = 190 (row 2, clear), 224 + 34 = 258 (row 4, clear, within grid)
    expect(isRayClearOnNavGrid(32, 224, 280, 224, navGrid, 34, 64)).toBe(true);

    // Ray passing in row 2 (y = 140) close to the wall (margin 34 reaches into row 1 y=106):
    // 140 - 34 = 106 -> falls into row 1 where col 2 is a wall -> returns false
    expect(isRayClearOnNavGrid(32, 140, 280, 140, navGrid, 34, 64)).toBe(false);
  });

  it('smoothPathNodes anchors the final destination to exact continuous targetPos', () => {
    const rawNodes = [
      { x: 64, y: 64 },
      { x: 128, y: 64 }
    ];
    const targetPos = { x: 155.7, y: 72.3 };

    // Clear LOS between all points
    const smoothed = smoothPathNodes(rawNodes, targetPos, () => true);

    // Start node is preserved, final node is exact continuous target
    expect(smoothed[0]).toEqual({ x: 64, y: 64 });
    expect(smoothed[smoothed.length - 1]).toEqual({ x: 155.7, y: 72.3 });
  });

  it('smoothPathNodes collapses collinear staircase nodes into direct straight segment', () => {
    // A* returned 5 staircase/collinear steps: (0,0) -> (32,0) -> (64,0) -> (96,0) -> (128,0)
    const rawNodes = [
      { x: 0, y: 0 },
      { x: 32, y: 0 },
      { x: 64, y: 0 },
      { x: 96, y: 0 },
      { x: 128, y: 0 }
    ];
    const targetPos = { x: 150, y: 0 };

    // Direct unobstructed view between (0,0) and target
    const smoothed = smoothPathNodes(rawNodes, targetPos, () => true);

    // Should collapse all redundant intermediate steps down to start -> target
    expect(smoothed).toHaveLength(2);
    expect(smoothed[0]).toEqual({ x: 0, y: 0 });
    expect(smoothed[1]).toEqual({ x: 150, y: 0 });
  });

  it('smoothPathNodes preserves necessary corner waypoint when obstacle blocks direct ray', () => {
    // Path turns around a corner:
    // Start (0,0) -> Corner (0, 100) -> End (100, 100)
    const rawNodes = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 100 },
      { x: 50, y: 100 },
      { x: 100, y: 100 }
    ];
    const targetPos = { x: 110, y: 100 };

    // Raycast LOS: (0,0) can only see along the vertical segment (x === 0).
    // It cannot see points with x > 0 directly because a wall is at (50, 50).
    const mockLOS = (x1: number, _y1: number, x2: number, _y2: number) => {
      // Direct view only if both are on the same axis (x1 === x2 === 0 or y1 === y2 === 100)
      if (x1 === 0 && x2 === 0) return true;
      if (x1 >= 0 && x2 >= 0 && _y1 === 100 && _y2 === 100) return true;
      return false;
    };

    const smoothed = smoothPathNodes(rawNodes, targetPos, mockLOS);

    // Should keep start (0, 0), the corner waypoint (0, 100), and final target (110, 100)
    expect(smoothed).toHaveLength(3);
    expect(smoothed[0]).toEqual({ x: 0, y: 0 });
    expect(smoothed[1]).toEqual({ x: 0, y: 100 });
    expect(smoothed[2]).toEqual({ x: 110, y: 100 });
  });
});

describe('Grid Telemetry & Tile Mapping (Math.floor / 64)', () => {
  it('correctly maps origin and initial player spawn to grid tile coordinates', () => {
    // Spawn padrão do Player: x = 1920, y = 1408 -> 1920/64 = 30, 1408/64 = 22
    expect(calculateCurrentTile(1920, 1408)).toEqual([30, 22]);
    expect(formatCurrentTile(1920, 1408)).toBe('[30, 22]');

    // Origem do mapa (canto superior esquerdo)
    expect(calculateCurrentTile(0, 0)).toEqual([0, 0]);
    expect(formatCurrentTile(0, 0)).toBe('[0, 0]');
  });

  it('correctly floors sub-tile and fractional coordinates without rounding up prematurely', () => {
    // Coordenada dentro do tile [0, 0]
    expect(calculateCurrentTile(63.9, 63.9)).toEqual([0, 0]);
    expect(formatCurrentTile(63.9, 63.9)).toBe('[0, 0]');

    // Exatamente no limite do tile [1, 1]
    expect(calculateCurrentTile(64.0, 64.0)).toEqual([1, 1]);
    expect(formatCurrentTile(64.0, 64.0)).toBe('[1, 1]');

    // Canto inferior direito do mundo 3840x2880 (cols 0..59, rows 0..44)
    expect(calculateCurrentTile(3839.9, 2879.9)).toEqual([59, 44]);
    expect(formatCurrentTile(3839.9, 2879.9)).toBe('[59, 44]');
  });

  it('accurately reports tile indices for key generator coordinates', () => {
    // Gerador A (Ala Nordeste): x = 3072, y = 512 -> [48, 8]
    expect(formatCurrentTile(3072, 512)).toBe('[48, 8]');

    // Gerador B (Ala Sudoeste): x = 768, y = 2304 -> [12, 36]
    expect(formatCurrentTile(768, 2304)).toBe('[12, 36]');

    // Gerador C (Ala Sudeste): x = 3072, y = 2304 -> [48, 36]
    expect(formatCurrentTile(3072, 2304)).toBe('[48, 36]');
  });
});



