import { describe, it, expect } from 'vitest';
import { addGeneratorProgress, applyExplosionPenalty } from '../src/utils/gameLogic';

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
