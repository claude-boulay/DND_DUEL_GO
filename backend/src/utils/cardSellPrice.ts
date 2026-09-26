import type { CardDocument } from '../models/Card.model';

/**
 * Prix de rachat par le marchand (demande utilisateur), basé sur la rareté
 * de la PREMIÈRE édition connue de la carte — décidé avec l'utilisateur pour
 * éviter de devoir tracer précisément de quel booster/exemplaire vient
 * chaque copie en collection (`Character.collection` reste un simple
 * `string[]`, aucune migration de schéma). Toute carte est vendable au même
 * prix quelle que soit son origine réelle (booster, don du MJ, import CSV) —
 * décidé avec l'utilisateur, pas de distinction par source d'acquisition.
 * Recherche par sous-chaîne, même convention que `boosterOpening.ts`
 * `rarityWeight` : les raretés composées doivent être testées avant leur
 * racine générique (ex. "secret" avant "rare").
 */
const SELL_PRICE_BY_RARITY: Array<[needle: string, price: number]> = [
  ['starlight', 50],
  ['quarter century', 50],
  ['prismatic secret', 50],
  ["collector's", 50],
  ['platinum secret', 50],
  ['ghost', 50],
  ['ultimate', 50],
  ['secret', 50],
  ['ultra', 20],
  ['super', 10],
  ['rare', 5],
  ['common', 1],
];

/**
 * Repli Commune (1) si le libellé de rareté ne correspond à rien de connu,
 * ou si la carte n'a aucune rareté connue du tout (ex. carte custom jamais
 * liée à un booster) — décidé avec l'utilisateur : la valeur la plus basse,
 * pour qu'il n'y ait aucun intérêt à créer une carte custom non liée juste
 * pour en tirer un prix de rachat élevé.
 */
export function sellPriceForRarity(rarityLabel: string | null): number {
  if (!rarityLabel) return 1;
  const lower = rarityLabel.toLowerCase();
  for (const [needle, price] of SELL_PRICE_BY_RARITY) {
    if (lower.includes(needle)) return price;
  }
  return 1;
}

/**
 * Rareté de la toute PREMIÈRE édition connue de cette carte : elle peut
 * apparaître dans plusieurs sets (`card_sets`), chacun avec sa propre
 * `CardSet.tcg_date` et sa propre rareté — on retient celle du set dont la
 * date est la plus ancienne (même logique déjà utilisée pour
 * `ApiCollectionEntry.release_date`, voir `GET /:id/collection`). Repli sur
 * la première entrée du tableau si aucune date n'est connue pour aucun set
 * référencé (même limite déjà acceptée pour `release_date`) ; `null` si la
 * carte n'a absolument aucun set référencé (carte custom jamais liée à un
 * booster).
 */
export function earliestPrintRarity(card: CardDocument, tcgDateBySetName: Map<string, string | null>): string | null {
  if (card.card_sets.length === 0) return null;
  const dated = card.card_sets
    .map((s) => ({ rarity: s.set_rarity, date: tcgDateBySetName.get(s.set_name) ?? null }))
    .filter((e): e is { rarity: string; date: string } => e.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length > 0) return dated[0]!.rarity;
  return card.card_sets[0]!.set_rarity;
}
