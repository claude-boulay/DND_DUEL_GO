import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface GmNotebookAttrs {
  // Carnet du MJ (demande utilisateur) : un par partie, jamais par
  // personnage — indépendant de tout PJ/PNJ. Deux sections de texte libre
  // pour l'instant (Histoire/Lieu), pensé pour en accueillir d'autres plus
  // tard sans migration (juste ajouter un champ). Visible/éditable
  // uniquement par le MJ — voir toSessionDto ci-dessous, jamais exposé à un
  // joueur même s'il regarde le même salon.
  history: string;
  location: string;
}

export interface GameSessionAttrs {
  code: string;
  gm_id: Types.ObjectId;
  currency_name: string;
  custom_banlist: string[];
  players: Types.ObjectId[];
  gm_notebook: GmNotebookAttrs;
}

export type GameSessionDocument = HydratedDocument<GameSessionAttrs>;

const gmNotebookSchema = new Schema<GmNotebookAttrs>(
  { history: { type: String, default: '', maxlength: 20_000 }, location: { type: String, default: '', maxlength: 20_000 } },
  { _id: false },
);

const gameSessionSchema = new Schema<GameSessionAttrs>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    gm_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currency_name: { type: String, default: 'Gold', trim: true },
    custom_banlist: { type: [String], default: [] },
    players: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    gm_notebook: { type: gmNotebookSchema, default: () => ({ history: '', location: '' }) },
  },
  { timestamps: true },
);

export const GameSession = model<GameSessionAttrs>('GameSession', gameSessionSchema);
