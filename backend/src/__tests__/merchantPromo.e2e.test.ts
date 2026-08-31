import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { Character } from '../models/Character.model';

/**
 * E2E : offre "achetés/offerts" par article marchand (demande utilisateur,
 * ex. "10 achetés, 1 offert") — voir Merchant.model.ts
 * promo_buy_quantity/promo_free_quantity et merchant.routes.ts POST
 * .../purchase. Cartes seedées directement en base (comme
 * economy.e2e.test.ts) pour rester rapide et indépendant du réseau.
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

describe('Marchand : offre "achetés/offerts" par article (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let characterId: string;
  let merchantId: string;
  let cardMongoId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('promo_gm');
    player = await registerUser('promo_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    await request(app).post(`/api/sessions/${session.body.session.code}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Testeuse Promo', stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 } })
      .expect(201);
    characterId = character.body.character.id;
    // Assez d'argent pour de gros achats groupés, sans être le point du test.
    await Character.updateOne({ _id: characterId }, { $set: { money: 100_000 } });

    const merchant = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Boutique Promo' })
      .expect(201);
    merchantId = merchant.body.merchant.id;

    const card = await Card.create({
      ygoprodeck_id: 950_000_000 + rand,
      name: 'Carte Promo de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Carte de test promo.',
      atk: 1000,
      def: 1000,
      level_rank: 4,
      race: 'Warrior',
      attribute: 'LIGHT',
      card_sets: [],
      card_images: [{ image_id: 1, image_url: 'https://example.com/1.jpg', image_url_small: 'https://example.com/1s.jpg', image_url_cropped: 'https://example.com/1c.jpg' }],
      is_custom: false,
    });
    cardMongoId = card._id.toString();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it("POST .../items accepte promo_buy_quantity/promo_free_quantity à la création", async () => {
    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'card', card_id: cardMongoId, price: 10, stock: 1000, promo_buy_quantity: 10, promo_free_quantity: 1 })
      .expect(201);
    const item = res.body.merchant.items[0];
    expect(item.promo_buy_quantity).toBe(10);
    expect(item.promo_free_quantity).toBe(1);
  });

  it('acheter EXACTEMENT le seuil (10) livre 1 exemplaire offert en plus (11 au total), facturé pour 10 seulement', async () => {
    const items = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const itemId = items.body.merchants[0].items[0].id;

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const collectionBefore = before.body.character.collection.length;
    const moneyBefore = before.body.character.money;

    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${itemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 10 })
      .expect(200);

    expect(res.body.purchase.quantity).toBe(10);
    expect(res.body.purchase.bonus_quantity).toBe(1);
    expect(res.body.purchase.delivered_quantity).toBe(11);
    expect(res.body.purchase.total_price).toBe(100); // 10 x prix 10, jamais les exemplaires offerts

    const after = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(after.body.character.collection.length - collectionBefore).toBe(11); // 10 payées + 1 offerte
    expect(moneyBefore - after.body.character.money).toBe(100);
  });

  it('acheter un multiple du seuil (25, seuil 10) applique la promo PLUSIEURS fois : 2 offertes, pas 1', async () => {
    const items = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const itemId = items.body.merchants[0].items[0].id;

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const collectionBefore = before.body.character.collection.length;

    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${itemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 25 })
      .expect(200);

    expect(res.body.purchase.bonus_quantity).toBe(2); // floor(25/10) * 1
    expect(res.body.purchase.delivered_quantity).toBe(27);
    expect(res.body.purchase.total_price).toBe(250);

    const after = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(after.body.character.collection.length - collectionBefore).toBe(27);
  });

  it("acheter SOUS le seuil (5, seuil 10) ne donne aucun bonus", async () => {
    const items = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const itemId = items.body.merchants[0].items[0].id;

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const collectionBefore = before.body.character.collection.length;

    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${itemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 5 })
      .expect(200);

    expect(res.body.purchase.bonus_quantity).toBe(0);
    expect(res.body.purchase.delivered_quantity).toBe(5);

    const after = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(after.body.character.collection.length - collectionBefore).toBe(5);
  });

  it("un stock insuffisant pour couvrir la quantité OFFERTE en plus refuse l'achat (409), même si la quantité payée seule tiendrait", async () => {
    const stockItem = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'card', card_id: cardMongoId, price: 5, stock: 10, promo_buy_quantity: 10, promo_free_quantity: 1 })
      .expect(201);
    const itemId = stockItem.body.merchant.items[stockItem.body.merchant.items.length - 1].id;

    // 10 payées + 1 offerte = 11 nécessaires, stock = 10 seulement.
    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${itemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 10 })
      .expect(409);
    expect(res.body.error.code).toBe('insufficient_stock');

    // Le stock n'a pas bougé (échec avant tout décrément appliqué pour de bon).
    const merchantAfter = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const refreshed = merchantAfter.body.merchants[0].items.find((i: { id: string }) => i.id === itemId);
    expect(refreshed.stock).toBe(10);
  });

  it("PATCH .../items/:itemId modifie la promo, ou la retire (null sur les deux)", async () => {
    const items = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const itemId = items.body.merchants[0].items[0].id;

    const updated = await request(app)
      .patch(`/api/merchants/${merchantId}/items/${itemId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ promo_buy_quantity: 3, promo_free_quantity: 1 })
      .expect(200);
    const item = updated.body.merchant.items.find((i: { id: string }) => i.id === itemId);
    expect(item.promo_buy_quantity).toBe(3);
    expect(item.promo_free_quantity).toBe(1);

    const cleared = await request(app)
      .patch(`/api/merchants/${merchantId}/items/${itemId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ promo_buy_quantity: null, promo_free_quantity: null })
      .expect(200);
    const clearedItem = cleared.body.merchant.items.find((i: { id: string }) => i.id === itemId);
    expect(clearedItem.promo_buy_quantity).toBeNull();
    expect(clearedItem.promo_free_quantity).toBeNull();
  });

  it("un joueur (pas MJ) ne peut pas configurer la promo d'un article", async () => {
    const items = await request(app).get(`/api/merchants/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const itemId = items.body.merchants[0].items[0].id;
    await request(app)
      .patch(`/api/merchants/${merchantId}/items/${itemId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ promo_buy_quantity: 2, promo_free_quantity: 1 })
      .expect(403);
  });
});
