import { describe, expect, it } from 'vitest';
import { abilityModifier } from '../abilityScore';

describe('abilityModifier (formule D&D standard : floor((valeur - 10) / 2))', () => {
  it('vaut 0 pour une valeur de 10 ou 11 (arrondi vers le bas)', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
  });

  it('est positif au-dessus de 10', () => {
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(21)).toBe(5);
  });

  it('est négatif en dessous de 10', () => {
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(9)).toBe(-1);
  });

  it("n'est pas plafonné : accepte une valeur effective non entière (bonus de niveau)", () => {
    expect(abilityModifier(10.5)).toBe(0);
    expect(abilityModifier(11.5)).toBe(0);
  });
});
