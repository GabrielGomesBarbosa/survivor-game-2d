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
  isPlayerDetectableByKiller,
  ACTIVE_GENERATORS_STORAGE_KEY,
  ActiveGeneratorData,
  parseActiveGeneratorsJson,
  saveActiveGeneratorsToStorage,
  loadActiveGeneratorsFromStorage,
  clearActiveGeneratorsFromStorage
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

describe('Active Generators Session Persistence (F5 Resistance)', () => {
  const createMockStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    };
  };

  it('uses the strict key "horror2d_active_generators"', () => {
    expect(ACTIVE_GENERATORS_STORAGE_KEY).toBe('horror2d_active_generators');
  });

  describe('parseActiveGeneratorsJson', () => {
    it('returns empty array on invalid, non-array or null/undefined inputs', () => {
      expect(parseActiveGeneratorsJson(null)).toEqual([]);
      expect(parseActiveGeneratorsJson(undefined)).toEqual([]);
      expect(parseActiveGeneratorsJson('')).toEqual([]);
      expect(parseActiveGeneratorsJson('   ')).toEqual([]);
      expect(parseActiveGeneratorsJson('not valid json')).toEqual([]);
      expect(parseActiveGeneratorsJson('{"key": "value"}')).toEqual([]);
      expect(parseActiveGeneratorsJson('123')).toEqual([]);
    });

    it('parses valid active generators and normalizes fields', () => {
      const input = JSON.stringify([
        {
          id: 'gen-1',
          name: 'Gerador A',
          roomName: 'Recepção',
          x: 1000,
          y: 2000,
          rotation: 90,
          maxSurvivors: 2,
          progress: 45,
          isCompleted: false
        },
        {
          id: 2,
          name: 'Gerador B',
          roomName: 'Laboratório',
          x: 1500,
          y: 800,
          rotation: 0,
          progress: 100,
          isCompleted: true
        }
      ]);

      const parsed = parseActiveGeneratorsJson(input);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        id: 'gen-1',
        name: 'Gerador A',
        roomName: 'Recepção',
        x: 1000,
        y: 2000,
        rotation: 90,
        maxSurvivors: 2,
        progress: 45,
        isCompleted: false
      });
      expect(parsed[1]).toEqual({
        id: 2,
        name: 'Gerador B',
        roomName: 'Laboratório',
        x: 1500,
        y: 800,
        rotation: 0,
        maxSurvivors: 4,
        progress: 100,
        isCompleted: true
      });
    });

    it('filters out invalid items without valid finite coordinates or id', () => {
      const input = JSON.stringify([
        { id: 'valid-1', x: 100, y: 200 },
        { id: 'no-coords' },
        { x: 100, y: 200 }, // missing id
        { id: 'nan-coords', x: NaN, y: 200 },
        { id: 'infinity-coords', x: 100, y: Infinity },
        null,
        'string-element'
      ]);

      const parsed = parseActiveGeneratorsJson(input);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('valid-1');
      expect(parsed[0].x).toBe(100);
      expect(parsed[0].y).toBe(200);
      expect(parsed[0].rotation).toBe(0);
      expect(parsed[0].progress).toBe(0);
      expect(parsed[0].isCompleted).toBe(false);
    });

    it('marks isCompleted as true if progress >= 100 even if isCompleted was omitted', () => {
      const input = JSON.stringify([
        { id: 'gen-full', x: 500, y: 600, progress: 100 }
      ]);
      const parsed = parseActiveGeneratorsJson(input);
      expect(parsed[0].isCompleted).toBe(true);
    });
  });

  describe('Storage CRUD Operations', () => {
    it('saves, loads, and clears active generators from mock storage', () => {
      const mockStorage = createMockStorage();

      // Initially empty
      expect(loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage)).toEqual([]);

      const activeGens: ActiveGeneratorData[] = [
        {
          id: 'gen-1',
          name: 'Gerador Alfa',
          roomName: 'Ala Noroeste',
          x: 800,
          y: 900,
          rotation: 0,
          maxSurvivors: 3,
          progress: 50,
          isCompleted: false
        },
        {
          id: 'gen-2',
          name: 'Gerador Beta',
          roomName: 'Ala Nordeste',
          x: 2400,
          y: 900,
          rotation: 180,
          maxSurvivors: 4,
          progress: 100,
          isCompleted: true
        }
      ];

      // Save
      saveActiveGeneratorsToStorage(activeGens, ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      const rawInStore = mockStorage.getItem(ACTIVE_GENERATORS_STORAGE_KEY);
      expect(rawInStore).not.toBeNull();

      // Load
      const loaded = loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('gen-1');
      expect(loaded[0].progress).toBe(50);
      expect(loaded[1].id).toBe('gen-2');
      expect(loaded[1].isCompleted).toBe(true);

      // Clear
      clearActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      expect(mockStorage.getItem(ACTIVE_GENERATORS_STORAGE_KEY)).toBeNull();
      expect(loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage)).toEqual([]);
    });

    it('handles failing storage gracefully without crashing', () => {
      const brokenStorage = {
        getItem: () => { throw new Error('Storage disabled'); },
        setItem: () => { throw new Error('Storage full'); },
        removeItem: () => { throw new Error('Storage locked'); }
      };

      expect(() => {
        loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, brokenStorage);
      }).not.toThrow();
      expect(loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, brokenStorage)).toEqual([]);

      expect(() => {
        saveActiveGeneratorsToStorage([], ACTIVE_GENERATORS_STORAGE_KEY, brokenStorage);
      }).not.toThrow();

      expect(() => {
        clearActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, brokenStorage);
      }).not.toThrow();
    });
  });

  describe('candidateToGeneratorDef with ActiveGeneratorData', () => {
    it('correctly maps ActiveGeneratorData to GeneratorDef', () => {
      const activeData: ActiveGeneratorData = {
        id: 'gen-4',
        name: 'Gerador Sala Técnica',
        roomName: 'Sala Técnica',
        x: 1280,
        y: 640,
        rotation: 270,
        progress: 75,
        isCompleted: false
      };

      const def = candidateToGeneratorDef(activeData);
      expect(def.id).toBe('gen-4');
      expect(def.name).toBe('Gerador Sala Técnica');
      expect(def.roomName).toBe('Sala Técnica');
      expect(def.x).toBe(1280);
      expect(def.y).toBe(640);
      expect(def.rotation).toBe(270);
    });
  });

  describe('Session Lifecycle Simulation', () => {
    it('simulates page reload (F5) with active generators restoring patrol, and clear resetting to standby', () => {
      const mockStorage = createMockStorage();

      // 1. Initial boot with empty storage -> Killer stays in STANDBY
      const initialSaved = loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      expect(initialSaved).toHaveLength(0);
      const killerStateAtStart = evaluateKillerAiState('STANDBY', true, initialSaved.length);
      expect(killerStateAtStart).toBe('STANDBY');

      // 2. User clicks Shuffle (8 generators active) -> persisted to localStorage
      const candidates = selectRandomCandidates(DEFAULT_SPAWN_CANDIDATES, 8);
      const activeGens: ActiveGeneratorData[] = candidates.map((c, i) => ({
        id: `gen-${c.id}`,
        name: `Gerador ${String.fromCharCode(65 + i)}`,
        roomName: c.roomName || 'Complexo',
        x: c.x,
        y: c.y,
        rotation: c.rotation ?? 0,
        progress: 0,
        isCompleted: false
      }));
      saveActiveGeneratorsToStorage(activeGens, ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);

      // Killer transitions to PATROL
      const killerStateAfterShuffle = evaluateKillerAiState('STANDBY', true, activeGens.length);
      expect(killerStateAfterShuffle).toBe('PATROL');

      // 3. Page Reload (F5) -> Read from storage
      const reloadedGens = loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      expect(reloadedGens).toHaveLength(8);
      // Killer transitions out of STANDBY into PATROL on the very first frame
      const killerStateOnReload = evaluateKillerAiState('STANDBY', true, reloadedGens.length);
      expect(killerStateOnReload).toBe('PATROL');

      // 4. User clicks "Limpar Todos do Mapa" -> Clear storage, active gens = 0
      clearActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      const clearedGens = loadActiveGeneratorsFromStorage(ACTIVE_GENERATORS_STORAGE_KEY, mockStorage);
      expect(clearedGens).toHaveLength(0);

      // Killer returns to STANDBY
      const killerStateAfterClear = evaluateKillerAiState('PATROL', true, clearedGens.length);
      expect(killerStateAfterClear).toBe('STANDBY');
    });
  });
});

