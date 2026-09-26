import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Merchant, type MerchantDocument } from '../models/Merchant.model';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { earliestPrintRarity, sellPriceForRarity } from '../utils/cardSellPrice';
import { Character, type CharacterDocument } from '../models/Character.model';
import type { GameSessionDocument } from '../models/GameSession.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { loadSessionOrThrow } from '../utils/loaders';
import { rollDie } from '../utils/dice';
import { broadcastSessionResourceChanged } from '../utils/broadcast';
import { effectiveStat } from '../utils/luck';
import { abilityModifier } from '../utils/abilityScore';
import { consumeHaggle, getHaggle, recordHaggle, updateHaggleRoll, type PendingHaggle } from '../utils/haggleStore';
import { resolveCardSet } from '../utils/resolveCardSet';

export const merchantRouter = Router();
merchantRouter.use(requireAuth);

function toMerchantDto(merchant: MerchantDocument) {
  return {
    id: merchant._id.toString(),
    game_session_id: merchant.game_session_id.toString(),
    name: merchant.name,
    description: merchant.description,
    haggle_dc: merchant.haggle_dc,
    buys_cards: merchant.buys_cards,
    items: merchant.items.map((item) => ({
      id: item._id.toString(),
      item_type: item.item_type,
      card_id: item.card_id ? item.card_id.toString() : null,
      set_code: item.set_code,
      card_set_id: item.card_set_id ? item.card_set_id.toString() : null,
      name: item.name,
      image_url: item.image_url,
      price: item.price,
      stock: item.stock,
      haggle_dc: item.haggle_dc,
      haggle_discount_percent: item.haggle_discount_percent,
      promo_buy_quantity: item.promo_buy_quantity,
      promo_free_quantity: item.promo_free_quantity,
    })),
  };
}

async function loadMerchantOrThrow(merchantId: string): Promise<MerchantDocument> {
  if (!Types.ObjectId.isValid(merchantId)) throw new AppError(404, 'Marchand introuvable', 'not_found');
  const merchant = await Merchant.findById(merchantId);
  if (!merchant) throw new AppError(404, 'Marchand introuvable', 'not_found');
  return merchant;
}

/** Charge le marchand + vérifie que l'appelant est bien le MJ du salon associé. */
async function loadMerchantAsGmOrThrow(merchantId: string, userId: string): Promise<MerchantDocument> {
  const merchant = await loadMerchantOrThrow(merchantId);
  const session = await loadSessionOrThrow(merchant.game_session_id.toString());
  if (!isSessionGm(session, userId)) {
    throw new AppError(403, 'Seul le MJ peut gérer ce marchand', 'forbidden');
  }
  return merchant;
}

/** Personnage du même salon, contrôlé par l'appelant (son propre personnage) ou le MJ — même règle que pour l'achat. */
async function loadOwnedCharacterOrThrow(
  characterId: string,
  gameSessionId: string,
  session: GameSessionDocument,
  userId: string,
): Promise<CharacterDocument> {
  if (!Types.ObjectId.isValid(characterId)) throw new AppError(400, 'character_id invalide', 'invalid_input');
  const character = await Character.findById(characterId);
  if (!character || character.game_session_id.toString() !== gameSessionId) {
    throw new AppError(404, 'Personnage introuvable dans ce salon', 'not_found');
  }
  const isOwner = character.user_id.toString() === userId;
  const isGm = isSessionGm(session, userId);
  if (!isOwner && !isGm) {
    throw new AppError(403, 'Vous ne pouvez pas agir pour ce personnage', 'forbidden');
  }
  return character;
}

const createMerchantSchema = z.object({
  game_session_id: z.string(),
  name: z.string().trim().min(1).max(64),
  description: z.string().max(500).default(''),
  haggle_dc: z.number().int().min(1).max(30).default(15),
  buys_cards: z.boolean().default(false),
});

merchantRouter.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = createMerchantSchema.parse(req.body);
    if (!Types.ObjectId.isValid(body.game_session_id)) {
      throw new AppError(400, 'game_session_id invalide', 'invalid_input');
    }

    const session = await loadSessionOrThrow(body.game_session_id);
    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut créer un marchand', 'forbidden');
    }

    const merchant = await Merchant.create({
      game_session_id: session._id,
      name: body.name,
      description: body.description,
      haggle_dc: body.haggle_dc,
      buys_cards: body.buys_cards,
      items: [],
    });

    broadcastSessionResourceChanged(req, session._id.toString(), 'merchants');
    res.status(201).json({ merchant: toMerchantDto(merchant) });
  }),
);

merchantRouter.get(
  '/session/:sessionId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = req.params.sessionId!;
    if (!Types.ObjectId.isValid(sessionId)) throw new AppError(400, 'Identifiant de salon invalide', 'invalid_input');

    const session = await loadSessionOrThrow(sessionId);
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const merchants = await Merchant.find({ game_session_id: session._id }).sort({ createdAt: 1 });
    res.json({ merchants: merchants.map(toMerchantDto) });
  }),
);

merchantRouter.get(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    res.json({ merchant: toMerchantDto(merchant) });
  }),
);

const updateMerchantSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(500).optional(),
  haggle_dc: z.number().int().min(1).max(30).optional(),
  buys_cards: z.boolean().optional(),
});

merchantRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    const updates = updateMerchantSchema.parse(req.body);

    if (updates.name !== undefined) merchant.name = updates.name;
    if (updates.description !== undefined) merchant.description = updates.description;
    if (updates.haggle_dc !== undefined) merchant.haggle_dc = updates.haggle_dc;
    if (updates.buys_cards !== undefined) merchant.buys_cards = updates.buys_cards;
    await merchant.save();

    res.json({ merchant: toMerchantDto(merchant) });
  }),
);

merchantRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    await merchant.deleteOne();
    broadcastSessionResourceChanged(req, merchant.game_session_id.toString(), 'merchants');
    res.status(204).send();
  }),
);

const addItemSchema = z.object({
  item_type: z.enum(['card', 'booster']),
  card_id: z.string().optional(),
  // Préféré pour un article booster (voir CLAUDE.md — set_code seul
  // n'identifie pas un set de façon fiable). set_code reste accepté seul en
  // repli (résout arbitrairement vers le premier set trouvé avec ce code).
  set_id: z.string().optional(),
  set_code: z.string().optional(),
  price: z.number().int().min(0),
  stock: z.number().int().min(0).nullable().optional(),
  // Marchandage propre à cet article (voir Merchant.model.ts) : les deux
  // ensemble ou aucun des deux — un article négociable a forcément les deux,
  // sinon `success` ne voudrait jamais rien dire (voir la route .../haggle).
  haggle_dc: z.number().int().min(1).max(30).nullable().optional(),
  haggle_discount_percent: z.number().int().min(0).max(100).nullable().optional(),
  // Offre "achetés/offerts" (demande utilisateur, ex. "10 achetés, 1 offert")
  // — les deux ensemble ou aucun des deux, même convention que haggle_dc/
  // haggle_discount_percent (voir Merchant.model.ts).
  promo_buy_quantity: z.number().int().min(1).nullable().optional(),
  promo_free_quantity: z.number().int().min(1).nullable().optional(),
});

merchantRouter.post(
  '/:id/items',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    const body = addItemSchema.parse(req.body);

    let name: string;
    let imageUrl: string | null = null;
    let cardId: Types.ObjectId | null = null;
    let setCode: string | null = null;
    let cardSetId: Types.ObjectId | null = null;

    if (body.item_type === 'card') {
      if (!body.card_id || !Types.ObjectId.isValid(body.card_id)) {
        throw new AppError(400, 'card_id requis et valide pour un article de type carte', 'invalid_input');
      }
      const card = await Card.findById(body.card_id);
      if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');
      name = card.name;
      // Réel bug corrigé (rapporté par l'utilisateur : le zoom au survol d'une
      // carte vendue directement chez un marchand restait flou/illisible,
      // contrairement au zoom sur les cartes d'un contenu de booster, qui
      // lit `image_url` — pleine résolution — en direct) : `image_url_small`
      // est une miniature, jamais assez nette une fois agrandie à l'écran.
      // Voir aussi POST /:id/refresh-card-images pour les articles déjà
      // ajoutés avant ce correctif.
      imageUrl = card.card_images[0]?.image_url ?? null;
      cardId = card._id;
    } else {
      if (!body.set_id && !body.set_code) throw new AppError(400, 'set_id (ou set_code) requis pour un article de type booster', 'invalid_input');
      const cardSet =
        body.set_id && Types.ObjectId.isValid(body.set_id) ? await CardSet.findById(body.set_id) : await CardSet.findOne({ set_code: body.set_code });
      if (!cardSet) throw new AppError(404, 'Set introuvable', 'not_found');
      name = cardSet.set_name;
      setCode = cardSet.set_code;
      cardSetId = cardSet._id;
      imageUrl = cardSet.set_image;
    }

    merchant.items.push({
      _id: new Types.ObjectId(),
      item_type: body.item_type,
      card_id: cardId,
      set_code: setCode,
      card_set_id: cardSetId,
      name,
      image_url: imageUrl,
      price: body.price,
      stock: body.stock ?? null,
      haggle_dc: body.haggle_dc ?? null,
      haggle_discount_percent: body.haggle_discount_percent ?? null,
      promo_buy_quantity: body.promo_buy_quantity ?? null,
      promo_free_quantity: body.promo_free_quantity ?? null,
    });
    await merchant.save();

    res.status(201).json({ merchant: toMerchantDto(merchant) });
  }),
);

/**
 * Rattrapage pour les articles de type carte ajoutés AVANT le correctif
 * ci-dessus (voir POST /:id/items) : leur `image_url` stocké est encore la
 * miniature `image_url_small`, jamais assez nette pour le zoom au survol
 * (demande utilisateur directe). Ré-résout chaque article carte depuis sa
 * `Card` en base et réécrit `image_url` en pleine résolution. Les articles
 * booster ne sont jamais concernés (leur image vient de `CardSet.set_image`,
 * déjà en résolution normale, pas une miniature de carte).
 */
merchantRouter.post(
  '/:id/refresh-card-images',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);

    const cardItemIds = merchant.items.filter((item) => item.item_type === 'card' && item.card_id).map((item) => item.card_id!);
    const cards = await Card.find({ _id: { $in: cardItemIds } }).select('card_images');
    const imageById = new Map(cards.map((c) => [c._id.toString(), c.card_images[0]?.image_url ?? null]));

    let updatedCount = 0;
    for (const item of merchant.items) {
      if (item.item_type !== 'card' || !item.card_id) continue;
      const freshImage = imageById.get(item.card_id.toString());
      if (freshImage && freshImage !== item.image_url) {
        item.image_url = freshImage;
        updatedCount++;
      }
    }
    if (updatedCount > 0) await merchant.save();

    res.json({ merchant: toMerchantDto(merchant), updated_count: updatedCount });
  }),
);

const updateItemSchema = z.object({
  price: z.number().int().min(0).optional(),
  stock: z.number().int().min(0).nullable().optional(),
  haggle_dc: z.number().int().min(1).max(30).nullable().optional(),
  haggle_discount_percent: z.number().int().min(0).max(100).nullable().optional(),
  promo_buy_quantity: z.number().int().min(1).nullable().optional(),
  promo_free_quantity: z.number().int().min(1).nullable().optional(),
});

merchantRouter.patch(
  '/:id/items/:itemId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    const item = merchant.items.find((i) => i._id.toString() === req.params.itemId);
    if (!item) throw new AppError(404, 'Article introuvable', 'not_found');

    const updates = updateItemSchema.parse(req.body);
    if (updates.price !== undefined) item.price = updates.price;
    if (updates.stock !== undefined) item.stock = updates.stock;
    if (updates.haggle_dc !== undefined) item.haggle_dc = updates.haggle_dc;
    if (updates.haggle_discount_percent !== undefined) item.haggle_discount_percent = updates.haggle_discount_percent;
    if (updates.promo_buy_quantity !== undefined) item.promo_buy_quantity = updates.promo_buy_quantity;
    if (updates.promo_free_quantity !== undefined) item.promo_free_quantity = updates.promo_free_quantity;
    await merchant.save();

    res.json({ merchant: toMerchantDto(merchant) });
  }),
);

merchantRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    const index = merchant.items.findIndex((i) => i._id.toString() === req.params.itemId);
    if (index === -1) throw new AppError(404, 'Article introuvable', 'not_found');

    merchant.items.splice(index, 1);
    await merchant.save();

    res.json({ merchant: toMerchantDto(merchant) });
  }),
);

function toHaggleDto(haggle: PendingHaggle) {
  return {
    id: haggle.haggleId,
    item_id: haggle.itemId,
    character_id: haggle.characterId,
    modifier: haggle.modifier,
    discount_percent: haggle.discountPercent,
    dc: haggle.dc,
    roll: haggle.roll,
    total: haggle.total,
    success: haggle.success,
  };
}

const haggleRollSchema = z.object({
  character_id: z.string(),
});

/**
 * Modificateur de marchandage = modificateur de Charisme du personnage,
 * calculé côté serveur (jamais fourni par le client — "never trust client
 * state", CLAUDE.md §4) : +1 tous les 2 points au-dessus de 10 dans la
 * Charisme EFFECTIVE (avec le bonus de niveau, voir effectiveStat).
 * Remplace l'ancien modificateur libre saisi par le joueur à chaque
 * marchandage — demande utilisateur explicite (feedback de ses amis) pour
 * automatiser ce calcul, cohérent avec ce qui existe déjà pour les rerolls
 * de Chance (même formule, voir maxLuckRerolls).
 */
function haggleModifierFor(character: CharacterDocument): number {
  return abilityModifier(effectiveStat(character.stats.charisma, character.level));
}

/**
 * Lance le marchandage SANS acheter — sépare le jet de la confirmation
 * d'achat pour laisser le temps de voir le résultat et de dépenser un
 * reroll de Chance avant de valider, exactement comme pour n'importe quel
 * autre jet (voir sockets/index.ts `roll_dice`/`reroll_dice`, même
 * mécanique de reroll server-authoritative appliquée ici).
 */
merchantRouter.post(
  '/:id/items/:itemId/haggle',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const item = merchant.items.find((i) => i._id.toString() === req.params.itemId);
    if (!item) throw new AppError(404, 'Article introuvable', 'not_found');
    if (item.haggle_dc === null || item.haggle_discount_percent === null) {
      throw new AppError(400, "Cet article n'est pas négociable (le MJ n'a pas configuré de DC/remise)", 'not_negotiable');
    }

    const body = haggleRollSchema.parse(req.body);
    const character = await loadOwnedCharacterOrThrow(body.character_id, merchant.game_session_id.toString(), session, userId);

    const roll = rollDie(20);
    const haggle = recordHaggle({
      merchantId: merchant._id.toString(),
      itemId: item._id.toString(),
      characterId: character._id.toString(),
      modifier: haggleModifierFor(character),
      discountPercent: item.haggle_discount_percent,
      dc: item.haggle_dc,
      roll,
    });

    res.status(201).json({ haggle: toHaggleDto(haggle), remaining_luck_rerolls: character.remaining_luck_rerolls });
  }),
);

/** Dépense un reroll de Chance sur une négociation déjà lancée (pas encore utilisée pour un achat) — même garde anti-triche que reroll_dice. */
merchantRouter.post(
  '/:id/haggle/:haggleId/reroll',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const pending = getHaggle(req.params.haggleId!);
    if (!pending || pending.merchantId !== merchant._id.toString()) {
      throw new AppError(404, 'Négociation introuvable (peut-être expirée) — relancez le marchandage', 'not_found');
    }

    const character = await loadOwnedCharacterOrThrow(pending.characterId, merchant.game_session_id.toString(), session, userId);

    // Décrément atomique conditionné à un solde positif : anti-triche même en
    // cas de double clic/requêtes concurrentes — même garde que reroll_dice.
    const updated = await Character.findOneAndUpdate(
      { _id: character._id, remaining_luck_rerolls: { $gt: 0 } },
      { $inc: { remaining_luck_rerolls: -1 } },
      { new: true },
    );
    if (!updated) throw new AppError(400, 'Plus de reroll de Chance disponible pour ce personnage', 'no_rerolls_left');

    const roll = rollDie(20);
    const updatedHaggle = updateHaggleRoll(pending.haggleId, roll);
    if (!updatedHaggle) throw new AppError(404, 'Négociation introuvable (peut-être expirée)', 'not_found');

    res.json({ haggle: toHaggleDto(updatedHaggle), remaining_luck_rerolls: updated.remaining_luck_rerolls });
  }),
);

const purchaseSchema = z.object({
  character_id: z.string(),
  quantity: z.number().int().min(1).max(99).default(1),
  // Marchandage en un seul appel (pas de reroll possible) : juste "je
  // marchande ou pas" — le modificateur (Charisme du personnage) et la
  // remise sont calculés/configurés côté serveur (voir haggleModifierFor,
  // haggle_dc/haggle_discount_percent sur Merchant.model.ts). Absent = achat
  // plein tarif.
  haggle: z.object({}).optional(),
  // Négociation déjà lancée via POST .../haggle (+ éventuels rerolls de
  // Chance, voir POST .../haggle/:haggleId/reroll) — prioritaire sur
  // `haggle` si les deux sont fournis : reflète le résultat déjà VU et
  // accepté par le joueur, pas un nouveau tirage à l'aveugle dans cet appel.
  haggle_id: z.string().optional(),
});

merchantRouter.post(
  '/:id/items/:itemId/purchase',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const body = purchaseSchema.parse(req.body);

    const item = merchant.items.find((i) => i._id.toString() === req.params.itemId);
    if (!item) throw new AppError(404, 'Article introuvable', 'not_found');

    const character = await loadOwnedCharacterOrThrow(body.character_id, merchant.game_session_id.toString(), session, userId);

    // Jet server-authoritative (anti-triche) : le d20 est lancé ici (ou lu
    // depuis une négociation déjà tranchée via `haggle_id`), mais le
    // modificateur et la remise en cas de succès sont ceux que le MJ a
    // choisis pour cette négociation précise, pas une formule automatique.
    let haggleResult: {
      roll: number;
      modifier: number;
      total: number;
      dc: number;
      success: boolean;
      discount_percent: number;
    } | null = null;

    let unitPrice = item.price;
    if (body.haggle_id) {
      const pending = getHaggle(body.haggle_id);
      if (
        !pending ||
        pending.merchantId !== merchant._id.toString() ||
        pending.itemId !== item._id.toString() ||
        pending.characterId !== character._id.toString()
      ) {
        throw new AppError(404, 'Négociation introuvable (peut-être expirée) — relancez le marchandage', 'not_found');
      }
      // Consommée dès qu'elle sert à un achat, réussi ou non — jamais
      // rejouable (empêche de réutiliser le même bon résultat sur plusieurs
      // achats, ou de la garder "en réserve" indéfiniment).
      consumeHaggle(body.haggle_id);
      const discountPercent = pending.success ? pending.discountPercent : 0;
      unitPrice = Math.ceil(item.price * (1 - discountPercent / 100));
      haggleResult = { roll: pending.roll, modifier: pending.modifier, total: pending.total, dc: pending.dc, success: pending.success, discount_percent: discountPercent };
    } else if (body.haggle) {
      if (item.haggle_dc === null || item.haggle_discount_percent === null) {
        throw new AppError(400, "Cet article n'est pas négociable (le MJ n'a pas configuré de DC/remise)", 'not_negotiable');
      }
      const modifier = haggleModifierFor(character);
      const roll = rollDie(20);
      const total = roll + modifier;
      const success = total >= item.haggle_dc;
      const discountPercent = success ? item.haggle_discount_percent : 0;
      unitPrice = Math.ceil(item.price * (1 - discountPercent / 100));
      haggleResult = { roll, modifier, total, dc: item.haggle_dc, success, discount_percent: discountPercent };
    }

    const totalPrice = unitPrice * body.quantity;

    // Offre "achetés/offerts" (demande utilisateur, ex. "10 achetés, 1
    // offert") : pour chaque multiple ENTIER de promo_buy_quantity
    // effectivement payé, promo_free_quantity exemplaires de plus sont
    // livrés — jamais facturés (totalPrice ci-dessus reste basé sur
    // body.quantity seul), mais bien pris sur le stock (un exemplaire offert
    // reste un vrai exemplaire, pas une remise fictive).
    const bonusQuantity =
      item.promo_buy_quantity && item.promo_free_quantity
        ? Math.floor(body.quantity / item.promo_buy_quantity) * item.promo_free_quantity
        : 0;
    const deliveredQuantity = body.quantity + bonusQuantity;

    // 1) Stock (si fini) : décrément atomique conditionnel, pour la
    // quantité RÉELLEMENT livrée (payante + offerte). $elemMatch est
    // indispensable ici : sans lui, 'items._id' et 'items.stock' sont évalués
    // comme deux conditions indépendantes sur le tableau (l'une peut matcher
    // CET article, l'autre un article différent), et l'opérateur positionnel
    // $ peut alors modifier le mauvais élément du tableau.
    if (item.stock !== null) {
      const stockResult = await Merchant.updateOne(
        { _id: merchant._id, items: { $elemMatch: { _id: item._id, stock: { $gte: deliveredQuantity } } } },
        { $inc: { 'items.$.stock': -deliveredQuantity } },
      );
      if (stockResult.modifiedCount === 0) {
        throw new AppError(409, 'Stock insuffisant', 'insufficient_stock');
      }
    }

    // 2) Argent : décrément atomique conditionnel. Pas de transaction multi-
    // documents disponible (Mongo standalone) : en cas d'échec, on annule le
    // décrément de stock déjà appliqué à l'étape précédente.
    const updatedCharacter = await Character.findOneAndUpdate(
      { _id: character._id, money: { $gte: totalPrice } },
      { $inc: { money: -totalPrice } },
      { new: true },
    );
    if (!updatedCharacter) {
      if (item.stock !== null) {
        await Merchant.updateOne(
          { _id: merchant._id, items: { $elemMatch: { _id: item._id } } },
          { $inc: { 'items.$.stock': deliveredQuantity } },
        );
      }
      throw new AppError(402, 'Fonds insuffisants', 'insufficient_funds');
    }

    // 3) Livraison (quantité payante + offerte) : carte ajoutée directement à
    // la collection, booster mis de côté scellé (ouverture = action distincte
    // via /characters/:id/open-booster).
    if (item.item_type === 'card' && item.card_id) {
      const cardIdStr = item.card_id.toString();
      for (let i = 0; i < deliveredQuantity; i += 1) updatedCharacter.collection.push(cardIdStr);
    } else if (item.item_type === 'booster' && item.set_code) {
      // Rattrape card_set_id à l'achat pour un article ajouté avant ce champ
      // (voir CLAUDE.md) : item.name est déjà le set_name exact capturé à
      // l'ajout de l'article, donc resolveCardSet le retrouve précisément
      // sans avoir besoin d'une migration séparée — chaque achat FRAIS d'un
      // article existant se met de lui-même à jour.
      const resolvedCardSet = await resolveCardSet({ cardSetId: item.card_set_id?.toString(), setCode: item.set_code, setName: item.name });
      const resolvedCardSetId = resolvedCardSet?._id ?? item.card_set_id;

      const existing = resolvedCardSetId
        ? updatedCharacter.sealed_boosters.find((b) => b.card_set_id?.toString() === resolvedCardSetId.toString())
        : updatedCharacter.sealed_boosters.find((b) => b.set_code === item.set_code && !b.card_set_id);
      if (existing) {
        existing.quantity += deliveredQuantity;
        if (!existing.card_set_id && resolvedCardSetId) existing.card_set_id = resolvedCardSetId;
      } else {
        updatedCharacter.sealed_boosters.push({
          card_set_id: resolvedCardSetId,
          set_code: item.set_code,
          set_name: item.name,
          quantity: deliveredQuantity,
        });
      }
    }
    await updatedCharacter.save();

    const refreshedMerchant = await loadMerchantOrThrow(merchant._id.toString());

    res.json({
      merchant: toMerchantDto(refreshedMerchant),
      character: {
        id: updatedCharacter._id.toString(),
        money: updatedCharacter.money,
        collection: updatedCharacter.collection,
        sealed_boosters: updatedCharacter.sealed_boosters,
      },
      purchase: {
        item_type: item.item_type,
        quantity: body.quantity,
        bonus_quantity: bonusQuantity,
        delivered_quantity: deliveredQuantity,
        unit_price: unitPrice,
        total_price: totalPrice,
        haggle: haggleResult,
      },
    });
  }),
);

const sellItemSchema = z.object({
  card_id: z.string(),
  quantity: z.number().int().min(1).max(99).default(1),
});

// Plafond généreux (une collection réaliste ne dépasse pas des centaines
// d'entrées distinctes) — évite un abus trivial (des milliers d'entrées dans
// un seul appel) sans jamais gêner un usage normal, même "vendre toute une
// grosse collection d'un coup".
const sellCardsSchema = z.object({
  character_id: z.string(),
  items: z.array(sellItemSchema).min(1).max(200),
});

interface PricedSellItem {
  card_id: string;
  card_name: string;
  // `null` si la carte n'a aucun set référencé (custom jamais liée à un
  // booster) — voir sellPriceForRarity, replié sur le prix Commune.
  rarity: string | null;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

/**
 * Valide ET calcule le prix de chaque article d'une vente groupée, SANS
 * muter quoi que ce soit — réutilisé identiquement par la prévisualisation
 * (.../sell-cards/quote, demande utilisateur : voir le prix avant de vendre)
 * et l'exécution réelle (.../sell-cards), qui revalide toujours tout au
 * moment de vendre plutôt que de faire confiance à un devis potentiellement
 * obsolète (la collection/les decks ont pu changer entre-temps). Fusionne
 * les entrées répétant le même card_id (quantités additionnées) plutôt que
 * de les valider indépendamment, ce qui contournerait la vérification.
 */
async function priceSellItems(
  character: CharacterDocument,
  items: { card_id: string; quantity: number }[],
): Promise<{ priced: PricedSellItem[]; totalPrice: number }> {
  const quantityByCardId = new Map<string, number>();
  for (const item of items) {
    if (!Types.ObjectId.isValid(item.card_id)) throw new AppError(400, 'card_id invalide', 'invalid_input');
    quantityByCardId.set(item.card_id, (quantityByCardId.get(item.card_id) ?? 0) + item.quantity);
  }

  const cardIds = [...quantityByCardId.keys()];
  const cards = await Card.find({ _id: { $in: cardIds } });
  const cardById = new Map(cards.map((c) => [c._id.toString(), c]));

  const setNames = [...new Set(cards.flatMap((c) => c.card_sets.map((s) => s.set_name)))];
  const referencedSets = setNames.length ? await CardSet.find({ set_name: { $in: setNames } }) : [];
  const tcgDateBySetName = new Map(referencedSets.map((s) => [s.set_name, s.tcg_date]));

  const priced: PricedSellItem[] = [];
  let totalPrice = 0;
  for (const [cardId, quantity] of quantityByCardId) {
    const card = cardById.get(cardId);
    if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');

    // Même code ET même forme de message que POST .../decks/:deckId/cards
    // (voir errors.not_owned côté frontend, CLAUDE.md Phase 5 — un code ne se
    // catalogue que si TOUS ses sites d'appel partagent le même texte).
    const ownedCopies = character.collection.filter((id) => id === cardId).length;
    if (ownedCopies < quantity) {
      throw new AppError(
        400,
        `Vous ne possédez que ${ownedCopies} exemplaire(s) de « ${card.name} » dans votre collection`,
        'not_owned',
        { owned: ownedCopies, name: card.name },
      );
    }

    // Bloque tant qu'un seul exemplaire est utilisé dans un deck (décidé avec
    // l'utilisateur) — `collection` et `deck.cards` sont deux tableaux
    // indépendants (voir POST .../decks/:deckId/cards), donc vendre sans
    // vérifier pourrait faire passer un deck déjà construit sous le nombre de
    // copies réellement possédées, sans que le joueur s'en rende compte.
    const usedInDecks = character.decks.reduce((sum, deck) => sum + deck.cards.filter((id) => id === cardId).length, 0);
    if (usedInDecks > 0) {
      throw new AppError(409, `« ${card.name} » est utilisée dans un deck — retirez-la de vos decks avant de la vendre`, 'card_in_deck', { name: card.name });
    }

    const rarity = earliestPrintRarity(card, tcgDateBySetName);
    const unitPrice = sellPriceForRarity(rarity);
    const subtotal = unitPrice * quantity;
    totalPrice += subtotal;
    priced.push({ card_id: cardId, card_name: card.name, rarity, unit_price: unitPrice, quantity, subtotal });
  }

  return { priced, totalPrice };
}

/**
 * Devis de vente (demande utilisateur : prévisualiser le montant avant de
 * confirmer) — calcule tout mais ne mute rien. Mêmes vérifications que la
 * vente réelle (ownership, deck) pour que les erreurs (ex. "dans un deck")
 * soient déjà visibles avant la confirmation, pas seulement au clic final.
 */
merchantRouter.post(
  '/:id/sell-cards/quote',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    if (!merchant.buys_cards) {
      throw new AppError(400, "Ce marchand n'achète pas de cartes", 'not_buying_cards');
    }

    const body = sellCardsSchema.parse(req.body);
    const character = await loadOwnedCharacterOrThrow(body.character_id, merchant.game_session_id.toString(), session, userId);
    const { priced, totalPrice } = await priceSellItems(character, body.items);

    res.json({ items: priced, total_price: totalPrice });
  }),
);

/**
 * Rachat de cartes par un marchand (demande utilisateur) — vente groupée de
 * plusieurs cartes différentes en un seul appel (demande utilisateur
 * explicite : "vendre plusieurs cartes en même temps"). GM-only opt-in par
 * marchand (`Merchant.buys_cards`), prix calculé côté serveur depuis la
 * rareté de la PREMIÈRE édition connue de chaque carte (voir
 * utils/cardSellPrice.ts), jamais fourni par le client. Toute carte de la
 * collection est vendable, quelle que soit son origine réelle (booster, don
 * du MJ, import CSV) — décidé avec l'utilisateur, `collection` reste un
 * simple `string[]` sans tracer la provenance de chaque exemplaire. Un seul
 * document `Character` est modifié (collection + money) : pas besoin de
 * transaction multi-documents pour rester atomique, un simple `.save()`
 * suffit — validé entièrement (priceSellItems) AVANT toute mutation, donc
 * jamais de vente partielle en cas d'échec sur un article.
 */
merchantRouter.post(
  '/:id/sell-cards',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(merchant.game_session_id.toString());
    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    if (!merchant.buys_cards) {
      throw new AppError(400, "Ce marchand n'achète pas de cartes", 'not_buying_cards');
    }

    const body = sellCardsSchema.parse(req.body);
    const character = await loadOwnedCharacterOrThrow(body.character_id, merchant.game_session_id.toString(), session, userId);
    // Revalide tout ici (ne fait jamais confiance à un devis déjà vu côté
    // client — l'état a pu changer entre-temps, ex. la carte ajoutée à un
    // deck après l'appel à .../quote).
    const { priced, totalPrice } = await priceSellItems(character, body.items);

    for (const item of priced) {
      let remaining = item.quantity;
      for (let i = character.collection.length - 1; i >= 0 && remaining > 0; i -= 1) {
        if (character.collection[i] === item.card_id) {
          character.collection.splice(i, 1);
          remaining -= 1;
        }
      }
    }
    character.money += totalPrice;
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.json({
      character: { id: character._id.toString(), money: character.money, collection: character.collection },
      sale: { items: priced, total_price: totalPrice },
    });
  }),
);
