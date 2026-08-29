import type { ApiCard } from './api';

export type CardCategory = 'monster' | 'spell' | 'trap';

export function cardCategory(card: ApiCard): CardCategory {
  if (card.frame_type === 'spell') return 'spell';
  if (card.frame_type === 'trap') return 'trap';
  return 'monster';
}

/** frame_type sans le suffixe _pendulum (normal/effect/fusion/synchro/xyz/link/ritual). */
export function monsterBaseKind(card: ApiCard): string {
  return card.frame_type.replace('_pendulum', '');
}

export function isPendulum(card: ApiCard): boolean {
  return card.frame_type.endsWith('_pendulum');
}

export const MONSTER_KIND_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'effect', label: 'Effet' },
  { value: 'ritual', label: 'Rituel' },
  { value: 'fusion', label: 'Fusion' },
  { value: 'synchro', label: 'Synchro' },
  { value: 'xyz', label: 'Xyz' },
  { value: 'link', label: 'Lien' },
];

// Sous-type magie/piège stocké dans `race` (convention YGOPRODeck, reprise
// telle quelle par nos cartes custom — voir customCardRules.ts côté backend).
export const SPELL_RACE_OPTIONS = [
  { value: 'Normal', label: 'Normale' },
  { value: 'Continuous', label: 'Continue' },
  { value: 'Quick-Play', label: 'Jeu Rapide' },
  { value: 'Equip', label: 'Équipement' },
  { value: 'Field', label: 'Terrain' },
  { value: 'Ritual', label: 'Rituelle' },
];

export const TRAP_RACE_OPTIONS = [
  { value: 'Normal', label: 'Normal' },
  { value: 'Continuous', label: 'Continu' },
  { value: 'Counter', label: 'Contre-piège' },
];

export const ATTRIBUTE_OPTIONS = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];

export const CATEGORY_OPTIONS: { value: CardCategory; label: string }[] = [
  { value: 'monster', label: 'Monstre' },
  { value: 'spell', label: 'Magie' },
  { value: 'trap', label: 'Piège' },
];

export interface CollectionFilters {
  categories: CardCategory[];
  monsterKinds: string[];
  pendulumOnly: boolean;
  spellTypes: string[];
  trapTypes: string[];
  attributes: string[];
  races: string[];
}

export const EMPTY_FILTERS: CollectionFilters = {
  categories: [],
  monsterKinds: [],
  pendulumOnly: false,
  spellTypes: [],
  trapTypes: [],
  attributes: [],
  races: [],
};

/**
 * Traduit l'état de la modale de filtre en paramètres pour GET /api/cards,
 * pour que le catalogue complet soit interrogé côté serveur au lieu de
 * filtrer côté client une page qui n'en représente qu'une fraction. race
 * regroupe races (monstre), spellTypes et trapTypes : même champ `race` en
 * base, quelle que soit la section de la modale d'où vient la sélection.
 */
export function filtersToQueryParams(
  filters: CollectionFilters,
): { category?: string; monster_kind?: string; pendulum?: boolean; attribute?: string; race?: string } {
  const params: { category?: string; monster_kind?: string; pendulum?: boolean; attribute?: string; race?: string } = {};
  if (filters.categories.length > 0) params.category = filters.categories.join(',');
  if (filters.monsterKinds.length > 0) params.monster_kind = filters.monsterKinds.join(',');
  if (filters.pendulumOnly) params.pendulum = true;
  if (filters.attributes.length > 0) params.attribute = filters.attributes.join(',');
  const races = [...filters.races, ...filters.spellTypes, ...filters.trapTypes];
  if (races.length > 0) params.race = races.join(',');
  return params;
}

export function isFiltersEmpty(filters: CollectionFilters): boolean {
  return (
    filters.categories.length === 0 &&
    filters.monsterKinds.length === 0 &&
    !filters.pendulumOnly &&
    filters.spellTypes.length === 0 &&
    filters.trapTypes.length === 0 &&
    filters.attributes.length === 0 &&
    filters.races.length === 0
  );
}

export function activeFilterCount(filters: CollectionFilters): number {
  return (
    filters.categories.length +
    filters.monsterKinds.length +
    (filters.pendulumOnly ? 1 : 0) +
    filters.spellTypes.length +
    filters.trapTypes.length +
    filters.attributes.length +
    filters.races.length
  );
}

export function toggleInArray<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function matchesFilters(card: ApiCard, filters: CollectionFilters): boolean {
  const category = cardCategory(card);
  if (filters.categories.length > 0 && !filters.categories.includes(category)) return false;

  // Volontairement PAS conditionné à category === 'monster' : un sort/piège
  // n'a ni attribut ni type de monstre (attribute est null, frame_type ne
  // matche aucune valeur de monsterKinds), donc ces filtres l'excluent déjà
  // naturellement dès qu'ils sont actifs — pas besoin (et pas correct) de le
  // laisser passer en le contournant par catégorie.
  if (filters.monsterKinds.length > 0 && !filters.monsterKinds.includes(monsterBaseKind(card))) return false;
  if (filters.pendulumOnly && !isPendulum(card)) return false;
  if (filters.attributes.length > 0 && (!card.attribute || !filters.attributes.includes(card.attribute))) return false;
  if (filters.races.length > 0 && (!card.race || !filters.races.includes(card.race))) return false;
  if (filters.spellTypes.length > 0 && (!card.race || !filters.spellTypes.includes(card.race))) return false;
  if (filters.trapTypes.length > 0 && (!card.race || !filters.trapTypes.includes(card.race))) return false;
  return true;
}

export type SortKey = 'type' | 'name' | 'release_date' | 'acquired_order';

// Options complètes (collection d'un personnage : deckbuilder). Le
// sélecteur du marchand (catalogue global, rien "acquis") n'en propose
// qu'un sous-sélectionné — voir MERCHANT_CARD_SORT_OPTIONS ci-dessous.
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'type', label: 'Type (monstre → magie → piège)' },
  { value: 'release_date', label: 'Date de sortie' },
  { value: 'acquired_order', label: "Ordre d'acquisition" },
];

export const MERCHANT_CARD_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'type', label: 'Type (monstre → magie → piège)' },
  { value: 'name', label: 'Nom (A → Z)' },
];

const CATEGORY_ORDER: Record<CardCategory, number> = { monster: 0, spell: 1, trap: 2 };

export interface SortableEntry {
  card: ApiCard;
  releaseDate: string | null;
  acquiredOrder: number | null;
}

export function compareEntries(a: SortableEntry, b: SortableEntry, sortKey: SortKey, direction: 1 | -1): number {
  let cmp = 0;
  if (sortKey === 'type') {
    cmp = CATEGORY_ORDER[cardCategory(a.card)] - CATEGORY_ORDER[cardCategory(b.card)];
    if (cmp === 0) cmp = a.card.name.localeCompare(b.card.name);
  } else if (sortKey === 'name') {
    cmp = a.card.name.localeCompare(b.card.name);
  } else if (sortKey === 'release_date') {
    const da = a.releaseDate;
    const db = b.releaseDate;
    // Dates inconnues toujours en fin de liste, quel que soit le sens du tri.
    if (!da && !db) cmp = a.card.name.localeCompare(b.card.name);
    else if (!da) return 1;
    else if (!db) return -1;
    else cmp = da.localeCompare(db);
  } else {
    cmp = (a.acquiredOrder ?? Number.MAX_SAFE_INTEGER) - (b.acquiredOrder ?? Number.MAX_SAFE_INTEGER);
  }
  return cmp * direction;
}
