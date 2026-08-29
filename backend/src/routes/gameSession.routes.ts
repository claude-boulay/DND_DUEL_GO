import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { GameSession, type GameSessionDocument } from '../models/GameSession.model';
import { Character } from '../models/Character.model';
import { Merchant } from '../models/Merchant.model';
import { Duel } from '../models/Duel.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { generateUniqueRoomCode } from '../utils/roomCode';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';

export const gameSessionRouter = Router();
gameSessionRouter.use(requireAuth);

function toSessionDto(session: GameSessionDocument, userId: string) {
  return {
    id: session._id.toString(),
    code: session.code,
    currency_name: session.currency_name,
    custom_banlist: session.custom_banlist,
    player_count: session.players.length,
    is_gm: isSessionGm(session, userId),
  };
}

const createSessionSchema = z.object({
  currency_name: z.string().trim().min(1).max(32).default('Gold'),
});

gameSessionRouter.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { currency_name } = createSessionSchema.parse(req.body ?? {});
    const code = await generateUniqueRoomCode();

    const session = await GameSession.create({
      code,
      gm_id: new Types.ObjectId(req.user?.sub),
      currency_name,
      custom_banlist: [],
      players: [],
    });

    res.status(201).json({ session: toSessionDto(session, req.user!.sub) });
  }),
);

// Doit être déclarée avant `/:code` : sinon Express tente de faire matcher
// "mine" comme un code de salon (échec du regex YGO-XXXX).
gameSessionRouter.get(
  '/mine',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.sub;
    const sessions = await GameSession.find({
      $or: [{ gm_id: userId }, { players: userId }],
    }).sort({ updatedAt: -1 });

    res.json({ sessions: sessions.map((session) => toSessionDto(session, userId)) });
  }),
);

const codeParamSchema = z.string().trim().toUpperCase().regex(/^YGO-\d{4}$/, 'Format de code invalide');

gameSessionRouter.post(
  '/:code/join',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const code = codeParamSchema.parse(req.params.code);
    const session = await GameSession.findOne({ code });
    if (!session) throw new AppError(404, 'Salon introuvable', 'not_found');

    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      session.players.push(new Types.ObjectId(userId));
      await session.save();
    }

    res.json({ session: toSessionDto(session, userId) });
  }),
);

gameSessionRouter.get(
  '/:code',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const code = codeParamSchema.parse(req.params.code);
    const session = await GameSession.findOne({ code });
    if (!session) throw new AppError(404, 'Salon introuvable', 'not_found');

    const userId = req.user!.sub;
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, 'Accès refusé à ce salon', 'forbidden');
    }

    res.json({ session: toSessionDto(session, userId) });
  }),
);

gameSessionRouter.delete(
  '/:code',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const code = codeParamSchema.parse(req.params.code);
    const session = await GameSession.findOne({ code });
    if (!session) throw new AppError(404, 'Salon introuvable', 'not_found');

    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut supprimer ce salon', 'forbidden');
    }

    // Nettoyage en cascade pour éviter l'accumulation de données orphelines
    // (personnages/marchands d'une partie terminée). Card/CardSet restent :
    // ce sont des données de référence partagées entre toutes les parties.
    await Promise.all([
      Character.deleteMany({ game_session_id: session._id }),
      Merchant.deleteMany({ game_session_id: session._id }),
      Duel.deleteMany({ game_session_id: session._id }),
    ]);
    await session.deleteOne();

    res.status(204).send();
  }),
);
