import { describe, expect, it } from 'vitest';
import { earliestPrintRarity, sellPriceForRarity } from '../cardSellPrice';
import type { CardDocument } from '../../models/Card.model';

function fakeCard(cardSets: Array<{ set_name: string; set_rarity: string }>): CardDocument {
  return {
    card_sets: cardSets.map((s) => ({ set_name: s.set_name, set_code: 'TST-001', set_rarity: s.set_rarity, set_rarity_code: '', set_price: '0' })),
  } as unknown as CardDocument;
}

describe('sellPriceForRarity', () => {
  it('associe les 5 paliers de rareté demandés par l\'utilisateur', () => {
    expect(sellPriceForRarity('Common')).toBe(1);
    expect(sellPriceForRarity('Rare')).toBe(5);
    expect(sellPriceForRarity('Super Rare')).toBe(10);
    expect(sellPriceForRarity('Ultra Rare')).toBe(20);
    expect(sellPriceForRarity('Secret Rare')).toBe(50);
    expect(sellPriceForRarity('Ultimate Rare')).toBe(50);
    expect(sellPriceForRarity('Ghost Rare')).toBe(50);
    expect(sellPriceForRarity('Starlight Rare')).toBe(50);
  });

  it("priorise les raretés composées sur leur racine générique ('Rare')", () => {
    expect(sellPriceForRarity('Quarter Century Secret Rare')).toBe(50);
    expect(sellPriceForRarity('Prismatic Secret Rare')).toBe(50);
    expect(sellPriceForRarity("Collector's Rare")).toBe(50);
    expect(sellPriceForRarity('Platinum Secret Rare')).toBe(50);
  });

  it('ignore la casse', () => {
    expect(sellPriceForRarity('COMMON')).toBe(1);
    expect(sellPriceForRarity('ultra rare')).toBe(20);
  });

  it('retombe sur le prix Commune (1) pour une rareté inconnue ou absente', () => {
    // Ne doit recouper aucune sous-chaîne connue (attention : ne pas utiliser
    // un mot contenant "rare", comme "Rareté" — même piège que boosterOpening.test.ts).
    expect(sellPriceForRarity('Mystery Tier')).toBe(1);
    expect(sellPriceForRarity(null)).toBe(1);
    expect(sellPriceForRarity('')).toBe(1);
  });
});

describe('earliestPrintRarity', () => {
  it('retient la rareté du set dont la date est la plus ancienne', () => {
    const card = fakeCard([
      { set_name: 'Reprint Set', set_rarity: 'Ultra Rare' },
      { set_name: 'Original Set', set_rarity: 'Common' },
    ]);
    const tcgDateBySetName = new Map([
      ['Reprint Set', '2023-01-01'],
      ['Original Set', '2002-03-08'],
    ]);
    expect(earliestPrintRarity(card, tcgDateBySetName)).toBe('Common');
  });

  it("retombe sur la première entrée si aucune date n'est connue", () => {
    const card = fakeCard([
      { set_name: 'Unknown Date Set', set_rarity: 'Super Rare' },
      { set_name: 'Also Unknown', set_rarity: 'Common' },
    ]);
    expect(earliestPrintRarity(card, new Map())).toBe('Super Rare');
  });

  it("renvoie null si la carte n'a aucun set référencé (custom jamais lié à un booster)", () => {
    const card = fakeCard([]);
    expect(earliestPrintRarity(card, new Map())).toBeNull();
  });

  it('ignore les sets sans date connue au profit de ceux qui en ont une', () => {
    const card = fakeCard([
      { set_name: 'No Date', set_rarity: 'Secret Rare' },
      { set_name: 'Has Date', set_rarity: 'Rare' },
    ]);
    const tcgDateBySetName = new Map([['Has Date', '2010-06-17']]);
    expect(earliestPrintRarity(card, tcgDateBySetName)).toBe('Rare');
  });
});
