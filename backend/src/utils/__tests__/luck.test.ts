import { describe, expect, it } from 'vitest';
import { effectiveStat, maxLuckRerolls } from '../luck';

describe('effectiveStat', () => {
  it("n'ajoute aucun bonus au niveau 1", () => {
    expect(effectiveStat(10, 1)).toBe(10);
  });

  it('ajoute +0.5 par niveau au-delà du niveau 1', () => {
    expect(effectiveStat(10, 3)).toBe(11); // +0.5 * 2 niveaux
    expect(effectiveStat(20, 5)).toBe(22); // +0.5 * 4 niveaux
  });
});

describe('maxLuckRerolls (CLAUDE.md §3.3 : floor(max(0, (Chance effective - 10) / 2)))', () => {
  it('vaut 0 en dessous du seuil de 10', () => {
    expect(maxLuckRerolls(8, 1)).toBe(0);
  });

  it('ne devient jamais négatif même très en dessous du seuil', () => {
    expect(maxLuckRerolls(1, 1)).toBe(0);
  });

  it('vaut 0 exactement au seuil (10)', () => {
    expect(maxLuckRerolls(10, 1)).toBe(0);
  });

  it('arrondit vers le bas entre deux paliers', () => {
    expect(maxLuckRerolls(11, 1)).toBe(0); // (11-10)/2 = 0.5 -> floor 0
    expect(maxLuckRerolls(12, 1)).toBe(1); // (12-10)/2 = 1
  });

  it('vaut 5 pour une Chance de 20 au niveau 1', () => {
    expect(maxLuckRerolls(20, 1)).toBe(5);
  });

  it('prend en compte le bonus de niveau dans le calcul', () => {
    // Chance 8, niveau 5 -> effective = 8 + 4*0.5 = 10 -> toujours 0 reroll.
    expect(maxLuckRerolls(8, 5)).toBe(0);
    // Chance 8, niveau 9 -> effective = 8 + 8*0.5 = 12 -> 1 reroll.
    expect(maxLuckRerolls(8, 9)).toBe(1);
  });
});
