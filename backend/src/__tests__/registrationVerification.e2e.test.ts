import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { User } from '../models/User.model';
import { PendingRegistration } from '../models/PendingRegistration.model';

/**
 * E2E : vérification d'email à l'inscription (demande utilisateur — éviter
 * de polluer la liste des comptes avec des emails invalides/jamais relevés),
 * mais SEULEMENT quand SMTP est configuré (`isEmailConfigured`) — sans ça,
 * /register garde son comportement historique, couvert séparément par
 * characterCreation.e2e.test.ts et consorts (registerUser y appelle
 * /register en s'attendant à un token immédiat, comportement inchangé).
 * `isEmailConfigured` forcé à `true` ici (contrairement à
 * passwordReset.e2e.test.ts, qui le force à `false`) pour exercer le
 * nouveau chemin de bout en bout.
 */
const sentEmails: Array<{ to: string; code: string }> = [];
vi.mock('../services/email', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendRegistrationVerificationEmail: vi.fn(async (to: string, code: string) => {
    sentEmails.push({ to, code });
  }),
  isEmailConfigured: () => true,
}));

const app = createApp();
const rand = Math.floor(Math.random() * 1e6);

describe("Vérification d'email à l'inscription, quand SMTP est configuré (E2E)", () => {
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

  it("POST /register ne crée pas le compte tout de suite : renvoie pending:true et envoie un code", async () => {
    const email = `reg_${rand}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `reguser_${rand}`, email, password: 'supersecret123' })
      .expect(200);

    expect(res.body.pending).toBe(true);
    expect(res.body.token).toBeUndefined();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(email);
    expect(sentEmails[0]!.code).toMatch(/^\d{6}$/);

    const user = await User.findOne({ email });
    expect(user).toBeNull(); // pas encore créé — c'est tout le point de la vérification
  });

  it('POST /verify-registration avec le bon code crée réellement le compte et connecte directement', async () => {
    const email = `regverify_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `regverify_${rand}`, email, password: 'supersecret123' }).expect(200);
    const code = sentEmails[0]!.code;

    const res = await request(app).post('/api/auth/verify-registration').send({ email, code }).expect(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);

    const user = await User.findOne({ email });
    expect(user).not.toBeNull();

    // Le mot de passe fourni à l'inscription fonctionne bien pour se reconnecter.
    await request(app).post('/api/auth/login').send({ email, password: 'supersecret123' }).expect(200);

    // La demande en attente est bien nettoyée après création réussie.
    expect(await PendingRegistration.findOne({ email })).toBeNull();
  });

  it('un mauvais code est refusé (400), ne crée pas le compte ; le bon code reste utilisable ensuite', async () => {
    const email = `regbadcode_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `regbadcode_${rand}`, email, password: 'supersecret123' }).expect(200);
    const code = sentEmails[0]!.code;

    await request(app).post('/api/auth/verify-registration').send({ email, code: '000000' }).expect(400);
    expect(await User.findOne({ email })).toBeNull();

    await request(app).post('/api/auth/verify-registration').send({ email, code }).expect(201);
  });

  it('un code est invalidé après 5 mauvaises tentatives, même correct ensuite', async () => {
    const email = `reglockout_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `reglockout_${rand}`, email, password: 'supersecret123' }).expect(200);
    const code = sentEmails[0]!.code;

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/verify-registration').send({ email, code: '000000' }).expect(400);
    }
    await request(app).post('/api/auth/verify-registration').send({ email, code }).expect(400);
    expect(await User.findOne({ email })).toBeNull();
  });

  it("une nouvelle demande d'inscription pour le même email invalide l'ancien code (un seul actif à la fois)", async () => {
    const email = `regsuperseded_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `regsuperseded_${rand}`, email, password: 'supersecret123' }).expect(200);
    const firstCode = sentEmails[0]!.code;

    await request(app).post('/api/auth/register').send({ username: `regsuperseded_${rand}`, email, password: 'supersecret123' }).expect(200);
    const secondCode = sentEmails[1]!.code;

    await request(app).post('/api/auth/verify-registration').send({ email, code: firstCode }).expect(400);
    await request(app).post('/api/auth/verify-registration').send({ email, code: secondCode }).expect(201);
  });

  it("un username déjà réservé par une AUTRE inscription en attente est rejeté (409), avant même l'envoi du code", async () => {
    const sharedUsername = `regconflict_${rand}`;
    await request(app)
      .post('/api/auth/register')
      .send({ username: sharedUsername, email: `regconflict_a_${rand}@example.com`, password: 'supersecret123' })
      .expect(200);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: sharedUsername, email: `regconflict_b_${rand}@example.com`, password: 'supersecret123' })
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('un username/email déjà pris par un VRAI compte reste rejeté immédiatement (comportement inchangé)', async () => {
    const email = `regrealuser_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `regrealuser_${rand}`, email, password: 'supersecret123' }).expect(200);
    await request(app).post('/api/auth/verify-registration').send({ email, code: sentEmails[0]!.code }).expect(201);

    await request(app)
      .post('/api/auth/register')
      .send({ username: `regrealuser_${rand}`, email: `autre_${rand}@example.com`, password: 'supersecret123' })
      .expect(409);
  });

  it('vérifier un email sans inscription en attente renvoie un message générique (400)', async () => {
    await request(app)
      .post('/api/auth/verify-registration')
      .send({ email: `regjamaisdemande_${rand}@example.com`, code: '123456' })
      .expect(400);
  });

  it('le code est bien stocké hashé en base, jamais en clair', async () => {
    const email = `reghash_${rand}@example.com`;
    await request(app).post('/api/auth/register').send({ username: `reghash_${rand}`, email, password: 'supersecret123' }).expect(200);
    const code = sentEmails[0]!.code;

    const stored = await PendingRegistration.findOne({ email });
    expect(stored).not.toBeNull();
    expect(stored!.code_hash).not.toBe(code);
    expect(stored!.code_hash.length).toBeGreaterThan(20); // format bcrypt
    expect(stored!.password_hash).not.toBe('supersecret123'); // jamais le mot de passe en clair non plus
  });
});
