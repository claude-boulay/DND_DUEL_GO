/**
 * Copie de la logique de `backend/src/utils/pointBuy.ts` pour piloter l'UI
 * sans aller-retour serveur à chaque clic. Le backend reste la seule source
 * de vérité : toute création est revalidée côté serveur.
 */
export type StatName = 'history' | 'perception' | 'intelligence' | 'charisma' | 'luck';

export interface CharacterStats {
  history: number;
  perception: number;
  intelligence: number;
  charisma: number;
  luck: number;
}

export const STAT_NAMES: StatName[] = ['history', 'perception', 'intelligence', 'charisma', 'luck'];

// Clés de traduction i18next (voir locales/{fr,en}.json, namespace
// `stats.*`) — PAS du texte affichable directement, les composants
// appellent `t(STAT_LABELS[stat])` au rendu (même convention que
// cardFilters.ts). STAT_NAMES (les clés `StatName`, ex. "history"), elles,
// restent anglaises : donnée fonctionnelle (stockée en base), jamais traduite.
export const STAT_LABELS: Record<StatName, string> = {
  history: 'stats.full.history',
  perception: 'stats.full.perception',
  intelligence: 'stats.full.intelligence',
  charisma: 'stats.full.charisma',
  luck: 'stats.full.luck',
};

/** Libellés courts pour les affichages compacts (grille de fiche personnage) — mêmes clés i18next que ci-dessus. */
export const STAT_SHORT_LABELS: Record<StatName, string> = {
  history: 'stats.short.history',
  perception: 'stats.short.perception',
  intelligence: 'stats.short.intelligence',
  charisma: 'stats.short.charisma',
  luck: 'stats.short.luck',
};

export const STAT_MIN = 8;
// Pas d'objets pour booster ces stats en jeu : 20 est le plafond dur, pas une
// borne de coût dégressif.
export const STAT_MAX = 20;
export const POINT_BUY_BUDGET = 27;

/** Coût plat : chaque point au-dessus du plancher coûte 1 point de budget. */
export function totalPointBuyCost(stats: CharacterStats): number {
  return STAT_NAMES.reduce((sum, stat) => sum + (stats[stat] - STAT_MIN), 0);
}

/**
 * Copie de backend/src/utils/luck.ts effectiveStat + abilityScore.ts
 * abilityModifier — juste pour un aperçu client avant de lancer le dé (voir
 * DicePanel.tsx) ; le serveur recalcule et reste seul faisant foi (jamais
 * transmis par le client, voir sockets/index.ts roll_dice).
 */
export function effectiveStat(base: number, level: number): number {
  return base + (level - 1) * 0.5;
}

/** Modificateur D&D standard : floor((valeur - 10) / 2). */
export function abilityModifier(effectiveValue: number): number {
  return Math.floor((effectiveValue - 10) / 2);
}
