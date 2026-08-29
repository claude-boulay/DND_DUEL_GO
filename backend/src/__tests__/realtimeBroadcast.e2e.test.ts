import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import http from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { createSocketServer } from '../sockets';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/socket';

/**
 * E2E : diffusion temps réel des changements de ressources REST (personnage
 * créé/supprimé, marchand créé/supprimé) aux autres membres du salon déjà
 * connectés. Avant cette fonctionnalité, un joueur déjà dans le salon ne
 * voyait un NPC/marchand ajouté par le MJ (ou un autre joueur rejoignant et
 * créant son personnage) qu'après avoir quitté et rejoint le salon (ou
 * rechargé la page).
 *
 * Contrairement aux autres fichiers e2e (supertest en direct sur `app`, sans
 * `.listen()`), ce test a besoin d'un vrai serveur HTTP + Socket.io en
 * écoute, pour qu'un client socket.io-client réel puisse s'y connecter et
 * recevoir les évènements diffusés par le serveur.
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

describe('Diffusion temps réel : personnages et marchands créés/supprimés par un autre membre (E2E)', () => {
  let baseUrl: string;
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
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

    gm = await registerUser('rt_gm');
    player = await registerUser('rt_player');

    const session = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ currency_name: 'Gold' })
      .expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

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

  it("le joueur déjà connecté est notifié quand le MJ crée un personnage (NPC), sans avoir rien demandé", async () => {
    const changed = waitForEvent<{ resource: string; session_id: string }>(playerSocket, 'session_resource_changed');

    const npc = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({
        game_session_id: sessionId,
        name: 'PNJ Notifié',
        is_npc: true,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);

    const payload = await changed;
    expect(payload.resource).toBe('characters');
    expect(payload.session_id).toBe(sessionId);

    // Confirme que la ressource existe bel et bien côté serveur (pas juste l'évènement) :
    // le joueur peut désormais la récupérer via un simple re-fetch REST.
    const list = await request(app).get(`/api/characters/session/${sessionId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(list.body.characters.some((c: { id: string }) => c.id === npc.body.character.id)).toBe(true);
  });

  it("le joueur déjà connecté est notifié quand un autre joueur rejoint et crée son personnage", async () => {
    const otherPlayer = await registerUser('rt_player2');
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${otherPlayer.token}`).expect(200);

    const changed = waitForEvent<{ resource: string }>(playerSocket, 'session_resource_changed');
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${otherPlayer.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Personnage du Second Joueur',
        is_npc: false,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);

    expect((await changed).resource).toBe('characters');
  });

  it('le joueur déjà connecté est notifié quand le MJ crée un marchand', async () => {
    const changed = waitForEvent<{ resource: string; session_id: string }>(playerSocket, 'session_resource_changed');

    await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Marchand Notifié' })
      .expect(201);

    const payload = await changed;
    expect(payload.resource).toBe('merchants');
    expect(payload.session_id).toBe(sessionId);
  });

  it('le joueur déjà connecté est notifié quand le MJ supprime ce marchand', async () => {
    const merchants = await request(app)
      .get(`/api/merchants/session/${sessionId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .expect(200);
    const merchantId = merchants.body.merchants[0].id;

    const changed = waitForEvent<{ resource: string }>(playerSocket, 'session_resource_changed');
    await request(app).delete(`/api/merchants/${merchantId}`).set('Authorization', `Bearer ${gm.token}`).expect(204);

    expect((await changed).resource).toBe('merchants');
  });

  it("le joueur déjà connecté est notifié quand le MJ modifie l'argent de SON personnage (régression : PATCH /characters/:id ne diffusait rien)", async () => {
    const created = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Personnage Argent Notifié',
        is_npc: false,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    const characterId = created.body.character.id as string;

    const changed = waitForEvent<{ resource: string; session_id: string }>(playerSocket, 'session_resource_changed');
    await request(app).patch(`/api/characters/${characterId}`).set('Authorization', `Bearer ${gm.token}`).send({ money: 500 }).expect(200);

    const payload = await changed;
    expect(payload.resource).toBe('characters');
    expect(payload.session_id).toBe(sessionId);

    // Confirme que la valeur est bien là côté serveur, pas juste l'évènement.
    const list = await request(app).get(`/api/characters/session/${sessionId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(list.body.characters.find((c: { id: string }) => c.id === characterId)?.money).toBe(500);
  });
});
