import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { PasswordReset } from '../models/PasswordReset.model';

/**
 * E2E : mot de passe oublié (code envoyé par email, saisi pour choisir un
 * nouveau mot de passe). `sendPasswordResetEmail` est mocké (comme
 * `fetchCardsBySet` dans economy.e2e.test.ts) pour capturer le vrai code
 * généré — aucun SMTP réel n'est configuré en test, et le code est hashé en
 * base (jamais lisible directement), donc c'est le seul moyen de le récupérer.
 */
const sentEmails: Array<{ to: string; code: string }> = [];
vi.mock('../services/email', () => ({
  sendPasswordResetEmail: vi.fn(async (to: string, code: string) => {
    sentEmails.push({ to, code });
  }),
}));

const app = createApp();
const rand = Math.floor(Math.random() * 1e6);

async function registerUser(username: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `${username}_${rand}`, email: `${username}_${rand}@example.com`, password: 'supersecret123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string, email: res.body.user.email as string };
}

describe('Mot de passe oublié : code par email, réinitialisation (E2E)', () => {
  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();
  });

  afterEach(() => {
    sentEmails.length = 0;
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('demande un code, le reçoit (mock), et réinitialise son mot de passe avec — connecté directement', async () => {
    const user = await registerUser('pwreset');

    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(user.email);
    const code = sentEmails[0]!.code;
    expect(code).toMatch(/^\d{6}$/);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code, new_password: 'nouveauMotDePasse123' })
      .expect(200);
    expect(reset.body.token).toBeTruthy();
    expect(reset.body.user.email).toBe(user.email);

    // L'ancien mot de passe ne fonctionne plus, le nouveau si.
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'supersecret123' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'nouveauMotDePasse123' }).expect(200);
  });

  it("ne révèle jamais si l'email existe : même réponse 200 pour un email inconnu, aucun email 'envoyé'", async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: `inconnu_${rand}@example.com` }).expect(200);
    expect(res.body.message).toBeTruthy();
    expect(sentEmails).toHaveLength(0);
  });

  it('un mauvais code est refusé (400), le bon code reste utilisable ensuite', async () => {
    const user = await registerUser('pwreset_badcode');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const code = sentEmails[0]!.code;

    await request(app).post('/api/auth/reset-password').send({ email: user.email, code: '000000', new_password: 'autreMotDePasse123' }).expect(400);

    await request(app).post('/api/auth/reset-password').send({ email: user.email, code, new_password: 'autreMotDePasse123' }).expect(200);
  });

  it('un code est invalidé après 5 mauvaises tentatives, même correct ensuite', async () => {
    const user = await registerUser('pwreset_lockout');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const code = sentEmails[0]!.code;

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/reset-password').send({ email: user.email, code: '000000', new_password: 'x'.repeat(10) }).expect(400);
    }
    // Le code réel ne marche plus : le code a été invalidé après trop d'échecs.
    await request(app).post('/api/auth/reset-password').send({ email: user.email, code, new_password: 'motDePasseFinal123' }).expect(400);
  });

  it("une nouvelle demande invalide l'ancien code (un seul code actif à la fois)", async () => {
    const user = await registerUser('pwreset_superseded');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const firstCode = sentEmails[0]!.code;

    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const secondCode = sentEmails[1]!.code;

    await request(app).post('/api/auth/reset-password').send({ email: user.email, code: firstCode, new_password: 'motDePasseX123456' }).expect(400);
    await request(app).post('/api/auth/reset-password').send({ email: user.email, code: secondCode, new_password: 'motDePasseX123456' }).expect(200);
  });

  it('le code est bien stocké hashé en base, jamais en clair', async () => {
    const user = await registerUser('pwreset_hash');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    const code = sentEmails[0]!.code;

    const stored = await PasswordReset.findOne().sort({ createdAt: -1 });
    expect(stored).not.toBeNull();
    expect(stored!.code_hash).not.toBe(code);
    expect(stored!.code_hash.length).toBeGreaterThan(20); // format bcrypt
  });
});
