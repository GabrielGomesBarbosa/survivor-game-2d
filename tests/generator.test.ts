import { describe, it, expect } from 'vitest';
import {
  addGeneratorProgress,
  applyExplosionPenalty,
  GENERATOR_HITBOX_WIDTH,
  GENERATOR_HITBOX_HEIGHT,
  GENERATOR_HITBOX_OFFSET_Y,
  GENERATOR_INTERACTION_RADIUS,
  getGeneratorHitboxBounds,
  isWithinGeneratorInteractionRange,
  getGeneratorContactPosition
} from '../src/utils/gameLogic';

describe('Generator Repair & Explosion Logic (Pure Rules)', () => {
  it('starts incomplete with 0% progress', () => {
    const result = addGeneratorProgress(0, 0);
    expect(result.progress).toBe(0);
    expect(result.isCompleted).toBe(false);
  });

  it('accumulates repair progress correctly', () => {
    const result = addGeneratorProgress(0, 25);
    expect(result.progress).toBe(25);
    expect(result.isCompleted).toBe(false);

    const step2 = addGeneratorProgress(result.progress, 30);
    expect(step2.progress).toBe(55);
    expect(step2.isCompleted).toBe(false);
  });

  it('caps progress at 100% and triggers completion', () => {
    const result = addGeneratorProgress(90, 20);
    expect(result.progress).toBe(100);
    expect(result.isCompleted).toBe(true);
  });

  it('does not accept further progress once completed at 100%', () => {
    const result = addGeneratorProgress(100, 15);
    expect(result.progress).toBe(100);
    expect(result.isCompleted).toBe(true);
  });

  it('applies -10% explosion penalty on failed skill check without dropping below 0%', () => {
    let progress = 25;
    progress = applyExplosionPenalty(progress, 10);
    expect(progress).toBe(15);

    progress = applyExplosionPenalty(progress, 10);
    expect(progress).toBe(5);

    progress = applyExplosionPenalty(progress, 10);
    expect(progress).toBe(0); // clamped at 0
  });
});

describe('Generator Hitbox Dimensions & Physical Constraints (50x112px)', () => {
  it('strictly defines the solid block dimensions as 50px width and 112px height with -4px Y offset', () => {
    expect(GENERATOR_HITBOX_WIDTH).toBe(50);
    expect(GENERATOR_HITBOX_HEIGHT).toBe(112);
    expect(GENERATOR_HITBOX_OFFSET_Y).toBe(-4);
    expect(GENERATOR_INTERACTION_RADIUS).toBe(130);

    const bounds = getGeneratorHitboxBounds(1000, 1000);
    expect(bounds.width).toBe(50);
    expect(bounds.height).toBe(112);
    expect(bounds.centerX).toBe(1000);
    expect(bounds.centerY).toBe(996);
    expect(bounds.left).toBe(975);
    expect(bounds.right).toBe(1025);
    expect(bounds.top).toBe(940);
    expect(bounds.bottom).toBe(1052);
  });
});

describe('Generator 4-Cardinal Interaction Range Verification', () => {
  const genPos = { x: 1000, y: 1000 };
  const playerRadius = 66.25; // 53px * 1.25 scale

  it('allows interaction when contacting from East (distance ~91.3px <= 130px)', () => {
    const contact = getGeneratorContactPosition(genPos.x, genPos.y, 'east', playerRadius);
    const dist = Math.hypot(contact.x - genPos.x, contact.y - genPos.y);

    expect(contact.x).toBe(1091.25);
    expect(contact.y).toBe(996);
    expect(dist).toBeGreaterThanOrEqual(90);
    expect(dist).toBeLessThanOrEqual(95);
    expect(dist).toBeLessThanOrEqual(GENERATOR_INTERACTION_RADIUS);
    expect(isWithinGeneratorInteractionRange(contact, genPos)).toBe(true);
  });

  it('allows interaction when contacting from West (distance ~91.3px <= 130px)', () => {
    const contact = getGeneratorContactPosition(genPos.x, genPos.y, 'west', playerRadius);
    const dist = Math.hypot(contact.x - genPos.x, contact.y - genPos.y);

    expect(contact.x).toBe(908.75);
    expect(contact.y).toBe(996);
    expect(dist).toBeGreaterThanOrEqual(90);
    expect(dist).toBeLessThanOrEqual(95);
    expect(dist).toBeLessThanOrEqual(GENERATOR_INTERACTION_RADIUS);
    expect(isWithinGeneratorInteractionRange(contact, genPos)).toBe(true);
  });

  it('allows interaction when contacting from South (distance ~118.25px <= 130px)', () => {
    const contact = getGeneratorContactPosition(genPos.x, genPos.y, 'south', playerRadius);
    const dist = Math.hypot(contact.x - genPos.x, contact.y - genPos.y);

    expect(contact.x).toBe(1000);
    expect(contact.y).toBe(1118.25);
    expect(dist).toBeGreaterThanOrEqual(115);
    expect(dist).toBeLessThanOrEqual(120);
    expect(dist).toBeLessThanOrEqual(GENERATOR_INTERACTION_RADIUS);
    expect(isWithinGeneratorInteractionRange(contact, genPos)).toBe(true);
  });

  it('allows interaction when contacting from North (distance ~126.25px <= 130px)', () => {
    const contact = getGeneratorContactPosition(genPos.x, genPos.y, 'north', playerRadius);
    const dist = Math.hypot(contact.x - genPos.x, contact.y - genPos.y);

    expect(contact.x).toBe(1000);
    expect(contact.y).toBe(873.75);
    expect(dist).toBeGreaterThanOrEqual(125);
    expect(dist).toBeLessThanOrEqual(127);
    expect(dist).toBeLessThanOrEqual(GENERATOR_INTERACTION_RADIUS);
    expect(isWithinGeneratorInteractionRange(contact, genPos)).toBe(true);
  });

  it('strictly rejects interaction when the player is outside 130px interaction radius', () => {
    // Exatamente na borda de 130px
    expect(isWithinGeneratorInteractionRange({ x: 1000 + 130, y: 1000 }, genPos)).toBe(true);
    // 0.5px além do limite
    expect(isWithinGeneratorInteractionRange({ x: 1000 + 130.5, y: 1000 }, genPos)).toBe(false);
    // Distâncias maiores
    expect(isWithinGeneratorInteractionRange({ x: 1000 + 140, y: 1000 }, genPos)).toBe(false);
    expect(isWithinGeneratorInteractionRange({ x: 1000, y: 1000 - 131 }, genPos)).toBe(false);
    expect(isWithinGeneratorInteractionRange({ x: 1200, y: 1200 }, genPos)).toBe(false);
  });

  it('ensures stand-off waypoints for Killer patrol remain outside the solid body and inside the 130px zone', () => {
    const standOffDist = 72;
    const bounds = getGeneratorHitboxBounds(genPos.x, genPos.y);
    const northPt = { x: genPos.x, y: genPos.y - standOffDist };
    const southPt = { x: genPos.x, y: genPos.y + standOffDist };
    const eastPt = { x: genPos.x + standOffDist, y: genPos.y };
    const westPt = { x: genPos.x - standOffDist, y: genPos.y };

    [northPt, southPt, eastPt, westPt].forEach((pt) => {
      // Deve estar dentro da zona de 130px
      expect(isWithinGeneratorInteractionRange(pt, genPos)).toBe(true);

      // Deve estar estritamente fora do colisor retangular
      const insideX = pt.x >= bounds.left && pt.x <= bounds.right;
      const insideY = pt.y >= bounds.top && pt.y <= bounds.bottom;
      expect(insideX && insideY).toBe(false);
    });
  });
});

