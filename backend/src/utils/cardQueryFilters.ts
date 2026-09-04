/**
 * Traduit les mêmes dimensions de filtre que le front (catégorie, type de
 * monstre, Pendule, attribut, race — voir frontend/src/lib/cardFilters.ts)
 * en conditions Mongo, pour que GET /api/cards interroge directement le
 * catalogue complet au lieu de filtrer côté client une page déjà chargée
 * (qui ne peut représenter qu'une infime fraction de milliers de cartes).
 */
export interface CardCatalogFilterParams {
  categories?: string[]; // 'monster' | 'spell' | 'trap'
  monsterKinds?: string[]; // 'normal' | 'effect' | 'ritual' | 'fusion' | 'synchro' | 'xyz' | 'link'
  pendulumOnly?: boolean;
  attributes?: string[];
  // Couvre à la fois la race d'un monstre et le sous-type magie/piège
  // (Normal/Continuous/Quick-Play/...) : même champ `race` en base,
  // conformément à la convention YGOPRODeck reprise par nos cartes custom.
  races?: string[];
  atkMin?: number;
  atkMax?: number;
  levelMin?: number;
  levelMax?: number;
  // 'flip' | 'tuner' | 'union' | 'toon' | 'gemini' | 'spirit' — voir
  // ABILITY_NEEDLES ci-dessous (miroir de ABILITY_OPTIONS côté front,
  // frontend/src/lib/cardFilters.ts).
  abilities?: string[];
  // Correspondance exacte (voir Card.archetype) — demande utilisateur
  // "cartes liées" : retrouver toutes les cartes du même archétype qu'une
  // carte donnée (ex. "Blue-Eyes"), pas juste celles déjà possédées.
  archetype?: string;
}

// Capacité -> sous-chaîne à chercher dans `type` (ex. "Flip Effect Monster",
// "Tuner Monster", "Union Effect Monster") — pas de champ dédié en base, ces
// types composés YGOPRODeck la portent déjà nativement.
const ABILITY_NEEDLES: Record<string, string> = {
  flip: 'Flip',
  tuner: 'Tuner',
  union: 'Union',
  toon: 'Toon',
  gemini: 'Gemini',
  spirit: 'Spirit',
};

export function buildCardCatalogQuery(params: CardCatalogFilterParams): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  if (params.categories && params.categories.length > 0) {
    const categoryConditions = params.categories.map((category) => {
      if (category === 'spell') return { frame_type: 'spell' };
      if (category === 'trap') return { frame_type: 'trap' };
      return { frame_type: { $nin: ['spell', 'trap'] } }; // monster
    });
    conditions.push({ $or: categoryConditions });
  }

  if (params.monsterKinds && params.monsterKinds.length > 0) {
    // Un frame_type "kind" ou "kind_pendulum" compte pour ce type de monstre.
    const frameTypeValues = params.monsterKinds.flatMap((kind) => [kind, `${kind}_pendulum`]);
    conditions.push({ frame_type: { $in: frameTypeValues } });
  }

  if (params.pendulumOnly) {
    conditions.push({ frame_type: { $regex: /_pendulum$/ } });
  }

  if (params.attributes && params.attributes.length > 0) {
    conditions.push({ attribute: { $in: params.attributes } });
  }

  if (params.races && params.races.length > 0) {
    conditions.push({ race: { $in: params.races } });
  }

  if (params.atkMin !== undefined || params.atkMax !== undefined) {
    const range: Record<string, number> = {};
    if (params.atkMin !== undefined) range.$gte = params.atkMin;
    if (params.atkMax !== undefined) range.$lte = params.atkMax;
    conditions.push({ atk: range });
  }

  if (params.levelMin !== undefined || params.levelMax !== undefined) {
    const range: Record<string, number> = {};
    if (params.levelMin !== undefined) range.$gte = params.levelMin;
    if (params.levelMax !== undefined) range.$lte = params.levelMax;
    conditions.push({ level_rank: range });
  }

  if (params.abilities && params.abilities.length > 0) {
    const needles = params.abilities.map((a) => ABILITY_NEEDLES[a]).filter((n): n is string => Boolean(n));
    if (needles.length > 0) {
      conditions.push({ $or: needles.map((needle) => ({ type: { $regex: needle } })) });
    }
  }

  if (params.archetype) {
    conditions.push({ archetype: params.archetype });
  }

  if (conditions.length === 0) return {};
  return conditions.length === 1 ? conditions[0]! : { $and: conditions };
}
