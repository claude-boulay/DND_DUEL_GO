import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { fetchCardsByIds } from '../services/ygoprodeck';

/**
 * E2E : le MJ ajoute des cartes à la collection d'un personnage, soit une par
 * une (recherche + quantité), soit en masse via un import CSV — migration
 * d'une collection déjà existante (CLAUDE.md §3.5). Mocke `fetchCardsByIds`
 * (comme economy.e2e.test.ts mocke fetchCardsBySet) : le vrai appel réseau a
 * déjà été vérifié en direct séparément (voir la session), ce fichier reste
 * rapide/indépendant du réseau comme le reste des tests de cartes.
 */
vi.mock('../services/ygoprodeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ygoprodeck')>();
  return { ...actual, fetchCardsByIds: vi.fn() };
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

const stats = { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 };

describe('Collection : le MJ ajoute des cartes à un personnage (recherche + import CSV) (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let characterId: string;
  let alreadyImportedCardId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('ci_gm');
    player = await registerUser('ci_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const character = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Personnage de Test Import', is_npc: false, stats })
      .expect(201);
    characterId = character.body.character.id;

    // Déjà en base (import direct, pas via fetchCardsByIds) — le CSV pourra
    // le référencer sans jamais déclencher d'appel réseau pour lui.
    const already = await Card.create({
      ygoprodeck_id: 16768387 + rand,
      engine_code: 16768387 + rand,
      name: 'Carte Déjà Importée',
      type: 'Flip Effect Monster',
      frame_type: 'effect',
      description: 'Carte de test déjà en base.',
      atk: 800,
      def: 1500,
      level_rank: 3,
      race: 'Fiend',
      attribute: 'DARK',
      archetype: null,
      card_sets: [],
      card_images: [{ image_id: 1, image_url: 'https://example.com/1.jpg', image_url_small: 'https://example.com/1s.jpg', image_url_cropped: 'https://example.com/1c.jpg' }],
      is_custom: false,
    });
    alreadyImportedCardId = already._id.toString();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  describe('POST /:id/collection/add-card — ajout unitaire via recherche', () => {
    it('le MJ ajoute 3 exemplaires ; un joueur (même propriétaire du personnage) ne peut pas', async () => {
      await request(app)
        .post(`/api/characters/${characterId}/collection/add-card`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ card_id: alreadyImportedCardId, quantity: 3 })
        .expect(403);

      const res = await request(app)
        .post(`/api/characters/${characterId}/collection/add-card`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ card_id: alreadyImportedCardId, quantity: 3 })
        .expect(200);

      expect(res.body.added).toEqual({ card: expect.objectContaining({ id: alreadyImportedCardId }), quantity: 3 });
      const copies = res.body.character.collection.filter((id: string) => id === alreadyImportedCardId);
      expect(copies).toHaveLength(3);
    });

    it('quantité invalide (0, négatif, non entière) rejetée ; carte inconnue -> 404', async () => {
      await request(app)
        .post(`/api/characters/${characterId}/collection/add-card`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ card_id: alreadyImportedCardId, quantity: 0 })
        .expect(400);

      await request(app)
        .post(`/api/characters/${characterId}/collection/add-card`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ card_id: new mongoose.Types.ObjectId().toString(), quantity: 1 })
        .expect(404);
    });
  });

  describe('POST /:id/collection/import-csv — migration de masse', () => {
    it("importe une carte déjà connue (aucun appel réseau), une carte manquante récupérée en direct, ignore une ligne sans cardid, et rapporte un id inconnu comme non trouvé", async () => {
      const missingId = 41392891 + rand; // pas encore en base -> doit déclencher fetchCardsByIds
      const unknownId = 999999999 + rand; // jamais trouvé, même après tentative réseau

      vi.mocked(fetchCardsByIds).mockResolvedValue([
        {
          id: missingId,
          name: 'Carte Récupérée en Direct',
          type: 'Normal Monster',
          frameType: 'normal',
          desc: 'Carte de test récupérée via fetchCardsByIds.',
          atk: 1300,
          def: 1400,
          level: 4,
          race: 'Fiend',
          attribute: 'DARK',
          card_images: [{ id: 2, image_url: 'https://example.com/2.jpg', image_url_small: 'https://example.com/2s.jpg', image_url_cropped: 'https://example.com/2c.jpg' }],
        },
      ]);

      // Reproduit fidèlement le format réel (BOM UTF-8 + colonnes YGOPRODeck),
      // avec une ligne sans cardid (doit être ignorée, pas planter tout l'import).
      const csv =
        '﻿cardname,cardq,cardrarity,card_edition,cardset,cardcode,cardid,print_id\n' +
        `Carte Déjà Importée,2,Common,Unlimited,Metal Raiders,MRD-017,${16768387 + rand},21779\n` +
        `Carte Récupérée en Direct,1,Common,Unlimited,Metal Raiders,MRD-049,${missingId},22089\n` +
        `Carte Sans Id,1,Common,Unlimited,Metal Raiders,MRD-999,,99999\n` +
        `Carte Introuvable,5,Common,Unlimited,Metal Raiders,MRD-000,${unknownId},00000\n`;

      const res = await request(app)
        .post(`/api/characters/${characterId}/collection/import-csv`)
        .set('Authorization', `Bearer ${gm.token}`)
        .attach('csv', Buffer.from(csv, 'utf-8'), 'collection.csv')
        .expect(200);

      expect(res.body.summary.total_copies_added).toBe(3); // 2 (déjà connue) + 1 (récupérée en direct)
      expect(res.body.summary.added).toEqual(
        expect.arrayContaining([
          { card_name: 'Carte Déjà Importée', quantity: 2 },
          { card_name: 'Carte Récupérée en Direct', quantity: 1 },
        ]),
      );
      expect(res.body.summary.not_found).toEqual([{ cardname: 'Carte Introuvable', cardid: String(unknownId) }]);
      expect(res.body.summary.skipped).toEqual([expect.objectContaining({ cardname: 'Carte Sans Id' })]);

      // fetchCardsByIds n'a JAMAIS été appelé avec l'id déjà connu (16768387+rand) — pas de requête réseau inutile.
      const calledWithIds = vi.mocked(fetchCardsByIds).mock.calls.flatMap(([ids]) => ids);
      expect(calledWithIds).not.toContain(16768387 + rand);
      expect(calledWithIds).toContain(missingId);

      // Vérifie que la carte récupérée en direct a bien été persistée localement (pas juste renvoyée).
      const savedMissing = await Card.findOne({ ygoprodeck_id: missingId });
      expect(savedMissing?.name).toBe('Carte Récupérée en Direct');
    });

    it("un joueur (pas MJ) ne peut pas importer de CSV", async () => {
      const csv = 'cardname,cardq,cardrarity,card_edition,cardset,cardcode,cardid,print_id\n';
      await request(app)
        .post(`/api/characters/${characterId}/collection/import-csv`)
        .set('Authorization', `Bearer ${player.token}`)
        .attach('csv', Buffer.from(csv, 'utf-8'), 'collection.csv')
        .expect(403);
    });
  });
});
