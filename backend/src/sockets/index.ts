import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';
import { corsOrigins } from '../config/env';
import { verifyToken } from '../utils/jwt';
import { rollDie } from '../utils/dice';
import { User } from '../models/User.model';
import { GameSession } from '../models/GameSession.model';
import { Character } from '../models/Character.model';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { recordRoll, getRoll, updateRollResult } from './rollStore';
import { appendAction, getRecentActions } from './actionLog';
import type {
  ActionLogEntry,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/socket';

export type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ZodError) return 'Requête invalide';
  return error instanceof Error ? error.message : fallback;
}

/** Toute action de jeu suppose un `join_game` réussi au préalable. */
function requireJoinedSession(socket: GameSocket): string {
  if (!socket.data.game_session_id || !socket.data.user_id) {
    throw new Error("Rejoignez un salon avec join_game avant de lancer les dés");
  }
  return socket.data.game_session_id;
}

const joinGameSchema = z.object({ token: z.string().min(1), code: z.string().min(1) });

const rollDiceSchema = z.object({
  sides: z.number().int().min(2).max(1000).optional(),
  character_id: z.string().optional(),
  label: z.string().max(200).optional(),
});

const rerollDiceSchema = z.object({ roll_id: z.string().min(1) });

export function createSocketServer(httpServer: HttpServer): GameServer {
  const io: GameServer = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  io.on('connection', (socket: GameSocket) => {
    console.log(`[socket] Connexion ${socket.id}`);

    socket.emit('server_hello', {
      socket_id: socket.id,
      server_time: new Date().toISOString(),
    });

    socket.on('ping_server', ({ sent_at }) => {
      socket.emit('pong_server', { sent_at, server_time: new Date().toISOString() });
    });

    socket.on('join_game', async (payload) => {
      try {
        const { token, code } = joinGameSchema.parse(payload);
        const jwtPayload = verifyToken(token);

        const user = await User.findById(jwtPayload.sub);
        if (!user) throw new Error('Utilisateur introuvable');

        const session = await GameSession.findOne({ code: code.trim().toUpperCase() });
        if (!session) throw new Error('Salon introuvable');
        if (!isSessionMember(session, user._id.toString())) {
          throw new Error("Vous n'êtes pas membre de ce salon");
        }

        socket.data.user_id = user._id.toString();
        socket.data.username = user.username;
        socket.data.game_session_id = session._id.toString();

        await socket.join(session._id.toString());

        socket.emit('game_joined', {
          session_id: session._id.toString(),
          code: session.code,
          recent_actions: getRecentActions(session._id.toString()),
        });
      } catch (error) {
        socket.emit('error_message', {
          code: 'join_failed',
          message: errorMessage(error, 'Impossible de rejoindre le salon'),
        });
      }
    });

    socket.on('roll_dice', async (payload) => {
      try {
        const sessionId = requireJoinedSession(socket);
        const { sides = 20, character_id, label } = rollDiceSchema.parse(payload);

        let character = null;
        if (character_id) {
          if (!Types.ObjectId.isValid(character_id)) throw new Error('Identifiant de personnage invalide');
          character = await Character.findById(character_id);
          if (!character || character.game_session_id.toString() !== sessionId) {
            throw new Error('Personnage introuvable dans ce salon');
          }

          const session = await GameSession.findById(sessionId);
          const isOwner = character.user_id.toString() === socket.data.user_id;
          const isGm = session ? isSessionGm(session, socket.data.user_id!) : false;
          if (!isOwner && !isGm) throw new Error('Vous ne pouvez pas lancer les dés pour ce personnage');
        }

        const result = rollDie(sides);
        const pending = recordRoll(sessionId, character ? character._id.toString() : null, sides, result);

        const entry: ActionLogEntry = {
          roll_id: pending.rollId,
          user_id: socket.data.user_id!,
          username: socket.data.username!,
          character_id: character ? character._id.toString() : null,
          character_name: character ? character.name : null,
          sides,
          result,
          is_reroll: false,
          previous_result: null,
          rerolls_remaining: character ? character.remaining_luck_rerolls : null,
          label: label ?? null,
          rolled_at: new Date().toISOString(),
        };

        appendAction(sessionId, entry);
        io.to(sessionId).emit('dice_rolled', entry);
      } catch (error) {
        socket.emit('error_message', { code: 'roll_failed', message: errorMessage(error, 'Lancer impossible') });
      }
    });

    socket.on('reroll_dice', async (payload) => {
      try {
        const sessionId = requireJoinedSession(socket);
        const { roll_id } = rerollDiceSchema.parse(payload);

        const pending = getRoll(roll_id);
        if (!pending || pending.sessionId !== sessionId) throw new Error('Lancer introuvable');
        if (!pending.characterId) throw new Error("Ce lancer n'est associé à aucun personnage");

        const character = await Character.findById(pending.characterId);
        if (!character || character.game_session_id.toString() !== sessionId) {
          throw new Error('Personnage introuvable dans ce salon');
        }

        const session = await GameSession.findById(sessionId);
        const isOwner = character.user_id.toString() === socket.data.user_id;
        const isGm = session ? isSessionGm(session, socket.data.user_id!) : false;
        if (!isOwner && !isGm) throw new Error('Vous ne pouvez pas relancer ce jet');

        // Décrément atomique conditionné à un solde positif : anti-triche même
        // en cas de doubles clics/requêtes concurrentes sur le même personnage.
        const updated = await Character.findOneAndUpdate(
          { _id: character._id, remaining_luck_rerolls: { $gt: 0 } },
          { $inc: { remaining_luck_rerolls: -1 } },
          { new: true },
        );
        if (!updated) throw new Error('Plus de reroll de Chance disponible pour ce personnage');

        const previousResult = pending.result;
        const newResult = rollDie(pending.sides);
        updateRollResult(roll_id, newResult);

        const entry: ActionLogEntry = {
          roll_id,
          user_id: socket.data.user_id!,
          username: socket.data.username!,
          character_id: updated._id.toString(),
          character_name: updated.name,
          sides: pending.sides,
          result: newResult,
          is_reroll: true,
          previous_result: previousResult,
          rerolls_remaining: updated.remaining_luck_rerolls,
          label: null,
          rolled_at: new Date().toISOString(),
        };

        appendAction(sessionId, entry);
        io.to(sessionId).emit('dice_rerolled', entry);
      } catch (error) {
        socket.emit('error_message', { code: 'reroll_failed', message: errorMessage(error, 'Reroll impossible') });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] Déconnexion ${socket.id} (${reason})`);
    });
  });

  return io;
}
