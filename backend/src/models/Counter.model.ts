import { Schema, model } from 'mongoose';

/**
 * Compteurs atomiques génériques (pattern MongoDB classique pour un
 * équivalent d'auto-incrément). Utilisé pour l'instant uniquement par
 * engineCardCode.ts (allocation de codes moteur synthétiques pour les
 * cartes custom), mais volontairement générique par `_id` au cas où
 * d'autres compteurs deviennent utiles.
 */
export interface CounterAttrs {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterAttrs>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter = model<CounterAttrs>('Counter', counterSchema);
