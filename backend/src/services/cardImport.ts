import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { fetchCardSets, fetchCardsBySet, fetchCardsByIds, type YgoCard } from './ygoprodeck';

// cardsets.php renvoie certains noms de set avec des entités HTML littérales
// (ex. "Legendary 5D&apos;s Decks") au lieu du caractère lui-même — un
// artefact de LEUR côté, pas un encodage systématique (les "&" simples, eux,
// ne sont pas touchés). Décodage minimal des entités nommées les plus
// courantes, suffisant pour ce cas précis sans dépendance externe.
const HTML_ENTITIES: Record<string, string> = {
  '&apos;': "'",
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
};

function decodeSetName(name: string): string {
  return name.replace(/&(apos|quot|amp|lt|gt|#39);/g, (match) => HTML_ENTITIES[match] ?? match);
}

/**
 * Réel bug corrigé ici (rapporté par l'utilisateur : "Legend of Blue Eyes
 * White Dragon (LOB)" invisible, seule sa réédition 25th Anniversary
 * apparaissait, avec seulement des Magies dedans) : `CardSet.set_code`
 * n'est PAS unique dans les vraies données YGOPRODeck — confirmé en direct
 * contre `cardsets.php` : 142 des 644 `set_code` distincts sont partagés par
 * 2+ sets réellement différents (ex. "LOB" = l'édition originale 2002 à 355
 * cartes ET sa réédition 25th Anniversary à 14 cartes). `(set_code,
 * set_name)`, en revanche, est bien unique sur les 1032 sets réels — c'est
 * la clé d'upsert utilisée ici, chaque variante devenant son propre document
 * `CardSet` (son propre `_id`), au lieu de l'ancien "on ne garde que le plus
 * gros des deux" (fix minimal, aujourd'hui remplacé par ce correctif complet
 * — demande utilisateur explicite : pouvoir importer et différencier CHAQUE
 * variante pour la mettre en boutique). Le reste de l'app référence
 * désormais un set par son `_id` Mongo (stable, jamais ambigu), pas par
 * set_code seul — voir card.routes.ts (`GET /sets/:id/import`,
 * `GET /cards?set_id=`), merchant.routes.ts (`MerchantItem.card_set_id`) et
 * character.routes.ts (`SealedBoosterAttrs.card_set_id`).
 *
 * `had_code_collision` reste calculé (purement informatif désormais, voir
 * CardSet.model.ts) : utile pour signaler côté GM qu'un code est partagé,
 * même si ce n'est plus un signe de donnée perdue.
 */
export async function syncCardSets(): Promise<{ syncedCount: number; collidedSetCodes: string[] }> {
  const sets = await fetchCardSets();

  const countByCode = new Map<string, number>();
  for (const set of sets) countByCode.set(set.set_code, (countByCode.get(set.set_code) ?? 0) + 1);
  const collidedCodes = new Set([...countByCode.entries()].filter(([, count]) => count > 1).map(([code]) => code));

  await Promise.all(
    sets.map((set) =>
      CardSet.updateOne(
        { set_code: set.set_code, set_name: decodeSetName(set.set_name) },
        {
          $set: {
            num_of_cards: set.num_of_cards,
            tcg_date: set.tcg_date ?? null,
            set_image: set.set_image ?? null,
            had_code_collision: collidedCodes.has(set.set_code),
          },
        },
        { upsert: true },
      ),
    ),
  );

  return { syncedCount: sets.length, collidedSetCodes: [...collidedCodes] };
}

/**
 * Champs `$set` communs à toute carte officielle importée, quelle que soit
 * la voie d'entrée (par set complet, voir importCardsForSet ; ou par id,
 * voir importCardsByIds pour l'import CSV de collection) — extrait pour ne
 * jamais laisser les deux chemins diverger sur des champs comme
 * pendulum_scale/link_arrows (voir le commentaire historique ci-dessous).
 */
function buildCardUpdateFields(card: YgoCard, frCard?: YgoCard) {
  return {
    name: card.name,
    type: card.type,
    frame_type: card.frameType,
    description: card.desc,
    atk: card.atk ?? null,
    def: card.def ?? null,
    level_rank: card.level ?? null,
    race: card.race ?? null,
    attribute: card.attribute ?? null,
    archetype: card.archetype ?? null,
    // Réel bug corrigé ici : ces deux champs n'étaient JAMAIS renseignés
    // pour une carte officielle (YgoCard ne les déclarait même pas),
    // laissant `pendulum_scale` toujours null pour tout monstre Pendule
    // officiel — l'échelle n'apparaissait donc nulle part dans
    // l'app (DeckEditorOverlay.tsx affiche pourtant "Échelle Pendule"
    // dès que non-null). `linkmarkers` de YGOPRODeck utilise déjà la
    // même casse que LinkArrow ("Top-Left" etc.) — juste mis en
    // minuscules pour matcher exactement la convention custom
    // ("top-left", voir CustomCardPanel.tsx).
    pendulum_scale: card.scale ?? null,
    link_arrows: (card.linkmarkers ?? []).map((m) => m.toLowerCase()),
    card_sets: (card.card_sets ?? []).map((s) => ({
      set_name: s.set_name,
      set_code: s.set_code,
      set_rarity: s.set_rarity,
      set_rarity_code: s.set_rarity_code,
      set_price: s.set_price,
    })),
    card_images: card.card_images.map((img) => ({
      image_id: img.id,
      image_url: img.image_url,
      image_url_small: img.image_url_small,
      image_url_cropped: img.image_url_cropped,
    })),
    is_custom: false as const,
    // Le passcode YGOPRODeck EST le passcode officiel attendu par le
    // moteur de duel (ocgcore) — aucune allocation nécessaire ici,
    // contrairement aux cartes custom (voir engineCardCode.ts).
    engine_code: card.id,
    // N'écrase `translations.fr` que si le second appel FR a réellement
    // trouvé cette carte (voir fetchCardsBySet/fetchCardsByIds ci-dessus) —
    // absent du `$set` sinon, pour ne jamais effacer une traduction déjà
    // stockée par un import précédent en cas d'échec réseau ponctuel.
    ...(frCard ? { translations: { fr: { name: frCard.name, description: frCard.desc } } } : {}),
  };
}

/**
 * Prend l'`_id` Mongo du `CardSet`, pas son `set_code` — set_code seul est
 * ambigu depuis qu'une même valeur peut désigner 2+ sets réels distincts
 * (voir syncCardSets). `set_name`, lui, reste la clé fiable pour interroger
 * YGOPRODeck (`fetchCardsBySet`) : jamais ambiguë, confirmée unique en
 * combinaison avec set_code sur les vraies données.
 */
export async function importCardsForSet(cardSetId: string): Promise<{ setName: string; importedCount: number }> {
  const cardSet = await CardSet.findById(cardSetId);
  if (!cardSet) {
    throw new Error("Set inconnu : synchronisez d'abord la liste des sets");
  }

  const cards = await fetchCardsBySet(cardSet.set_name);

  // Second appel optionnel, en français — jamais bloquant : une erreur
  // réseau ici ne doit pas faire échouer l'import lui-même, juste le priver
  // de traduction pour cette fois (voir buildCardUpdateFields ci-dessus).
  let frById = new Map<number, YgoCard>();
  try {
    const frCards = await fetchCardsBySet(cardSet.set_name, 'fr');
    frById = new Map(frCards.map((c) => [c.id, c]));
  } catch (err) {
    console.warn('[cardImport] Récupération FR impossible, import poursuivi sans traduction :', err);
  }

  for (const card of cards) {
    await Card.updateOne({ ygoprodeck_id: card.id }, { $set: buildCardUpdateFields(card, frById.get(card.id)) }, { upsert: true });
  }

  // Ne marque "importé" que si on a réellement rapatrié des cartes : sinon
  // un souci réseau ou un nom de set introuvable côté YGOPRODeck figerait le
  // set en "importé avec 0 carte" pour toujours (plus aucune nouvelle
  // tentative possible), ce qui rouvrirait la contamination par réimpression
  // que ce champ sert justement à empêcher côté ouverture de booster.
  if (cards.length > 0) {
    cardSet.imported_at = new Date();
    await cardSet.save();
  }

  return { setName: cardSet.set_name, importedCount: cards.length };
}

/**
 * Importe (ou met à jour) des cartes officielles par passcode YGOPRODeck
 * directement, sans passer par un set — utilisé par l'import CSV de
 * collection (CharacterList.tsx/GrantCardsOverlay.tsx) : une carte manquante
 * localement (jamais importée via son set) est récupérée à la volée plutôt
 * que de bloquer toute la migration. Ne redemande jamais un id déjà en base
 * (par ygoprodeck_id) — seuls les manquants déclenchent un vrai appel réseau.
 */
export async function importCardsByIds(ids: number[]): Promise<{ foundIds: Set<number> }> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return { foundIds: new Set() };

  const already = await Card.find({ ygoprodeck_id: { $in: uniqueIds } }).select('ygoprodeck_id');
  const alreadyIds = new Set(already.map((c) => c.ygoprodeck_id!));
  const missingIds = uniqueIds.filter((id) => !alreadyIds.has(id));

  const fetched = missingIds.length > 0 ? await fetchCardsByIds(missingIds) : [];

  let frById = new Map<number, YgoCard>();
  if (fetched.length > 0) {
    try {
      const frCards = await fetchCardsByIds(fetched.map((c) => c.id), 'fr');
      frById = new Map(frCards.map((c) => [c.id, c]));
    } catch (err) {
      console.warn('[cardImport] Récupération FR impossible, import poursuivi sans traduction :', err);
    }
  }

  for (const card of fetched) {
    await Card.updateOne({ ygoprodeck_id: card.id }, { $set: buildCardUpdateFields(card, frById.get(card.id)) }, { upsert: true });
  }

  const foundIds = new Set([...alreadyIds, ...fetched.map((c) => c.id)]);
  return { foundIds };
}
