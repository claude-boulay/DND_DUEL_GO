import { Types } from 'mongoose';
import { CardSet, type CardSetDocument } from '../models/CardSet.model';

/**
 * Résout LE `CardSet` précis visé, en préférant toujours l'identifiant le
 * plus fiable disponible (voir CLAUDE.md — set_code seul n'identifie pas un
 * set de façon fiable, une même valeur pouvant désigner 2+ sets réels
 * distincts) :
 *   1. `cardSetId` — le plus précis, jamais ambigu.
 *   2. `(setCode, setName)` ensemble — composite unique confirmé sur les
 *      vraies données (voir syncCardSets) ; `setName` est quasi toujours
 *      déjà connu même quand `cardSetId` manque (snapshot capturé à l'ajout
 *      de l'article marchand / à l'achat, avant l'introduction de
 *      `card_set_id`), donc ce repli reste précis pour la quasi-totalité des
 *      données existant avant ce correctif — pas besoin de migration.
 *   3. `setCode` seul — dernier repli, ambigu, seulement si `setName` est
 *      lui-même absent (ne devrait normalement jamais arriver).
 */
export async function resolveCardSet(ref: { cardSetId?: string | null; setCode: string; setName?: string | null }): Promise<CardSetDocument | null> {
  if (ref.cardSetId && Types.ObjectId.isValid(ref.cardSetId)) {
    const byId = await CardSet.findById(ref.cardSetId);
    if (byId) return byId;
  }
  if (ref.setName) {
    const byComposite = await CardSet.findOne({ set_code: ref.setCode, set_name: ref.setName });
    if (byComposite) return byComposite;
  }
  return CardSet.findOne({ set_code: ref.setCode });
}
