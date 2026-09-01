import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * Duel piloté par le moteur ocgcore réel (voir engine/ocgcore/, plan
 * d'intégration) — remplace entièrement l'ancien plateau calculé à la main.
 *
 * Le duel VIVANT (PV, phase, tour, main, terrain) est un process externe
 * (backend/src/services/ocgcoreClient.ts) tenu en mémoire par le backend
 * (voir duel.routes.ts, registre en mémoire) — ce document Mongo ne stocke
 * QUE la configuration et un journal humain, jamais l'état de jeu détaillé
 * (qui n'existe que dans le process, tant qu'il tourne).
 *
 * Limite assumée : si le backend redémarre (déploiement, ou hot-reload en
 * dev), les process ocgcore actifs meurent avec lui — un duel en cours
 * devient alors `status: 'lost'` (non reprenable, comme un simulateur de
 * bureau qui crashe). Pas de sauvegarde/restauration d'état moteur : ocgapi.h
 * n'expose aucune fonction de sérialisation, ce serait un chantier séparé.
 *
 * Équipes (2 camps, 1-5 participants chacun, PV partagés PAR CAMP) : ocgcore
 * n'a QUE 2 réservoirs de PV en dur (`std::array<player_info,2> player`,
 * field.h) — un vrai "chacun pour soi" à 3+ PV indépendants (battle royale
 * au sens strict) est structurellement impossible avec un seul duel ocgcore,
 * pas juste non câblé. Ce qui EST natif : le "Duel Tag" — plusieurs
 * "duelists" partageant le même camp (mêmes PV, même terrain — les zones
 * Monstre/Magie-Piège sont TOUJOURS au niveau du camp, jamais personnelles à
 * un participant), avec leur propre deck/main/Extra Deck qui tourne
 * automatiquement au fil des tours (voir `duelist_index` ci-dessous et
 * `duelEngine.ts`). C'est ce que ce fichier modélise — décision utilisateur
 * explicite (le vrai battle royale à PV individuels a été écarté).
 */

export interface DuelParticipantAttrs {
  _id: Types.ObjectId;
  character_id: Types.ObjectId;
  // Copie figée à la création (affichage sans jointure).
  character_name: string;
  is_npc: boolean;
  team: 0 | 1;
  // Rang de ce participant au sein de SON camp (0 = premier ajouté = deck
  // "principal" enregistré normalement côté moteur ; 1-4 = decks
  // supplémentaires du même camp). Détermine l'ordre de rotation du duelist
  // actif — voir EngineDuelState.activeDuelistIndex (duelEngine.ts) : cet
  // ordre n'est PAS forcément l'ordre de jeu réel (le camp qui perd le tirage
  // au sort de départ peut sauter directement au duelist d'index 1 sur son
  // propre premier tour — comportement RÉEL du moteur, confirmé en le
  // pilotant en direct, pas un bug de suivi côté app).
  duelist_index: number;
  deck_id: Types.ObjectId;
}

export interface DuelEventAttrs {
  message: string;
  // Additif (voir plan d'internationalisation §3, même conception que
  // `AppError.params` côté errorHandler.ts) : `code`/`params` permettent au
  // frontend de traduire l'évènement via `duelEvents.<code>` dans
  // locales/{fr,en}.json quand présents ; `message` (toujours le français,
  // jamais retiré) reste le repli pour tout évènement plus ancien ou pas
  // encore catalogué.
  code?: string;
  params?: Record<string, string | number>;
  created_at: Date;
}

export interface DuelAttrs {
  game_session_id: Types.ObjectId;
  name: string;
  status: 'active' | 'finished' | 'lost';
  starting_lp: number;
  hand_size: number;
  draw_count_per_turn: number;
  teams: [{ name: string }, { name: string }];
  participants: DuelParticipantAttrs[];
  winner_team: number | null;
  events: DuelEventAttrs[];
}

export type DuelDocument = HydratedDocument<DuelAttrs>;

const duelParticipantSchema = new Schema<DuelParticipantAttrs>({
  character_id: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  character_name: { type: String, required: true },
  is_npc: { type: Boolean, default: false },
  team: { type: Number, required: true, min: 0, max: 1 },
  duelist_index: { type: Number, required: true, min: 0, max: 4 },
  deck_id: { type: Schema.Types.ObjectId, required: true },
});

const duelTeamSchema = new Schema<{ name: string }>({ name: { type: String, required: true, trim: true, maxlength: 64 } }, { _id: false });

const duelEventSchema = new Schema<DuelEventAttrs>(
  {
    message: { type: String, required: true },
    code: { type: String },
    params: { type: Schema.Types.Mixed },
    created_at: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const duelSchema = new Schema<DuelAttrs>(
  {
    game_session_id: { type: Schema.Types.ObjectId, ref: 'GameSession', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    status: { type: String, enum: ['active', 'finished', 'lost'], default: 'active' },
    starting_lp: { type: Number, required: true, min: 0 },
    hand_size: { type: Number, required: true, min: 0 },
    draw_count_per_turn: { type: Number, required: true, min: 0 },
    teams: { type: [duelTeamSchema], default: [] },
    participants: { type: [duelParticipantSchema], default: [] },
    winner_team: { type: Number, default: null },
    events: { type: [duelEventSchema], default: [] },
  },
  { timestamps: true },
);

duelSchema.index({ game_session_id: 1 });

export const Duel = model<DuelAttrs>('Duel', duelSchema);
