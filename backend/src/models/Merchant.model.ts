import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export type MerchantItemType = 'card' | 'booster';

export interface MerchantItemAttrs {
  _id: Types.ObjectId;
  item_type: MerchantItemType;
  // Rempli pour item_type === 'card', sinon null.
  card_id: Types.ObjectId | null;
  // Rempli pour item_type === 'booster' (snapshot d'affichage), sinon null.
  set_code: string | null;
  // Rempli pour item_type === 'booster' : référence sans ambiguïté LE
  // CardSet précis vendu (voir CLAUDE.md — set_code seul n'identifie pas un
  // set de façon fiable, une même valeur pouvant désigner 2+ sets réels
  // distincts). `null` uniquement pour un article ajouté avant ce correctif.
  card_set_id: Types.ObjectId | null;
  // Snapshot pris à l'ajout (nom de la carte ou du set) : évite un join à
  // chaque consultation de la boutique, le stock/prix reste seul mutable.
  name: string;
  image_url: string | null;
  price: number;
  // null = stock illimité.
  stock: number | null;
  // Marchandage PROPRE à cet article (CLAUDE.md §3.5) : le DC à battre et la
  // remise accordée en cas de succès sont configurés par le MJ une fois,
  // pour CET article précis — pas retapés à chaque tentative d'achat. null
  // sur l'un ou l'autre = article non négociable (prix plein uniquement).
  haggle_dc: number | null;
  haggle_discount_percent: number | null;
  // Offre "achetés/offerts" PROPRE à cet article (demande utilisateur, ex.
  // "10 achetés, 1 offert") : pour chaque multiple entier de
  // promo_buy_quantity effectivement acheté, promo_free_quantity exemplaires
  // supplémentaires sont livrés en plus, gratuitement — le stock, lui, est
  // bien décrémenté pour la totalité livrée (un exemplaire offert reste un
  // vrai exemplaire pris sur le stock). null sur l'un ou l'autre = pas
  // d'offre (même convention que haggle_dc/haggle_discount_percent).
  promo_buy_quantity: number | null;
  promo_free_quantity: number | null;
}

export interface MerchantAttrs {
  game_session_id: Types.ObjectId;
  name: string;
  description: string;
  // DC "par défaut" proposé au MJ quand il ajoute un nouvel article (voir
  // MerchantShopOverlay.tsx côté front) — n'est plus consulté par le
  // marchandage lui-même depuis que le DC/la remise sont configurés PAR
  // ARTICLE (voir MerchantItemAttrs.haggle_dc), un même marchand pouvant
  // avoir des articles à négocier très différemment les uns des autres.
  haggle_dc: number;
  items: MerchantItemAttrs[];
}

export type MerchantDocument = HydratedDocument<MerchantAttrs>;

const merchantItemSchema = new Schema<MerchantItemAttrs>({
  item_type: { type: String, enum: ['card', 'booster'], required: true },
  card_id: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
  set_code: { type: String, default: null },
  card_set_id: { type: Schema.Types.ObjectId, ref: 'CardSet', default: null },
  name: { type: String, required: true },
  image_url: { type: String, default: null },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: null, min: 0 },
  haggle_dc: { type: Number, default: null, min: 1, max: 30 },
  haggle_discount_percent: { type: Number, default: null, min: 0, max: 100 },
  promo_buy_quantity: { type: Number, default: null, min: 1 },
  promo_free_quantity: { type: Number, default: null, min: 1 },
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
