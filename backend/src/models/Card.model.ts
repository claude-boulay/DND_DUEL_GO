import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface CardSetRef {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code: string;
  set_price: string;
}

export interface CardImageRef {
  image_id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface CardTranslationEntry {
  name: string;
  description: string;
}

export interface CardTranslations {
  // Officielle : peuplée en rappelant YGOPRODeck avec `&language=fr` (voir
  // ygoprodeck.ts/cardImport.ts), au fil des imports/réimports — jamais de
  // backfill de masse des sets déjà importés (précédent déjà établi dans ce
  // projet, voir CLAUDE.md). Custom : saisie à la main par le MJ créateur
  // (aucune traduction automatique possible pour du contenu inventé), voir
  // customCard.routes.ts. Absente tant qu'aucune traduction n'existe —
  // l'affichage retombe alors sur `name`/`description` (toujours l'anglais
  // officiel, ou la langue de saisie du MJ pour une carte custom).
  fr?: CardTranslationEntry;
}

export interface CardAttrs {
  // Absent pour les cartes custom (pas d'id YGOPRODeck) : index sparse unique.
  ygoprodeck_id: number | null;
  name: string;
  type: string;
  frame_type: string;
  description: string;
  atk: number | null;
  def: number | null;
  // Level (monstres normaux/effet/rituel/fusion/synchro), Rank (Xyz) ou Link
  // Rating (Link) selon frame_type — un seul champ numérique, comme YGOPRODeck.
  level_rank: number | null;
  race: string | null;
  attribute: string | null;
  archetype: string | null;
  // Custom uniquement : échelle Pendule (monstres Pendule) et flèches Lien
  // (monstres Link). null/[] pour tout le reste, y compris les cartes officielles.
  pendulum_scale: number | null;
  link_arrows: string[];
  // Chaque entrée = un booster dans lequel la carte apparaît, avec sa rareté
  // et son prix propres à CE set (une même carte peut avoir des raretés
  // différentes selon le booster). C'est le "booster set mapping" de CLAUDE.md §3.4.
  // Pour une carte custom, un GM peut y lier un set officiel OU un set custom.
  card_sets: CardSetRef[];
  card_images: CardImageRef[];
  // Toujours false pour les cartes officielles : distingue visuellement des
  // CustomCard côté frontend (CLAUDE.md §4).
  is_custom: boolean;
  // Custom uniquement : créateur (MJ). Détermine la réutilisation inter-parties
  // (utilisable dans toute partie où ce même utilisateur est MJ).
  owner_id: Types.ObjectId | null;
  // Custom uniquement : partie d'origine, pour affichage/traçabilité seulement
  // (la règle d'accès repose sur owner_id, pas sur ce champ).
  created_in_session_id: Types.ObjectId | null;
  // Passcode utilisé par le moteur de duel (ocgcore) pour identifier cette
  // carte. Officielle : identique à ygoprodeck_id (déjà le vrai passcode).
  // Custom : code synthétique alloué à la création (voir engineCardCode.ts),
  // dans une plage réservée au-dessus de tout passcode officiel réel.
  engine_code: number | null;
  // Custom uniquement, OBLIGATOIRE à la création (voir customCard.routes.ts) :
  // script Lua fourni par le MJ, exécuté par le moteur exactement comme un
  // script officiel Project Ignis (voir engine/ocgcore/poc/server.cpp,
  // commande CUSTOMSCRIPT). Sans script réel fourni par un humain, aucune
  // automatisation fiable de l'effet n'est possible — voir CLAUDE.md §3.4.
  lua_script: string | null;
  translations: CardTranslations;
}

export type CardDocument = HydratedDocument<CardAttrs>;

const cardSetRefSchema = new Schema<CardSetRef>(
  {
    set_name: { type: String, required: true },
    set_code: { type: String, required: true },
    set_rarity: { type: String, default: '' },
    set_rarity_code: { type: String, default: '' },
    set_price: { type: String, default: '0' },
  },
  { _id: false },
);

const cardImageRefSchema = new Schema<CardImageRef>(
  {
    image_id: { type: Number, required: true },
    image_url: { type: String, required: true },
    image_url_small: { type: String, required: true },
    image_url_cropped: { type: String, required: true },
  },
  { _id: false },
);

const cardTranslationEntrySchema = new Schema<CardTranslationEntry>(
  { name: { type: String, required: true }, description: { type: String, required: true } },
  { _id: false },
);

const cardTranslationsSchema = new Schema<CardTranslations>({ fr: { type: cardTranslationEntrySchema, default: undefined } }, { _id: false });

const cardSchema = new Schema<CardAttrs>(
  {
    // Pas de `default: null` : Mongoose persisterait alors null pour chaque
    // carte custom, et un index sparse n'exclut que les documents où le champ
    // est réellement ABSENT (pas juste null) — plusieurs null entreraient en
    // collision sur l'unicité. On laisse le champ non défini pour le custom.
    ygoprodeck_id: { type: Number, unique: true, sparse: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true },
    frame_type: { type: String, required: true },
    description: { type: String, default: '' },
    atk: { type: Number, default: null },
    def: { type: Number, default: null },
    level_rank: { type: Number, default: null },
    race: { type: String, default: null },
    attribute: { type: String, default: null },
    archetype: { type: String, default: null },
    pendulum_scale: { type: Number, default: null },
    link_arrows: { type: [String], default: [] },
    card_sets: { type: [cardSetRefSchema], default: [] },
    card_images: { type: [cardImageRefSchema], default: [] },
    is_custom: { type: Boolean, default: false },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    created_in_session_id: { type: Schema.Types.ObjectId, ref: 'GameSession', default: null },
    // Même remarque que ygoprodeck_id : pas de `default: null`, sinon l'index
    // sparse ne joue plus son rôle (chaque carte custom sans code encore
    // alloué percuterait les autres sur l'unicité d'un `null` partagé).
    engine_code: { type: Number, unique: true, sparse: true },
    lua_script: { type: String, default: null },
    translations: { type: cardTranslationsSchema, default: {} },
  },
  { timestamps: true },
);

cardSchema.index({ name: 1 });
cardSchema.index({ 'card_sets.set_code': 1 });
cardSchema.index({ is_custom: 1, owner_id: 1 });

export const Card = model<CardAttrs>('Card', cardSchema);
