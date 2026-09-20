/**
 * @file gameLogic.ts
 * @description Pure decoupled game logic functions free of Phaser or DOM dependencies.
 * Designed for 100% deterministic unit testing with Vitest.
 */

export type SkillCheckRating = 'GREAT' | 'GOOD' | 'FAIL';

/**
 * Pure evaluation of DBD Skill Check timing based on circular dial angles.
 * @param angle Current needle angle in degrees.
 * @param zoneStart Starting angle of success zone in degrees.
 * @param zoneSize Total width of success zone (Good Zone).
 * @param greatSize Width of bonus section at start of zone (Great Zone).
 * @returns 'GREAT' (+5%), 'GOOD' (+1.5%), or 'FAIL'
 */
export function evaluateSkillCheckHit(
  angle: number,
  zoneStart: number,
  zoneSize: number,
  greatSize: number
): SkillCheckRating {
  const greatEnd = zoneStart + greatSize;
  const goodEnd = zoneStart + zoneSize;

  if (angle >= zoneStart && angle <= greatEnd) {
    return 'GREAT';
  } else if (angle > greatEnd && angle <= goodEnd) {
    return 'GOOD';
  }
  return 'FAIL';
}

/**
 * Normalizes an angle into [-PI, PI] range, eliminating 2PI boundary spin locks.
 * @param angle Radian angle
 * @returns Normalized angle in radians between -PI and PI
 */
export function wrapAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) {
    wrapped -= Math.PI * 2;
  } else if (wrapped < -Math.PI) {
    wrapped += Math.PI * 2;
  }
  return wrapped;
}

/**
 * Pure calculation of generator progress addition.
 * @param current Current progress percentage (0 - 100).
 * @param addAmount Amount of percentage to add.
 * @returns Clamped progress and whether the generator just completed.
 */
export function addGeneratorProgress(
  current: number,
  addAmount: number
): { progress: number; isCompleted: boolean } {
  if (current >= 100) {
    return { progress: 100, isCompleted: true };
  }
  const next = Math.min(100, current + addAmount);
  return {
    progress: next,
    isCompleted: next >= 100
  };
}

/**
 * Computes generator explosion progress penalty.
 * @param current Current progress (0 - 100).
 * @param penalty Percentage to deduct (default 10%).
 * @returns Resulting clamped progress percentage (>= 0).
 */
export function applyExplosionPenalty(current: number, penalty: number = 10): number {
  return Math.max(0, current - penalty);
}

/**
 * Pure anti-push velocity cancellation:
 * Eliminates approach velocity between Killer and Player along collision normal
 * without pushing the Player into solid walls.
 * @param killerVel Velocity vector { x, y } of killer.
 * @param playerVel Velocity vector { x, y } of player.
 * @param dx Difference x (killer.x - player.x).
 * @param dy Difference y (killer.y - player.y).
 */
export function resolveAntiPushVelocity(
  killerVel: { x: number; y: number },
  playerVel: { x: number; y: number },
  dx: number,
  dy: number
): { killerVel: { x: number; y: number }; playerVel: { x: number; y: number } } {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 0.001) {
    return { killerVel: { ...killerVel }, playerVel: { ...playerVel } };
  }

  // Normal points from player to killer
  const nx = dx / dist;
  const ny = dy / dist;

  const kVel = { ...killerVel };
  const pVel = { ...playerVel };

  // Approach vector from killer towards player is (-nx, -ny)
  const kSpeedTowards = kVel.x * (-nx) + kVel.y * (-ny);
  if (kSpeedTowards > 0) {
    kVel.x -= (-nx) * kSpeedTowards;
    kVel.y -= (-ny) * kSpeedTowards;
  }

  // Approach vector from player towards killer is (nx, ny)
  const pSpeedTowards = pVel.x * nx + pVel.y * ny;
  if (pSpeedTowards > 0) {
    pVel.x -= nx * pSpeedTowards;
    pVel.y -= ny * pSpeedTowards;
  }

  return { killerVel: kVel, playerVel: pVel };
}

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
  { name: 'Recepção Central', x: 1280, y: 960, type: 'room' },
  { name: 'Ala de Contenção (Norte)', x: 1280, y: 224, type: 'room' },
  { name: 'Ala Leste (Usina)', x: 2240, y: 960, type: 'room' },
  { name: 'Ala Oeste (Enfermaria)', x: 320, y: 960, type: 'room' },
  { name: 'Ala Sul (Manutenção)', x: 1280, y: 1680, type: 'room' }
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

