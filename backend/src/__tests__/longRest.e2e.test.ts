import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Character } from '../models/Character.model';

/**
 * E2E : "long repos" (demande utilisateur) — le MJ recharge en une seule
 * action les rerolls de Chance de TOUS les personnages du salon (joueurs et
 * PNJ) à leur maximum, plutôt que de devoir le faire un par un.
 */
const app = createApp();
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

// Chance 20, niveau 1 -> effectiveLuck = 20 -> maxLuckRerolls = floor((20-10)/2) = 5.
// Coût point-buy (budget 27, plancher 8) : (13-8)*3 + (8-8) + (20-8) = 15+0+12 = 27.
const stats = { history: 13, perception: 13, intelligence: 13, charisma: 8, luck: 20 };

describe('Long repos : le MJ recharge les rerolls de Chance de tout le salon (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let npcId: string;
  let playerCharacterId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('lr_gm');
    player = await registerUser('lr_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const npc = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'PNJ Reposé', is_npc: true, stats })
      .expect(201);
    npcId = npc.body.character.id;

    const playerCharacter = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Joueur Reposé', is_npc: false, stats })
      .expect(201);
    playerCharacterId = playerCharacter.body.character.id;

    // Simule des rerolls déjà dépensés (comme après une vraie session de jeu).
    await Character.updateOne({ _id: npcId }, { $set: { remaining_luck_rerolls: 0 } });
    await Character.updateOne({ _id: playerCharacterId }, { $set: { remaining_luck_rerolls: 1 } });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it("un joueur (non MJ) ne peut pas déclencher le long repos", async () => {
    await request(app)
      .post(`/api/characters/session/${sessionId}/long-rest`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(403);
  });

  it('un identifiant de salon invalide est rejeté (400)', async () => {
    await request(app)
      .post('/api/characters/session/not-an-id/long-rest')
      .set('Authorization', `Bearer ${gm.token}`)
      .expect(400);
  });

  it('le MJ recharge tous les personnages (joueur ET PNJ) à leur maximum en une action', async () => {
    const res = await request(app)
      .post(`/api/characters/session/${sessionId}/long-rest`)
      .set('Authorization', `Bearer ${gm.token}`)
      .expect(200);

    const byId = new Map<string, number>(res.body.characters.map((c: { id: string; remaining_luck_rerolls: number }) => [c.id, c.remaining_luck_rerolls]));
    expect(byId.get(npcId)).toBe(5);
    expect(byId.get(playerCharacterId)).toBe(5);

    const npcInDb = await Character.findById(npcId);
    const playerInDb = await Character.findById(playerCharacterId);
    expect(npcInDb?.remaining_luck_rerolls).toBe(5);
    expect(playerInDb?.remaining_luck_rerolls).toBe(5);
  });
});
