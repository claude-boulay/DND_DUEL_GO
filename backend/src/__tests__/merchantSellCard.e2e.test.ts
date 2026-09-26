import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { Character } from '../models/Character.model';

/**
 * E2E : rachat de cartes par un marchand (demande utilisateur) — voir
 * Merchant.model.ts `buys_cards` et merchant.routes.ts POST
 * .../sell-cards/quote (devis, sans mutation) et .../sell-cards (vente
 * groupée réelle, plusieurs cartes différentes en un seul appel — demande
 * utilisateur explicite). Prix par rareté (décidé avec l'utilisateur) :
 * Commune 1, Rare 5, Super Rare 10, Ultra Rare 20, plus rare que ça 50 — voir
 * utils/cardSellPrice.ts. Cartes/sets seedés directement en base (comme
 * merchantPromo.e2e.test.ts), pas d'appel réseau.
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

describe('Marchand : rachat de cartes selon la rareté de la première édition (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let characterId: string;
  let buyingMerchantId: string;
  let nonBuyingMerchantId: string;
  // Carte réimprimée : rareté Common à l'origine (2002), Ultra Rare dans une
  // réédition bien plus récente — le prix doit suivre la PREMIÈRE édition.
  let reprintedCardId: string;
  // Carte custom jamais liée à un set : aucune rareté connue.
  let unlinkedCustomCardId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('sell_gm');
    player = await registerUser('sell_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    await request(app).post(`/api/sessions/${session.body.session.code}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Testeuse Revendeuse', stats: { history: 14, perception: 13, intelligence: 13, charisma: 13, luck: 14 } })
      .expect(201);
    characterId = character.body.character.id;

    const buyingMerchant = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Boutique Rachat', buys_cards: true })
      .expect(201);
    buyingMerchantId = buyingMerchant.body.merchant.id;
    expect(buyingMerchant.body.merchant.buys_cards).toBe(true);

    const nonBuyingMerchant = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Boutique Sans Rachat' })
      .expect(201);
    nonBuyingMerchantId = nonBuyingMerchant.body.merchant.id;
    expect(nonBuyingMerchant.body.merchant.buys_cards).toBe(false);

    await CardSet.create([
      { set_name: `Original Set ${rand}`, set_code: 'ORG', num_of_cards: 100, tcg_date: '2002-03-08', is_custom: false },
      { set_name: `Reprint Set ${rand}`, set_code: 'RPR', num_of_cards: 20, tcg_date: '2023-01-01', is_custom: false },
    ]);

    const commonCard = await Card.create({
      ygoprodeck_id: 951_000_000 + rand,
      name: 'Carte Commune de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte commune.',
      card_sets: [{ set_name: `Original Set ${rand}`, set_code: 'ORG-001', set_rarity: 'Common', set_rarity_code: '(C)', set_price: '0' }],
      card_images: [{ image_id: 1, image_url: 'https://example.com/1.jpg', image_url_small: 'https://example.com/1s.jpg', image_url_cropped: 'https://example.com/1c.jpg' }],
      is_custom: false,
    });

    const rareCard = await Card.create({
      ygoprodeck_id: 952_000_000 + rand,
      name: 'Carte Rare de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte rare.',
      card_sets: [{ set_name: `Original Set ${rand}`, set_code: 'ORG-002', set_rarity: 'Rare', set_rarity_code: '(R)', set_price: '0' }],
      card_images: [{ image_id: 2, image_url: 'https://example.com/2.jpg', image_url_small: 'https://example.com/2s.jpg', image_url_cropped: 'https://example.com/2c.jpg' }],
      is_custom: false,
    });

    const superRareCard = await Card.create({
      ygoprodeck_id: 953_000_000 + rand,
      name: 'Carte Super Rare de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte super rare.',
      card_sets: [{ set_name: `Original Set ${rand}`, set_code: 'ORG-003', set_rarity: 'Super Rare', set_rarity_code: '(SR)', set_price: '0' }],
      card_images: [{ image_id: 3, image_url: 'https://example.com/3.jpg', image_url_small: 'https://example.com/3s.jpg', image_url_cropped: 'https://example.com/3c.jpg' }],
      is_custom: false,
    });

    const ultraRareCard = await Card.create({
      ygoprodeck_id: 954_000_000 + rand,
      name: 'Carte Ultra Rare de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte ultra rare.',
      card_sets: [{ set_name: `Original Set ${rand}`, set_code: 'ORG-004', set_rarity: 'Ultra Rare', set_rarity_code: '(UR)', set_price: '0' }],
      card_images: [{ image_id: 4, image_url: 'https://example.com/4.jpg', image_url_small: 'https://example.com/4s.jpg', image_url_cropped: 'https://example.com/4c.jpg' }],
      is_custom: false,
    });

    const secretRareCard = await Card.create({
      ygoprodeck_id: 955_000_000 + rand,
      name: 'Carte Secret Rare de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte secret rare.',
      card_sets: [{ set_name: `Original Set ${rand}`, set_code: 'ORG-005', set_rarity: 'Secret Rare', set_rarity_code: '(ScR)', set_price: '0' }],
      card_images: [{ image_id: 5, image_url: 'https://example.com/5.jpg', image_url_small: 'https://example.com/5s.jpg', image_url_cropped: 'https://example.com/5c.jpg' }],
      is_custom: false,
    });

    const reprintedCard = await Card.create({
      ygoprodeck_id: 956_000_000 + rand,
      name: 'Carte Réimprimée de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Une carte réimprimée à une rareté différente.',
      card_sets: [
        { set_name: `Reprint Set ${rand}`, set_code: 'RPR-001', set_rarity: 'Ultra Rare', set_rarity_code: '(UR)', set_price: '0' },
        { set_name: `Original Set ${rand}`, set_code: 'ORG-006', set_rarity: 'Common', set_rarity_code: '(C)', set_price: '0' },
      ],
      card_images: [{ image_id: 6, image_url: 'https://example.com/6.jpg', image_url_small: 'https://example.com/6s.jpg', image_url_cropped: 'https://example.com/6c.jpg' }],
      is_custom: false,
    });
    reprintedCardId = reprintedCard._id.toString();

    const unlinkedCustomCard = await Card.create({
      name: 'Carte Custom Non Liée',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Jamais liée à un booster.',
      card_sets: [],
      card_images: [],
      is_custom: true,
      owner_id: gm.id,
      lua_script: '--[[ test ]]',
      engine_code: 500_000_100 + rand,
    });
    unlinkedCustomCardId = unlinkedCustomCard._id.toString();

    // Donne toutes ces cartes au personnage (don du MJ — vendable au même
    // titre que les autres, décidé avec l'utilisateur), 2 exemplaires chacune.
    for (const card of [commonCard, rareCard, superRareCard, ultraRareCard, secretRareCard, reprintedCard, unlinkedCustomCard]) {
      await request(app)
        .post(`/api/characters/${characterId}/collection/add-card`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ card_id: card._id.toString(), quantity: 2 })
        .expect(200);
    }
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it("un marchand qui n'achète pas de cartes (buys_cards: false) refuse la vente (400)", async () => {
    const res = await request(app)
      .post(`/api/merchants/${nonBuyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: reprintedCardId, quantity: 1 }] })
      .expect(400);
    expect(res.body.error.code).toBe('not_buying_cards');
  });

  it("un marchand qui n'achète pas de cartes refuse aussi le DEVIS (400)", async () => {
    const res = await request(app)
      .post(`/api/merchants/${nonBuyingMerchantId}/sell-cards/quote`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: reprintedCardId, quantity: 1 }] })
      .expect(400);
    expect(res.body.error.code).toBe('not_buying_cards');
  });

  it.each([
    ['Commune', 951, 1],
    ['Rare', 952, 5],
    ['Super Rare', 953, 10],
    ['Ultra Rare', 954, 20],
    ['Secret Rare (plus rare qu\'Ultra)', 955, 50],
  ])('vend 1 exemplaire au bon prix pour la rareté %s', async (_label, ygoprodeckPrefix, expectedPrice) => {
    const card = await Card.findOne({ ygoprodeck_id: ygoprodeckPrefix * 1_000_000 + rand });
    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const moneyBefore = before.body.character.money;
    const ownedBefore = before.body.character.collection.filter((id: string) => id === card!._id.toString()).length;

    // Devis d'abord : mêmes montants que la vente réelle, ne mute rien.
    const quote = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards/quote`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: card!._id.toString(), quantity: 1 }] })
      .expect(200);
    expect(quote.body.items[0].unit_price).toBe(expectedPrice);
    expect(quote.body.total_price).toBe(expectedPrice);
    const afterQuote = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(afterQuote.body.character.collection.length).toBe(before.body.character.collection.length); // le devis ne mute rien

    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: card!._id.toString(), quantity: 1 }] })
      .expect(200);

    expect(res.body.sale.items[0].unit_price).toBe(expectedPrice);
    expect(res.body.sale.total_price).toBe(expectedPrice);
    expect(res.body.character.money).toBe(moneyBefore + expectedPrice);
    const ownedAfter = res.body.character.collection.filter((id: string) => id === card!._id.toString()).length;
    expect(ownedAfter).toBe(ownedBefore - 1);
  });

  it('carte réimprimée : le prix suit la rareté de la PREMIÈRE édition (Common, 1), pas la réédition Ultra Rare plus récente', async () => {
    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: reprintedCardId, quantity: 1 }] })
      .expect(200);

    expect(res.body.sale.items[0].rarity).toBe('Common');
    expect(res.body.sale.items[0].unit_price).toBe(1);
  });

  it('carte custom jamais liée à un booster : repli sur le prix Commune (1), pas refusée', async () => {
    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: unlinkedCustomCardId, quantity: 1 }] })
      .expect(200);

    expect(res.body.sale.items[0].rarity).toBeNull();
    expect(res.body.sale.items[0].unit_price).toBe(1);
  });

  it('vend PLUSIEURS cartes différentes en un seul appel (demande utilisateur) : chaque article a son propre prix, le total est la somme', async () => {
    const commonCard = await Card.findOne({ ygoprodeck_id: 951_000_000 + rand }); // reste 1 exemplaire
    const rareCard = await Card.findOne({ ygoprodeck_id: 952_000_000 + rand }); // reste 1 exemplaire

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const moneyBefore = before.body.character.money;

    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        character_id: characterId,
        items: [
          { card_id: commonCard!._id.toString(), quantity: 1 },
          { card_id: rareCard!._id.toString(), quantity: 1 },
        ],
      })
      .expect(200);

    expect(res.body.sale.items).toHaveLength(2);
    expect(res.body.sale.total_price).toBe(1 + 5); // Commune + Rare
    expect(res.body.character.money).toBe(moneyBefore + 6);
  });

  it('fusionne deux entrées répétant le même card_id (quantités additionnées) plutôt que de les traiter indépendamment', async () => {
    // Recrédite 2 exemplaires d'une carte connue pour ce test précis.
    const card = await Card.findOne({ ygoprodeck_id: 951_000_000 + rand });
    await request(app)
      .post(`/api/characters/${characterId}/collection/add-card`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ card_id: card!._id.toString(), quantity: 2 })
      .expect(200);

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const ownedBefore = before.body.character.collection.filter((id: string) => id === card!._id.toString()).length;
    expect(ownedBefore).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        character_id: characterId,
        items: [
          { card_id: card!._id.toString(), quantity: 1 },
          { card_id: card!._id.toString(), quantity: 1 },
        ],
      })
      .expect(200);

    expect(res.body.sale.items).toHaveLength(1); // fusionné en une seule ligne
    expect(res.body.sale.items[0].quantity).toBe(2);
    expect(res.body.sale.total_price).toBe(2); // 2 × prix Commune (1)
  });

  it('vendre plus d\'exemplaires que possédés est refusé (400)', async () => {
    const card = await Card.findOne({ ygoprodeck_id: 953_000_000 + rand }); // super rare, il n'en reste qu'1
    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: card!._id.toString(), quantity: 99 }] })
      .expect(400);
    expect(res.body.error.code).toBe('not_owned');
  });

  it('un article invalide dans une vente groupée refuse la vente ENTIÈRE, sans vendre partiellement les articles valides', async () => {
    const validCard = await Card.findOne({ ygoprodeck_id: 954_000_000 + rand }); // ultra rare, il en reste 1
    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const ownedBefore = before.body.character.collection.filter((id: string) => id === validCard!._id.toString()).length;

    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        character_id: characterId,
        items: [
          { card_id: validCard!._id.toString(), quantity: 1 },
          { card_id: validCard!._id.toString(), quantity: 99 }, // fusionné à 100 avec la ligne précédente : dépasse largement le possédé
        ],
      })
      .expect(400);
    expect(res.body.error.code).toBe('not_owned');

    const after = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const ownedAfter = after.body.character.collection.filter((id: string) => id === validCard!._id.toString()).length;
    expect(ownedAfter).toBe(ownedBefore); // rien n'a été vendu
  });

  it('une carte utilisée dans un deck ne peut pas être vendue (409), même un autre exemplaire du même id', async () => {
    const card = await Card.findOne({ ygoprodeck_id: 954_000_000 + rand }); // ultra rare, il en reste 1
    const deck = await request(app)
      .post(`/api/characters/${characterId}/decks`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ name: 'Deck Test Vente' })
      .expect(201);
    const deckId = deck.body.character.decks[0].id;
    await request(app)
      .post(`/api/characters/${characterId}/decks/${deckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: card!._id.toString(), quantity: 1 })
      .expect(201);

    const res = await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, items: [{ card_id: card!._id.toString(), quantity: 1 }] })
      .expect(409);
    expect(res.body.error.code).toBe('card_in_deck');
  });

  it("un utilisateur qui ne contrôle pas ce personnage (ni MJ, ni propriétaire) ne peut pas vendre pour lui", async () => {
    const outsider = await registerUser('sell_outsider');
    const card = await Card.findOne({ ygoprodeck_id: 951_000_000 + rand });
    await request(app)
      .post(`/api/merchants/${buyingMerchantId}/sell-cards`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ character_id: characterId, items: [{ card_id: card!._id.toString(), quantity: 1 }] })
      .expect(403);
  });

  it("PATCH .../:id active/désactive buys_cards, GM-only", async () => {
    const updated = await request(app)
      .patch(`/api/merchants/${nonBuyingMerchantId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ buys_cards: true })
      .expect(200);
    expect(updated.body.merchant.buys_cards).toBe(true);

    await request(app)
      .patch(`/api/merchants/${nonBuyingMerchantId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ buys_cards: false })
      .expect(403);
  });
});
