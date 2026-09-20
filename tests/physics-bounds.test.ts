import { describe, it, expect } from 'vitest';
import { COLS, ROWS, TILE_SIZE } from '../src/config/constants';
import {
  wrapAngle,
  resolveAntiPushVelocity,
  resolveSolidBodyCollision,
  calculateEffectiveSpeed,
  evaluatePlayerMovementState
} from '../src/utils/gameLogic';

describe('Physics & Navigation Bounds Logic (Pure Rules)', () => {
  it('correctly wraps angles into [-PI, PI] without discontinuity', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(2 * Math.PI)).toBeCloseTo(0);
  });

  it('cancels killer approach velocity towards player on collision without pushing player', () => {
    // Player at (100, 100), Killer at (100, 80) moving down (+Y) at 150 px/s
    const playerVel = { x: 0, y: 0 };
    const killerVel = { x: 0, y: 150 };
    const dx = 0; // killer.x - player.x = 0
    const dy = -20; // killer.y - player.y = -20 (normal points from player to killer)

    const resolved = resolveAntiPushVelocity(killerVel, playerVel, dx, dy);

    // Killer downward approach velocity towards player is cancelled to 0
    expect(resolved.killerVel.y).toBeCloseTo(0);
    expect(resolved.killerVel.x).toBe(0);

    // Player remains stationary, not pushed
    expect(resolved.playerVel.x).toBe(0);
    expect(resolved.playerVel.y).toBe(0);
  });

  it('strictly enforces solid body non-penetration: separates overlapping bodies to distance >= sum of radii', () => {
    // Player radius: 66.25, Killer radius: 84.8 -> minDistance = 151.05
    const player = { x: 100, y: 100, radius: 66.25, vx: 0, vy: 0 };
    const killer = { x: 100, y: 80, radius: 84.8, vx: 0, vy: 150 }; // distance = 20px (overlap = 131.05px)

    const res = resolveSolidBodyCollision(killer, player);

    expect(res.hasCollision).toBe(true);
    expect(res.overlap).toBeCloseTo(131.05, 1);
    expect(res.minDistance).toBeCloseTo(151.05, 1);

    // Distance between resolved positions MUST be >= minDistance
    const finalDist = Math.hypot(res.killerPos.x - res.playerPos.x, res.killerPos.y - res.playerPos.y);
    expect(finalDist).toBeGreaterThanOrEqual(res.minDistance - 0.001);
    expect(finalDist).toBeCloseTo(151.05, 1);

    // Approach velocity along normal must be cancelled to 0
    expect(res.killerVel.y).toBeCloseTo(0);
  });

  it('preserves positions and velocities when bodies do not overlap (distance >= sum of radii)', () => {
    const player = { x: 100, y: 100, radius: 66.25, vx: 10, vy: 10 };
    const killer = { x: 100, y: 300, radius: 84.8, vx: 0, vy: -50 }; // distance = 200px > 151.05px

    const res = resolveSolidBodyCollision(killer, player);

    expect(res.hasCollision).toBe(false);
    expect(res.overlap).toBe(0);
    expect(res.killerPos.x).toBe(100);
    expect(res.killerPos.y).toBe(300);
    expect(res.playerPos.x).toBe(100);
    expect(res.playerPos.y).toBe(100);
    expect(res.killerVel.y).toBe(-50);
    expect(res.playerVel.x).toBe(10);
  });

  it('displaces player when killer is blocked against a solid wall', () => {
    const player = { x: 100, y: 100, radius: 66.25, vx: 0, vy: 0 };
    const killer = { x: 100, y: 80, radius: 84.8, vx: 0, vy: 150 };

    // Simula que a posição para onde o killer seria empurrado (y < 80) é parede sólida
    const isWalkable = (_x: number, y: number) => y >= 80;

    const res = resolveSolidBodyCollision(killer, player, isWalkable);

    expect(res.hasCollision).toBe(true);
    // Player é empurrado para frente para liberar espaço
    const finalDist = Math.hypot(res.killerPos.x - res.playerPos.x, res.killerPos.y - res.playerPos.y);
    expect(finalDist).toBeGreaterThanOrEqual(res.minDistance - 0.001);
  });

  it('allows killer to slide tangentially without sticking', () => {
    // Killer moving diagonally down-right (vx: 100, vy: 100) towards player who is straight below (dx: 0, dy: -20)
    const playerVel = { x: 0, y: 0 };
    const killerVel = { x: 100, y: 100 };
    const dx = 0;
    const dy = -20;

    const resolved = resolveAntiPushVelocity(killerVel, playerVel, dx, dy);

    // Approach velocity (vy) is cancelled to 0, but tangential velocity (vx) is preserved
    expect(resolved.killerVel.y).toBeCloseTo(0);
    expect(resolved.killerVel.x).toBeCloseTo(100);
  });

  it('maps world coordinates to correct tile indices within boundaries', () => {
    const worldX = 1280;
    const worldY = 960;
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);

    expect(col).toBe(20);
    expect(row).toBe(15);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(COLS);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(ROWS);
  });

  it('evaluates movement state to idle and 0 speed under frontal wall collision with zero displacement', () => {
    // Jogador pressionando W (moveY = -1), colidindo frontalmente com parede superior (blocked.up = true, displacement = 0)
    const isInputMoving = true;
    const isSprinting = false;
    const effectiveSpeed = 0;
    const blocked = { up: true, down: false, left: false, right: false };
    const inputDir = { x: 0, y: -1 };

    const result = evaluatePlayerMovementState(
      isInputMoving,
      isSprinting,
      effectiveSpeed,
      5,
      blocked,
      inputDir
    );

    expect(result.animState).toBe('idle');
    expect(result.isMoving).toBe(false);
    expect(result.actualSpeed).toBe(0);
  });

  it('evaluates movement state to idle even when sprinting into a wall with zero displacement', () => {
    const result = evaluatePlayerMovementState(
      true,
      true,
      0,
      5,
      { left: true, right: false, up: false, down: false },
      { x: -1, y: 0 }
    );

    expect(result.animState).toBe('idle');
    expect(result.isMoving).toBe(false);
    expect(result.actualSpeed).toBe(0);
  });

  it('preserves walking and running animation when strafing along a wall with positive displacement', () => {
    // Jogador pressionando W + D contra parede superior (W bloqueado, D livre com deslocamento horizontal)
    const blocked = { up: true, down: false, left: false, right: false };
    const inputDir = { x: 1, y: -1 };
    const effectiveSpeed = 99; // Deslocamento real na horizontal

    const walkResult = evaluatePlayerMovementState(true, false, effectiveSpeed, 5, blocked, inputDir);
    expect(walkResult.animState).toBe('walk');
    expect(walkResult.isMoving).toBe(true);
    expect(walkResult.actualSpeed).toBe(99);

    const runResult = evaluatePlayerMovementState(true, true, effectiveSpeed, 5, blocked, inputDir);
    expect(runResult.animState).toBe('run');
    expect(runResult.isMoving).toBe(true);
    expect(runResult.actualSpeed).toBe(99);
  });

  it('correctly computes effective speed from delta position and delta time', () => {
    // 2.333px em 16.666ms -> ~140 px/s
    const speed = calculateEffectiveSpeed(2.333, 0, 16.666);
    expect(speed).toBeCloseTo(140, 0);

    // Deslocamento zero -> 0 px/s
    expect(calculateEffectiveSpeed(0, 0, 16.666)).toBe(0);

    // Delta time zero ou negativo -> 0 px/s
    expect(calculateEffectiveSpeed(5, 5, 0)).toBe(0);
  });
});
