import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { Character } from '../models/Character.model';

/**
 * E2E : construction de deck. Les cartes ajoutables à un deck de personnage
 * joueur doivent se trouver dans sa collection ; les decks de PNJ créés par
 * le MJ en sont dispensés (pas de collection à faire correspondre pour un
 * adversaire). Les règles de deck légal (3 exemplaires max, tailles
 * Main/Extra) s'appliquent dans tous les cas.
 *
 * Cartes seedées directement en base (comme economy.e2e.test.ts) pour rester
 * rapide et indépendant du réseau YGOPRODeck.
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

async function seedCard(name: string, frameType: string, ygoId: number): Promise<string> {
  const card = await Card.create({
    ygoprodeck_id: ygoId,
    name,
    type: frameType === 'spell' ? 'Spell Card' : 'Monster',
    frame_type: frameType,
    description: 'Carte de test deckbuilding',
    atk: 1000,
    def: 1000,
    level_rank: 4,
    race: 'Warrior',
    attribute: 'LIGHT',
    archetype: null,
    card_sets: [],
    card_images: [
      {
        image_id: ygoId,
        image_url: 'https://images.ygoprodeck.com/images/cards/test.jpg',
        image_url_small: 'https://images.ygoprodeck.com/images/cards_small/test.jpg',
        image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/test.jpg',
      },
    ],
    is_custom: false,
  });
  return card._id.toString();
}

describe('Deckbuilding : cartes limitées à la collection, PNJ dispensés (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let outsider: AuthedUser;

  let sessionId: string;
  let playerCharacterId: string;
  let npcCharacterId: string;

  let mainCardId: string; // frame_type 'normal' -> Main Deck
  let extraCardId: string; // frame_type 'xyz' -> Extra Deck

  let playerDeckId: string;
  let npcDeckId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    mainCardId = await seedCard('Carte Main Deck', 'normal', 910_000_000 + rand);
    extraCardId = await seedCard('Carte Extra Deck', 'xyz', 920_000_000 + rand);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('inscrit un MJ, un joueur et un tiers, crée le salon et les personnages', async () => {
    gm = await registerUser('deck_gm');
    player = await registerUser('deck_player');
    outsider = await registerUser('deck_outsider');

    const session = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ currency_name: 'Gold' })
      .expect(201);
    sessionId = session.body.session.id;
    await request(app).post(`/api/sessions/${session.body.session.code}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const playerChar = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Duelliste',
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    playerCharacterId = playerChar.body.character.id;

    const npcChar = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Adversaire PNJ',
        is_npc: true,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    npcCharacterId = npcChar.body.character.id;

    // Collection du joueur seedée directement : 5 exemplaires de la carte
    // Main (pour isoler le test de la limite à 3/deck de celui de propriété)
    // et 1 exemplaire de la carte Extra. Le PNJ reste sans collection.
    await Character.updateOne(
      { _id: playerCharacterId },
      { $set: { collection: Array(5).fill(mainCardId).concat([extraCardId]) } },
    );
  });

  it('crée un deck pour le personnage joueur', async () => {
    const res = await request(app)
      .post(`/api/characters/${playerCharacterId}/decks`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ name: 'Mon premier deck' })
      .expect(201);

    expect(res.body.character.decks).toHaveLength(1);
    playerDeckId = res.body.character.decks[0].id;
    expect(res.body.character.decks[0].name).toBe('Mon premier deck');
  });

  it('renomme le deck', async () => {
    const res = await request(app)
      .patch(`/api/characters/${playerCharacterId}/decks/${playerDeckId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ name: 'Deck Renommé' })
      .expect(200);
    expect(res.body.character.decks[0].name).toBe('Deck Renommé');
  });

  it('ajoute une carte possédée au deck', async () => {
    const res = await request(app)
      .post(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: mainCardId, quantity: 2 })
      .expect(201);

    const deck = res.body.character.decks.find((d: { id: string }) => d.id === playerDeckId);
    expect(deck.cards.filter((id: string) => id === mainCardId)).toHaveLength(2);
  });

  it("refuse d'ajouter plus de copies que possédées", async () => {
    // 2 déjà dans le deck + 5 demandées = 7, alors que la collection n'en
    // contient que 5 au total.
    await request(app)
      .post(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: mainCardId, quantity: 3 })
      .expect(400);
  });

  it("refuse de dépasser la limite de 3 exemplaires par deck, même si possédées", async () => {
    // La collection contient 5 exemplaires (largement assez), mais la règle
    // des 3 copies max par deck doit quand même s'appliquer.
    await request(app)
      .post(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: mainCardId, quantity: 2 }) // 2 déjà présentes + 2 = 4 > 3
      .expect(400);
  });

  it('ajoute une carte Extra Deck, correctement classée dans le détail du deck', async () => {
    await request(app)
      .post(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: extraCardId, quantity: 1 })
      .expect(201);

    const res = await request(app)
      .get(`/api/characters/${playerCharacterId}/decks/${playerDeckId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);

    expect(res.body.deck.main).toHaveLength(1);
    expect(res.body.deck.main[0].quantity).toBe(2);
    expect(res.body.deck.extra).toHaveLength(1);
    expect(res.body.deck.extra[0].quantity).toBe(1);
    expect(res.body.deck.main_count).toBe(2);
    expect(res.body.deck.extra_count).toBe(1);
    expect(res.body.deck.is_valid).toBe(false); // largement sous les 40 minimum

    // DTO carte complet (pas juste id/name/type/card_images) : nécessaire à
    // l'aperçu grand format du deckbuilder plein écran (texte d'effet, stats).
    expect(res.body.deck.main[0].card.description).toBe('Carte de test deckbuilding');
    expect(res.body.deck.main[0].card.atk).toBe(1000);
    expect(res.body.deck.main[0].card.def).toBe(1000);
  });

  it('retire un exemplaire de carte du deck', async () => {
    const res = await request(app)
      .delete(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards/${mainCardId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .query({ quantity: 1 })
      .expect(200);

    const deck = res.body.character.decks.find((d: { id: string }) => d.id === playerDeckId);
    expect(deck.cards.filter((id: string) => id === mainCardId)).toHaveLength(1);
  });

  it('un tiers ne peut pas modifier le deck du joueur', async () => {
    await request(app)
      .post(`/api/characters/${playerCharacterId}/decks/${playerDeckId}/cards`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ card_id: mainCardId, quantity: 1 })
      .expect(403);
  });

  it("le MJ construit le deck du PNJ sans que les cartes soient dans sa collection", async () => {
    const deckRes = await request(app)
      .post(`/api/characters/${npcCharacterId}/decks`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ name: 'Deck du boss' })
      .expect(201);
    npcDeckId = deckRes.body.character.decks[0].id;

    const npcBefore = await request(app)
      .get(`/api/characters/${npcCharacterId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .expect(200);
    expect(npcBefore.body.character.collection).toEqual([]);

    const res = await request(app)
      .post(`/api/characters/${npcCharacterId}/decks/${npcDeckId}/cards`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ card_id: mainCardId, quantity: 3 })
      .expect(201);

    const deck = res.body.character.decks.find((d: { id: string }) => d.id === npcDeckId);
    expect(deck.cards.filter((id: string) => id === mainCardId)).toHaveLength(3);
  });

  it("la limite de 3 exemplaires par deck s'applique aussi aux PNJ", async () => {
    await request(app)
      .post(`/api/characters/${npcCharacterId}/decks/${npcDeckId}/cards`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ card_id: mainCardId, quantity: 1 })
      .expect(400);
  });

  it("un joueur ne peut pas gérer le deck d'un PNJ qui ne lui appartient pas", async () => {
    await request(app)
      .post(`/api/characters/${npcCharacterId}/decks/${npcDeckId}/cards`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_id: extraCardId, quantity: 1 })
      .expect(403);
  });

  it("la limite de l'Extra Deck (15 cartes) est appliquée", async () => {
    // 15 cartes Extra Deck distinctes, dispensées de collection via le PNJ.
    const extraCardIds: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      extraCardIds.push(await seedCard(`Extra Filler ${i}`, 'xyz', 930_000_000 + rand + i));
    }

    for (const id of extraCardIds) {
      await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/${npcDeckId}/cards`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ card_id: id, quantity: 1 })
        .expect(201);
    }

    // La 16e carte Extra Deck doit être refusée : la limite est atteinte.
    const overflowCardId = await seedCard('Extra En Trop', 'xyz', 940_000_000 + rand);
    const res = await request(app)
      .post(`/api/characters/${npcCharacterId}/decks/${npcDeckId}/cards`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ card_id: overflowCardId, quantity: 1 })
      .expect(400);
    expect(res.body.error.code).toBe('extra_deck_full');
  });

  it('supprime le deck', async () => {
    const res = await request(app)
      .delete(`/api/characters/${playerCharacterId}/decks/${playerDeckId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    expect(res.body.character.decks).toEqual([]);
  });
});
