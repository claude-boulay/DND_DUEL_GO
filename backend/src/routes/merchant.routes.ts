import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Merchant, type MerchantDocument } from '../models/Merchant.model';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { Character } from '../models/Character.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { loadSessionOrThrow } from '../utils/loaders';
import { rollDie } from '../utils/dice';
import { broadcastSessionResourceChanged } from '../utils/broadcast';

export const merchantRouter = Router();
merchantRouter.use(requireAuth);

function toMerchantDto(merchant: MerchantDocument) {
  return {
    id: merchant._id.toString(),
    game_session_id: merchant.game_session_id.toString(),
    name: merchant.name,
    description: merchant.description,
    haggle_dc: merchant.haggle_dc,
    items: merchant.items.map((item) => ({
      id: item._id.toString(),
      item_type: item.item_type,
      card_id: item.card_id ? item.card_id.toString() : null,
      set_code: item.set_code,
      name: item.name,
      image_url: item.image_url,
      price: item.price,
      stock: item.stock,
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

const createMerchantSchema = z.object({
  game_session_id: z.string(),
  name: z.string().trim().min(1).max(64),
  description: z.string().max(500).default(''),
  haggle_dc: z.number().int().min(1).max(30).default(15),
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
});

merchantRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const merchant = await loadMerchantAsGmOrThrow(req.params.id!, req.user!.sub);
    const updates = updateMerchantSchema.parse(req.body);

    if (updates.name !== undefined) merchant.name = updates.name;
    if (updates.description !== undefined) merchant.description = updates.description;
    if (updates.haggle_dc !== undefined) merchant.haggle_dc = updates.haggle_dc;
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
  set_code: z.string().optional(),
  price: z.number().int().min(0),
  stock: z.number().int().min(0).nullable().optional(),
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

    if (body.item_type === 'card') {
      if (!body.card_id || !Types.ObjectId.isValid(body.card_id)) {
        throw new AppError(400, 'card_id requis et valide pour un article de type carte', 'invalid_input');
      }
      const card = await Card.findById(body.card_id);
      if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');
      name = card.name;
      imageUrl = card.card_images[0]?.image_url_small ?? null;
      cardId = card._id;
    } else {
      if (!body.set_code) throw new AppError(400, 'set_code requis pour un article de type booster', 'invalid_input');
      const cardSet = await CardSet.findOne({ set_code: body.set_code });
      if (!cardSet) throw new AppError(404, 'Set introuvable', 'not_found');
      name = cardSet.set_name;
      setCode = cardSet.set_code;
    }

    merchant.items.push({
      _id: new Types.ObjectId(),
      item_type: body.item_type,
      card_id: cardId,
      set_code: setCode,
      name,
      image_url: imageUrl,
      price: body.price,
      stock: body.stock ?? null,
    });
    await merchant.save();

    res.status(201).json({ merchant: toMerchantDto(merchant) });
  }),
);

const updateItemSchema = z.object({
  price: z.number().int().min(0).optional(),
  stock: z.number().int().min(0).nullable().optional(),
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

const purchaseSchema = z.object({
  character_id: z.string(),
  quantity: z.number().int().min(1).max(99).default(1),
  // Marchandage (CLAUDE.md §3.5) : le MJ arbitre les deux paramètres avant le
  // jet, comme à la table — le modificateur appliqué au d20 (contexte du
  // personnage/scène, pas nécessairement le modificateur de Charisme brut de
  // la fiche) et la remise accordée en cas de succès. Absent = achat plein tarif.
  haggle: z
    .object({
      modifier: z.number().int().min(-20).max(30),
      discount_percent: z.number().int().min(0).max(100),
    })
    .optional(),
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

    if (!Types.ObjectId.isValid(body.character_id)) {
      throw new AppError(400, 'character_id invalide', 'invalid_input');
    }
    const character = await Character.findById(body.character_id);
    if (!character || character.game_session_id.toString() !== merchant.game_session_id.toString()) {
      throw new AppError(404, 'Personnage introuvable dans ce salon', 'not_found');
    }
    const isOwner = character.user_id.toString() === userId;
    const isGm = isSessionGm(session, userId);
    if (!isOwner && !isGm) {
      throw new AppError(403, 'Vous ne pouvez pas acheter pour ce personnage', 'forbidden');
    }

    // Jet server-authoritative (anti-triche) : le d20 est lancé ici, mais le
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
    if (body.haggle) {
      const { modifier, discount_percent: chosenDiscount } = body.haggle;
      const roll = rollDie(20);
      const total = roll + modifier;
      const success = total >= merchant.haggle_dc;
      const discountPercent = success ? chosenDiscount : 0;
      unitPrice = Math.ceil(item.price * (1 - discountPercent / 100));
      haggleResult = { roll, modifier, total, dc: merchant.haggle_dc, success, discount_percent: discountPercent };
    }

    const totalPrice = unitPrice * body.quantity;

    // 1) Stock (si fini) : décrément atomique conditionnel. $elemMatch est
    // indispensable ici : sans lui, 'items._id' et 'items.stock' sont évalués
    // comme deux conditions indépendantes sur le tableau (l'une peut matcher
    // CET article, l'autre un article différent), et l'opérateur positionnel
    // $ peut alors modifier le mauvais élément du tableau.
    if (item.stock !== null) {
      const stockResult = await Merchant.updateOne(
        { _id: merchant._id, items: { $elemMatch: { _id: item._id, stock: { $gte: body.quantity } } } },
        { $inc: { 'items.$.stock': -body.quantity } },
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
          { $inc: { 'items.$.stock': body.quantity } },
        );
      }
      throw new AppError(402, 'Fonds insuffisants', 'insufficient_funds');
    }

    // 3) Livraison : carte ajoutée directement à la collection, booster mis de
    // côté scellé (ouverture = action distincte via /characters/:id/open-booster).
    if (item.item_type === 'card' && item.card_id) {
      const cardIdStr = item.card_id.toString();
      for (let i = 0; i < body.quantity; i += 1) updatedCharacter.collection.push(cardIdStr);
    } else if (item.item_type === 'booster' && item.set_code) {
      const existing = updatedCharacter.sealed_boosters.find((b) => b.set_code === item.set_code);
      if (existing) {
        existing.quantity += body.quantity;
      } else {
        updatedCharacter.sealed_boosters.push({ set_code: item.set_code, set_name: item.name, quantity: body.quantity });
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
        unit_price: unitPrice,
        total_price: totalPrice,
        haggle: haggleResult,
      },
    });
  }),
);
