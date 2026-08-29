import { Router } from 'express';
import { z } from 'zod';
import { Card } from '../models/Card.model';
import { CardSet, type CardSetDocument } from '../models/CardSet.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { syncCardSets, importCardsForSet } from '../services/cardImport';
import { toCardDto } from '../utils/cardDto';
import { buildCardCatalogQuery } from '../utils/cardQueryFilters';

export const cardRouter = Router();
cardRouter.use(requireAuth);

/** Échappe les caractères spéciaux regex avant d'injecter une recherche utilisateur dans un $regex Mongo. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCardSetDto(set: CardSetDocument) {
  return {
    set_code: set.set_code,
    set_name: set.set_name,
    num_of_cards: set.num_of_cards,
    tcg_date: set.tcg_date,
    set_image: set.set_image,
    imported: set.imported_at !== null,
    imported_at: set.imported_at,
  };
}

const listSetsSchema = z.object({
  refresh: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
});

cardRouter.get(
  '/sets',
  asyncHandler(async (req, res) => {
    const { refresh, search } = listSetsSchema.parse(req.query);

    const isEmpty = (await CardSet.estimatedDocumentCount()) === 0;
    if (refresh === 'true' || isEmpty) {
      await syncCardSets();
    }

    // Les boosters custom (créés depuis le panneau de cartes custom) ne sont
    // pas des sets YGOPRODeck : les exclure ici évite un faux bouton
    // "Importer" qui interrogerait l'API réelle pour un nom de set fictif.
    const filter: Record<string, unknown> = { is_custom: { $ne: true } };
    if (search) filter.set_name = { $regex: escapeRegex(search), $options: 'i' };
    const sets = await CardSet.find(filter).sort({ set_name: 1 }).limit(500);
    res.json({ sets: sets.map(toCardSetDto) });
  }),
);

const importParamsSchema = z.object({ setCode: z.string().trim().min(1) });

cardRouter.post(
  '/sets/:setCode/import',
  asyncHandler(async (req, res) => {
    const { setCode } = importParamsSchema.parse(req.params);
    try {
      const result = await importCardsForSet(setCode);
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
  set_code: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
  category: csvParam,
  monster_kind: csvParam,
  pendulum: z.enum(['true', 'false']).optional(),
  attribute: csvParam,
  race: csvParam,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

cardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { set_code, search, category, monster_kind, pendulum, attribute, race, page, limit } = listCardsSchema.parse(req.query);

    const filter: Record<string, unknown> = {};
    if (set_code) {
      // Card.card_sets[].set_code est le code PAR CARTE (ex. "LOB-041"), pas le
      // code du set (ex. "LOB") : on résout via CardSet.set_name, le vrai lien
      // entre une carte et le set auquel elle appartient.
      const cardSet = await CardSet.findOne({ set_code });
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
