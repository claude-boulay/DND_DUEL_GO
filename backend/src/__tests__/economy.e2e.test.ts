import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { Character } from '../models/Character.model';
import { fetchCardsBySet } from '../services/ygoprodeck';

// L'import automatique déclenché par l'ouverture d'un booster jamais importé
// (voir le bloc de régression plus bas) appelle l'API YGOPRODeck réelle sans
// ce mock : on la remplace pour garder ce fichier rapide et indépendant du
// réseau, comme le reste des tests de cartes ici (données seedées en base).
vi.mock('../services/ygoprodeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ygoprodeck')>();
  return { ...actual, fetchCardsBySet: vi.fn() };
});

/**
 * E2E : création d'un marchand et de son inventaire (carte + booster),
 * achat par un joueur (avec et sans marchandage), et ajout des cartes à sa
 * collection — soit directement (carte), soit via ouverture d'un booster
 * scellé (CLAUDE.md §3.5).
 *
 * Tourne contre une vraie instance MongoDB (pas de mocks), sur une base
 * dédiée (`MONGO_URI` se terminant par `_test`, imposé par `npm test`) pour
 * ne jamais toucher aux données de développement. Les données de cartes sont
 * seedées directement en base plutôt que via un vrai appel YGOPRODeck, pour
 * garder le test rapide et indépendant du réseau — l'intégration YGOPRODeck
 * elle-même est vérifiée séparément (voir CardImportPanel / card.routes.ts).
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

describe('Économie : marchand, inventaire, achat et collection (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let outsider: AuthedUser;

  let sessionId: string;
  let sessionCode: string;
  let characterId: string;

  let testSetCode: string;
  let cardMongoId: string;

  let merchantId: string;
  let cardItemId: string;
  let boosterItemId: string;
  let stockTestItemId: string;
  let fundsTestItemId: string;

  let collectionSizeBeforeOpen: number;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error(
        `Les tests doivent tourner sur une base dédiée se terminant par "_test" pour ne jamais toucher aux données de développement (MONGO_URI actuel : ${env.MONGO_URI}). Utilisez "npm test".`,
      );
    }
    await connectMongo();

    const cardSet = await CardSet.create({
      set_name: `Test Set E2E ${rand}`,
      set_code: `TSE${rand}`,
      num_of_cards: 3,
      tcg_date: null,
      imported_at: new Date(),
    });
    testSetCode = cardSet.set_code;

    const raritySeeds = [
      { name: 'Test Common Card', rarity: 'Common' },
      { name: 'Test Rare Card', rarity: 'Rare' },
      { name: 'Test Secret Card', rarity: 'Secret Rare' },
    ];
    const createdCards = await Card.insertMany(
      raritySeeds.map((seed, i) => ({
        ygoprodeck_id: 900_000_000 + rand * 10 + i,
        name: seed.name,
        type: 'Normal Monster',
        frame_type: 'normal',
        description: 'Carte de test E2E',
        atk: 1000,
        def: 1000,
        level_rank: 4,
        race: 'Warrior',
        attribute: 'LIGHT',
        archetype: null,
        card_sets: [
          {
            set_name: cardSet.set_name,
            set_code: `${cardSet.set_code}-00${i + 1}`,
            set_rarity: seed.rarity,
            set_rarity_code: '',
            set_price: '0',
          },
        ],
        card_images: [
          {
            image_id: 900_000_000 + rand * 10 + i,
            image_url: 'https://images.ygoprodeck.com/images/cards/test.jpg',
            image_url_small: 'https://images.ygoprodeck.com/images/cards_small/test.jpg',
            image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/test.jpg',
          },
        ],
        is_custom: false,
      })),
    );
    cardMongoId = createdCards[0]!._id.toString();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('inscrit un MJ, un joueur et un tiers non-membre', async () => {
    gm = await registerUser('e2e_gm');
    player = await registerUser('e2e_player');
    outsider = await registerUser('e2e_outsider');
    expect(gm.token).toBeTruthy();
    expect(player.token).toBeTruthy();
    expect(outsider.token).toBeTruthy();
  });

  it('crée un salon (sans prix de booster global) et le joueur le rejoint', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ currency_name: 'Duel Points' })
      .expect(201);

    sessionId = res.body.session.id;
    sessionCode = res.body.session.code;
    expect(res.body.session.pack_price).toBeUndefined();
    expect(res.body.session.currency_name).toBe('Duel Points');

    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);
  });

  it('le joueur crée un personnage (point-buy 27, Charisme élevé pour le marchandage)', async () => {
    const res = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Testeuse E2E',
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);

    characterId = res.body.character.id;
    expect(res.body.character.money).toBe(0);
    expect(res.body.character.collection).toEqual([]);
    expect(res.body.character.sealed_boosters).toEqual([]);
  });

  it('le MJ crédite le personnage en monnaie', async () => {
    const res = await request(app)
      .patch(`/api/characters/${characterId}`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ money: 500 })
      .expect(200);
    expect(res.body.character.money).toBe(500);
  });

  it("le joueur, propriétaire du personnage, ne peut PAS se créditer lui-même (seul le MJ contrôle l'argent, comme le niveau/XP)", async () => {
    await request(app)
      .patch(`/api/characters/${characterId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ money: 999999 })
      .expect(403)
      .then((res) => {
        expect(res.body.error.code).toBe('forbidden');
      });

    // Le solde crédité par le MJ juste avant reste inchangé après la tentative refusée.
    const check = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    expect(check.body.character.money).toBe(500);
  });

  it('le joueur peut en revanche toujours modifier les champs qui lui restent ouverts (ex. historique) sans toucher à money', async () => {
    const res = await request(app)
      .patch(`/api/characters/${characterId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ backstory: 'Une histoire mise à jour par la joueuse elle-même.' })
      .expect(200);
    expect(res.body.character.backstory).toBe('Une histoire mise à jour par la joueuse elle-même.');
    expect(res.body.character.money).toBe(500); // inchangé
  });

  it('le MJ crée un marchand avec un DC de marchandage bas', async () => {
    const res = await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'Marchand E2E', description: 'Boutique de test', haggle_dc: 5 })
      .expect(201);

    merchantId = res.body.merchant.id;
    expect(res.body.merchant.haggle_dc).toBe(5);
    expect(res.body.merchant.items).toEqual([]);
  });

  it('un joueur (pas MJ) ne peut pas créer de marchand', async () => {
    await request(app)
      .post('/api/merchants')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Boutique pirate' })
      .expect(403);
  });

  it("le MJ construit l'inventaire du marchand : carte, booster, et deux articles dédiés aux cas limites", async () => {
    // haggle_dc/haggle_discount_percent : marchandage propre à CET article
    // (voir Merchant.model.ts) — configuré une fois par le MJ ici, plus
    // jamais retapé à chaque tentative d'achat.
    const cardItemRes = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'card', card_id: cardMongoId, price: 100, stock: 3, haggle_dc: 5, haggle_discount_percent: 30 })
      .expect(201);
    const cardItem = cardItemRes.body.merchant.items.find((i: { item_type: string }) => i.item_type === 'card');
    cardItemId = cardItem.id;
    expect(cardItem).toMatchObject({ haggle_dc: 5, haggle_discount_percent: 30 });

    const boosterItemRes = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'booster', set_code: testSetCode, price: 50, stock: 2 })
      .expect(201);
    const boosterItem = boosterItemRes.body.merchant.items.find((i: { item_type: string }) => i.item_type === 'booster');
    boosterItemId = boosterItem.id;
    // Pas de haggle_dc fourni : article non négociable par défaut.
    expect(boosterItem).toMatchObject({ haggle_dc: null, haggle_discount_percent: null });

    // Stock à 1 : sert à déclencher un refus "stock insuffisant" sans ambiguïté.
    const stockTestRes = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'card', card_id: cardMongoId, price: 10, stock: 1, haggle_dc: 5, haggle_discount_percent: 50 })
      .expect(201);
    stockTestItemId = stockTestRes.body.merchant.items[stockTestRes.body.merchant.items.length - 1].id;

    // Prix hors de portée + stock fini : sert à vérifier le rollback du stock
    // quand le prélèvement d'argent échoue après coup (régression du bug
    // $elemMatch : sans lui, ce décrément pouvait toucher un AUTRE article).
    const fundsTestRes = await request(app)
      .post(`/api/merchants/${merchantId}/items`)
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ item_type: 'card', card_id: cardMongoId, price: 999_999, stock: 5 })
      .expect(201);
    fundsTestItemId = fundsTestRes.body.merchant.items[fundsTestRes.body.merchant.items.length - 1].id;

    expect(fundsTestRes.body.merchant.items).toHaveLength(4);
  });

  it("l'inventaire est visible par un membre du salon, refusé à un tiers", async () => {
    const asPlayer = await request(app)
      .get(`/api/merchants/session/${sessionId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    expect(asPlayer.body.merchants).toHaveLength(1);
    expect(asPlayer.body.merchants[0].items).toHaveLength(4);

    await request(app)
      .get(`/api/merchants/session/${sessionId}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(403);
  });

  it('achète une carte sans marchandage : argent débité, carte ajoutée à la collection, stock décrémenté', async () => {
    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(200);

    expect(res.body.purchase.total_price).toBe(100);
    expect(res.body.purchase.haggle).toBeNull();
    expect(res.body.character.money).toBe(400);
    expect(res.body.character.collection).toEqual([cardMongoId]);

    const merchantAfter = await request(app)
      .get(`/api/merchants/${merchantId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    const items = merchantAfter.body.merchant.items as Array<{ id: string; stock: number | null }>;
    expect(items.find((i) => i.id === cardItemId)!.stock).toBe(2); // 3 - 1
    expect(items.find((i) => i.id === boosterItemId)!.stock).toBe(2); // inchangé
    expect(items.find((i) => i.id === stockTestItemId)!.stock).toBe(1); // inchangé
  });

  it("marchandage réussi : la remise CONFIGURÉE SUR L'ARTICLE (30%, pas retapée par le joueur) est appliquée au prix", async () => {
    // Modificateur choisi par le MJ assez haut pour garantir le succès contre
    // le DC de l'article (5) quel que soit le jet (min 1+15=16 >= 5).
    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1, haggle: { modifier: 15 } })
      .expect(200);

    expect(res.body.purchase.haggle).toMatchObject({ dc: 5, modifier: 15, success: true, discount_percent: 30 });
    expect(res.body.purchase.unit_price).toBe(70); // ceil(100 * (1 - 0.30))
    expect(res.body.character.collection).toHaveLength(2);
  });

  it("marchandage raté : la remise configurée sur l'article ne compte pas, prix plein appliqué", async () => {
    // Modificateur assez bas pour garantir l'échec quel que soit le jet
    // (max 20-20=0 < DC de l'article, 5).
    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1, haggle: { modifier: -20 } })
      .expect(200);

    expect(res.body.purchase.haggle).toMatchObject({ dc: 5, modifier: -20, success: false, discount_percent: 0 });
    expect(res.body.purchase.unit_price).toBe(100); // prix plein, la remise configurée ne s'applique qu'au succès
    expect(res.body.character.collection).toHaveLength(3);
  });

  it("un article sans haggle_dc configuré n'est pas négociable : POST .../haggle et l'achat inline avec `haggle` sont tous les deux refusés", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${boosterItemId}/haggle`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, modifier: 10 })
      .expect(400);

    await request(app)
      .post(`/api/merchants/${merchantId}/items/${boosterItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1, haggle: { modifier: 10 } })
      .expect(400);
  });

  it('achète un booster : mis de côté scellé (pas encore de nouvelles cartes dans la collection)', async () => {
    const collectionBefore = 3; // 1 achat simple + 1 marchandage réussi + 1 marchandage raté (prix plein)

    const res = await request(app)
      .post(`/api/merchants/${merchantId}/items/${boosterItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(200);

    expect(res.body.character.sealed_boosters).toHaveLength(1);
    expect(res.body.character.sealed_boosters[0]).toMatchObject({ set_code: testSetCode, quantity: 1 });
    expect(res.body.character.collection).toHaveLength(collectionBefore);
    collectionSizeBeforeOpen = res.body.character.collection.length;

    const merchantAfter = await request(app)
      .get(`/api/merchants/${merchantId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    const items = merchantAfter.body.merchant.items as Array<{ id: string; stock: number | null }>;
    expect(items.find((i) => i.id === boosterItemId)!.stock).toBe(1); // 2 - 1
  });

  it('stock insuffisant : achat refusé (409), sans effet de bord sur les autres articles', async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${stockTestItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 5 })
      .expect(409);

    const merchantAfter = await request(app)
      .get(`/api/merchants/${merchantId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    const items = merchantAfter.body.merchant.items as Array<{ id: string; stock: number | null }>;
    expect(items.find((i) => i.id === stockTestItemId)!.stock).toBe(1); // inchangé
    expect(items.find((i) => i.id === boosterItemId)!.stock).toBe(1); // pas touché par erreur
  });

  it(
    'fonds insuffisants : achat refusé (402), le stock déjà décrémenté est restauré (régression $elemMatch)',
    async () => {
      const before = await request(app)
        .get(`/api/characters/${characterId}`)
        .set('Authorization', `Bearer ${player.token}`)
        .expect(200);
      const moneyBefore = before.body.character.money;

      await request(app)
        .post(`/api/merchants/${merchantId}/items/${fundsTestItemId}/purchase`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ character_id: characterId, quantity: 1 })
        .expect(402);

      const after = await request(app)
        .get(`/api/characters/${characterId}`)
        .set('Authorization', `Bearer ${player.token}`)
        .expect(200);
      expect(after.body.character.money).toBe(moneyBefore);

      const merchantAfter = await request(app)
        .get(`/api/merchants/${merchantId}`)
        .set('Authorization', `Bearer ${player.token}`)
        .expect(200);
      const items = merchantAfter.body.merchant.items as Array<{ id: string; stock: number | null }>;
      // Le stock décrémenté avant l'échec du paiement doit être restauré à
      // l'identique — sans le fix $elemMatch, ce rollback pouvait incrémenter
      // le stock d'un AUTRE article du même marchand.
      expect(items.find((i) => i.id === fundsTestItemId)!.stock).toBe(5);
      expect(items.find((i) => i.id === stockTestItemId)!.stock).toBe(1); // du test précédent, inchangé ici
      expect(items.find((i) => i.id === boosterItemId)!.stock).toBe(1); // inchangé
    },
  );

  it('un tiers non-membre ne peut pas acheter', async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/purchase`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(403);
  });

  it('ouvre le booster scellé : 9 cartes ajoutées à la collection, tirage pondéré par rareté', async () => {
    const res = await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ set_code: testSetCode, quantity: 1 })
      .expect(200);

    expect(res.body.opened_cards).toHaveLength(9);
    expect(res.body.character.sealed_boosters).toEqual([]);
    expect(res.body.character.collection).toHaveLength(collectionSizeBeforeOpen + 9);

    // Le pool ne contient que les 3 cartes seedées : chaque carte tirée doit
    // en faire partie (aucune carte étrangère ne doit apparaître).
    const seededIds = new Set(res.body.opened_cards.map((c: { id: string }) => c.id));
    for (const id of seededIds) {
      expect(res.body.character.collection).toContain(id);
    }

    // Chaque carte tirée porte sa rareté (pour ce set précis) et le flag de
    // "grande révélation" côté front, dérivé de cette même rareté.
    for (const card of res.body.opened_cards as Array<{ name: string; rarity: string; is_rare_reveal: boolean }>) {
      if (card.name === 'Test Common Card') {
        expect(card.rarity).toBe('Common');
        expect(card.is_rare_reveal).toBe(false);
      } else if (card.name === 'Test Rare Card') {
        expect(card.rarity).toBe('Rare');
        expect(card.is_rare_reveal).toBe(false);
      } else if (card.name === 'Test Secret Card') {
        expect(card.rarity).toBe('Secret Rare');
        expect(card.is_rare_reveal).toBe(true);
      } else {
        throw new Error(`Carte inattendue dans le pack : ${card.name}`);
      }
    }
  });

  it("un tiers ne peut pas ouvrir un booster pour le personnage d'un autre joueur", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${boosterItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1 })
      .expect(200);

    await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ set_code: testSetCode, quantity: 1 })
      .expect(403);
  });

  it('la collection agrégée reflète exactement les cartes achetées et tirées', async () => {
    const res = await request(app)
      .get(`/api/characters/${characterId}/collection`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);

    const testCardEntry = res.body.collection.find(
      (entry: { card: { id: string } }) => entry.card.id === cardMongoId,
    );
    expect(testCardEntry).toBeDefined();
    // 3 exemplaires achetés directement, plus d'éventuels doublons tirés du booster.
    expect(testCardEntry.quantity).toBeGreaterThanOrEqual(3);

    const totalCopies = res.body.collection.reduce((sum: number, entry: { quantity: number }) => sum + entry.quantity, 0);
    expect(totalCopies).toBe(3 + 9); // 3 achats directs (dont 1 marchandage raté à prix plein) + 1 booster ouvert (9 cartes)

    // Enrichissement pour le tri du deckbuilder (filtre/tri plein écran) :
    // date de sortie (inconnue ici, le set de test n'a pas de tcg_date) et
    // position de première acquisition (index dans le tableau collection,
    // qui empile toujours dans l'ordre réel d'acquisition).
    expect(testCardEntry.release_date).toBeNull();
    expect(typeof testCardEntry.acquired_order).toBe('number');
    expect(testCardEntry.acquired_order).toBeGreaterThanOrEqual(0);
  });

  it("marchandage en 2 temps (POST .../haggle) : un jet raté peut être relancé via un reroll de Chance AVANT de valider l'achat, jamais après", async () => {
    // Solde de rerolls connu, indépendant de la Chance de base du personnage
    // (8, sous le seuil de la formule CLAUDE.md §3.3 — 0 reroll naturel).
    await Character.updateOne({ _id: characterId }, { $set: { remaining_luck_rerolls: 1 } });

    // Modificateur garanti en échec (max total = 20-20=0 < DC 5, quel que
    // soit le jet réel) : le premier jet ET le reroll échouent tous les
    // deux de façon déterministe — la remise négociée ne s'applique jamais,
    // seul le comptage du reroll et la consommation de la négociation sont
    // testés ici (pas l'issue du hasard, déjà couverte par les tests
    // "marchandage réussi/raté" plus haut).
    // stockTestItemId (prix 10, stock 1) plutôt que cardItemId : ce dernier
    // est déjà à sec (stock 3 entièrement consommé par les 3 achats plus
    // haut) — stockTestItemId, lui, n'a encore jamais été acheté avec
    // succès (les tests le concernant ne font que vérifier le refus 409).
    const rolled = await request(app)
      .post(`/api/merchants/${merchantId}/items/${stockTestItemId}/haggle`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, modifier: -20 })
      .expect(201);
    expect(rolled.body.haggle.success).toBe(false);
    expect(rolled.body.remaining_luck_rerolls).toBe(1);
    const haggleId = rolled.body.haggle.id as string;

    const rerolled = await request(app)
      .post(`/api/merchants/${merchantId}/haggle/${haggleId}/reroll`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({})
      .expect(200);
    expect(rerolled.body.haggle.success).toBe(false); // même modificateur -20, échec garanti aussi après reroll
    expect(rerolled.body.remaining_luck_rerolls).toBe(0);

    // Plus de reroll disponible pour ce personnage : refusé.
    await request(app)
      .post(`/api/merchants/${merchantId}/haggle/${haggleId}/reroll`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({})
      .expect(400);

    const before = await request(app).get(`/api/characters/${characterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
    const collectionBefore = (before.body.character.collection as string[]).length;

    const purchased = await request(app)
      .post(`/api/merchants/${merchantId}/items/${stockTestItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1, haggle_id: haggleId })
      .expect(200);
    expect(purchased.body.purchase.haggle).toMatchObject({ success: false, discount_percent: 0 });
    expect(purchased.body.purchase.unit_price).toBe(10); // prix plein (stockTestItemId), l'échec est resté un échec
    expect(purchased.body.character.collection).toHaveLength(collectionBefore + 1);

    // La négociation vient d'être consommée par cet achat : pas rejouable.
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${stockTestItemId}/purchase`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, quantity: 1, haggle_id: haggleId })
      .expect(404);
  });

  it("un tiers non-membre du salon ne peut ni lancer le marchandage, ni dépenser le reroll de Chance, pour ce personnage", async () => {
    await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/haggle`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ character_id: characterId, modifier: 0 })
      .expect(403);

    await Character.updateOne({ _id: characterId }, { $set: { remaining_luck_rerolls: 1 } });
    const rolled = await request(app)
      .post(`/api/merchants/${merchantId}/items/${cardItemId}/haggle`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ character_id: characterId, modifier: 0 })
      .expect(201);

    await request(app)
      .post(`/api/merchants/${merchantId}/haggle/${rolled.body.haggle.id}/reroll`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({})
      .expect(403);
  });
});

/**
 * Régression + fonctionnalité : un set jamais importé peut malgré tout avoir
 * un "pool" non vide, à cause des réimpressions. Le champ `card_sets` d'une
 * carte YGOPRODeck liste TOUS les produits où elle est jamais parue, pas
 * seulement celui par lequel on l'a importée chez nous : importer le Set A
 * peut donc faire apparaître dans notre base une carte qui liste AUSSI le
 * Set B dans son historique, même si le Set B lui-même n'a jamais été
 * importé chez nous. `open-booster` importe maintenant le set à la volée
 * s'il ne l'était pas encore (au lieu de simplement refuser), MAIS doit
 * quand même refuser si cet import à la volée ne ramène réellement aucune
 * carte pour CE set précis (sinon on retomberait sur le pool contaminé par
 * la réimpression au lieu des vraies cartes du set — ou de l'absence de
 * set réel si le nom est bidon).
 */
describe('Ouverture de booster : import à la volée d’un set jamais importé, sans jamais utiliser un pool contaminé par des réimpressions (E2E, régression)', () => {
  let player: AuthedUser;
  let characterId: string;
  let importedSetCode: string;
  let neverImportedSetCode: string;
  let reprintCardId: string;
  let sessionId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    // Par défaut (set non reconnu par le mock ci-dessous) : simule YGOPRODeck
    // qui ne trouve aucune carte pour ce nom de set (comme un vrai 400 de
    // cardinfo.php), pour rester représentatif de fetchCardsBySet réel.
    vi.mocked(fetchCardsBySet).mockResolvedValue([]);

    player = await registerUser('reprint_player');
    const session = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ currency_name: 'Gold' })
      .expect(201);
    sessionId = session.body.session.id;
    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: sessionId,
        name: 'Testeur Réimpression',
        is_npc: false,
        stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
      })
      .expect(201);
    characterId = character.body.character.id;

    const importedSet = await CardSet.create({
      set_name: `Set Importé ${rand}`,
      set_code: `IMP${rand}`,
      num_of_cards: 1,
      tcg_date: null,
      imported_at: new Date(), // effectivement importé
    });
    importedSetCode = importedSet.set_code;

    const neverImportedSet = await CardSet.create({
      set_name: `Set Jamais Importé ${rand}`,
      set_code: `NIMP${rand}`,
      num_of_cards: 50, // ses vraies cartes existent chez YGOPRODeck, mais jamais chez nous
      tcg_date: null,
      imported_at: null, // <- jamais importé
    });
    neverImportedSetCode = neverImportedSet.set_code;

    // Une seule carte en base, réimprimée dans les DEUX sets (comme une carte
    // staple réelle) : son card_sets liste les deux produits, alors que seul
    // le premier a réellement été importé chez nous.
    const reprintCard = await Card.create({
      ygoprodeck_id: 900_500_000 + rand,
      name: 'Carte Réimprimée de Test',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Carte de test réimpression',
      atk: 1000,
      def: 1000,
      level_rank: 4,
      race: 'Warrior',
      attribute: 'LIGHT',
      archetype: null,
      card_sets: [
        { set_name: importedSet.set_name, set_code: `${importedSet.set_code}-001`, set_rarity: 'Common', set_rarity_code: '', set_price: '0' },
        { set_name: neverImportedSet.set_name, set_code: `${neverImportedSet.set_code}-013`, set_rarity: 'Common', set_rarity_code: '', set_price: '0' },
      ],
      card_images: [
        {
          image_id: 900_500_000 + rand,
          image_url: 'https://images.ygoprodeck.com/images/cards/test.jpg',
          image_url_small: 'https://images.ygoprodeck.com/images/cards_small/test.jpg',
          image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/test.jpg',
        },
      ],
      is_custom: false,
    });
    reprintCardId = reprintCard._id.toString();

    await Character.updateOne(
      { _id: characterId },
      {
        $set: {
          sealed_boosters: [
            { set_code: importedSetCode, set_name: importedSet.set_name, quantity: 1 },
            { set_code: neverImportedSetCode, set_name: neverImportedSet.set_name, quantity: 1 },
          ],
        },
      },
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('tente un import à la volée puis refuse quand même si YGOPRODeck ne ramène réellement aucune carte pour ce set', async () => {
    await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ set_code: neverImportedSetCode, quantity: 1 })
      .expect(400)
      .then((res) => {
        expect(res.body.error.code).toBe('set_not_imported');
      });

    // Le booster scellé n'a pas été consommé par la tentative refusée.
    const character = await request(app)
      .get(`/api/characters/${characterId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    expect(character.body.character.sealed_boosters.find((b: { set_code: string }) => b.set_code === neverImportedSetCode)?.quantity).toBe(1);

    // L'import à la volée n'a rien trouvé : le set ne doit PAS être marqué
    // importé (sinon on ne retenterait plus jamais, alors qu'il n'a en
    // réalité aucune carte en base — cf. cardImport.ts).
    const cardSet = await CardSet.findOne({ set_code: neverImportedSetCode });
    expect(cardSet?.imported_at).toBeNull();
  });

  it('ouvre normalement le set réellement importé, malgré la carte partagée avec le set non importé', async () => {
    const res = await request(app)
      .post(`/api/characters/${characterId}/open-booster`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ set_code: importedSetCode, quantity: 1 })
      .expect(200);

    expect(res.body.opened_cards).toHaveLength(9);
    expect(res.body.opened_cards.every((c: { id: string }) => c.id === reprintCardId)).toBe(true);
  });

  describe('import automatique à la première ouverture (fonctionnalité demandée)', () => {
    const autoSetName = `Set Auto-Import ${rand}`;
    let autoSetCode: string;
    let autoCharacterId: string;

    beforeAll(async () => {
      const autoSet = await CardSet.create({
        set_name: autoSetName,
        set_code: `AUTO${rand}`,
        num_of_cards: 3,
        tcg_date: null,
        imported_at: null, // jamais importé
      });
      autoSetCode = autoSet.set_code;

      // Réponse canonique YGOPRODeck UNIQUEMENT pour ce set précis (le mock
      // reste [] par défaut pour tout autre nom, cf. beforeAll du bloc parent).
      vi.mocked(fetchCardsBySet).mockImplementation(async (setName: string) => {
        if (setName !== autoSetName) return [];
        return [0, 1, 2].map((i) => ({
          id: 900_600_000 + rand * 10 + i,
          name: `Carte Auto-Import ${i}`,
          type: 'Normal Monster',
          frameType: 'normal',
          desc: 'Carte de test import auto',
          atk: 1000,
          def: 1000,
          level: 4,
          race: 'Warrior',
          attribute: 'LIGHT',
          card_sets: [
            {
              set_name: autoSetName,
              set_code: `${autoSetCode}-00${i + 1}`,
              set_rarity: 'Common',
              set_rarity_code: '',
              set_price: '0',
            },
          ],
          card_images: [
            {
              id: 900_600_000 + rand * 10 + i,
              image_url: 'https://images.ygoprodeck.com/images/cards/test.jpg',
              image_url_small: 'https://images.ygoprodeck.com/images/cards_small/test.jpg',
              image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/test.jpg',
            },
          ],
        }));
      });

      const autoCharacter = await request(app)
        .post('/api/characters')
        .set('Authorization', `Bearer ${player.token}`)
        .send({
          game_session_id: sessionId,
          name: 'Testeur Import Auto',
          is_npc: false,
          stats: { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 },
        })
        .expect(201);
      autoCharacterId = autoCharacter.body.character.id;

      await Character.updateOne(
        { _id: autoCharacterId },
        { $set: { sealed_boosters: [{ set_code: autoSetCode, set_name: autoSetName, quantity: 2 }] } },
      );
    });

    it("ouvre directement un booster jamais importé : les cartes sont importées à la volée et le pool respecte celles du pack", async () => {
      expect((await CardSet.findOne({ set_code: autoSetCode }))?.imported_at).toBeNull();

      const res = await request(app)
        .post(`/api/characters/${autoCharacterId}/open-booster`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ set_code: autoSetCode, quantity: 1 })
        .expect(200);

      expect(res.body.opened_cards).toHaveLength(9);
      const openedNames = new Set(res.body.opened_cards.map((c: { name: string }) => c.name));
      for (const name of openedNames) {
        expect(name).toMatch(/^Carte Auto-Import [0-2]$/); // uniquement les 3 cartes propres à ce set, jamais la réimpression d'un autre set
      }

      const cardSet = await CardSet.findOne({ set_code: autoSetCode });
      expect(cardSet?.imported_at).not.toBeNull();

      const importedCards = await Card.find({ 'card_sets.set_name': autoSetName });
      expect(importedCards).toHaveLength(3);
    });

    it("n'importe qu'une seule fois : une seconde ouverture du même set n'appelle plus YGOPRODeck", async () => {
      const callsBefore = vi.mocked(fetchCardsBySet).mock.calls.filter(([name]) => name === autoSetName).length;
      expect(callsBefore).toBe(1);

      const res = await request(app)
        .post(`/api/characters/${autoCharacterId}/open-booster`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ set_code: autoSetCode, quantity: 1 })
        .expect(200);
      expect(res.body.opened_cards).toHaveLength(9);

      const callsAfter = vi.mocked(fetchCardsBySet).mock.calls.filter(([name]) => name === autoSetName).length;
      expect(callsAfter).toBe(1); // toujours 1 : pas de ré-import, le set était déjà marqué importé
    });
  });
});
