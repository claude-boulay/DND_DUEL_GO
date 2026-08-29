import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { fetchCardSets, fetchCardsBySet } from './ygoprodeck';

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

export async function syncCardSets(): Promise<number> {
  const sets = await fetchCardSets();

  await Promise.all(
    sets.map((set) =>
      CardSet.updateOne(
        { set_code: set.set_code },
        {
          $set: {
            set_name: decodeSetName(set.set_name),
            num_of_cards: set.num_of_cards,
            tcg_date: set.tcg_date ?? null,
          },
        },
        { upsert: true },
      ),
    ),
  );

  return sets.length;
}

export async function importCardsForSet(setCode: string): Promise<{ setName: string; importedCount: number }> {
  const cardSet = await CardSet.findOne({ set_code: setCode });
  if (!cardSet) {
    throw new Error("Set inconnu : synchronisez d'abord la liste des sets");
  }

  const cards = await fetchCardsBySet(cardSet.set_name);

  for (const card of cards) {
    await Card.updateOne(
      { ygoprodeck_id: card.id },
      {
        $set: {
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
          is_custom: false,
          // Le passcode YGOPRODeck EST le passcode officiel attendu par le
          // moteur de duel (ocgcore) — aucune allocation nécessaire ici,
          // contrairement aux cartes custom (voir engineCardCode.ts).
          engine_code: card.id,
        },
      },
      { upsert: true },
    );
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
