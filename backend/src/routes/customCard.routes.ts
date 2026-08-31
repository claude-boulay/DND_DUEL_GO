import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Card, type CardDocument } from '../models/Card.model';
import { CardSet, type CardSetDocument } from '../models/CardSet.model';
import { Merchant } from '../models/Merchant.model';
import { Character } from '../models/Character.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { loadSessionOrThrow } from '../utils/loaders';
import { CUSTOM_RARITIES, customCardInputSchema, deriveCardFields } from '../utils/customCardRules';
import { allocateEngineCode } from '../utils/engineCardCode';
import { toCardDto } from '../utils/cardDto';

export const customCardRouter = Router();
customCardRouter.use(requireAuth);

function toCustomCardDto(card: CardDocument, viewedFromSessionId?: string) {
  return {
    id: card._id.toString(),
    name: card.name,
    type: card.type,
    frame_type: card.frame_type,
    description: card.description,
    atk: card.atk,
    def: card.def,
    level_rank: card.level_rank,
    race: card.race,
    attribute: card.attribute,
    archetype: card.archetype,
    pendulum_scale: card.pendulum_scale,
    link_arrows: card.link_arrows,
    card_sets: card.card_sets,
    card_images: card.card_images,
    is_custom: true as const,
    // Le MJ doit pouvoir relire/corriger son script (voir CLAUDE.md §3.4 :
    // aucune carte custom automatisée sans un vrai script Lua fourni).
    lua_script: card.lua_script,
    owner_id: card.owner_id ? card.owner_id.toString() : null,
    created_in_session_id: card.created_in_session_id ? card.created_in_session_id.toString() : null,
    created_in_this_session: viewedFromSessionId
      ? card.created_in_session_id?.toString() === viewedFromSessionId
      : undefined,
  };
}

async function loadCustomCardOrThrow(cardId: string): Promise<CardDocument> {
  if (!Types.ObjectId.isValid(cardId)) throw new AppError(404, 'Carte introuvable', 'not_found');
  const card = await Card.findOne({ _id: cardId, is_custom: true });
  if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');
  return card;
}

function assertOwner(card: CardDocument, userId: string): void {
  if (card.owner_id?.toString() !== userId) {
    throw new AppError(403, "Vous n'êtes pas le créateur de cette carte custom", 'forbidden');
  }
}

// Un vrai script Lua est obligatoire (CLAUDE.md §3.4) : l'automatisation
// fiable d'un effet à partir d'un texte libre n'est pas possible, mais
// EXIGER le script réel du MJ l'est — il est chargé et exécuté par le
// moteur exactement comme un script officiel Project Ignis (voir
// engine/ocgcore/poc/server.cpp, commande CUSTOMSCRIPT). Vérification
// légère seulement (présence d'initial_effect) : pas de compilateur Lua
// disponible côté validation d'entrée, la vraie vérification a lieu quand
// le moteur charge le script au premier duel qui utilise la carte.
const luaScriptSchema = z
  .string()
  .trim()
  .min(1, 'Un script Lua est obligatoire pour automatiser cette carte')
  .max(20_000)
  .refine((s) => s.includes('initial_effect'), {
    message: "Le script doit définir initial_effect (voir la convention Project Ignis, ex. function s.initial_effect(c) ... end)",
  });

const createCustomCardSchema = z.object({
  game_session_id: z.string(),
  card: customCardInputSchema,
  lua_script: luaScriptSchema,
});

customCardRouter.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = createCustomCardSchema.parse(req.body);
    const userId = req.user!.sub;

    if (!Types.ObjectId.isValid(body.game_session_id)) {
      throw new AppError(400, 'game_session_id invalide', 'invalid_input');
    }
    const session = await loadSessionOrThrow(body.game_session_id);
    if (!isSessionGm(session, userId)) {
      throw new AppError(403, 'Seul le MJ peut créer une carte custom', 'forbidden');
    }

    const derived = deriveCardFields(body.card);
    const imageUrl = body.card.image_url?.trim();
    const engineCode = await allocateEngineCode();

    const card = await Card.create({
      name: body.card.name,
      type: derived.type,
      frame_type: derived.frame_type,
      description: body.card.effect_text,
      atk: derived.atk,
      def: derived.def,
      level_rank: derived.level_rank,
      race: derived.race,
      attribute: derived.attribute,
      archetype: body.card.archetype?.trim() || null,
      pendulum_scale: derived.pendulum_scale,
      link_arrows: derived.link_arrows,
      card_sets: [],
      card_images: imageUrl
        ? [{ image_id: 0, image_url: imageUrl, image_url_small: imageUrl, image_url_cropped: imageUrl }]
        : [],
      is_custom: true,
      owner_id: new Types.ObjectId(userId),
      created_in_session_id: session._id,
      engine_code: engineCode,
      lua_script: body.lua_script,
    });

    res.status(201).json({ card: toCustomCardDto(card, session._id.toString()) });
  }),
);

customCardRouter.get(
  '/session/:sessionId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = req.params.sessionId!;
    if (!Types.ObjectId.isValid(sessionId)) throw new AppError(400, 'Identifiant de salon invalide', 'invalid_input');

    const session = await loadSessionOrThrow(sessionId);
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    // Réutilisation inter-parties : toute carte custom créée par CE MJ, quelle
    // que soit la partie où elle est née, est disponible ici.
    const cards = await Card.find({ is_custom: true, owner_id: session.gm_id }).sort({ name: 1 });
    res.json({ cards: cards.map((c) => toCustomCardDto(c, sessionId)) });
  }),
);

customCardRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const card = await loadCustomCardOrThrow(req.params.id!);
    assertOwner(card, req.user!.sub);

    const body = z.object({ card: customCardInputSchema, lua_script: luaScriptSchema }).parse(req.body);
    const derived = deriveCardFields(body.card);
    const imageUrl = body.card.image_url?.trim();

    card.name = body.card.name;
    card.type = derived.type;
    card.frame_type = derived.frame_type;
    card.description = body.card.effect_text;
    card.atk = derived.atk;
    card.def = derived.def;
    card.level_rank = derived.level_rank;
    card.race = derived.race;
    card.attribute = derived.attribute;
    card.archetype = body.card.archetype?.trim() || null;
    card.pendulum_scale = derived.pendulum_scale;
    card.link_arrows = derived.link_arrows;
    card.card_images = imageUrl
      ? [{ image_id: 0, image_url: imageUrl, image_url_small: imageUrl, image_url_cropped: imageUrl }]
      : [];
    card.lua_script = body.lua_script;
    // Pas de réallocation d'engine_code : le passcode synthétique reste
    // stable pour cette carte même si son contenu change.

    await card.save();
    res.json({ card: toCustomCardDto(card) });
  }),
);

const updateImageSchema = z.object({ image_url: z.string().trim().min(1).optional() });

/**
 * Change UNIQUEMENT l'image — la mise à jour complète (PATCH /:id) exige de
 * renvoyer toute la carte + un script Lua (même validation qu'à la
 * création), trop lourd pour ce cas d'usage précis.
 */
customCardRouter.patch(
  '/:id/image',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const card = await loadCustomCardOrThrow(req.params.id!);
    assertOwner(card, req.user!.sub);

    const { image_url: imageUrl } = updateImageSchema.parse(req.body);
    card.card_images = imageUrl ? [{ image_id: 0, image_url: imageUrl, image_url_small: imageUrl, image_url_cropped: imageUrl }] : [];
    await card.save();

    res.json({ card: toCustomCardDto(card) });
  }),
);

customCardRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const card = await loadCustomCardOrThrow(req.params.id!);
    assertOwner(card, req.user!.sub);
    await card.deleteOne();
    res.status(204).send();
  }),
);

function randomSetCode(seed: string): string {
  const slug = seed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CUSTOM-${slug || 'SET'}-${suffix}`;
}

async function generateUniqueCustomSetCode(setName: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomSetCode(setName);
    const exists = await CardSet.exists({ set_code: code });
    if (!exists) return code;
  }
  throw new Error('Impossible de générer un code de booster custom unique');
}

const createBoosterSchema = z.object({
  game_session_id: z.string(),
  name: z.string().trim().min(1).max(64),
});

/**
 * Crée un booster custom VIDE (pas encore lié à une carte) — jusqu'ici, un
 * booster custom ne pouvait naître qu'en tant qu'effet de bord du lien d'une
 * première carte (`new_set_name` sur POST .../booster-link), obligeant à
 * déjà posséder une carte pour "réserver" le nom du booster. Cette route
 * permet au MJ de créer le booster D'ABORD, puis d'y ajouter des cartes
 * (existantes ou nouvelles) via booster-link comme avant.
 */
customCardRouter.post(
  '/boosters',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = createBoosterSchema.parse(req.body);
    const session = await loadSessionOrThrow(body.game_session_id);
    const userId = req.user!.sub;
    if (!isSessionGm(session, userId)) {
      throw new AppError(403, 'Seul le MJ peut créer un booster custom', 'forbidden');
    }

    const setCode = await generateUniqueCustomSetCode(body.name);
    const cardSet = await CardSet.create({
      set_name: body.name,
      set_code: setCode,
      num_of_cards: 0,
      tcg_date: null,
      imported_at: new Date(), // un booster custom n'a pas d'étape d'import
      is_custom: true,
      owner_id: new Types.ObjectId(userId),
    });

    res.status(201).json({ card_set: { set_code: cardSet.set_code, set_name: cardSet.set_name } });
  }),
);

async function loadOwnedCustomBoosterOrThrow(setCode: string, userId: string): Promise<CardSetDocument> {
  const cardSet = await CardSet.findOne({ set_code: setCode });
  if (!cardSet || !cardSet.is_custom) throw new AppError(404, 'Booster custom introuvable', 'not_found');
  if (cardSet.owner_id?.toString() !== userId) {
    throw new AppError(403, "Vous n'êtes pas le créateur de ce booster custom", 'forbidden');
  }
  return cardSet;
}

/**
 * Supprime un booster custom (vide ou non — les cartes qui y étaient liées ne
 * sont PAS supprimées, juste déliées, comme le fait déjà la suppression d'un
 * lien carte-booster individuel ci-dessus). Bloqué (409) si un marchand vend
 * encore ce booster, ou si un personnage possède déjà des exemplaires scellés
 * en attente d'ouverture — dans les deux cas la référence deviendrait
 * orpheline (l'ouverture échouerait avec "Set introuvable") si on laissait
 * passer ; le MJ doit d'abord retirer l'article du/des marchand(s) concernés
 * ou attendre que les exemplaires déjà distribués soient ouverts.
 */
customCardRouter.delete(
  '/boosters/:setCode',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const setCode = req.params.setCode!;
    const cardSet = await loadOwnedCustomBoosterOrThrow(setCode, req.user!.sub);

    const [merchantCount, characterCount] = await Promise.all([
      Merchant.countDocuments({ 'items.item_type': 'booster', 'items.set_code': setCode }),
      Character.countDocuments({ 'sealed_boosters.set_code': setCode }),
    ]);
    if (merchantCount > 0) {
      throw new AppError(409, 'Ce booster est encore en vente chez au moins un marchand — retirez-le de son inventaire avant de le supprimer', 'booster_in_use');
    }
    if (characterCount > 0) {
      throw new AppError(409, 'Au moins un personnage possède déjà des exemplaires scellés de ce booster — ils doivent être ouverts avant de le supprimer', 'booster_in_use');
    }

    await Card.updateMany({ 'card_sets.set_code': setCode }, { $pull: { card_sets: { set_code: setCode } } });
    await cardSet.deleteOne();

    res.status(204).send();
  }),
);

const linkExistingCardToBoosterSchema = z.object({
  card_id: z.string(),
  rarity: z.enum(CUSTOM_RARITIES).default('Common'),
});

/**
 * Lie une carte EXISTANTE — custom OU officielle — à un booster custom déjà
 * créé (demande utilisateur : "ajouter la possibilité de mettre des cartes
 * non custom dans les boosters custom"). Distinct de POST /:id/booster-link
 * ci-dessous (centré sur UNE carte custom, peut créer le booster à la volée)
 * : ici on part du BOOSTER et on y ajoute n'importe quelle carte déjà en
 * base — l'autorisation se fait donc sur la propriété du BOOSTER, pas de la
 * carte (une carte officielle n'a pas de propriétaire).
 *
 * Corrige au passage un vrai bug rapporté par l'utilisateur : le seul moyen
 * d'ajouter une carte à un booster custom était de choisir parmi les cartes
 * custom PAS ENCORE liées à CE booster (liste dérivée côté front) — dès que
 * toutes les cartes custom du salon étaient liées, l'UI d'ajout disparaissait
 * purement et simplement, sans plus aucun moyen d'en ajouter une autre. Le
 * front (CustomBoosterRow) bascule maintenant sur une recherche dans le
 * catalogue complet (officielles + custom), qui ne peut jamais être à sec.
 */
customCardRouter.post(
  '/boosters/:setCode/cards',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const setCode = req.params.setCode!;
    const cardSet = await loadOwnedCustomBoosterOrThrow(setCode, req.user!.sub);

    const body = linkExistingCardToBoosterSchema.parse(req.body);
    if (!Types.ObjectId.isValid(body.card_id)) throw new AppError(404, 'Carte introuvable', 'not_found');
    const card = await Card.findById(body.card_id);
    if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');
    // Une carte custom reste sous le contrôle exclusif de son créateur, même
    // pour l'ajouter à un booster que CE MÊME MJ possède par ailleurs
    // (CLAUDE.md §3.4) ; une carte officielle est une donnée de référence
    // partagée, sans propriétaire — l'appartenance du booster (déjà vérifiée
    // ci-dessus) suffit.
    if (card.is_custom && card.owner_id?.toString() !== req.user!.sub) {
      throw new AppError(403, "Vous n'êtes pas le créateur de cette carte custom", 'forbidden');
    }
    if (card.card_sets.some((s) => s.set_code === setCode)) {
      throw new AppError(400, 'Cette carte est déjà liée à ce booster', 'already_linked');
    }

    card.card_sets.push({
      set_name: cardSet.set_name,
      set_code: cardSet.set_code,
      set_rarity: body.rarity,
      set_rarity_code: '',
      set_price: '0',
    });
    await card.save();

    res.status(201).json({ card: toCardDto(card) });
  }),
);

customCardRouter.delete(
  '/boosters/:setCode/cards/:cardId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const setCode = req.params.setCode!;
    await loadOwnedCustomBoosterOrThrow(setCode, req.user!.sub);

    const cardId = req.params.cardId!;
    if (!Types.ObjectId.isValid(cardId)) throw new AppError(404, 'Carte introuvable', 'not_found');
    const card = await Card.findById(cardId);
    if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');

    const before = card.card_sets.length;
    card.card_sets = card.card_sets.filter((s) => s.set_code !== setCode);
    if (card.card_sets.length === before) {
      throw new AppError(404, "Cette carte n'est pas liée à ce booster", 'not_found');
    }
    await card.save();

    res.json({ card: toCardDto(card) });
  }),
);

const boosterLinkSchema = z
  .object({
    set_code: z.string().trim().min(1).optional(),
    new_set_name: z.string().trim().min(1).max(64).optional(),
    rarity: z.enum(CUSTOM_RARITIES).default('Common'),
  })
  .refine((v) => !!v.set_code !== !!v.new_set_name, {
    message: 'Fournissez soit set_code (booster existant), soit new_set_name (nouveau booster custom), pas les deux',
  });

customCardRouter.post(
  '/:id/booster-link',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const card = await loadCustomCardOrThrow(req.params.id!);
    assertOwner(card, req.user!.sub);

    const body = boosterLinkSchema.parse(req.body);
    const userId = req.user!.sub;

    let cardSet;
    if (body.new_set_name) {
      const setCode = await generateUniqueCustomSetCode(body.new_set_name);
      cardSet = await CardSet.create({
        set_name: body.new_set_name,
        set_code: setCode,
        num_of_cards: 0,
        tcg_date: null,
        imported_at: new Date(), // un booster custom n'a pas d'étape d'import
        is_custom: true,
        owner_id: new Types.ObjectId(userId),
      });
    } else {
      cardSet = await CardSet.findOne({ set_code: body.set_code });
      if (!cardSet) throw new AppError(404, 'Set introuvable', 'not_found');
    }

    if (card.card_sets.some((s) => s.set_code === cardSet.set_code)) {
      throw new AppError(400, 'Cette carte est déjà liée à ce booster', 'already_linked');
    }

    card.card_sets.push({
      set_name: cardSet.set_name,
      set_code: cardSet.set_code,
      set_rarity: body.rarity,
      set_rarity_code: '',
      set_price: '0',
    });
    await card.save();

    res.status(201).json({ card: toCustomCardDto(card), card_set: { set_code: cardSet.set_code, set_name: cardSet.set_name } });
  }),
);

customCardRouter.delete(
  '/:id/booster-link/:setCode',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const card = await loadCustomCardOrThrow(req.params.id!);
    assertOwner(card, req.user!.sub);

    const before = card.card_sets.length;
    card.card_sets = card.card_sets.filter((s) => s.set_code !== req.params.setCode);
    if (card.card_sets.length === before) {
      throw new AppError(404, 'Cette carte n’est pas liée à ce booster', 'not_found');
    }

    await card.save();
    res.json({ card: toCustomCardDto(card) });
  }),
);
