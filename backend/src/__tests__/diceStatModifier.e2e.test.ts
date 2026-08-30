import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import http from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { createSocketServer } from '../sockets';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import type { ActionLogEntry, ClientToServerEvents, ServerToClientEvents } from '../types/socket';

/**
 * E2E : un lancer de dé lié à une statistique (demande utilisateur —
 * "dé de charisme, histoire...") ajoute automatiquement le modificateur de
 * cette stat (+1 tous les 2 points au-dessus de 10, même formule que les
 * rerolls de Chance) — calculé côté serveur, jamais fourni par le client
 * ("never trust client state", CLAUDE.md §4). Même harnais que
 * realtimeBroadcast.e2e.test.ts (vrai serveur HTTP + Socket.io, pas de mock).
 */
type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function waitForEvent<T>(socket: TypedClientSocket, event: keyof ServerToClientEvents, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout en attendant l'évènement "${String(event)}"`)), timeoutMs);
    socket.once(event as never, ((payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

const app = createApp();
const httpServer = http.createServer(app);
const io = createSocketServer(httpServer);
app.set('io', io);

const rand = Math.floor(Math.random() * 1e6);

interface AuthedUser {
  token: string;
  id: string;
}

async function registerUser(username: string): Promise<AuthedUser> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `${username}_${rand}`, email: `${username}_${rand}@example.com`, password: 'supersecret123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

describe('Lancer de dé lié à une stat : modificateur automatique (E2E)', () => {
  let baseUrl: string;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let characterId: string;
  let playerSocket: TypedClientSocket;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Port du serveur de test introuvable');
    baseUrl = `http://127.0.0.1:${address.port}`;

    player = await registerUser('dsm_player');
    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${player.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;

    // `player` est le MJ de cette session (créateur, voir POST /sessions
    // ci-dessus) — ne peut créer qu'un PNJ (voir characterCreation.e2e.test.ts),
    // sans incidence ici (le MJ contrôle aussi bien ses propres PNJ que
    // n'importe quel personnage de son salon).
    // Charisme 20, niveau 1 -> effectiveStat = 20 -> abilityModifier = floor((20-10)/2) = +5.
    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Testeuse Modificateur',
        is_npc: true,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    characterId = character.body.character.id;

    playerSocket = ioClient(baseUrl, { transports: ['websocket'], autoConnect: false }) as TypedClientSocket;
    playerSocket.connect();
    await new Promise<void>((resolve) => playerSocket.on('connect', resolve));
    const joined = waitForEvent<{ session_id: string }>(playerSocket, 'game_joined');
    playerSocket.emit('join_game', { token: player.token, code: sessionCode });
    await joined;
  });

  afterAll(async () => {
    playerSocket.disconnect();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('un jet avec stat=charisma force un d20 et ajoute le modificateur (+5) — jamais fourni par le client', async () => {
    const rolled = waitForEvent<ActionLogEntry>(playerSocket, 'dice_rolled');
    // sides=6 délibérément fourni pour vérifier qu'une stat FORCE bien un d20
    // (ignoré) ; aucun `modifier` envoyé par le client — purement calculé
    // côté serveur.
    playerSocket.emit('roll_dice', { sides: 6, character_id: characterId, stat: 'charisma' });

    const entry = await rolled;
    expect(entry.sides).toBe(20);
    expect(entry.modifier).toBe(5);
    expect(entry.stat).toBe('charisma');
    expect(entry.total).toBe(entry.result + 5);
    expect(entry.result).toBeGreaterThanOrEqual(1);
    expect(entry.result).toBeLessThanOrEqual(20);
  });

  it("un jet sans stat reste inchangé : pas de modificateur/total, sides respecté", async () => {
    const rolled = waitForEvent<ActionLogEntry>(playerSocket, 'dice_rolled');
    playerSocket.emit('roll_dice', { sides: 6, character_id: characterId });

    const entry = await rolled;
    expect(entry.sides).toBe(6);
    expect(entry.modifier).toBeNull();
    expect(entry.stat).toBeNull();
    expect(entry.total).toBeNull();
  });

  it("stat fournie SANS character_id est refusée (une stat appartient à un personnage)", async () => {
    const error = waitForEvent<{ code: string; message: string }>(playerSocket, 'error_message');
    playerSocket.emit('roll_dice', { stat: 'charisma' });
    const payload = await error;
    expect(payload.code).toBe('roll_failed');
  });

  it('un reroll conserve le même modificateur/stat (le personnage ne change pas entre-temps)', async () => {
    // Reroll gratuit, indépendant de la Chance de base (8) : solde forcé.
    const { Character } = await import('../models/Character.model');
    await Character.updateOne({ _id: characterId }, { $set: { remaining_luck_rerolls: 1 } });

    const rolled = waitForEvent<ActionLogEntry>(playerSocket, 'dice_rolled');
    playerSocket.emit('roll_dice', { character_id: characterId, stat: 'charisma' });
    const original = await rolled;

    const rerolled = waitForEvent<ActionLogEntry>(playerSocket, 'dice_rerolled');
    playerSocket.emit('reroll_dice', { roll_id: original.roll_id });
    const entry = await rerolled;

    expect(entry.modifier).toBe(5);
    expect(entry.stat).toBe('charisma');
    expect(entry.total).toBe(entry.result + 5);
    expect(entry.previous_result).toBe(original.result);
  });
});
