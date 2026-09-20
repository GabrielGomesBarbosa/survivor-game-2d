import { describe, it, expect } from 'vitest';
import {
  buildValidPatrolDestinations,
  choosePatrolTarget,
  MAJOR_FACILITY_ROOMS
} from '../src/utils/gameLogic';
import { GENERATOR_DEFS } from '../src/config/constants';

describe('Killer Patrol Target Selection (Anti-Regression)', () => {
  it('includes all valid existing generator positions in patrol destinations', () => {
    const incompleteGens = GENERATOR_DEFS.map((g) => ({ name: g.name, x: g.x, y: g.y }));
    const destinations = buildValidPatrolDestinations(incompleteGens, MAJOR_FACILITY_ROOMS);

    // Deve conter os 3 geradores
    GENERATOR_DEFS.forEach((gen) => {
      const found = destinations.find((d) => d.name === gen.name && d.x === gen.x && d.y === gen.y);
      expect(found).toBeDefined();
      expect(found?.type).toBe('generator');
    });

    // Deve conter também os cômodos principais
    MAJOR_FACILITY_ROOMS.forEach((room) => {
      const found = destinations.find((d) => d.name === room.name);
      expect(found).toBeDefined();
      expect(found?.type).toBe('room');
    });
  });

  it('strictly filters out null, undefined or malformed candidate targets', () => {
    const dirtyCandidates = [
      null,
      undefined,
      { name: 'Invalid NaN', x: NaN, y: 100 },
      { name: 'Invalid Null Y', x: 200, y: null as any },
      { name: 'Invalid Infinity', x: Infinity, y: 500 },
      { name: 'Gerador A', x: 2240, y: 960 }
    ];

    const destinations = buildValidPatrolDestinations(dirtyCandidates, MAJOR_FACILITY_ROOMS);

    // Garante que nenhum elemento é nulo ou indefinido
    destinations.forEach((dest) => {
      expect(dest).not.toBeNull();
      expect(dest).not.toBeUndefined();
      expect(typeof dest.x).toBe('number');
      expect(typeof dest.y).toBe('number');
      expect(Number.isFinite(dest.x)).toBe(true);
      expect(Number.isFinite(dest.y)).toBe(true);
    });

    // Apenas o gerador válido deve estar presente entre os geradores
    const genDestinations = destinations.filter((d) => d.type === 'generator');
    expect(genDestinations).toHaveLength(1);
    expect(genDestinations[0].name).toBe('Gerador A');
  });

  it('prioritizes incomplete generators over empty areas during selection', () => {
    const incompleteGens = [
      { name: 'Gerador A', x: 2240, y: 960 },
      { name: 'Gerador B', x: 320, y: 960 }
    ];

    // Com determinismo simulando rng < 0.75 (alta probabilidade de focar gerador)
    const mockRngGenerator = () => 0.2;
    const selected = choosePatrolTarget(incompleteGens, MAJOR_FACILITY_ROOMS, mockRngGenerator);

    expect(selected).not.toBeNull();
    expect(selected?.type).toBe('generator');
    expect(['Gerador A', 'Gerador B']).toContain(selected?.name);
  });

  it('falls back safely to major rooms when all generators are completed', () => {
    const incompleteGens: Array<{ name: string; x: number; y: number }> = [];
    const selected = choosePatrolTarget(incompleteGens, MAJOR_FACILITY_ROOMS);

    expect(selected).not.toBeNull();
    expect(selected?.type).toBe('room');
    expect(MAJOR_FACILITY_ROOMS.map((r) => r.name)).toContain(selected?.name);
  });
});
