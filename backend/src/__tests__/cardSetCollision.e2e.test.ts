import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { fetchCardSets, fetchCardsBySet, type YgoCard, type YgoCardSet } from '../services/ygoprodeck';

/**
 * E2E de bout en bout pour la demande utilisateur de suivi sur le bug
 * set_code (voir CLAUDE.md) : "j'aimerais maintenant que l'on puisse les
 * importer et différencier pour les mettre en magasin et autres" — pas
 * juste corriger la synchronisation en silence (fix précédent, plus minimal
 * : ne gardait que la plus grosse variante), mais vraiment pouvoir importer
 * CHAQUE variante partageant un set_code, les distinguer dans le catalogue,
 * les vendre séparément chez un marchand, et ouvrir chacune sur son PROPRE
 * pool de cartes — jamais mélangées entre elles malgré le code partagé.
 *
 * `fetchCardSets`/`fetchCardsBySet` mockés (comme cardImport.test.ts) :
 * simule exactement le cas réel LOB (deux sets réels partageant le même
 * set_code, avec des cartes réellement différentes) sans dépendre du réseau.
 */
vi.mock('../services/ygoprodeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ygoprodeck')>();
  return { ...actual, fetchCardsBySet: vi.fn(), fetchCardSets: vi.fn() };
});

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

function testCardImage(id: number) {
  return { id, image_url: `https://example.com/${id}.jpg`, image_url_small: `https://example.com/${id}s.jpg`, image_url_cropped: `https://example.com/${id}c.jpg` };
}

describe('Collision de set_code, résolue de bout en bout : import, différenciation, boutique, ouverture (E2E)', () => {
  const sharedCode = `DUP${rand}`;
  const mainSetName = `Set Principal ${rand}`;
  const reprintSetName = `Set Réédition ${rand}`;

  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let characterId: string;
  let merchantId: string;
  let mainSetId: string;
  let reprintSetId: string;
  let mainItemId: string;
  let reprintItemId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('collide_gm');
    player = await registerUser('collide_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Testeuse Collision', stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 } })
      .expect(201);
    characterId = character.body.character.id;

    const merchant = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Boutique de Test' })
      .expect(201);
    merchantId = merchant.body.merchant.id;
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it("la synchro fait apparaître les DEUX variantes séparément, chacune avec son propre id", async () => {
    const main: YgoCardSet = { set_name: mainSetName, set_code: sharedCode, num_of_cards: 2, tcg_date: '2002-03-08' };
    const reprint: YgoCardSet = { set_name: reprintSetName, set_code: sharedCode, num_of_cards: 1, tcg_date: '2023-04-20' };
    vi.mocked(fetchCardSets).mockResolvedValue([main, reprint]);

    const res = await request(app).get('/api/cards/sets?refresh=true&search=' + encodeURIComponent(`${rand}`)).set('Authorization', `Bearer ${gm.token}`).expect(200);
    const found = res.body.sets.filter((s: { set_code: string }) => s.set_code === sharedCode);
    expect(found).toHaveLength(2);

    const mainSet = found.find((s: { set_name: string }) => s.set_name === mainSetName);
    const reprintSet = found.find((s: { set_name: string }) => s.set_name === reprintSetName);
    expect(mainSet).toBeDefined();
    expect(reprintSet).toBeDefined();
    expect(mainSet.id).not.toBe(reprintSet.id);
    expect(mainSet.had_code_collision).toBe(true);
    expect(reprintSet.had_code_collision).toBe(true);

    mainSetId = mainSet.id;
    reprintSetId = reprintSet.id;
  });

  it('chaque variante s\'importe séparément (par id), avec ses PROPRES cartes réelles', async () => {
    // card_sets (propre à la carte, pas au CardSet) : c'est CE tableau que
    // YGOPRODeck utilise réellement pour dire "cette carte appartient à ce
    // set" — sans une entrée dont set_name correspond, GET /cards?set_id=
    // et l'ouverture de booster ne trouveraient jamais la carte, exactement
    // comme cardinfo.php?cardset= ne la renverrait pas non plus en vrai.
    const mainCard: YgoCard = {
      id: 910_000_001 + rand,
      name: 'Carte Principale de Test',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'Carte du set principal.',
      atk: 1000,
      def: 1000,
      level: 4,
      race: 'Warrior',
      attribute: 'LIGHT',
      card_sets: [{ set_name: mainSetName, set_code: `${sharedCode}-001`, set_rarity: 'Common', set_rarity_code: '(C)', set_price: '0' }],
      card_images: [testCardImage(910_000_001 + rand)],
    };
    const reprintCard: YgoCard = {
      id: 910_000_002 + rand,
      name: 'Carte de Réédition de Test',
      type: 'Spell Card',
      frameType: 'spell',
      desc: 'Carte de la réédition seulement.',
      card_sets: [{ set_name: reprintSetName, set_code: `${sharedCode}-R01`, set_rarity: 'Common', set_rarity_code: '(C)', set_price: '0' }],
      card_images: [testCardImage(910_000_002 + rand)],
    };

    vi.mocked(fetchCardsBySet).mockImplementation(async (setName: string) => {
      if (setName === mainSetName) return [mainCard];
      if (setName === reprintSetName) return [reprintCard];
      return [];
    });

    const mainImport = await request(app).post(`/api/cards/sets/${mainSetId}/import`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    expect(mainImport.body.imported_count).toBe(1);
    expect(mainImport.body.set_name).toBe(mainSetName);

    const reprintImport = await request(app).post(`/api/cards/sets/${reprintSetId}/import`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    expect(reprintImport.body.imported_count).toBe(1);
    expect(reprintImport.body.set_name).toBe(reprintSetName);
  });

  it('GET /cards?set_id= ne mélange jamais les deux variantes, même si elles partagent le même set_code', async () => {
    const mainCards = await request(app).get(`/api/cards?set_id=${mainSetId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    expect(mainCards.body.cards).toHaveLength(1);
    expect(mainCards.body.cards[0].name).toBe('Carte Principale de Test');

    const reprintCards = await request(app).get(`/api/cards?set_id=${reprintSetId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    expect(reprintCards.body.cards).toHaveLength(1);
    expect(reprintCards.body.cards[0].name).toBe('Carte de Réédition de Test');
  });

  it('le MJ met les DEUX variantes en vente séparément chez le même marchand (par set_id)', async () => {
    // Prix à 0 : le personnage n'a pas d'argent, seule la distinction des
    // deux variantes est ce que ce test vérifie, pas le circuit financier
    // (déjà couvert par economy.e2e.test.ts).
    const mainItem = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'booster', set_id: mainSetId, price: 0 })
      .expect(201);
    const mainArticle = mainItem.body.merchant.items.find((i: { name: string }) => i.name === mainSetName);
    expect(mainArticle).toBeDefined();
    expect(mainArticle.card_set_id).toBe(mainSetId);
    mainItemId = mainArticle.id;

    const reprintItem = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'booster', set_id: reprintSetId, price: 0 })
      .expect(201);
    const reprintArticle = reprintItem.body.merchant.items.find((i: { name: string }) => i.name === reprintSetName);
    expect(reprintArticle).toBeDefined();
    expect(reprintArticle.card_set_id).toBe(reprintSetId);
    reprintItemId = reprintArticle.id;

    expect(reprintItem.body.merchant.items).toHaveLength(2);
  });

  it("la joueuse achète les DEUX, se retrouve avec deux entrées scellées SÉPARÉES (même set_code, card_set_id différents)", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${mainItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(200);
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${reprintItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(200);

    const char = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const boosters = char.body.character.sealed_boosters;
    expect(boosters).toHaveLength(2); // pas fusionnées malgré le même set_code
    expect(boosters.every((b: { set_code: string }) => b.set_code === sharedCode)).toBe(true);
    expect(new Set(boosters.map((b: { card_set_id: string }) => b.card_set_id)).size).toBe(2);
  });

  it("l'ouverture de chaque booster (par card_set_id) tire EXCLUSIVEMENT dans son propre pool, jamais celui de l'autre variante", async () => {
    const openMain = await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_set_id: mainSetId, set_code: sharedCode, quantity: 1 })
      .expect(200);
    // Un seul pool possible ici (une seule carte propre au set principal) :
    // toutes les cartes du paquet sont forcément cette même carte — le point
    // du test est qu'AUCUNE ne soit celle de l'autre variante.
    expect(openMain.body.opened_cards.length).toBeGreaterThan(0);
    expect(openMain.body.opened_cards.every((c: { name: string }) => c.name === 'Carte Principale de Test')).toBe(true);

    const openReprint = await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card_set_id: reprintSetId, set_code: sharedCode, quantity: 1 })
      .expect(200);
    expect(openReprint.body.opened_cards.length).toBeGreaterThan(0);
    expect(openReprint.body.opened_cards.every((c: { name: string }) => c.name === 'Carte de Réédition de Test')).toBe(true);

    // Plus aucun booster scellé après avoir ouvert les deux exemplaires.
    const char = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(char.body.character.sealed_boosters).toHaveLength(0);
  });
});
