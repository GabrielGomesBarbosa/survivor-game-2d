import { describe, it, expect } from 'vitest';
import { COLS, ROWS, TILE_SIZE } from '../src/config/constants';
import { wrapAngle, resolveAntiPushVelocity } from '../src/utils/gameLogic';

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
});
