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
