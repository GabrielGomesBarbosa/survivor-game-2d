import { describe, it, expect } from 'vitest';
import {
  validateGeneratorPlacement,
  addSpawnCandidate,
  removeSpawnCandidate,
  findCandidateAtPosition,
  exportCandidatesToJson,
  GeneratorSpawnCandidate,
  evaluateCameraPanState,
  parseCandidatesJson,
  loadCandidatesFromStorage,
  saveCandidatesToStorage,
  clearCandidatesFromStorage,
  GENERATOR_CANDIDATES_STORAGE_KEY
} from '../src/utils/gameLogic';
import { COLS, ROWS, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../src/config/constants';
import { MapBuilder } from '../src/map/MapBuilder';

describe('Generator Placer & DBD Slot Validation Logic', () => {
  // Matriz de navegação 80x60 vazia (apenas bordas sólidas)
  const createMockNavGrid = (): number[][] => {
    const grid: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    for (let c = 0; c < COLS; c++) {
      grid[0][c] = 1;
      grid[ROWS - 1][c] = 1;
    }
    for (let r = 0; r < ROWS; r++) {
      grid[r][0] = 1;
      grid[r][COLS - 1] = 1;
    }
    return grid;
  };

  it('validates open floor placement with 4 accessible survivor slots', () => {
    const grid = createMockNavGrid();
    // Centro do mapa em chão livre
    const result = validateGeneratorPlacement(2560, 1920, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(result.isValid).toBe(true);
    expect(result.isCollidingWithWall).toBe(false);
    expect(result.isOutOfBounds).toBe(false);
    expect(result.maxSurvivors).toBe(4);
    expect(result.accessibleSides).toEqual({
      north: true,
      south: true,
      east: true,
      west: true
    });
    expect(result.hitboxBounds.width).toBe(50);
    expect(result.hitboxBounds.height).toBe(112);
  });

  it('swaps width and height dimensions when rotated by 90° or 270°', () => {
    const grid = createMockNavGrid();

    // 0° (vertical)
    const rot0 = validateGeneratorPlacement(2560, 1920, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(rot0.hitboxBounds.width).toBe(50);
    expect(rot0.hitboxBounds.height).toBe(112);

    // 90° (horizontal)
    const rot90 = validateGeneratorPlacement(2560, 1920, 90, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(rot90.hitboxBounds.width).toBe(112);
    expect(rot90.hitboxBounds.height).toBe(50);

    // 180° (vertical)
    const rot180 = validateGeneratorPlacement(2560, 1920, 180, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(rot180.hitboxBounds.width).toBe(50);
    expect(rot180.hitboxBounds.height).toBe(112);

    // 270° (horizontal)
    const rot270 = validateGeneratorPlacement(2560, 1920, 270, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(rot270.hitboxBounds.width).toBe(112);
    expect(rot270.hitboxBounds.height).toBe(50);
  });

  it('correctly reports 3 slots when one face is flush against a solid wall', () => {
    const grid = createMockNavGrid();
    // Adiciona uma parede horizontal em r = 10, c in [35..45]
    for (let c = 35; c <= 45; c++) grid[10][c] = 1;

    // Posiciona o gerador com a face norte encostada na parede de r = 10 (parede vai até y = 704)
    // Gerador com height = 112, top em y = 706 (y central = 706 + 56 = 762)
    const result = validateGeneratorPlacement(2560, 762, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(result.isValid).toBe(true);
    expect(result.isCollidingWithWall).toBe(false);
    expect(result.accessibleSides.north).toBe(false); // Bloqueado pela parede ao norte
    expect(result.accessibleSides.south).toBe(true);
    expect(result.accessibleSides.east).toBe(true);
    expect(result.accessibleSides.west).toBe(true);
    expect(result.maxSurvivors).toBe(3);
  });

  it('correctly reports 2 slots when placed in a 90° corner', () => {
    const grid = createMockNavGrid();
    // Quina interna formada por parede norte (r = 10) e parede oeste (c = 35)
    for (let c = 35; c <= 45; c++) grid[10][c] = 1;
    for (let r = 10; r <= 20; r++) grid[r][35] = 1;

    // Gerador posicionado próximo à quina (x = 35*64 + 64 + 25 + 5 = 2398, y = 762)
    // Parede oeste termina em x = 2304. Left do gerador = 2398 - 25 = 2373.
    // Ponto de checagem oeste = 2373 - 48 = 2325 (coluna 36, livre se longe de 35, mas se colado em 35):
    // Se colado: x = 2304 + 25 + 10 = 2339 -> left = 2314 -> left - 48 = 2266 (coluna 35 -> parede!)
    const cornerGen = validateGeneratorPlacement(2339, 762, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(cornerGen.isValid).toBe(true);
    expect(cornerGen.accessibleSides.north).toBe(false);
    expect(cornerGen.accessibleSides.west).toBe(false);
    expect(cornerGen.accessibleSides.south).toBe(true);
    expect(cornerGen.accessibleSides.east).toBe(true);
    expect(cornerGen.maxSurvivors).toBe(2);
  });

  it('correctly reports exactly 1 slot in a 3-sided tight U-alcove', () => {
    const grid = createMockNavGrid();
    // Constrói uma alcova em U com abertura frontal ao Norte:
    // Parede de fundo (Sul): r = 20, c in [4..7]
    // Parede esquerda (Oeste): c = 4, r in [17..20]
    // Parede direita (Leste): c = 7, r in [17..20]
    // Interior livre: c in [5..6], r in [17..19] (abertura de 2 tiles ao Norte em r = 16)
    for (let c = 4; c <= 7; c++) grid[20][c] = 1;
    for (let r = 17; r <= 20; r++) {
      grid[r][4] = 1;
      grid[r][7] = 1;
    }

    // Posição no interior do nicho: x = 6 * 64 = 384, y encostado ao sul em r = 20 (y = 1214)
    const result = validateGeneratorPlacement(384, 1214, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(result.isValid).toBe(true);
    expect(result.isCollidingWithWall).toBe(false);
    expect(result.accessibleSides.north).toBe(true); // Único acesso aberto frontal
    expect(result.accessibleSides.south).toBe(false); // Parede de fundo r = 20
    expect(result.accessibleSides.west).toBe(false);  // Parede esquerda c = 4
    expect(result.accessibleSides.east).toBe(false);  // Parede direita c = 7
    expect(result.maxSurvivors).toBe(1);
  });

  it('rejects placement when generator solid hitbox overlaps a solid wall tile', () => {
    const grid = createMockNavGrid();
    // Parede em r = 15, c = 20
    grid[15][20] = 1;

    // Gerador com centro exatamente sobre a parede (x = 20*64 + 32 = 1312, y = 15*64 + 32 = 992)
    const result = validateGeneratorPlacement(1312, 992, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(result.isValid).toBe(false);
    expect(result.isCollidingWithWall).toBe(true);
    expect(result.maxSurvivors).toBe(0);
  });

  it('rejects placement when generator extends beyond world boundaries', () => {
    const grid = createMockNavGrid();

    // Posição fora do mapa (x negativo)
    const outLeft = validateGeneratorPlacement(-10, 1000, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(outLeft.isValid).toBe(false);
    expect(outLeft.isOutOfBounds).toBe(true);

    // Posição fora do mapa (y além de WORLD_HEIGHT)
    const outBottom = validateGeneratorPlacement(1000, WORLD_HEIGHT + 50, 0, grid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);
    expect(outBottom.isValid).toBe(false);
    expect(outBottom.isOutOfBounds).toBe(true);
  });
});

describe('Generator Spawn Candidates Management & JSON Serialization', () => {
  it('adds candidate with auto-incrementing ID and rounded coordinates', () => {
    let list: GeneratorSpawnCandidate[] = [];

    list = addSpawnCandidate(list, { x: 500.4, y: 300.7, rotation: 0, maxSurvivors: 4 });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: 1,
      x: 500,
      y: 301,
      rotation: 0,
      maxSurvivors: 4
    });

    list = addSpawnCandidate(list, { x: 1024, y: 2048, rotation: 90, maxSurvivors: 1 });
    expect(list).toHaveLength(2);
    expect(list[1].id).toBe(2);
    expect(list[1].rotation).toBe(90);
    expect(list[1].maxSurvivors).toBe(1);
  });

  it('removes candidate by ID correctly', () => {
    let list: GeneratorSpawnCandidate[] = [
      { id: 1, x: 100, y: 100, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 200, y: 200, rotation: 90, maxSurvivors: 3 },
      { id: 3, x: 300, y: 300, rotation: 180, maxSurvivors: 1 }
    ];

    list = removeSpawnCandidate(list, 2);
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.id === 2)).toBeUndefined();
    expect(list.map((c) => c.id)).toEqual([1, 3]);
  });

  it('finds candidate within detection radius and ignores distant candidates', () => {
    const list: GeneratorSpawnCandidate[] = [
      { id: 1, x: 500, y: 500, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 1000, y: 1000, rotation: 90, maxSurvivors: 2 }
    ];

    // Cursor a 20px de distância do candidato #1
    const found = findCandidateAtPosition(list, 520, 500, 45);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(1);

    // Cursor longe (80px de distância)
    const notFound = findCandidateAtPosition(list, 580, 500, 45);
    expect(notFound).toBeNull();
  });

  it('exports candidates to formatted JSON matching the required schema', () => {
    const list: GeneratorSpawnCandidate[] = [
      { id: 1, x: 2560, y: 1920, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 384, y: 1214, rotation: 90, maxSurvivors: 1 }
    ];

    const json = exportCandidatesToJson(list);
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: 1,
      x: 2560,
      y: 1920,
      rotation: 0,
      maxSurvivors: 4
    });
    expect(parsed[1]).toEqual({
      id: 2,
      x: 384,
      y: 1214,
      rotation: 90,
      maxSurvivors: 1
    });
  });
});

describe('Camera Pan & Generator Placer Priority Logic', () => {
  it('gives universal priority to middle mouse button pan regardless of placer or space state', () => {
    // 1. Middle button alone
    const res1 = evaluateCameraPanState(true, false, false, false, false);
    expect(res1.shouldPan).toBe(true);
    expect(res1.canPlaceGenerator).toBe(false);
    expect(res1.panReason).toBe('middle_drag');

    // 2. Middle button while Placer is active
    const res2 = evaluateCameraPanState(true, false, false, false, true);
    expect(res2.shouldPan).toBe(true);
    expect(res2.canPlaceGenerator).toBe(false);
    expect(res2.panReason).toBe('middle_drag');

    // 3. Middle button while both Space and Left are also down with Placer active
    const res3 = evaluateCameraPanState(true, true, true, false, true);
    expect(res3.shouldPan).toBe(true);
    expect(res3.canPlaceGenerator).toBe(false);
    expect(res3.panReason).toBe('middle_drag');
  });

  it('triggers touchpad camera pan when Space + Left Click are held, bypassing generator placement', () => {
    // Space + Left Click with Placer active: must pan and NEVER place a generator
    const res = evaluateCameraPanState(false, true, true, false, true);
    expect(res.shouldPan).toBe(true);
    expect(res.canPlaceGenerator).toBe(false);
    expect(res.panReason).toBe('space_drag');

    // Space alone (without Left click) does not pan and does not place
    const resSpaceOnly = evaluateCameraPanState(false, true, false, false, true);
    expect(resSpaceOnly.shouldPan).toBe(false);
    expect(resSpaceOnly.canPlaceGenerator).toBe(false);
    expect(resSpaceOnly.panReason).toBe('none');
  });

  it('allows generator placement ONLY on clean Left Click with Placer active and without Space or Middle Click', () => {
    // Clean Left Click with Placer active
    const resClean = evaluateCameraPanState(false, false, true, false, true);
    expect(resClean.shouldPan).toBe(false);
    expect(resClean.canPlaceGenerator).toBe(true);
    expect(resClean.panReason).toBe('none');

    // Clean Left Click even if FreeCam is true, Placer takes precedence for clean click
    const resFreeCamWithPlacer = evaluateCameraPanState(false, false, true, true, true);
    expect(resFreeCamWithPlacer.shouldPan).toBe(false);
    expect(resFreeCamWithPlacer.canPlaceGenerator).toBe(true);
    expect(resFreeCamWithPlacer.panReason).toBe('none');
  });

  it('unlinks simple left click from camera drag, keeping it exclusive for generator placement', () => {
    // Even if FreeCam is active, Left Click alone without Space or Middle Click does NOT pan
    const resFreeCam = evaluateCameraPanState(false, false, true, true, false);
    expect(resFreeCam.shouldPan).toBe(false);
    expect(resFreeCam.canPlaceGenerator).toBe(false);
    expect(resFreeCam.panReason).toBe('none');

    // FreeCam inactive, Placer inactive, Left Click alone does not pan
    const resInactive = evaluateCameraPanState(false, false, true, false, false);
    expect(resInactive.shouldPan).toBe(false);
    expect(resInactive.canPlaceGenerator).toBe(false);
    expect(resInactive.panReason).toBe('none');
  });

  it('safely restores generator placement when Space is released, avoiding phantom spawns during pan release', () => {
    // While Space is down, Left click pans
    const dragging = evaluateCameraPanState(false, true, true, false, true);
    expect(dragging.shouldPan).toBe(true);
    expect(dragging.canPlaceGenerator).toBe(false);

    // Left click released (pointerup), Space still held: nothing happens
    const leftReleased = evaluateCameraPanState(false, true, false, false, true);
    expect(leftReleased.shouldPan).toBe(false);
    expect(leftReleased.canPlaceGenerator).toBe(false);

    // Space released, no clicks: nothing happens
    const idle = evaluateCameraPanState(false, false, false, false, true);
    expect(idle.shouldPan).toBe(false);
    expect(idle.canPlaceGenerator).toBe(false);

    // Subsequent clean Left click now places generator
    const subsequentClick = evaluateCameraPanState(false, false, true, false, true);
    expect(subsequentClick.shouldPan).toBe(false);
    expect(subsequentClick.canPlaceGenerator).toBe(true);
  });
});

describe('Facility Dead Zones Level Design & East 1-Slot Alcove Validation', () => {
  it('contains solid looping structures in the West dead zone breaking line of sight', () => {
    const rawGrid = MapBuilder.buildOrganicFacilityGrid();

    // 1. Pilar central maciço (c in [18..20], r in [28..30])
    for (let r = 28; r <= 30; r++) {
      for (let c = 18; c <= 20; c++) {
        expect(rawGrid[r][c]).toBe('#');
      }
    }

    // 2. Estrutura em 'L' Noroeste (r = 25, c in [11..16] e c = 11, r in [25..29])
    expect(rawGrid[25][11]).toBe('#');
    expect(rawGrid[25][16]).toBe('#');
    expect(rawGrid[29][11]).toBe('#');

    // 3. Estrutura em 'T' Sudoeste (r = 35, c in [10..18] e c = 14, r in [32..35])
    expect(rawGrid[35][10]).toBe('#');
    expect(rawGrid[35][14]).toBe('#');
    expect(rawGrid[32][14]).toBe('#');

    // 4. Garante passagens livres de pelo menos 2 a 3 blocos (sem becos sem saída)
    // Corredor entre Pilar e Recepção (c in [21..24], r = 29): livre
    for (let c = 21; c <= 24; c++) {
      expect(rawGrid[29][c]).toBe('.');
    }
  });

  it('validates exactly 1 survivor slot in the newly built East U-alcove', () => {
    const rawGrid = MapBuilder.buildOrganicFacilityGrid();
    const navGrid: number[][] = rawGrid.map((row) => row.map((cell) => (cell === '#' ? 1 : 0)));

    // Alcova Leste em c = 66..69, r = 28..31
    // Paredes:
    // Parede esquerda (Oeste): c = 66
    // Parede direita (Leste): c = 69
    // Parede de fundo (Sul): r = 31
    // Interior livre: c = 67, 68, r = 28..30
    // Entrada aberta ao Norte: r = 27
    expect(navGrid[31][67]).toBe(1); // Fundo sólido
    expect(navGrid[31][68]).toBe(1);
    expect(navGrid[29][66]).toBe(1); // Parede oeste sólida
    expect(navGrid[29][69]).toBe(1); // Parede leste sólida
    expect(navGrid[27][67]).toBe(0); // Acesso norte aberto
    expect(navGrid[27][68]).toBe(0); // Acesso norte aberto

    // Posição de spawn do gerador no centro do nicho (c = 68 * 64 = 4352, y encostado na parede sul em r = 31: y = 1924)
    const result = validateGeneratorPlacement(4352, 1924, 0, navGrid, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT);

    expect(result.isValid).toBe(true);
    expect(result.isCollidingWithWall).toBe(false);
    expect(result.isOutOfBounds).toBe(false);
    expect(result.accessibleSides.north).toBe(true);  // Único lado aberto frontal
    expect(result.accessibleSides.south).toBe(false); // Bloqueado pela parede de fundo (r = 31)
    expect(result.accessibleSides.west).toBe(false);  // Bloqueado pela parede esquerda (c = 66)
    expect(result.accessibleSides.east).toBe(false);  // Bloqueado pela parede direita (c = 69)
    expect(result.maxSurvivors).toBe(1);
  });
});

describe('Generator Spawn Candidates LocalStorage Persistence & Error Handling', () => {
  const createMockStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get size() {
        return store.size;
      }
    };
  };

  it('correctly parses valid JSON and ignores invalid or corrupted payloads', () => {
    // 1. Array válido
    const validJson = JSON.stringify([
      { id: 1, x: 2560, y: 1920, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 4352, y: 1924, rotation: 90, maxSurvivors: 1 }
    ]);
    const parsed = parseCandidatesJson(validJson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe(1);
    expect(parsed[1].maxSurvivors).toBe(1);

    // 2. String nula ou vazia
    expect(parseCandidatesJson(null)).toEqual([]);
    expect(parseCandidatesJson(undefined)).toEqual([]);
    expect(parseCandidatesJson('')).toEqual([]);

    // 3. JSON corrompido / sintaxe inválida
    expect(parseCandidatesJson('{ bad: json')).toEqual([]);

    // 4. JSON que não é array (ex: objeto único ou número)
    expect(parseCandidatesJson('{"id":1}')).toEqual([]);
    expect(parseCandidatesJson('123')).toEqual([]);

    // 5. Array com elementos corrompidos (filtra os inválidos)
    const corruptedArrayJson = JSON.stringify([
      { id: 1, x: 500, y: 500, rotation: 0, maxSurvivors: 4 },
      { id: 'not-a-number', x: NaN, y: 500 },
      null,
      { x: 100 }
    ]);
    const filtered = parseCandidatesJson(corruptedArrayJson);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('saves candidates to the exact key horror2d_generator_candidates and loads them back', () => {
    const mockStorage = createMockStorage();
    const candidates: GeneratorSpawnCandidate[] = [
      { id: 1, x: 1024, y: 768, rotation: 0, maxSurvivors: 3 },
      { id: 2, x: 4096, y: 3072, rotation: 180, maxSurvivors: 2 }
    ];

    expect(GENERATOR_CANDIDATES_STORAGE_KEY).toBe('horror2d_generator_candidates');

    // 1. Salva no storage
    saveCandidatesToStorage(candidates, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(mockStorage.getItem('horror2d_generator_candidates')).not.toBeNull();

    // 2. Carrega de volta
    const loaded = loadCandidatesFromStorage(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual({ id: 1, x: 1024, y: 768, rotation: 0, maxSurvivors: 3 });
    expect(loaded[1]).toEqual({ id: 2, x: 4096, y: 3072, rotation: 180, maxSurvivors: 2 });
  });

  it('removes the storage key on clearCandidatesFromStorage, returning empty array on next load', () => {
    const mockStorage = createMockStorage();
    const candidates: GeneratorSpawnCandidate[] = [
      { id: 1, x: 500, y: 500, rotation: 0, maxSurvivors: 4 }
    ];

    saveCandidatesToStorage(candidates, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(mockStorage.getItem('horror2d_generator_candidates')).toBeTruthy();

    // Limpa o armazenamento
    clearCandidatesFromStorage(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(mockStorage.getItem('horror2d_generator_candidates')).toBeNull();

    const reloaded = loadCandidatesFromStorage(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(reloaded).toEqual([]);
  });

  it('preserves ID sequence continuity when adding candidates after restoring from storage', () => {
    const mockStorage = createMockStorage();
    let candidates: GeneratorSpawnCandidate[] = [
      { id: 1, x: 2560, y: 1920, rotation: 0, maxSurvivors: 4 },
      { id: 2, x: 4352, y: 1924, rotation: 90, maxSurvivors: 1 }
    ];

    saveCandidatesToStorage(candidates, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);

    // Simula inicialização de uma nova sessão carregando do storage
    let sessionCandidates = loadCandidatesFromStorage(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(sessionCandidates).toHaveLength(2);

    // Adiciona um terceiro candidato: deve receber automaticamente o id 3
    sessionCandidates = addSpawnCandidate(sessionCandidates, {
      x: 1024,
      y: 3072,
      rotation: 270,
      maxSurvivors: 2
    });
    saveCandidatesToStorage(sessionCandidates, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);

    expect(sessionCandidates).toHaveLength(3);
    expect(sessionCandidates[2].id).toBe(3);

    // Remove o candidato id 1
    sessionCandidates = removeSpawnCandidate(sessionCandidates, 1);
    saveCandidatesToStorage(sessionCandidates, GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);

    const afterRemoval = loadCandidatesFromStorage(GENERATOR_CANDIDATES_STORAGE_KEY, mockStorage);
    expect(afterRemoval).toHaveLength(2);
    expect(afterRemoval.map((c) => c.id)).toEqual([2, 3]);
  });
});



