import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export type MerchantItemType = 'card' | 'booster';

export interface MerchantItemAttrs {
  _id: Types.ObjectId;
  item_type: MerchantItemType;
  // Rempli pour item_type === 'card', sinon null.
  card_id: Types.ObjectId | null;
  // Rempli pour item_type === 'booster' (référence CardSet.set_code), sinon null.
  set_code: string | null;
  // Snapshot pris à l'ajout (nom de la carte ou du set) : évite un join à
  // chaque consultation de la boutique, le stock/prix reste seul mutable.
  name: string;
  image_url: string | null;
  price: number;
  // null = stock illimité.
  stock: number | null;
}

export interface MerchantAttrs {
  game_session_id: Types.ObjectId;
  name: string;
  description: string;
  // DC du jet de Charisme pour le marchandage (CLAUDE.md §3.5).
  haggle_dc: number;
  items: MerchantItemAttrs[];
}

export type MerchantDocument = HydratedDocument<MerchantAttrs>;

const merchantItemSchema = new Schema<MerchantItemAttrs>({
  item_type: { type: String, enum: ['card', 'booster'], required: true },
  card_id: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
  set_code: { type: String, default: null },
  name: { type: String, required: true },
  image_url: { type: String, default: null },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: null, min: 0 },
});

const merchantSchema = new Schema<MerchantAttrs>(
  {
    game_session_id: { type: Schema.Types.ObjectId, ref: 'GameSession', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
    description: { type: String, default: '', maxlength: 500 },
    haggle_dc: { type: Number, default: 15, min: 1, max: 30 },
    items: { type: [merchantItemSchema], default: [] },
  },
  { timestamps: true },
);

merchantSchema.index({ game_session_id: 1 });

export const Merchant = model<MerchantAttrs>('Merchant', merchantSchema);
