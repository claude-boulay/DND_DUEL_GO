import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Card } from '../models/Card.model';
import { CardSet, type CardSetDocument } from '../models/CardSet.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { syncCardSets, importCardsForSet } from '../services/cardImport';
import { toCardDto } from '../utils/cardDto';
import { buildCardCatalogQuery } from '../utils/cardQueryFilters';
import { resolveCardSet } from '../utils/resolveCardSet';

export const cardRouter = Router();
cardRouter.use(requireAuth);

/** Échappe les caractères spéciaux regex avant d'injecter une recherche utilisateur dans un $regex Mongo. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCardSetDto(set: CardSetDocument) {
  return {
    // Identifiant stable (voir CLAUDE.md — set_code seul n'est pas unique
    // dans les vraies données) : à utiliser pour toute référence précise à
    // CE set précis (import, filtrage de cartes, article marchand...).
    id: set._id.toString(),
    set_code: set.set_code,
    set_name: set.set_name,
    num_of_cards: set.num_of_cards,
    tcg_date: set.tcg_date,
    set_image: set.set_image,
    imported: set.imported_at !== null,
    imported_at: set.imported_at,
    is_custom: set.is_custom,
    // Voir syncCardSets : true si ce set_code était partagé par 2+ sets
    // réellement différents lors de la dernière synchronisation — purement
    // informatif désormais (chaque variante est son propre document,
    // identifiée par `id`, plus par set_code seul).
    had_code_collision: set.had_code_collision,
  };
}

const listSetsSchema = z.object({
  refresh: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  // Par défaut, les boosters custom (créés depuis le panneau de cartes
  // custom) sont exclus : dans le panneau d'IMPORT, un faux bouton
  // "Importer" interrogerait l'API YGOPRODeck réelle pour un nom de set
  // fictif. Mais un autre appelant (ex. le sélecteur d'article de marchand)
  // a besoin de VOIR les boosters custom pour pouvoir les stocker — d'où ce
  // paramètre plutôt qu'une exclusion en dur.
  include_custom: z.enum(['true', 'false']).optional(),
});

cardRouter.get(
  '/sets',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { refresh, search, include_custom } = listSetsSchema.parse(req.query);

    const isEmpty = (await CardSet.estimatedDocumentCount()) === 0;
    if (refresh === 'true' || isEmpty) {
      await syncCardSets();
    }

    // Un booster custom appartient à SON créateur (CLAUDE.md §3.4, comme les
    // cartes custom elles-mêmes) — même avec include_custom=true, on ne
    // montre jamais le booster custom d'un AUTRE MJ.
    const filter: Record<string, unknown> =
      include_custom === 'true' ? { $or: [{ is_custom: { $ne: true } }, { is_custom: true, owner_id: req.user!.sub }] } : { is_custom: { $ne: true } };
    if (search) filter.set_name = { $regex: escapeRegex(search), $options: 'i' };
    const sets = await CardSet.find(filter).sort({ set_name: 1 }).limit(500);
    res.json({ sets: sets.map(toCardSetDto) });
  }),
);

cardRouter.post(
  '/sets/:id/import',
  asyncHandler(async (req, res) => {
    const id = req.params.id!;
    if (!Types.ObjectId.isValid(id)) throw new AppError(400, 'Identifiant de set invalide', 'invalid_input');
    try {
      const result = await importCardsForSet(id);
      res.json({ set_name: result.setName, imported_count: result.importedCount });
    } catch (error) {
      throw new AppError(400, error instanceof Error ? error.message : 'Import impossible', 'import_failed');
    }
  }),
);

// Paramètres CSV ("monster,spell" -> ['monster','spell']) : le front envoie
// les mêmes dimensions que sa modale de filtre (voir cardFilters.ts), pour
// que le catalogue entier soit interrogé côté serveur au lieu de filtrer une
// page déjà chargée côté client.
const csvParam = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined));

const listCardsSchema = z.object({
  // Identifiant précis (voir toCardSetDto) — préféré à set_code, ambigu
  // depuis qu'une même valeur peut désigner 2+ sets réels distincts.
  set_id: z.string().trim().optional(),
  // Repli précis quand set_id est absent (voir resolveCardSet) — set_name
  // est le snapshot déjà capturé partout où un set est référencé (article
  // marchand, booster scellé...), donc quasi toujours disponible même pour
  // une donnée créée avant l'introduction de set_id.
  set_name: z.string().trim().optional(),
  // Dernier repli seul (appels non encore migrés) : en cas de collision,
  // résout arbitrairement vers LE PREMIER set trouvé avec ce code — un vrai
  // besoin de précision doit passer par set_id (ou au moins set_name).
  set_code: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
  category: csvParam,
  monster_kind: csvParam,
  pendulum: z.enum(['true', 'false']).optional(),
  attribute: csvParam,
  race: csvParam,
  page: z.coerce.number().int().min(1).default(1),
  // Plafond relevé (voir CLAUDE.md) : un aperçu de contenu de booster (100
  // cartes plafond auparavant) coupait silencieusement le vrai contenu d'un
  // gros set réel (ex. LOB, 126 cartes distinctes) — jamais assez pour un
  // seul vrai booster officiel connu.
  limit: z.coerce.number().int().min(1).max(500).default(30),
});

cardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { set_id, set_name, set_code, search, category, monster_kind, pendulum, attribute, race, page, limit } = listCardsSchema.parse(req.query);

    const filter: Record<string, unknown> = {};
    if (set_id || set_name || set_code) {
      // Card.card_sets[].set_code est le code PAR CARTE (ex. "LOB-041"), pas le
      // code du set (ex. "LOB") : on résout via CardSet.set_name, le vrai lien
      // entre une carte et le set auquel elle appartient — set_name reste
      // fiable même en cas de collision de set_code (voir syncCardSets).
      const cardSet = await resolveCardSet({ cardSetId: set_id, setCode: set_code ?? '', setName: set_name });
      if (!cardSet) {
        res.json({ cards: [], total: 0, page, limit });
        return;
      }
      filter['card_sets.set_name'] = cardSet.set_name;
    }
    if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };

    Object.assign(
      filter,
      buildCardCatalogQuery({
        categories: category,
        monsterKinds: monster_kind,
        pendulumOnly: pendulum === 'true',
        attributes: attribute,
        races: race,
      }),
    );

    const [cards, total] = await Promise.all([
      Card.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Card.countDocuments(filter),
    ]);

    res.json({ cards: cards.map(toCardDto), total, page, limit });
  }),
);
