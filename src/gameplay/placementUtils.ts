/**
 * @file placementUtils.ts
 * @description Generator placement validation, survivor slot counting, and spawn candidate pool management.
 */

import { GENERATOR_HITBOX_WIDTH, GENERATOR_HITBOX_HEIGHT } from '../physics/generatorHitbox';
import {
  GeneratorSpawnCandidate,
  ActiveGeneratorData,
  GENERATOR_CANDIDATES_STORAGE_KEY,
  loadCandidatesFromStorage
} from '../storage/generatorStorage';
import defaultSpawnCandidatesJson from '../data/generatorSpawnCandidates.json';

export interface GeneratorPlacementValidation {
  isValid: boolean;
  isCollidingWithWall: boolean;
  isOutOfBounds: boolean;
  maxSurvivors: number;
  accessibleSides: {
    north: boolean;
    south: boolean;
    east: boolean;
    west: boolean;
  };
  hitboxBounds: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

/**
 * Valida o posicionamento de um gerador (50x112px ou 112x50px) na grade de navegação.
 * Verifica colisão direta da hitbox com paredes sólidas ('#') e calcula os lados acessíveis (1 a 4 slots estilo DBD).
 *
 * @param genX Coordenada central X em pixels.
 * @param genY Coordenada central Y em pixels.
 * @param rotation Rotação em graus (0, 90, 180 ou 270).
 * @param navGrid Matriz de navegação onde 1 = parede e 0 = livre.
 * @param tileSize Tamanho do bloco em pixels (padrão: 64).
 * @param worldWidth Largura do mundo (padrão: 5120).
 * @param worldHeight Altura do mundo (padrão: 3840).
 * @param repairOffset Distância de verificação do ponto de reparo do survivor (padrão: 48px).
 */
export function validateGeneratorPlacement(
  genX: number,
  genY: number,
  rotation: number,
  navGrid: number[][],
  tileSize: number = 64,
  worldWidth: number = 5120,
  worldHeight: number = 3840,
  repairOffset: number = 48
): GeneratorPlacementValidation {
  const normRot = ((rotation % 360) + 360) % 360;
  const isHorizontal = normRot === 90 || normRot === 270;
  const width = isHorizontal ? GENERATOR_HITBOX_HEIGHT : GENERATOR_HITBOX_WIDTH;
  const height = isHorizontal ? GENERATOR_HITBOX_WIDTH : GENERATOR_HITBOX_HEIGHT;

  const halfW = width / 2;
  const halfH = height / 2;
  const left = genX - halfW;
  const right = genX + halfW;
  const top = genY - halfH;
  const bottom = genY + halfH;

  const hitboxBounds = { left, right, top, bottom, width, height };

  const cols = navGrid[0]?.length || Math.floor(worldWidth / tileSize);
  const rows = navGrid.length || Math.floor(worldHeight / tileSize);

  // 1. Verificação de limites do mundo
  if (left < 0 || right > worldWidth || top < 0 || bottom > worldHeight) {
    return {
      isValid: false,
      isCollidingWithWall: false,
      isOutOfBounds: true,
      maxSurvivors: 0,
      accessibleSides: { north: false, south: false, east: false, west: false },
      hitboxBounds
    };
  }

  // 2. Verificação de colisão da hitbox sólida com paredes ('#')
  const minC = Math.max(0, Math.floor(left / tileSize));
  const maxC = Math.min(cols - 1, Math.floor((right - 0.01) / tileSize));
  const minR = Math.max(0, Math.floor(top / tileSize));
  const maxR = Math.min(rows - 1, Math.floor((bottom - 0.01) / tileSize));

  let isCollidingWithWall = false;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (navGrid[r]?.[c] === 1) {
        isCollidingWithWall = true;
        break;
      }
    }
    if (isCollidingWithWall) break;
  }

  // 3. Verificação de slots acessíveis (cardeais) estilo DBD
  const checkWalkable = (px: number, py: number): boolean => {
    const c = Math.floor(px / tileSize);
    const r = Math.floor(py / tileSize);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return false;
    return navGrid[r]?.[c] === 0;
  };

  const accessibleSides = {
    north: checkWalkable(genX, top - repairOffset),
    south: checkWalkable(genX, bottom + repairOffset),
    east: checkWalkable(right + repairOffset, genY),
    west: checkWalkable(left - repairOffset, genY)
  };

  const openCount =
    (accessibleSides.north ? 1 : 0) +
    (accessibleSides.south ? 1 : 0) +
    (accessibleSides.east ? 1 : 0) +
    (accessibleSides.west ? 1 : 0);

  const isValid = !isCollidingWithWall && openCount >= 1;

  return {
    isValid,
    isCollidingWithWall,
    isOutOfBounds: false,
    maxSurvivors: isValid ? openCount : 0,
    accessibleSides,
    hitboxBounds
  };
}

/**
 * Adiciona um ponto candidato à lista, gerando id sequencial se necessário.
 */
export function addSpawnCandidate(
  candidates: GeneratorSpawnCandidate[],
  candidate: Omit<GeneratorSpawnCandidate, 'id'> & { id?: number }
): GeneratorSpawnCandidate[] {
  const nextId = candidate.id ?? (candidates.reduce((max, c) => Math.max(max, c.id), 0) + 1);
  const newCandidate: GeneratorSpawnCandidate = {
    id: nextId,
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    rotation: ((candidate.rotation % 360) + 360) % 360,
    maxSurvivors: candidate.maxSurvivors
  };
  return [...candidates, newCandidate];
}

/**
 * Remove um candidato por id.
 */
export function removeSpawnCandidate(
  candidates: GeneratorSpawnCandidate[],
  id: number
): GeneratorSpawnCandidate[] {
  return candidates.filter((c) => c.id !== id);
}

/**
 * Localiza candidato sob uma coordenada dada dentro de um raio de detecção (padrão: 50px).
 */
export function findCandidateAtPosition(
  candidates: GeneratorSpawnCandidate[],
  x: number,
  y: number,
  hitRadius: number = 50
): GeneratorSpawnCandidate | null {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (Math.hypot(c.x - x, c.y - y) <= hitRadius) {
      return c;
    }
  }
  return null;
}

export const DEFAULT_SPAWN_CANDIDATES: GeneratorSpawnCandidate[] = (defaultSpawnCandidatesJson as unknown) as GeneratorSpawnCandidate[];

/**
 * Retorna o conjunto de candidatos disponíveis:
 * Retorna os dados persistidos no localStorage se existirem e não estiverem vazios;
 * caso contrário, retorna os candidatos padrão calibrados (DEFAULT_SPAWN_CANDIDATES).
 */
export function getMappedCandidatePool(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): GeneratorSpawnCandidate[] {
  const stored = loadCandidatesFromStorage(storageKey, storage);
  if (stored && stored.length > 0) {
    return stored;
  }
  return [...DEFAULT_SPAWN_CANDIDATES];
}

/**
 * Sorteia aleatoriamente até N candidatos do conjunto fornecido (embaralhamento Fisher-Yates).
 * @param candidates Lista de candidatos.
 * @param count Quantidade máxima de candidatos a sortear (padrão: 8).
 * @param rng Função geradora de números aleatórios (padrão: Math.random).
 */
export function selectRandomCandidates(
  candidates: GeneratorSpawnCandidate[],
  count: number = 8,
  rng: () => number = Math.random
): GeneratorSpawnCandidate[] {
  if (!candidates || candidates.length === 0) return [];
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * Converte um candidato a spawn em uma definição de gerador funcional (GeneratorDef).
 */
export function candidateToGeneratorDef(
  candidate: GeneratorSpawnCandidate | ActiveGeneratorData,
  index?: number
): { id: string; name: string; roomName: string; x: number; y: number; rotation: number } {
  const numId = typeof candidate.id === 'number'
    ? candidate.id
    : parseInt(String(candidate.id).replace(/\D/g, ''), 10) || 1;
  const genLetter = String.fromCharCode(65 + ((index !== undefined ? index : numId - 1) % 26));
  const fallbackName = `Gerador ${genLetter}`;
  const isNumbered = Boolean(candidate.name && /^Gerador \d+$/i.test(candidate.name));
  const name = candidate.name && !isNumbered ? candidate.name : fallbackName;
  const strId = String(candidate.id).startsWith('gen-') ? String(candidate.id) : `gen-${candidate.id}`;
  return {
    id: strId,
    name,
    roomName: candidate.roomName || 'Complexo Industrial',
    x: candidate.x,
    y: candidate.y,
    rotation: candidate.rotation ?? 0
  };
}
