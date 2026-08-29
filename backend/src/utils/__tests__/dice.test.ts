import { describe, expect, it } from 'vitest';
import { rollDie } from '../dice';

describe('rollDie', () => {
  it('reste toujours dans les bornes [1, sides]', () => {
    for (let i = 0; i < 500; i += 1) {
      const result = rollDie(20);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(20);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('gère les dés à 2 faces (bornes extrêmes uniquement)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const result = rollDie(2);
      expect([1, 2]).toContain(result);
      seen.add(result);
    }
    // Sur 200 lancers d'un d2, les deux faces doivent apparaître au moins une fois.
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });

  it('respecte des faces plus grandes (d100)', () => {
    for (let i = 0; i < 100; i += 1) {
      const result = rollDie(100);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(100);
    }
  });
});
