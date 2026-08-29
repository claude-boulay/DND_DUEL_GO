import { randomInt } from 'node:crypto';
import type { CardDocument } from '../models/Card.model';

// Convention standard OCG/TCG ; pas encore paramétrable par set.
export const BOOSTER_PACK_SIZE = 9;

/**
 * Poids de tirage par rareté. CLAUDE.md ne fournit pas de table : reprise
 * d'une hiérarchie de rareté Yu-Gi-Oh standard, du plus courant au plus rare.
 * Recherche par sous-chaîne car les libellés YGOPRODeck varient selon
 * l'édition ("Ultra Rare", "Quarter Century Secret Rare", ...). L'ordre
 * compte : les raretés composées doivent être testées avant leur racine
 * générique (ex. "secret" avant "rare").
 */
const RARITY_WEIGHTS: Array<[needle: string, weight: number]> = [
  ['starlight', 0.5],
  ['quarter century', 0.5],
  ['prismatic secret', 0.5],
  ["collector's", 0.5],
  ['platinum secret', 0.5],
  ['ghost', 1.5],
  ['ultimate', 2],
  ['secret', 3],
  ['ultra', 5],
  ['super', 10],
  ['short print', 40],
  ['rare', 25],
  ['common', 100],
];

const DEFAULT_WEIGHT = 10;

export function rarityWeight(rarityLabel: string): number {
  const lower = rarityLabel.toLowerCase();
  for (const [needle, weight] of RARITY_WEIGHTS) {
    if (lower.includes(needle)) return weight;
  }
  return DEFAULT_WEIGHT;
}

export function rarityForSet(card: CardDocument, setName: string): string {
  return card.card_sets.find((s) => s.set_name === setName)?.set_rarity ?? '';
}

/**
 * Seuil pour la "grande révélation" (agrandissement + brillance) côté front :
 * Super Rare (poids 10) et tout ce qui est plus rare (Ultra, Secret,
 * Ultimate, Ghost, Starlight...). Réutilise la même hiérarchie que le tirage
 * pondéré, pour ne pas dupliquer une seconde liste de raretés.
 */
export function isRareReveal(rarityLabel: string): boolean {
  return rarityWeight(rarityLabel) <= 10;
}

/** Tirage pondéré avec remise (une même carte peut sortir plusieurs fois dans un booster). */
function drawWeighted<T>(pool: { item: T; weight: number }[], count: number): T[] {
  const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0 || pool.length === 0) return [];

  const scale = 1000;
  const scaledTotal = Math.round(totalWeight * scale);
  const drawn: T[] = [];

  for (let i = 0; i < count; i += 1) {
    let roll = randomInt(0, scaledTotal);
    for (const entry of pool) {
      roll -= Math.round(entry.weight * scale);
      if (roll < 0) {
        drawn.push(entry.item);
        break;
      }
    }
  }
  return drawn;
}

export function drawBoosterPack(pool: CardDocument[], setName: string): CardDocument[] {
  const weighted = pool.map((card) => ({ item: card, weight: rarityWeight(rarityForSet(card, setName)) }));
  return drawWeighted(weighted, BOOSTER_PACK_SIZE);
}
