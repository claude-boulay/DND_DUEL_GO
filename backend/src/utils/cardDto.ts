import type { CardDocument } from '../models/Card.model';

/**
 * DTO carte complet — partagé entre card.routes.ts (listing) et
 * character.routes.ts (collection, vue de deck), qui en avaient chacun une
 * version tronquée. La vue plein écran du deckbuilder (DeckEditorOverlay)
 * affiche le texte d'effet et les stats en grand : il lui faut le DTO
 * complet, pas juste id/name/type/card_images.
 */
export function toCardDto(card: CardDocument) {
  return {
    id: card._id.toString(),
    ygoprodeck_id: card.ygoprodeck_id,
    name: card.name,
    type: card.type,
    frame_type: card.frame_type,
    description: card.description,
    atk: card.atk,
    def: card.def,
    level_rank: card.level_rank,
    race: card.race,
    attribute: card.attribute,
    archetype: card.archetype,
    pendulum_scale: card.pendulum_scale,
    link_arrows: card.link_arrows,
    card_sets: card.card_sets,
    card_images: card.card_images,
    is_custom: card.is_custom,
  };
}
