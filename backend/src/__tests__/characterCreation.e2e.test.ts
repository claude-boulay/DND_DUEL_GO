import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';

/**
 * E2E : un personnage joueur par compte et par salon ; le MJ ne peut créer
 * que des PNJ, jamais un personnage joueur — demande utilisateur explicite,
 * en vue du calcul automatique du modificateur de stat lors des lancers de
 * dés (plusieurs personnages joueurs pour un même compte rendrait "le"
 * modificateur ambigu).
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

const stats = { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 };

describe('Un personnage joueur par salon ; le MJ ne crée que des PNJ (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('cc_gm');
    player = await registerUser('cc_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('le MJ ne peut pas créer de personnage joueur (is_npc: false rejeté)', async () => {
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'MJ Tente un Joueur', is_npc: false, stats })
      .expect(403);
  });

  it('le MJ peut créer autant de PNJ que voulu', async () => {
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'PNJ Un', is_npc: true, stats })
      .expect(201);
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'PNJ Deux', is_npc: true, stats })
      .expect(201);
  });

  it('un joueur crée son premier personnage sans problème, mais pas de second', async () => {
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Premier Personnage', is_npc: false, stats })
      .expect(201);

    const second = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Second Personnage', is_npc: false, stats })
      .expect(409);
    expect(second.body.error.code).toBe('already_has_character');
  });

  it("un joueur ne peut pas créer de PNJ (déjà interdit avant cette fonctionnalité, vérifié pour ne pas régresser)", async () => {
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Joueur Tente un PNJ', is_npc: true, stats })
      .expect(403);
  });

  it('un second joueur, dans le même salon, peut créer son propre personnage (la limite est par utilisateur, pas globale)', async () => {
    const otherPlayer = await registerUser('cc_player2');
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${otherPlayer.token}`).expect(200);
    await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${otherPlayer.token}`)
      .send({ game_session_id: sessionId, name: 'Personnage du Second Joueur', is_npc: false, stats })
      .expect(201);
  });
});
