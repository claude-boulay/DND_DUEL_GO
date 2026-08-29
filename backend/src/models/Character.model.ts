import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface CharacterStatsAttrs {
  history: number;
  perception: number;
  intelligence: number;
  charisma: number;
  luck: number;
}

export interface DeckAttrs {
  _id: Types.ObjectId;
  name: string;
  // Chaque entrée = l'id Mongo (string) d'une carte ; les doublons
  // représentent des copies multiples, comme pour `collection`.
  cards: string[];
}

/** Un booster acheté mais pas encore ouvert. Agrégé par set : pas besoin d'id individuel. */
export interface SealedBoosterAttrs {
  set_code: string;
  set_name: string;
  quantity: number;
}

export interface CharacterAttrs {
  user_id: Types.ObjectId;
  game_session_id: Types.ObjectId;
  name: string;
  is_npc: boolean;
  level: number;
  experience: number;
  money: number;
  backstory: string;
  personality: string;
  visual_description: string;
  stats: CharacterStatsAttrs;
  remaining_luck_rerolls: number;
  inventory: string[];
  // Chaque entrée = l'id Mongo (string) d'une carte possédée ; les doublons
  // représentent des copies multiples (pas de champ "quantity" séparé).
  collection: string[];
  sealed_boosters: SealedBoosterAttrs[];
  decks: DeckAttrs[];
}

export type CharacterDocument = HydratedDocument<CharacterAttrs>;

const statsSchema = new Schema<CharacterStatsAttrs>(
  {
    history: { type: Number, required: true },
    perception: { type: Number, required: true },
    intelligence: { type: Number, required: true },
    charisma: { type: Number, required: true },
    luck: { type: Number, required: true },
  },
  { _id: false },
);

const deckSchema = new Schema<DeckAttrs>({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
  cards: { type: [String], default: [] },
});

const sealedBoosterSchema = new Schema<SealedBoosterAttrs>(
  {
    set_code: { type: String, required: true },
    set_name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const characterSchema = new Schema<CharacterAttrs>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    game_session_id: { type: Schema.Types.ObjectId, ref: 'GameSession', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    is_npc: { type: Boolean, default: false },
    level: { type: Number, default: 1, min: 1 },
    experience: { type: Number, default: 0, min: 0 },
    money: { type: Number, default: 0, min: 0 },
    backstory: { type: String, default: '', maxlength: 5000 },
    personality: { type: String, default: '', maxlength: 2000 },
    visual_description: { type: String, default: '', maxlength: 2000 },
    stats: { type: statsSchema, required: true },
    // Compteur de charges restantes ; distinct du maximum recalculé par la formule
    // de CLAUDE.md §3.3. Décrémenté par le futur moteur de dés Socket.io.
    remaining_luck_rerolls: { type: Number, default: 0, min: 0 },
    inventory: { type: [String], default: [] },
    collection: { type: [String], default: [] },
    sealed_boosters: { type: [sealedBoosterSchema], default: [] },
    decks: { type: [deckSchema], default: [] },
  },
  {
    timestamps: true,
    // `collection` est le nom imposé par CLAUDE.md §5 ; il entre en collision
    // avec `Document.collection` (le handle interne Mongoose vers la
    // collection MongoDB), d'où l'avertissement au démarrage. Vérifié inoffensif
    // par la suite e2e (backend/src/__tests__/economy.e2e.test.ts) : lecture,
    // écriture et $push sur ce champ fonctionnent normalement.
    suppressReservedKeysWarning: true,
  },
);

characterSchema.index({ game_session_id: 1 });

export const Character = model<CharacterAttrs>('Character', characterSchema);
