import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Merchant, type MerchantDocument } from '../models/Merchant.model';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
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
      haggle_dc: item.haggle_dc,
      haggle_discount_percent: item.haggle_discount_percent,
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
  // Marchandage propre à cet article (voir Merchant.model.ts) : les deux
  // ensemble ou aucun des deux — un article négociable a forcément les deux,
  // sinon `success` ne voudrait jamais rien dire (voir la route .../haggle).
  haggle_dc: z.number().int().min(1).max(30).nullable().optional(),
  haggle_discount_percent: z.number().int().min(0).max(100).nullable().optional(),
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
      if (!body.set_code) throw new AppError(400, 'set_code requis pour un article de type booster', 'invalid_input');
      const cardSet = await CardSet.findOne({ set_code: body.set_code });
      if (!cardSet) throw new AppError(404, 'Set introuvable', 'not_found');
      name = cardSet.set_name;
      setCode = cardSet.set_code;
      imageUrl = cardSet.set_image;
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
      haggle_dc: body.haggle_dc ?? null,
      haggle_discount_percent: body.haggle_discount_percent ?? null,
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
