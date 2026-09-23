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
  formatCurrentTile,
  getGeneratorOccupiedTiles,
  updateNavGridWithGenerators,
  evaluatePatrolArrival,
  PIXELS_PER_METER,
  metersToPixels,
  pixelsToMeters,
  formatMapDimensionsMetric
} from '../src/utils/gameLogic';
import { KillerAIController, IKillerPawn } from '../src/controllers/KillerAIController';
import { DEFAULT_DEBUG_SETTINGS } from '../src/config/constants';


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

  it('calculates stand-off waypoints outside the solid collider but inside the 130px yellow interaction zone (110-115px)', () => {
    const gen = { x: 2240, y: 960 };
    const standOff = getGeneratorStandOffPoint(gen);

    const dist = Math.hypot(standOff.x - gen.x, standOff.y - gen.y);

    // Deve estar dentro do raio amarelo de 130px e na faixa de 110px a 115px
    expect(dist).toBeLessThanOrEqual(130);
    expect(dist).toBeGreaterThanOrEqual(110);

    // Deve estar estritamente fora da caixa sólida de 50x112px (half-extents 25x56px)
    const insideBox = Math.abs(standOff.x - gen.x) <= 25 && Math.abs(standOff.y - gen.y) <= 56;
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

describe('alertToNoise Unfreeze & Resilient Arrival (DIAGNOSTICO_KILLER_FREEZE)', () => {
  it('positions stand-off point safely at 112px (110-115px) outside solid collider', () => {
    const gen = { name: 'Gerador Alpha', x: 2000, y: 2000, rotation: 0 };
    const standOff = getGeneratorStandOffPoint(gen, { x: 1000, y: 1000 }, () => true, 112);

    const distToCenter = Math.hypot(standOff.x - 2000, standOff.y - 2000);
    expect(distToCenter).toBeCloseTo(112);
    expect(standOff.x === 2000 && standOff.y === 2000).toBe(false);

    // Standoff point must be outside solid block (half-extents 25x56)
    const insideSolid = Math.abs(standOff.x - 2000) <= 25 && Math.abs(standOff.y - 2000) <= 56;
    expect(insideSolid).toBe(false);

    // Standoff point must be within the 130px interaction circle
    expect(distToCenter).toBeLessThanOrEqual(130);
  });

  it('registerAlertDestination properly sets destination, marks lastVisitedGenerator, and interrupts inspection', () => {
    const mgr = new GeneratorPatrolManager();
    mgr.startInspection(2500);
    expect(mgr.isInspecting).toBe(true);

    const target = mgr.registerAlertDestination({ name: 'Gerador Explosão', x: 1500, y: 1500 });
    expect(mgr.isInspecting).toBe(false);
    expect(mgr.inspectTimer).toBe(0);
    expect(mgr.currentDestination).toEqual(target);
    expect(mgr.currentDestination?.name).toBe('Gerador Explosão');
    expect(mgr.lastVisitedGenerator).toBe('Gerador Explosão');
  });

  it('ensures getNextDestination excludes the alerted generator to prevent re-selection loops', () => {
    const mgr = new GeneratorPatrolManager();
    const gens = [
      { name: 'Gerador Explosão', x: 1500, y: 1500, progress: 80, isCompleted: false },
      { name: 'Gerador Outro', x: 2500, y: 2500, progress: 0, isCompleted: false }
    ];

    // Simula alerta de ruído marcando o gerador afetado
    mgr.registerAlertDestination(gens[0]);
    expect(mgr.lastVisitedGenerator).toBe('Gerador Explosão');

    // Ao terminar inspeção e pedir o próximo alvo, DEVE escolher o outro gerador
    const nextTarget = mgr.getNextDestination(gens);
    expect(nextTarget?.name).toBe('Gerador Outro');
    expect(nextTarget?.name).not.toBe('Gerador Explosão');
  });

  describe('evaluatePatrolArrival', () => {
    it('confirms arrival when Killer reaches stand-off waypoint (distToTarget <= 32)', () => {
      expect(evaluatePatrolArrival(0, true, 112)).toBe(true);
      expect(evaluatePatrolArrival(20, true, 112)).toBe(true);
      expect(evaluatePatrolArrival(32, true, 112)).toBe(true);
    });

    it('confirms arrival when Killer is within interaction zone (distToGen <= 130) and adjacent to stand-off (distToTarget <= 75)', () => {
      expect(evaluatePatrolArrival(40, true, 110)).toBe(true);
      expect(evaluatePatrolArrival(55, true, 130)).toBe(true);
      expect(evaluatePatrolArrival(65, true, 120)).toBe(true); // Killer stopped at corner ~65px away
      expect(evaluatePatrolArrival(75, true, 95)).toBe(true);
    });

    it('rejects arrival when Killer is too far from stand-off or outside interaction radius', () => {
      // Too far from stand-off (> 75)
      expect(evaluatePatrolArrival(76, true, 100)).toBe(false);
      expect(evaluatePatrolArrival(100, true, 100)).toBe(false);

      // Outside interaction radius (> 130)
      expect(evaluatePatrolArrival(40, true, 131)).toBe(false);
      expect(evaluatePatrolArrival(50, true, 200)).toBe(false);
    });

    it('evaluates room arrival threshold (distToTarget <= 40)', () => {
      expect(evaluatePatrolArrival(30, false)).toBe(true);
      expect(evaluatePatrolArrival(40, false)).toBe(true);
      expect(evaluatePatrolArrival(41, false)).toBe(false);
    });
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

  it('forces STANDBY state when activeGeneratorsCount is 0, even if killerAiEnabled is true', () => {
    expect(evaluateKillerAiState('PATROL', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('CHASE', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('INSPECTING', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('DESATIVADO', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('STANDBY', true, 0)).toBe('STANDBY');
  });

  it('transitions from STANDBY to PATROL when at least 1 generator is active', () => {
    expect(evaluateKillerAiState('STANDBY', true, 1)).toBe('PATROL');
    expect(evaluateKillerAiState('STANDBY', true, 8)).toBe('PATROL');
  });

  it('still enforces DESATIVADO if killerAiEnabled is false regardless of generator count', () => {
    expect(evaluateKillerAiState('STANDBY', false, 0)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('STANDBY', false, 5)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('PATROL', false, 5)).toBe('DESATIVADO');
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
    // Spawn padrão do Player: x = 2560, y = 1920 -> 2560/64 = 40, 1920/64 = 30
    expect(calculateCurrentTile(2560, 1920)).toEqual([40, 30]);
    expect(formatCurrentTile(2560, 1920)).toBe('[40, 30]');

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

    // Canto inferior direito do mundo 5120x3840 (cols 0..79, rows 0..59)
    expect(calculateCurrentTile(5119.9, 3839.9)).toEqual([79, 59]);
    expect(formatCurrentTile(5119.9, 3839.9)).toBe('[79, 59]');
  });

  it('accurately reports tile indices for key generator coordinates', () => {
    // Gerador A (Ala Nordeste): x = 4096, y = 768 -> [64, 12]
    expect(formatCurrentTile(4096, 768)).toBe('[64, 12]');

    // Gerador B (Ala Sudoeste): x = 1024, y = 3072 -> [16, 48]
    expect(formatCurrentTile(1024, 3072)).toBe('[16, 48]');

    // Gerador C (Ala Sudeste): x = 4096, y = 3072 -> [64, 48]
    expect(formatCurrentTile(4096, 3072)).toBe('[64, 48]');
  });
});

describe('Generator Dynamic NavGrid Blocking & Hitbox Clearance', () => {
  it('computes correct occupied tiles for vertical generator (50x112px)', () => {
    // Generator centered at (128, 128) - tile (2, 2)
    // Vertical: width=50, height=112
    // left = 128 - 25 = 103 (tile 1), right = 128 + 25 = 153 (tile 2)
    // top = 128 - 56 = 72 (tile 1), bottom = 128 + 56 = 184 (tile 2)
    const tiles = getGeneratorOccupiedTiles(128, 128, 0, 64, 10, 10);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    const hasTile22 = tiles.some((t) => t.col === 2 && t.row === 2);
    expect(hasTile22).toBe(true);
  });

  it('computes correct occupied tiles for horizontal generator (112x50px with 90° rotation)', () => {
    // Horizontal: width=112, height=50
    // Centered at (192, 192) - tile (3, 3)
    const tiles = getGeneratorOccupiedTiles(192, 192, 90, 64, 10, 10);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    const hasTile33 = tiles.some((t) => t.col === 3 && t.row === 3);
    expect(hasTile33).toBe(true);
  });

  it('updateNavGridWithGenerators creates an immutable blocked grid leaving baseNavGrid intact', () => {
    // 5x5 empty floor grid (all 0)
    const baseNavGrid = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ];

    const gens = [{ x: 160, y: 160, rotation: 0 }]; // around tile [2, 2]
    const updated = updateNavGridWithGenerators(baseNavGrid, gens, 64);

    // baseNavGrid must remain purely 0
    expect(baseNavGrid[2][2]).toBe(0);

    // updated grid tile [2, 2] must be blocked (1)
    expect(updated[2][2]).toBe(1);

    // Clearing generators returns identical values to baseNavGrid
    const cleared = updateNavGridWithGenerators(baseNavGrid, [], 64);
    expect(cleared).toEqual(baseNavGrid);
  });

  it('buildAiWeightedGrid marks cells adjacent to active generators with cost 2 (weight 8)', () => {
    // 5x5 grid with generator placed at center (2, 2)
    const navGrid = [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0], // Generator at (2, 2)
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0]
    ];

    const weighted = buildAiWeightedGrid(navGrid);

    // The generator tile itself is 1
    expect(weighted[2][2]).toBe(1);

    // All 8 surrounding adjacent tiles receive cost 2 (elevated cost)
    expect(weighted[1][1]).toBe(2);
    expect(weighted[1][2]).toBe(2);
    expect(weighted[1][3]).toBe(2);
    expect(weighted[2][1]).toBe(2);
    expect(weighted[2][3]).toBe(2);
    expect(weighted[3][1]).toBe(2);
    expect(weighted[3][2]).toBe(2);
    expect(weighted[3][3]).toBe(2);

    // Outer corner tiles far from the generator stay 0 (cost 1)
    expect(weighted[0][0]).toBe(0);
    expect(weighted[0][4]).toBe(0);
    expect(weighted[4][0]).toBe(0);
    expect(weighted[4][4]).toBe(0);
  });
});

describe('Generator Stand-off Line-of-Sight & Wall Clearance (CORREÇÃO CRÍTICA DE NAVEGAÇÃO)', () => {
  const tileSize = 64;
  const cols = 10;
  const rows = 10;

  // Cria matriz 10x10 preenchida com 0 (chão transitável)
  const createEmptyGrid = () => Array.from({ length: rows }, () => Array(cols).fill(0));

  it('rejects candidate stand-off point across a solid wall divider even if that point is closer to Killer', () => {
    const grid = createEmptyGrid();
    // Divisória sólida na linha 3 (y de 192 a 255) cobrindo as colunas 2 a 8
    for (let c = 2; c <= 8; c++) {
      grid[3][c] = 1;
    }

    // Gerador horizontal no cômodo ao sul da divisória (largura 112, altura 50):
    // Topo em y = 260 (colado na parede sul da divisória sem sobreposição)
    // gen.x = 5 * 64 + 32 = 352, gen.y = 260 + 25 = 285, rotation = 90
    const gen = { x: 352, y: 285, rotation: 90 };
    // Killer posicionado no corredor norte: col 5, row 1 (centro: 352, 96)
    const killerPos = { x: 352, y: 96 };

    // Candidato Norte fica em y = 285 - 112 = 173 (row 2, no corredor norte onde grid = 0)
    // Sem validação de LoS, o candidato Norte seria escolhido por estar mais próximo do Killer (|173 - 96| = 77px)
    const standOff = getGeneratorStandOffPoint(gen, killerPos, undefined, 112, grid, tileSize, cols, rows);

    // Com validação de LoS, o raio até o candidato Norte é interceptado pela parede na row 3 (192 a 255)!
    // Logo, o ponto escolhido NÃO pode estar no corredor norte (y < 256)
    expect(standOff.y).toBeGreaterThanOrEqual(256);

    // O ponto escolhido deve ser uma das faces livres no mesmo cômodo (Leste, Oeste ou Sul)
    const validFaces = [
      { x: gen.x + 112, y: gen.y }, // Leste
      { x: gen.x - 112, y: gen.y }, // Oeste
      { x: gen.x, y: gen.y + 112 }  // Sul
    ];
    const isOneOfValid = validFaces.some(
      (vf) => Math.hypot(vf.x - standOff.x, vf.y - standOff.y) < 1
    );
    expect(isOneOfValid).toBe(true);

    // A distância até o centro do gerador deve ser 112px
    expect(Math.hypot(standOff.x - gen.x, standOff.y - gen.y)).toBeCloseTo(112);
  });

  it('does NOT block line of sight by the generator own footprint in navGrid', () => {
    const baseGrid = createEmptyGrid();
    const gen = { x: 5 * tileSize + 32, y: 5 * tileSize + 32, rotation: 0 };

    // Marca os ladrilhos do próprio gerador no navGrid com 1
    const gridWithGen = updateNavGridWithGenerators(baseGrid, [gen], tileSize);

    // Killer posicionado ao Norte
    const killerPos = { x: gen.x, y: gen.y - 300 };

    // Nenhuma parede arquitetural no mapa
    const standOff = getGeneratorStandOffPoint(gen, killerPos, undefined, 112, gridWithGen, tileSize, cols, rows);

    // Como o Norte está livre de paredes arquiteturais, os próprios ladrilhos da máquina não bloqueiam o raio
    expect(standOff.x).toBeCloseTo(gen.x);
    expect(standOff.y).toBeCloseTo(gen.y - 112);
  });

  it('handles generator placed in a corner with 2 blocked faces', () => {
    const grid = createEmptyGrid();
    // Parede Norte (row 3) e Parede Oeste (col 3) formando um canto
    for (let c = 3; c <= 7; c++) grid[3][c] = 1;
    for (let r = 3; r <= 7; r++) grid[r][3] = 1;

    // Gerador posicionado no canto interno (dentro do cômodo rows 4+, cols 4+)
    // Vertical (50w x 112h, halfW = 25, halfH = 56):
    // gen.x = 256 + 25 + 10 = 291, gen.y = 256 + 56 + 10 = 322
    const gen = { x: 291, y: 322, rotation: 0 };

    // Killer aproxima-se do noroeste (fora do cômodo)
    const killerPos = { x: 0, y: 0 };

    const standOff = getGeneratorStandOffPoint(gen, killerPos, undefined, 112, grid, tileSize, cols, rows);

    // Norte (y = 210, row 3) e Oeste (x = 179, col 2 através da parede em col 3) estão bloqueados
    // Apenas Sul e Leste estão desobstruídos
    const isEast = Math.hypot(standOff.x - (gen.x + 112), standOff.y - gen.y) < 1;
    const isSouth = Math.hypot(standOff.x - gen.x, standOff.y - (gen.y + 112)) < 1;
    expect(isEast || isSouth).toBe(true);

    // Nunca deve escolher Norte ou Oeste
    expect(standOff.y < gen.y).toBe(false); // Não é Norte
    expect(standOff.x < gen.x).toBe(false); // Não é Oeste
  });

  it('rejects candidate coordinates outside world boundaries', () => {
    const grid = createEmptyGrid();
    // Gerador colado na borda superior e esquerda: col 0, row 0
    const gen = { x: 32, y: 32, rotation: 0 };

    // standOffDist = 112 colocaria Norte em y = -80 e Oeste em x = -80
    const standOff = getGeneratorStandOffPoint(gen, { x: 0, y: 0 }, undefined, 112, grid, tileSize, cols, rows);

    // Deve escolher apenas candidatos dentro dos limites do mapa (Sul ou Leste)
    expect(standOff.x).toBeGreaterThanOrEqual(0);
    expect(standOff.y).toBeGreaterThanOrEqual(0);
    expect(standOff.x).toBeLessThan(cols * tileSize);
    expect(standOff.y).toBeLessThan(rows * tileSize);
  });

  it('rejects candidate if the candidate tile itself is a solid wall', () => {
    const grid = createEmptyGrid();
    // Gerador em col 5, row 5
    const gen = { x: 5 * tileSize + 32, y: 5 * tileSize + 32, rotation: 0 };

    // Parede exatamente onde ficaria o candidato Leste (col 7, row 5)
    grid[5][7] = 1;

    // Killer vindo do Leste
    const killerPos = { x: 9 * tileSize, y: 5 * tileSize + 32 };

    const standOff = getGeneratorStandOffPoint(gen, killerPos, undefined, 112, grid, tileSize, cols, rows);

    // Leste não pode ser escolhido porque o ladrilho é uma parede sólida
    expect(standOff.x).not.toBe(gen.x + 112);
  });

  it('safely falls back without throwing when surrounded on all sides', () => {
    const grid = createEmptyGrid();
    // Enclausurado por paredes nas 4 direções
    grid[4][5] = 1; // Norte
    grid[6][5] = 1; // Sul
    grid[5][4] = 1; // Oeste
    grid[5][6] = 1; // Leste

    const gen = { x: 5 * tileSize + 32, y: 5 * tileSize + 32, rotation: 0 };
    const standOff = getGeneratorStandOffPoint(gen, { x: 0, y: 0 }, undefined, 112, grid, tileSize, cols, rows);

    expect(standOff).toBeDefined();
    expect(typeof standOff.x).toBe('number');
    expect(typeof standOff.y).toBe('number');
  });

  it('discards strangled candidate faces where distance to wall is less than 90px and selects open room face', () => {
    const grid = createEmptyGrid();
    // Parede sólida ao Sul do gerador na row 7 (y de 448 a 511)
    for (let c = 0; c < cols; c++) {
      grid[7][c] = 1;
    }

    // Gerador posicionado na row 5 (centro: x=352, y=352)
    // O ponto de stand-off Sul ficaria em y = 352 + 112 = 464, que fica a apenas 16px da parede na row 7 (y=448)!
    // 16px < 90px -> Face Sul deve ser descartada como estrangulada
    // Norte (y = 352 - 112 = 240) é amplo e aberto (distância de parede = Infinity)
    const gen = { x: 5 * tileSize + 32, y: 5 * tileSize + 32, rotation: 0 };

    // Killer aproximando-se pelo Sul (x=352, y=600)
    // Sem o filtro de 90px, a face Sul seria escolhida por estar mais próxima do Killer.
    // Com o filtro de 90px, a face Sul é descartada e a face Norte (ou Leste/Oeste abertas) é selecionada!
    const standOff = getGeneratorStandOffPoint(gen, { x: 352, y: 600 }, undefined, 112, grid, tileSize, cols, rows);

    // O ponto de stand-off não pode ser a face Sul (y = 464)
    expect(standOff.y).not.toBe(gen.y + 112);

    // Deve escolher uma das faces amplas e com folga >= 90px (Norte, Leste ou Oeste)
    const validOpenFaces = [
      { x: gen.x, y: gen.y - 112 }, // Norte
      { x: gen.x - 112, y: gen.y }, // Oeste
      { x: gen.x + 112, y: gen.y }  // Leste
    ];
    const isOneOfOpenFaces = validOpenFaces.some(
      (f) => Math.hypot(f.x - standOff.x, f.y - standOff.y) < 1
    );
    expect(isOneOfOpenFaces).toBe(true);
  });
});

describe('Killer AI - Watchdog Anti-Stuck Failsafe', () => {
  function createMockPawn(initialX = 100, initialY = 100): IKillerPawn & { velocities: Array<{ vx: number; vy: number }> } {
    return {
      x: initialX,
      y: initialY,
      rotation: 0,
      velocities: [],
      setVelocity(vx: number, vy: number) {
        this.velocities.push({ vx, vy });
      },
      stopMovement() {
        this.velocities.push({ vx: 0, vy: 0 });
      },
      rotateTowards() {},
      playAnimation() {},
      stopAnimation() {},
      isWalkableTile: () => true,
      hasLineOfSight: () => false,
      calculatePath: (_fx, _fy, _tx, _ty, cb) => {
        cb([{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }]);
      },
      renderVisionGraphic() {},
      renderRouteGraphic() {}
    };
  }

  const mockGenerators = [
    { name: 'Gerador A', x: 2240, y: 960, progress: 20, isCompleted: false },
    { name: 'Gerador B', x: 320, y: 960, progress: 50, isCompleted: false },
    { name: 'Gerador C', x: 1280, y: 1664, progress: 0, isCompleted: false }
  ] as any;

  it('skips current waypoint and applies perpendicular impulse when stuck for >= 400ms', () => {
    const pawn = createMockPawn(100, 100);
    const controller = new KillerAIController(pawn);
    controller.state = 'PATROL';
    controller.setPathForTesting([
      { x: 100, y: 100 },
      { x: 150, y: 100 },
      { x: 200, y: 100 }
    ], 0);

    // Inicialização da posição de amostragem
    controller.handleWatchdogAntiStuck(16, mockGenerators);
    expect(controller.pathIndex).toBe(0);

    // Amostragem 1: 300ms parado (deslocamento 0 < 8px) -> stuckDuration = 300ms (< 400ms)
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    expect(controller.pathIndex).toBe(0);
    expect(pawn.velocities.length).toBe(0);

    // Amostragem 2: mais 300ms parado -> stuckDuration = 600ms (>= 400ms)
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    // Deve ter pulado para o próximo waypoint
    expect(controller.pathIndex).toBe(1);
    // Deve ter aplicado impulso de descolamento perpendicular
    expect(pawn.velocities.length).toBeGreaterThan(0);
    const lastVel = pawn.velocities[pawn.velocities.length - 1];
    expect(Math.hypot(lastVel.vx, lastVel.vy)).toBeCloseTo(75, 1);
  });

  it('aborts current path and forces advance to next generator after >= 800ms of being stuck', () => {
    const pawn = createMockPawn(100, 100);
    const controller = new KillerAIController(pawn);
    controller.state = 'PATROL';
    controller.setPathForTesting([
      { x: 100, y: 100 },
      { x: 150, y: 100 },
      { x: 200, y: 100 }
    ], 0);

    controller.handleWatchdogAntiStuck(16, mockGenerators);
    // 300ms (stuck = 300ms)
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    // 300ms (stuck = 600ms -> skips waypoint)
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    expect(controller.pathIndex).toBe(1);

    // 300ms (stuck = 900ms >= 800ms -> cancels route & forces advanceToNextPatrolGenerator)
    controller.handleWatchdogAntiStuck(300, mockGenerators);

    // stuckDuration deve ser resetado após abortar rota
    expect(controller.stuckTimer).toBe(0);
    // A rota deve ter sido recalculada (via pawn.calculatePath mock)
    expect(controller.path.length).toBeGreaterThan(0);
  });

  it('resets stuck duration when physical displacement is >= 8px within the sample window', () => {
    const pawn = createMockPawn(100, 100);
    const controller = new KillerAIController(pawn);
    controller.state = 'PATROL';

    controller.handleWatchdogAntiStuck(16, mockGenerators);
    // 300ms parado -> stuck = 300ms
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    expect(controller.stuckTimer).toBe(300);

    // Killer se move 15px (>= 8px)
    pawn.x = 115;
    controller.handleWatchdogAntiStuck(300, mockGenerators);

    // stuckDuration deve ter sido zerado
    expect(controller.stuckTimer).toBe(0);
  });

  it('resets and disables watchdog when AI is in non-moving state (e.g. INSPECTING)', () => {
    const pawn = createMockPawn(100, 100);
    const controller = new KillerAIController(pawn);
    controller.state = 'PATROL';

    controller.handleWatchdogAntiStuck(16, mockGenerators);
    controller.handleWatchdogAntiStuck(300, mockGenerators);
    expect(controller.stuckTimer).toBe(300);

    // Transiciona para INSPECTING
    controller.state = 'INSPECTING';
    controller.handleWatchdogAntiStuck(16, mockGenerators);

    expect(controller.stuckTimer).toBe(0);
  });
});

describe('Killer AI - Constant Single Speed (Dead by Daylight Standard)', () => {
  function createSpeedTestPawn(initialX = 100, initialY = 100, hasLOS = true): IKillerPawn & { velocities: Array<{ vx: number; vy: number }> } {
    return {
      x: initialX,
      y: initialY,
      rotation: 0,
      velocities: [],
      setVelocity(vx: number, vy: number) {
        this.velocities.push({ vx, vy });
      },
      stopMovement() {
        this.velocities.push({ vx: 0, vy: 0 });
      },
      rotateTowards() {},
      playAnimation() {},
      stopAnimation() {},
      isWalkableTile: () => true,
      hasLineOfSight: () => hasLOS,
      calculatePath: (_fx, _fy, _tx, _ty, cb) => {
        cb([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }]);
      },
      renderVisionGraphic() {},
      renderRouteGraphic() {}
    };
  }

  const mockSettings = {
    ...DEFAULT_DEBUG_SETTINGS,
    killerSpeed: 4.6, // m/s (276 px/s - padrão DBD)
    killerAiEnabled: true,
    detectionRadius: 7.5, // 7.5m (~450 px)
    survivorActive: true
  };

  const mockGenerators = [
    { name: 'Gerador A', x: 1000, y: 1000, progress: 20, isCompleted: false }
  ] as any;

  it('applies nominal settings.killerSpeed without reduction multiplier during PATROL with direct line of sight', () => {
    const pawn = createSpeedTestPawn(100, 100, true);
    const controller = new KillerAIController(pawn);
    controller.advanceToNextPatrolGenerator(mockGenerators);
    controller.patrolTarget.set(500, 100);

    const mockPlayerFar = { x: 9999, y: 9999, isActive: true, sprite: { visible: true } } as any;
    controller.update(16, mockPlayerFar, mockGenerators, mockSettings);

    expect(pawn.velocities.length).toBeGreaterThan(0);
    const lastVel = pawn.velocities[pawn.velocities.length - 1];
    const speedMagnitude = Math.hypot(lastVel.vx, lastVel.vy);

    // Deve ser estritamente igual à velocidade nominal em pixels (4.6 * 60 = 276 px/s)
    expect(speedMagnitude).toBeCloseTo(276, 1);
  });

  it('applies nominal settings.killerSpeed without reduction multiplier during PATROL following A* path', () => {
    const pawn = createSpeedTestPawn(100, 100, false); // Sem linha de visão direta
    const controller = new KillerAIController(pawn);
    controller.advanceToNextPatrolGenerator(mockGenerators);
    controller.patrolTarget.set(500, 500);
    controller.setPathForTesting([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 }
    ], 1);

    const mockPlayerFar = { x: 9999, y: 9999, isActive: true, sprite: { visible: true } } as any;
    controller.update(16, mockPlayerFar, mockGenerators, mockSettings);

    expect(pawn.velocities.length).toBeGreaterThan(0);
    const lastVel = pawn.velocities[pawn.velocities.length - 1];
    const speedMagnitude = Math.hypot(lastVel.vx, lastVel.vy);

    expect(speedMagnitude).toBeCloseTo(276, 1);
  });

  it('applies nominal settings.killerSpeed during CHASE with direct line of sight', () => {
    const pawn = createSpeedTestPawn(100, 100, true);
    const controller = new KillerAIController(pawn);
    controller.state = 'CHASE';

    // Jogador a 300px de distância (100 -> 400), superior a minBodyDist (~151px) e dentro do detectionRadius (8.5m = 510px)
    const mockPlayerNear = { x: 400, y: 100, isActive: true, sprite: { visible: true } } as any;
    controller.update(16, mockPlayerNear, mockGenerators, { ...mockSettings, detectionRadius: 8.5 });

    expect(pawn.velocities.length).toBeGreaterThan(0);
    const lastVel = pawn.velocities[pawn.velocities.length - 1];
    const speedMagnitude = Math.hypot(lastVel.vx, lastVel.vy);

    expect(speedMagnitude).toBeCloseTo(276, 1);
  });

  it('applies nominal settings.killerSpeed during CHASE following A* path and fallback', () => {
    const pawn = createSpeedTestPawn(100, 100, false);
    const controller = new KillerAIController(pawn);
    controller.state = 'CHASE';
    controller.setPathForTesting([
      { x: 100, y: 100 },
      { x: 200, y: 100 }
    ], 1);

    const mockPlayer = { x: 400, y: 200, isActive: true, sprite: { visible: true } } as any;
    controller.update(16, mockPlayer, mockGenerators, { ...mockSettings, detectionRadius: 8.5 });

    expect(pawn.velocities.length).toBeGreaterThan(0);
    const lastVel = pawn.velocities[pawn.velocities.length - 1];
    const speedMagnitude = Math.hypot(lastVel.vx, lastVel.vy);

    expect(speedMagnitude).toBeCloseTo(276, 1);
  });

  it('guarantees identical constant speed between PATROL and CHASE states (Dead by Daylight standard)', () => {
    // 1. Velocidade em PATROL
    const patrolPawn = createSpeedTestPawn(100, 100, true);
    const patrolController = new KillerAIController(patrolPawn);
    patrolController.advanceToNextPatrolGenerator(mockGenerators);
    patrolController.patrolTarget.set(300, 100);
    const mockPlayerFar = { x: 9999, y: 9999, isActive: true, sprite: { visible: true } } as any;
    patrolController.update(16, mockPlayerFar, mockGenerators, mockSettings);
    const patrolVel = patrolPawn.velocities[patrolPawn.velocities.length - 1];
    const patrolSpeed = Math.hypot(patrolVel.vx, patrolVel.vy);

    // 2. Velocidade em CHASE
    const chasePawn = createSpeedTestPawn(100, 100, true);
    const chaseController = new KillerAIController(chasePawn);
    chaseController.state = 'CHASE';
    const mockPlayerNear = { x: 400, y: 100, isActive: true, sprite: { visible: true } } as any;
    chaseController.update(16, mockPlayerNear, mockGenerators, { ...mockSettings, detectionRadius: 8.5 });
    const chaseVel = chasePawn.velocities[chasePawn.velocities.length - 1];
    const chaseSpeed = Math.hypot(chaseVel.vx, chaseVel.vy);

    // As duas velocidades devem ser exatamente iguais (sem aceleração de sprint na perseguição nem marcha lenta em patrulha)
    expect(patrolSpeed).toBeCloseTo(chaseSpeed, 1);
    expect(patrolSpeed).toBeCloseTo(276, 1);
    expect(patrolSpeed).toBeCloseTo(metersToPixels(mockSettings.killerSpeed), 1);
  });
});

describe('Metric System Standardization (Dead by Daylight Scale: 1m = 60px)', () => {
  it('verifies constant scale definition of 60 pixels per meter', () => {
    expect(PIXELS_PER_METER).toBe(60);
  });

  it('correctly converts meters to pixels for all core entities', () => {
    // Survivor Walk: 2.26 m/s -> 135.6 px/s (~135-136 px/s)
    expect(metersToPixels(2.26)).toBeCloseTo(135.6, 1);

    // Survivor Run: 4.0 m/s -> 240 px/s
    expect(metersToPixels(4.0)).toBe(240);

    // Killer Speed: 4.6 m/s -> 276 px/s
    expect(metersToPixels(4.6)).toBe(276);

    // Terror Radius: 32 m -> 1920 px
    expect(metersToPixels(32)).toBe(1920);

    // Detection Radius: 7.5 m -> 450 px
    expect(metersToPixels(7.5)).toBe(450);
  });

  it('correctly converts pixels to meters with 1 decimal precision', () => {
    expect(pixelsToMeters(60)).toBe(1.0);
    expect(pixelsToMeters(240)).toBe(4.0);
    expect(pixelsToMeters(276)).toBe(4.6);
    expect(pixelsToMeters(1920)).toBe(32.0);
    expect(pixelsToMeters(850)).toBe(14.2);
  });

  it('formats map dimensions in pixels and meters according to specification', () => {
    const formatted = formatMapDimensionsMetric(5120, 3840);
    expect(formatted).toBe('5120x3840 px (85.3m x 64.0m)');
  });
});






