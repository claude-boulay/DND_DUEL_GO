import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface CardSetAttrs {
  set_name: string;
  set_code: string;
  num_of_cards: number;
  tcg_date: string | null;
  // Visuel officiel du boîtier/pack (YGOPRODeck) — null pour un set custom ou
  // un vieux set officiel dont YGOPRODeck ne fournit pas d'image.
  set_image: string | null;
  imported_at: Date | null;
  // Booster custom créé par un MJ (par opposition à un set officiel YGOPRODeck).
  is_custom: boolean;
  owner_id: Types.ObjectId | null;
  // true si, lors de la DERNIÈRE synchronisation, ce set_code était partagé
  // par 2+ sets réellement différents côté YGOPRODeck (ex. "LOB" partagé
  // entre le vrai set et sa réédition 25th Anniversary — voir syncCardSets).
  // Recalculé à chaque sync (jamais un état figé) : un code qui cesse de
  // collisionner un jour se voit remis à false automatiquement. Purement
  // informatif désormais (CLAUDE.md) : depuis la refonte "chaque variante
  // importable séparément" (identifiée par son propre `_id`, plus par
  // set_code seul), ce n'est plus un signe de donnée potentiellement
  // perdue — juste un repère utile pour savoir qu'un code est partagé.
  had_code_collision: boolean;
}

export type CardSetDocument = HydratedDocument<CardSetAttrs>;

const cardSetSchema = new Schema<CardSetAttrs>(
  {
    set_name: { type: String, required: true, trim: true },
    // PAS unique seul : voir CLAUDE.md — un set_code YGOPRODeck peut être
    // partagé par 2+ sets réellement différents (confirmé : 142 des 644
    // codes réels). (set_code, set_name) ensemble, en revanche, EST unique
    // sur les vraies données (vérifié sur les 1032 sets réels) — c'est cette
    // paire qui identifie un set côté API externe, `_id` restant la clé
    // stable côté app pour toute référence interne (Merchant, sealed
    // boosters...), voir dropLegacyCardSetCodeIndex (db/mongo.ts) pour la
    // migration de l'ancien index unique sur set_code seul.
    set_code: { type: String, required: true, trim: true },
    num_of_cards: { type: Number, default: 0 },
    tcg_date: { type: String, default: null },
    set_image: { type: String, default: null },
    // null tant que les cartes du set n'ont pas encore été importées dans Card.
    // Pour un set custom, non pertinent : traité comme "toujours prêt".
    imported_at: { type: Date, default: null },
    is_custom: { type: Boolean, default: false },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    had_code_collision: { type: Boolean, default: false },
  },
  { timestamps: true },
);

cardSetSchema.index({ set_name: 1 });
cardSetSchema.index({ set_code: 1, set_name: 1 }, { unique: true });

export const CardSet = model<CardSetAttrs>('CardSet', cardSetSchema);
