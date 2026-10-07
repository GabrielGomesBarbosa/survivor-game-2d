/**
 * @file generatorStorage.ts
 * @description LocalStorage persistence, parsing, and serialization for generator candidates and active sessions.
 */

/**
 * Ponto candidato a spawn de gerador selecionado pelo editor.
 */
export interface GeneratorSpawnCandidate {
  id: number;
  x: number;
  y: number;
  rotation: number;
  maxSurvivors: number;
  name?: string;
  roomName?: string;
}

export const GENERATOR_CANDIDATES_STORAGE_KEY = 'horror2d_generator_candidates';

/**
 * Exporta a lista de candidatos para string formatada em JSON.
 */
export function exportCandidatesToJson(candidates: GeneratorSpawnCandidate[]): string {
  return JSON.stringify(candidates, null, 2);
}

/**
 * Faz parse e validação defensiva da lista de candidatos a partir de uma string JSON.
 * Retorna array vazio se a string for nula, vazia ou inválida.
 */
export function parseCandidatesJson(rawJson: string | null | undefined): GeneratorSpawnCandidate[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is GeneratorSpawnCandidate =>
        Boolean(
          c &&
          typeof c.id === 'number' &&
          typeof c.x === 'number' &&
          typeof c.y === 'number' &&
          typeof c.rotation === 'number' &&
          typeof c.maxSurvivors === 'number' &&
          isFinite(c.x) &&
          isFinite(c.y)
        )
    );
  } catch {
    return [];
  }
}

/**
 * Carrega a lista de candidatos a partir do localStorage (ou storage injetado).
 */
export function loadCandidatesFromStorage(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): GeneratorSpawnCandidate[] {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return [];
    const raw = s.getItem(storageKey);
    return parseCandidatesJson(raw);
  } catch {
    return [];
  }
}

/**
 * Salva a lista de candidatos no localStorage (ou storage injetado).
 */
export function saveCandidatesToStorage(
  candidates: GeneratorSpawnCandidate[],
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { setItem: (key: string, value: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.setItem(storageKey, JSON.stringify(candidates));
  } catch (e) {
    console.warn('Erro ao salvar candidatos no localStorage:', e);
  }
}

/**
 * Remove os candidatos salvos no localStorage (ou storage injetado).
 */
export function clearCandidatesFromStorage(
  storageKey: string = GENERATOR_CANDIDATES_STORAGE_KEY,
  storage?: { removeItem: (key: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.removeItem(storageKey);
  } catch (e) {
    console.warn('Erro ao remover candidatos do localStorage:', e);
  }
}

export const ACTIVE_GENERATORS_STORAGE_KEY = 'horror2d_active_generators';

/**
 * Estrutura serializada para persistência de geradores ativos na sessão (resistência ao F5).
 */
export interface ActiveGeneratorData {
  id: string | number;
  name: string;
  roomName: string;
  x: number;
  y: number;
  rotation: number;
  maxSurvivors?: number;
  progress?: number;
  isCompleted?: boolean;
  isRegressing?: boolean;
}

/**
 * Faz parse defensivo do JSON de geradores ativos recuperados do localStorage.
 */
export function parseActiveGeneratorsJson(rawJson: string | null | undefined): ActiveGeneratorData[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is ActiveGeneratorData =>
        Boolean(
          g &&
          (typeof g.id === 'string' || typeof g.id === 'number') &&
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          isFinite(g.x) &&
          isFinite(g.y)
        )
    ).map((g) => ({
      id: g.id,
      name: g.name || `Gerador ${g.id}`,
      roomName: g.roomName || 'Complexo Industrial',
      x: g.x,
      y: g.y,
      rotation: typeof g.rotation === 'number' ? g.rotation : 0,
      maxSurvivors: typeof g.maxSurvivors === 'number' ? g.maxSurvivors : 4,
      progress: typeof g.progress === 'number' ? g.progress : 0,
      isCompleted: Boolean(g.isCompleted || (typeof g.progress === 'number' && g.progress >= 100)),
      ...(g.isRegressing ? { isRegressing: true } : {})
    }));
  } catch {
    return [];
  }
}

/**
 * Carrega a lista de geradores ativos atualmente configurados no localStorage.
 */
export function loadActiveGeneratorsFromStorage(
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { getItem: (key: string) => string | null }
): ActiveGeneratorData[] {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return [];
    const raw = s.getItem(storageKey);
    return parseActiveGeneratorsJson(raw);
  } catch {
    return [];
  }
}

/**
 * Salva a lista de geradores ativos atualmente na cena no localStorage.
 */
export function saveActiveGeneratorsToStorage(
  generators: ActiveGeneratorData[],
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { setItem: (key: string, value: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.setItem(storageKey, JSON.stringify(generators));
  } catch (e) {
    console.warn('Erro ao salvar geradores ativos no localStorage:', e);
  }
}

/**
 * Remove a chave de geradores ativos do localStorage.
 */
export function clearActiveGeneratorsFromStorage(
  storageKey: string = ACTIVE_GENERATORS_STORAGE_KEY,
  storage?: { removeItem: (key: string) => void }
): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined);
    if (!s) return;
    s.removeItem(storageKey);
  } catch (e) {
    console.warn('Erro ao limpar geradores ativos do localStorage:', e);
  }
}
