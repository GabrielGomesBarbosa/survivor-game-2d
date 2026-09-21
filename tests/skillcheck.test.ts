import { describe, it, expect } from 'vitest';
import { evaluateSkillCheckHit } from '../src/utils/gameLogic';

describe('SkillCheckSystem - evaluateSkillCheckHit', () => {
  const zoneStart = 120;
  const zoneSize = 44;
  const greatSize = 12;

  it('returns GREAT when needle hits within great zone', () => {
    // Great zone is [120, 132]
    expect(evaluateSkillCheckHit(120, zoneStart, zoneSize, greatSize)).toBe('GREAT');
    expect(evaluateSkillCheckHit(125, zoneStart, zoneSize, greatSize)).toBe('GREAT');
    expect(evaluateSkillCheckHit(132, zoneStart, zoneSize, greatSize)).toBe('GREAT');
  });

  it('returns GOOD when needle hits within good zone beyond great zone', () => {
    // Good zone is (132, 164]
    expect(evaluateSkillCheckHit(132.1, zoneStart, zoneSize, greatSize)).toBe('GOOD');
    expect(evaluateSkillCheckHit(145, zoneStart, zoneSize, greatSize)).toBe('GOOD');
    expect(evaluateSkillCheckHit(164, zoneStart, zoneSize, greatSize)).toBe('GOOD');
  });

  it('returns FAIL when needle is pressed too early', () => {
    expect(evaluateSkillCheckHit(119.9, zoneStart, zoneSize, greatSize)).toBe('FAIL');
    expect(evaluateSkillCheckHit(0, zoneStart, zoneSize, greatSize)).toBe('FAIL');
    expect(evaluateSkillCheckHit(90, zoneStart, zoneSize, greatSize)).toBe('FAIL');
  });

  it('returns FAIL when needle is pressed too late', () => {
    expect(evaluateSkillCheckHit(164.1, zoneStart, zoneSize, greatSize)).toBe('FAIL');
    expect(evaluateSkillCheckHit(180, zoneStart, zoneSize, greatSize)).toBe('FAIL');
    expect(evaluateSkillCheckHit(350, zoneStart, zoneSize, greatSize)).toBe('FAIL');
  });
});

