import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPAWN_CANDIDATES,
  getMappedCandidatePool,
  selectRandomCandidates,
  candidateToGeneratorDef,
  validateGeneratorPlacement,
  saveCandidatesToStorage,
  clearCandidatesFromStorage,
  GENERATOR_CANDIDATES_STORAGE_KEY,
  GeneratorSpawnCandidate,
  evaluateKillerAiState,
  formatGeneratorsHudText,
  isPlayerDetectableByKiller
} from '../src/utils/gameLogic';
import { MapBuilder } from '../src/map/MapBuilder';

import { TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../src/config/constants';

describe('Data-Driven Generator Candidates Pool', () => {
  const createMockStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    };
  };

  it('contains exactly 16 calibrated candidate spawns across all facility wings', () => {
    expect(DEFAULT_SPAWN_CANDIDATES).toHaveLength(16);
    const ids = DEFAULT_SPAWN_CANDIDATES.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(16);
  });


  it('verifies that every single default candidate is physically valid in the facility grid', () => {
    const rawGrid = MapBuilder.buildOrganicFacilityGrid();
    const navGrid: number[][] = rawGrid.map((row) => row.map((cell) => (cell === '#' ? 1 : 0)));

    DEFAULT_SPAWN_CANDIDATES.forEach((c) => {
      const res = validateGeneratorPlacement(
        c.x,
        c.y,
        c.rotation,
        navGrid,
        TILE_SIZE,
        WORLD_WIDTH,
        WORLD_HEIGHT
      );

      expect(res.isValid, `Candidate #${c.id} (${c.name} - ${c.roomName}) should be valid`).toBe(true);
      expect(res.isCollidingWithWall, `Candidate #${c.id} should not collide with walls`).toBe(false);
      expect(res.isOutOfBounds, `Candidate #${c.id} should be within map bounds`).toBe(false);
      expect(res.maxSurvivors, `Candidate #${c.id} should have >= 1 slot`).toBeGreaterThanOrEqual(1);
    });
  });

  it('verifies that the two tight alcoves (NW and East) have exactly 1 accessible slot', () => {
    const rawGrid = MapBuilder.buildOrganicFacilityGrid();
    const navGrid: number[][] = rawGrid.map((row) => row.map((cell) => (cell === '#' ? 1 : 0)));

    // Candidate 2 is NW alcove
    const nwAlcove = DEFAULT_SPAWN_CANDIDATES.find((c) => c.id === 2);
    expect(nwAlcove).toBeDefined();
    const nwRes = validateGeneratorPlacement(nwAlcove!.x, nwAlcove!.y, nwAlcove!.rotation, navGrid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(nwRes.isValid).toBe(true);
    expect(nwRes.maxSurvivors).toBe(1);

    // Candidate 8 is East alcove
    const eastAlcove = DEFAULT_SPAWN_CANDIDATES.find((c) => c.id === 8);
    expect(eastAlcove).toBeDefined();
    const eastRes = validateGeneratorPlacement(eastAlcove!.x, eastAlcove!.y, eastAlcove!.rotation, navGrid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(eastRes.isValid).toBe(true);
    expect(eastRes.maxSurvivors).toBe(1);
  });

  it('getMappedCandidatePool falls back to DEFAULT_SPAWN_CANDIDATES when storage is empty', () => {
    const mockStorage = createMockStorage();
    const pool = getMappedCandidatePool(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(pool).toHaveLength(16);
    expect(pool[0].id).toBe(1);
  });

  it('getMappedCandidatePool returns custom candidates when present in storage', () => {
    const mockStorage = createMockStorage();
    const custom: GeneratorSpawnCandidate[] = [
      { id: 99, x: 2000, y: 1500, rotation: 0, maxSurvivors: 4, name: 'Custom Gen', roomName: 'Custom Room' }
    ];
    saveCandidatesToStorage(custom, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);

    const pool = getMappedCandidatePool(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe(99);
  });

  it('selectRandomCandidates returns exactly the requested count without duplicates', () => {
    const selected = selectRandomCandidates(DEFAULT_SPAWN_CANDIDATES, 8);
    expect(selected).toHaveLength(8);
    const ids = new Set(selected.map((c) => c.id));
    expect(ids.size).toBe(8);
  });

  it('selectRandomCandidates returns empty array when pool is empty', () => {
    const selected = selectRandomCandidates([], 8);
    expect(selected).toEqual([]);
  });

  it('selectRandomCandidates caps selection at pool size if requested count is greater', () => {
    const miniPool: GeneratorSpawnCandidate[] = [
      { id: 1, x: 100, y: 100, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 200, y: 200, rotation: 0, maxSurvivors: 2 }
    ];
    const selected = selectRandomCandidates(miniPool, 8);
    expect(selected).toHaveLength(2);
  });

  it('candidateToGeneratorDef formats alphabetical name, roomName, id and coordinates properly', () => {
    const candidate: GeneratorSpawnCandidate = {
      id: 5,
      x: 1200,
      y: 800,
      rotation: 0,
      maxSurvivors: 3,
      name: 'Gerador 5',
      roomName: 'Laboratório'
    };
    // If index 0 is passed, it should map to Gerador A
    const defA = candidateToGeneratorDef(candidate, 0);
    expect(defA.id).toBe('gen-5');
    expect(defA.name).toBe('Gerador A');
    expect(defA.roomName).toBe('Laboratório');
    expect(defA.x).toBe(1200);
    expect(defA.y).toBe(800);

    // If index 2 is passed, it should map to Gerador C
    const defC = candidateToGeneratorDef(candidate, 2);
    expect(defC.name).toBe('Gerador C');

    // If custom non-numbered name is given, preserve it
    const customCand: GeneratorSpawnCandidate = {
      id: 9,
      x: 500,
      y: 600,
      rotation: 0,
      maxSurvivors: 2,
      name: 'Turbina Principal',
      roomName: 'Sala de Máquinas'
    };
    const defCustom = candidateToGeneratorDef(customCand, 1);
    expect(defCustom.name).toBe('Turbina Principal');
    expect(defCustom.roomName).toBe('Sala de Máquinas');
  });
});

describe('Killer Activation Guard Rule - Pure Logic Evaluation', () => {
  it('keeps Killer strictly in STANDBY when generators list is empty', () => {
    expect(evaluateKillerAiState('STANDBY', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('PATROL', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('CHASE', true, 0)).toBe('STANDBY');
    expect(evaluateKillerAiState('INSPECTING', true, 0)).toBe('STANDBY');
  });

  it('transitions from STANDBY to PATROL once at least 1 generator is supplied', () => {
    expect(evaluateKillerAiState('STANDBY', true, 1)).toBe('PATROL');
    expect(evaluateKillerAiState('STANDBY', true, 8)).toBe('PATROL');
  });

  it('forces DESATIVADO when bot is disabled, regardless of generator count', () => {
    expect(evaluateKillerAiState('STANDBY', false, 0)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('STANDBY', false, 8)).toBe('DESATIVADO');
    expect(evaluateKillerAiState('PATROL', false, 0)).toBe('DESATIVADO');
  });
});

describe('Telemetry HUD Formatting & Spectator Mode Rules', () => {
  it('formats HUD generator text with DBD style [completed]/[required] ([total] no mapa)', () => {
    expect(formatGeneratorsHudText(0, 8, 5)).toBe('0/5 (8 no mapa)');
    expect(formatGeneratorsHudText(3, 8, 5)).toBe('3/5 (8 no mapa)');
    expect(formatGeneratorsHudText(5, 8, 5)).toBe('5/5 (8 no mapa)');
    expect(formatGeneratorsHudText(0, 0, 5)).toBe('0/5 (0 no mapa)');
    expect(formatGeneratorsHudText(0, 0)).toBe('0/0 (0 no mapa)');
  });

  it('evaluates survivor detectability correctly in active vs spectator mode', () => {
    // Survivor active and visible -> detectable
    expect(isPlayerDetectableByKiller(true, true, true)).toBe(true);

    // Spectator mode toggle (survivorActive = false) -> undetectable
    expect(isPlayerDetectableByKiller(false, true, true)).toBe(false);

    // Survivor disabled/inactive -> undetectable
    expect(isPlayerDetectableByKiller(true, false, true)).toBe(false);

    // Survivor invisible -> undetectable
    expect(isPlayerDetectableByKiller(true, true, false)).toBe(false);
  });
});

