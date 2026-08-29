import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import http from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { createSocketServer } from '../sockets';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { Character } from '../models/Character.model';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/socket';

/**
 * E2E : un joueur déjà connecté (socket) reçoit une convocation explicite
 * (`duel_invite`) quand le MJ crée un duel où son personnage participe — pas
 * juste le `session_resource_changed('duels')` générique déjà émis (couvert
 * par realtimeBroadcast.e2e.test.ts), qui ne dit que "la liste a changé", pas
 * "c'est VOUS qu'on attend". Combine le pattern serveur HTTP+Socket.io réel de
 * realtimeBroadcast.e2e.test.ts avec les helpers de création de duel de
 * duel.e2e.test.ts (deck minimal, cartes officielles seedées).
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

/** Résout après `ms` sans qu'aucune occurrence de `event` n'ait été reçue — pour prouver une ABSENCE de notification. */
function expectNoEvent<T>(socket: TypedClientSocket, event: keyof ServerToClientEvents, ms = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (payload: T) => {
      clearTimeout(timer);
      reject(new Error(`"${String(event)}" reçu alors qu'aucun n'était attendu : ${JSON.stringify(payload)}`));
    };
    socket.once(event as never, handler as never);
    const timer = setTimeout(() => {
      socket.off(event as never, handler as never);
      resolve();
    }, ms);
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

const stats = { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 };

async function createCharacter(token: string, sessionId: string, name: string, isNpc = false) {
  const res = await request(app)
    .post('/api/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({ game_session_id: sessionId, name, is_npc: isNpc, stats })
    .expect(201);
  return res.body.character as { id: string };
}

async function seedOfficialCard(code: number, name: string) {
  const card = await Card.create({
    ygoprodeck_id: code,
    engine_code: code,
    name,
    type: 'Normal Monster',
    frame_type: 'normal',
    description: 'Carte vanille de test.',
    atk: 1000,
    def: 1000,
    level_rank: 4,
    race: 'Warrior',
    attribute: 'EARTH',
    archetype: null,
    card_sets: [],
    card_images: [
      { image_id: code, image_url: `https://images.ygoprodeck.com/images/cards/${code}.jpg`, image_url_small: `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, image_url_cropped: `https://images.ygoprodeck.com/images/cards_cropped/${code}.jpg` },
    ],
    is_custom: false,
  });
  return card._id.toString();
}

async function buildDeck(token: string, characterId: string, cardId: string) {
  const deckRes = await request(app).post(`/api/characters/${characterId}/decks`).set('Authorization', `Bearer ${token}`).send({ name: 'Deck de Test' }).expect(201);
  const deckId = deckRes.body.character.decks[0].id as string;
  await request(app).post(`/api/characters/${characterId}/decks/${deckId}/cards`).set('Authorization', `Bearer ${token}`).send({ card_id: cardId, quantity: 3 }).expect(201);
  return deckId as string;
}

describe('Convocation temps réel à un duel (duel_invite) (E2E)', () => {
  let baseUrl: string;
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let gmSocket: TypedClientSocket;
  let playerSocket: TypedClientSocket;

  let playerChar: { id: string };
  let npcChar: { id: string };
  let playerDeckId: string;
  let npcDeckId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Port du serveur de test introuvable');
    baseUrl = `http://127.0.0.1:${address.port}`;

    gm = await registerUser('di_gm');
    player = await registerUser('di_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    playerChar = await createCharacter(player.token, sessionId, 'Duelliste Convoqué');
    npcChar = await createCharacter(gm.token, sessionId, 'Adversaire PNJ', true);

    const cardId = await seedOfficialCard(91152256 + rand, 'Carte de Convocation');
    await Character.updateOne({ _id: playerChar.id }, { $set: { collection: Array(3).fill(cardId) } });
    playerDeckId = await buildDeck(player.token, playerChar.id, cardId);
    npcDeckId = await buildDeck(gm.token, npcChar.id, cardId);

    const connectAndJoin = async (u: AuthedUser): Promise<TypedClientSocket> => {
      const s = ioClient(baseUrl, { transports: ['websocket'], autoConnect: false }) as TypedClientSocket;
      s.connect();
      await new Promise<void>((resolve) => s.on('connect', resolve));
      const joined = waitForEvent<{ session_id: string }>(s, 'game_joined');
      s.emit('join_game', { token: u.token, code: sessionCode });
      await joined;
      return s;
    };
    playerSocket = await connectAndJoin(player);
    gmSocket = await connectAndJoin(gm);
  });

  afterAll(async () => {
    playerSocket.disconnect();
    gmSocket.disconnect();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it("le joueur dont le personnage participe reçoit duel_invite avec le nom du duel et son propre personnage ; le MJ créateur ne figure jamais dans la liste des convoqués", async () => {
    // Diffusé à toute la salle (même convention que session_resource_changed,
    // voir sockets/index.ts) : le MJ REÇOIT bien l'évènement brut lui aussi
    // (il est dans la même salle Socket.io), mais son propre user_id ne doit
    // JAMAIS apparaître dans `participants` — c'est ce tableau que le
    // frontend filtre pour savoir s'il doit afficher la convocation, pas la
    // simple réception de l'évènement.
    const playerInvite = waitForEvent<{
      session_id: string;
      duel_id: string;
      duel_name: string;
      participants: Array<{ user_id: string; character_id: string; character_name: string; team: 0 | 1 }>;
    }>(playerSocket, 'duel_invite');
    const gmInvite = waitForEvent<{ participants: Array<{ user_id: string }> }>(gmSocket, 'duel_invite');

    const created = await request(app)
      .post('/api/duels')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Duel de Convocation',
        rules: {},
        teams: [
          { name: 'Camp Joueur', participants: [{ character_id: playerChar.id, deck_id: playerDeckId }] },
          { name: 'Camp PNJ', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
        ],
      })
      .expect(201);

    const payload = await playerInvite;
    expect(payload.session_id).toBe(sessionId);
    expect(payload.duel_id).toBe(created.body.duel.id);
    expect(payload.duel_name).toBe('Duel de Convocation');
    // Le PNJ n'a aucun utilisateur humain derrière : une seule entrée, pour le joueur.
    expect(payload.participants).toEqual([{ user_id: player.id, character_id: playerChar.id, character_name: 'Duelliste Convoqué', team: 0 }]);

    const gmPayload = await gmInvite;
    expect(gmPayload.participants.some((p) => p.user_id === gm.id)).toBe(false);
  });

  it("un duel entre deux PNJ (pure supervision MJ) ne génère aucune convocation", async () => {
    const npcChar2 = await createCharacter(gm.token, sessionId, 'Second PNJ', true);
    const cardId2 = await seedOfficialCard(41392891 + rand, 'Carte de Convocation 2');
    const npcDeckId2 = await buildDeck(gm.token, npcChar2.id, cardId2);

    const playerShouldNotBeInvited = expectNoEvent(playerSocket, 'duel_invite');

    await request(app)
      .post('/api/duels')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Duel Sans Joueur',
        rules: {},
        teams: [
          { name: 'Camp PNJ A', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
          { name: 'Camp PNJ B', participants: [{ character_id: npcChar2.id, deck_id: npcDeckId2 }] },
        ],
      })
      .expect(201);

    await playerShouldNotBeInvited;
  });
});
