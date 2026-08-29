import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';

/**
 * E2E : retrouver ses parties (MJ et joueur) sans ressaisir le code, et
 * suppression d'une partie par son MJ avec nettoyage en cascade (personnages,
 * marchands) pour éviter l'accumulation de données orphelines.
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
    .send({
      username: `${username}_${rand}`,
      email: `${username}_${rand}@example.com`,
      password: 'supersecret123',
    })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

describe('Parties : retrouver ses sessions et suppression en cascade (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let outsider: AuthedUser;

  let sessionToKeepCode: string;
  let sessionToDeleteCode: string;
  let sessionToDeleteId: string;
  let characterId: string;
  let merchantId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('inscrit un MJ, un joueur et un tiers', async () => {
    gm = await registerUser('sess_gm');
    player = await registerUser('sess_player');
    outsider = await registerUser('sess_outsider');
  });

  it('le MJ crée deux parties, le joueur en rejoint une seule', async () => {
    const keep = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ currency_name: 'Gold' })
      .expect(201);
    sessionToKeepCode = keep.body.session.code;

    const toDelete = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ currency_name: 'Silver' })
      .expect(201);
    sessionToDeleteCode = toDelete.body.session.code;
    sessionToDeleteId = toDelete.body.session.id;

    await request(app)
      .post(`/api/sessions/${sessionToKeepCode}/join`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
  });

  it('GET /sessions/mine renvoie les parties du MJ (créateur), sans code à ressaisir', async () => {
    const res = await request(app).get('/api/sessions/mine').set('Authorization', `Bearer ${gm.token}`).expect(200);

    expect(res.body.sessions).toHaveLength(2);
    const codes = res.body.sessions.map((s: { code: string }) => s.code);
    expect(codes).toContain(sessionToKeepCode);
    expect(codes).toContain(sessionToDeleteCode);
    expect(res.body.sessions.every((s: { is_gm: boolean }) => s.is_gm)).toBe(true);
  });

  it('GET /sessions/mine renvoie au joueur uniquement la partie qu’il a rejointe', async () => {
    const res = await request(app).get('/api/sessions/mine').set('Authorization', `Bearer ${player.token}`).expect(200);

    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].code).toBe(sessionToKeepCode);
    expect(res.body.sessions[0].is_gm).toBe(false);
  });

  it('un tiers qui n’a jamais rejoint aucune partie reçoit une liste vide', async () => {
    const res = await request(app)
      .get('/api/sessions/mine')
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(200);
    expect(res.body.sessions).toEqual([]);
  });

  it("crée un personnage et un marchand dans la partie qui sera supprimée", async () => {
    const charRes = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({
        game_session_id: sessionToDeleteId,
        name: 'Personnage éphémère',
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    characterId = charRes.body.character.id;

    const merchantRes = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionToDeleteId, name: 'Marchand éphémère' })
      .expect(201);
    merchantId = merchantRes.body.merchant.id;
  });

  it('un joueur (pas MJ) ne peut pas supprimer la partie', async () => {
    await request(app)
      .delete(`/api/sessions/${sessionToDeleteCode}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(403);
  });

  it('un tiers non-membre ne peut pas supprimer la partie', async () => {
    await request(app)
      .delete(`/api/sessions/${sessionToDeleteCode}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });

  it('le MJ supprime sa partie : personnages et marchands associés disparaissent en cascade', async () => {
    await request(app).delete(`/api/sessions/${sessionToDeleteCode}`).set('Authorization', `Bearer ${gm.token}`).expect(204);

    await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${gm.token}`).expect(404);
    await request(app).get(`/api/merchants/${merchantId}`).set('Authorization', `Bearer ${gm.token}`).expect(404);
    await request(app).get(`/api/sessions/${sessionToDeleteCode}`).set('Authorization', `Bearer ${gm.token}`).expect(404);
  });

  it('la partie supprimée disparaît de la liste, la partie conservée reste accessible', async () => {
    const res = await request(app).get('/api/sessions/mine').set('Authorization', `Bearer ${gm.token}`).expect(200);
    const codes = res.body.sessions.map((s: { code: string }) => s.code);
    expect(codes).not.toContain(sessionToDeleteCode);
    expect(codes).toContain(sessionToKeepCode);
  });
});
