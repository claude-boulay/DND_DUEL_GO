import { Counter } from '../models/Counter.model';

/**
 * ocgcore identifie chaque carte par un "passcode" numérique (uint32). Les
 * cartes officielles utilisent directement leur `ygoprodeck_id` réel (déjà
 * le vrai passcode). Les cartes custom n'en ont pas — on leur alloue un code
 * synthétique dans une plage réservée, largement au-dessus du plus grand
 * passcode officiel connu (8 chiffres, donc < 100 000 000), pour éviter
 * toute collision.
 */
// Exporté pour character.routes.ts (import .ydk) : un code >= ce seuil ne
// peut jamais être une carte officielle, donc jamais résolu via YGOPRODeck —
// inutile de tenter l'appel réseau pour un tel passcode absent de notre base
// (il désigne soit une carte custom d'un AUTRE MJ, jamais accessible, soit
// un passcode invalide).
export const CUSTOM_CODE_BASE = 500_000_000;
const COUNTER_ID = 'custom_card_engine_code';

/** Alloue le prochain code moteur synthétique disponible (atomique, jamais réutilisé). */
export async function allocateEngineCode(): Promise<number> {
  const counter = await Counter.findByIdAndUpdate(COUNTER_ID, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return CUSTOM_CODE_BASE + counter.seq;
}
