import { describe, expect, it } from 'vitest';
import { consumeHaggle, getHaggle, recordHaggle, updateHaggleRoll } from '../haggleStore';

// Store singleton en mémoire : chaque test utilise des identifiants uniques
// pour rester isolé sans dépendre d'un reset entre les tests.
let counter = 0;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

describe('haggleStore', () => {
  it('enregistre une négociation, calcule total/success, et la restitue via getHaggle', () => {
    const haggle = recordHaggle({
      merchantId: uniqueId('merchant'),
      itemId: uniqueId('item'),
      characterId: uniqueId('char'),
      modifier: 5,
      discountPercent: 20,
      dc: 15,
      roll: 12,
    });

    expect(haggle.haggleId).toBeTruthy();
    expect(haggle.total).toBe(17);
    expect(haggle.success).toBe(true);
    expect(getHaggle(haggle.haggleId)).toEqual(haggle);
  });

  it('success est faux quand total < dc', () => {
    const haggle = recordHaggle({
      merchantId: uniqueId('merchant'),
      itemId: uniqueId('item'),
      characterId: uniqueId('char'),
      modifier: -2,
      discountPercent: 30,
      dc: 15,
      roll: 10,
    });
    expect(haggle.total).toBe(8);
    expect(haggle.success).toBe(false);
  });

  it('renvoie undefined pour un haggleId inconnu', () => {
    expect(getHaggle('haggle-inexistant')).toBeUndefined();
  });

  it('updateHaggleRoll (reroll) remplace le jet et recalcule total/success', () => {
    const haggle = recordHaggle({
      merchantId: uniqueId('merchant'),
      itemId: uniqueId('item'),
      characterId: uniqueId('char'),
      modifier: 0,
      discountPercent: 10,
      dc: 15,
      roll: 3, // échec
    });
    expect(haggle.success).toBe(false);

    const updated = updateHaggleRoll(haggle.haggleId, 18); // réussite après reroll
    expect(updated?.roll).toBe(18);
    expect(updated?.total).toBe(18);
    expect(updated?.success).toBe(true);
    expect(getHaggle(haggle.haggleId)?.success).toBe(true);
  });

  it("updateHaggleRoll sur un haggleId inconnu renvoie undefined sans lever d'erreur", () => {
    expect(() => updateHaggleRoll('haggle-inexistant', 20)).not.toThrow();
    expect(updateHaggleRoll('haggle-inexistant', 20)).toBeUndefined();
  });

  it('consumeHaggle retire la négociation du store', () => {
    const haggle = recordHaggle({
      merchantId: uniqueId('merchant'),
      itemId: uniqueId('item'),
      characterId: uniqueId('char'),
      modifier: 0,
      discountPercent: 10,
      dc: 15,
      roll: 20,
    });
    consumeHaggle(haggle.haggleId);
    expect(getHaggle(haggle.haggleId)).toBeUndefined();
  });
});
