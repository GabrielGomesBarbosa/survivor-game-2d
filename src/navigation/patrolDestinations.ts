/**
 * @file patrolDestinations.ts
 * @description Patrol targets, major facility rooms, and destination selection.
 */

export interface PatrolTarget {
  name: string;
  x: number;
  y: number;
  type: 'generator' | 'room';
}

/**
 * Centros das salas e cômodos principais da instalação (sem nós vazios de corredores).
 */
export const MAJOR_FACILITY_ROOMS: PatrolTarget[] = [
  { name: 'Recepção Central', x: 2560, y: 1920, type: 'room' },
  { name: 'Ala Norte (Contenção)', x: 2560, y: 736, type: 'room' },
  { name: 'Ala Nordeste (Laboratório)', x: 4096, y: 768, type: 'room' },
  { name: 'Ala Noroeste (Depósito)', x: 1024, y: 768, type: 'room' },
  { name: 'Ala Sudoeste (Enfermaria)', x: 1024, y: 3072, type: 'room' },
  { name: 'Ala Sudeste (Sala de Máquinas)', x: 4096, y: 3072, type: 'room' },
  { name: 'Ala Sul (Manutenção)', x: 2560, y: 3072, type: 'room' }
];

/**
 * Filtra e constrói a lista estrita de destinos de patrulha válidos:
 * - Valida que as coordenadas numéricas X e Y são finitas e não-nulas.
 * - Elimina entradas nulas, indefinidas ou com coordenadas inválidas/NaN.
 * - Inclui prioritariamente as posições dos geradores existentes.
 */
export function buildValidPatrolDestinations(
  incompleteGenerators: Array<{ name: string; x: number; y: number } | null | undefined>,
  majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS
): PatrolTarget[] {
  const validGens: PatrolTarget[] = (incompleteGenerators || [])
    .filter(
      (g): g is { name: string; x: number; y: number } =>
        Boolean(g && typeof g.x === 'number' && typeof g.y === 'number' && !isNaN(g.x) && !isNaN(g.y) && isFinite(g.x) && isFinite(g.y))
    )
    .map((g) => ({ name: g.name, x: g.x, y: g.y, type: 'generator' }));

  const validRooms = (majorRooms || []).filter(
    (r): r is PatrolTarget =>
      Boolean(r && typeof r.x === 'number' && typeof r.y === 'number' && !isNaN(r.x) && !isNaN(r.y) && isFinite(r.x) && isFinite(r.y))
  );

  return [...validGens, ...validRooms];
}

/**
 * Seleciona o próximo alvo de patrulha do Assassino:
 * - Foca prioritariamente nos geradores incompletos (75% de chance se houver geradores ativos).
 * - Caso contrário ou nos 25% restantes, inspeciona um cômodo principal.
 * - Garante que nunca retorna alvo nulo ou inválido enquanto houver destinos cadastrados.
 */
export function choosePatrolTarget(
  incompleteGenerators: Array<{ name: string; x: number; y: number } | null | undefined>,
  majorRooms: PatrolTarget[] = MAJOR_FACILITY_ROOMS,
  rng: () => number = Math.random
): PatrolTarget | null {
  const destinations = buildValidPatrolDestinations(incompleteGenerators, majorRooms);
  if (destinations.length === 0) return null;

  const validGens = destinations.filter((d) => d.type === 'generator');
  const validRooms = destinations.filter((d) => d.type === 'room');

  // Prioridade alta para geradores incompletos/ativos (75% de chance)
  if (validGens.length > 0 && rng() < 0.75) {
    const idx = Math.floor(rng() * validGens.length);
    return validGens[idx];
  }

  // Cômodos principais
  if (validRooms.length > 0) {
    const idx = Math.floor(rng() * validRooms.length);
    return validRooms[idx];
  }

  return validGens[0] || null;
}
