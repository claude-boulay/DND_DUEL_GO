import { describe, expect, it } from 'vitest';
import { shuffle } from '../duelBoard';

describe('shuffle', () => {
  it('conserve tous les éléments (même multiset)', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffle(input);
    expect(result.slice().sort()).toEqual(input.slice().sort());
  });

  it("ne modifie pas le tableau d'origine", () => {
    const input = ['a', 'b', 'c'];
    shuffle(input);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('produit un ordre différent sur un grand tableau (non déterministe)', () => {
    const input = Array.from({ length: 50 }, (_, i) => `card-${i}`);
    const result = shuffle(input);
    expect(result).not.toEqual(input);
  });
});
