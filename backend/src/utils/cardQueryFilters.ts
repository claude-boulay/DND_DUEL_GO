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
}

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

  if (conditions.length === 0) return {};
  return conditions.length === 1 ? conditions[0]! : { $and: conditions };
}
