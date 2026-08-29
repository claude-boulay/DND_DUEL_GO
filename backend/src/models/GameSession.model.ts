import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface GameSessionAttrs {
  code: string;
  gm_id: Types.ObjectId;
  currency_name: string;
  custom_banlist: string[];
  players: Types.ObjectId[];
}

export type GameSessionDocument = HydratedDocument<GameSessionAttrs>;

const gameSessionSchema = new Schema<GameSessionAttrs>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    gm_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    currency_name: { type: String, default: 'Gold', trim: true },
    custom_banlist: { type: [String], default: [] },
    players: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true },
);

export const GameSession = model<GameSessionAttrs>('GameSession', gameSessionSchema);
