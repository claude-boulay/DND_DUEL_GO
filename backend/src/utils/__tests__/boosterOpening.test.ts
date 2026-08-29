import { describe, expect, it } from 'vitest';
import { BOOSTER_PACK_SIZE, drawBoosterPack, isRareReveal, rarityWeight } from '../boosterOpening';
import type { CardDocument } from '../../models/Card.model';

function fakeCard(name: string, setName: string, rarity: string): CardDocument {
  return {
    name,
    card_sets: [{ set_name: setName, set_code: 'TST-001', set_rarity: rarity, set_rarity_code: '', set_price: '0' }],
  } as unknown as CardDocument;
}

describe('rarityWeight', () => {
  it('associe les raretés courantes aux poids attendus', () => {
    expect(rarityWeight('Common')).toBe(100);
    expect(rarityWeight('Rare')).toBe(25);
    expect(rarityWeight('Super Rare')).toBe(10);
    expect(rarityWeight('Ultra Rare')).toBe(5);
    expect(rarityWeight('Secret Rare')).toBe(3);
    expect(rarityWeight('Ultimate Rare')).toBe(2);
    expect(rarityWeight('Ghost Rare')).toBe(1.5);
    expect(rarityWeight('Starlight Rare')).toBe(0.5);
  });

  it("priorise les raretés composées sur leur racine générique ('Rare')", () => {
    // Toutes contiennent "rare" en sous-chaîne : sans la priorité sur les
    // formes composées, elles retomberaient toutes à tort sur le poids de
    // "Rare" simple (25).
    expect(rarityWeight('Quarter Century Secret Rare')).toBe(0.5);
    expect(rarityWeight('Prismatic Secret Rare')).toBe(0.5);
    expect(rarityWeight("Collector's Rare")).toBe(0.5);
    expect(rarityWeight('Platinum Secret Rare')).toBe(0.5);
  });

  it('ignore la casse', () => {
    expect(rarityWeight('COMMON')).toBe(100);
    expect(rarityWeight('ultra rare')).toBe(5);
  });

  it('retombe sur un poids par défaut pour une rareté inconnue', () => {
    // Ne doit recouper aucune sous-chaîne de la table (attention : "rare" à
    // lui seul matcherait la règle générique "Rare").
    expect(rarityWeight('Alternate Foil XYZ')).toBe(10);
    expect(rarityWeight('')).toBe(10);
  });
});

describe('isRareReveal', () => {
  it('Super Rare et plus rare déclenchent la grande révélation', () => {
    expect(isRareReveal('Super Rare')).toBe(true);
    expect(isRareReveal('Ultra Rare')).toBe(true);
    expect(isRareReveal('Secret Rare')).toBe(true);
    expect(isRareReveal('Ultimate Rare')).toBe(true);
    expect(isRareReveal('Ghost Rare')).toBe(true);
    expect(isRareReveal('Starlight Rare')).toBe(true);
  });

  it('Common, Rare et Short Print restent une révélation normale', () => {
    expect(isRareReveal('Common')).toBe(false);
    expect(isRareReveal('Rare')).toBe(false);
    expect(isRareReveal('Short Print')).toBe(false);
  });
});

describe('drawBoosterPack', () => {
  const setName = 'Booster de Test';

  it("tire exactement BOOSTER_PACK_SIZE cartes quand le pool n'est pas vide", () => {
    const pool = [fakeCard('Carte A', setName, 'Common'), fakeCard('Carte B', setName, 'Rare')];
    const drawn = drawBoosterPack(pool, setName);
    expect(drawn).toHaveLength(BOOSTER_PACK_SIZE);
  });

  it('ne tire que des cartes appartenant au pool fourni', () => {
    const pool = [fakeCard('Carte A', setName, 'Common'), fakeCard('Carte B', setName, 'Rare')];
    const drawn = drawBoosterPack(pool, setName);
    for (const card of drawn) {
      expect(pool).toContain(card);
    }
  });

  it('renvoie un tableau vide si le pool est vide', () => {
    expect(drawBoosterPack([], setName)).toEqual([]);
  });

  it('favorise très largement les cartes communes sur les cartes ultra-rares (pondération par rareté)', () => {
    const common = fakeCard('Commune', setName, 'Common');
    const starlight = fakeCard('Starlight', setName, 'Starlight Rare');
    const pool = [common, starlight];

    let commonCount = 0;
    let starlightCount = 0;
    const packs = 300;
    for (let i = 0; i < packs; i += 1) {
      for (const card of drawBoosterPack(pool, setName)) {
        if (card === common) commonCount += 1;
        if (card === starlight) starlightCount += 1;
      }
    }

    // Poids 100 contre 0.5 (ratio 200:1) : sur ~2700 tirages, la carte commune
    // doit dominer très largement. Marge généreuse pour éviter la flakiness
    // tout en détectant une régression grossière de la pondération.
    expect(commonCount).toBeGreaterThan(starlightCount * 10);
  });
});
