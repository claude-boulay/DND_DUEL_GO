import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { fetchCardsByIds } from '../services/ygoprodeck';

/**
 * E2E : trois fonctionnalités demandées par l'utilisateur pour le MJ (voir
 * "Liste DND Yugiyo.txt") — un carnet du MJ par partie (Histoire/Lieu), des
 * notes MJ privées sur chaque fiche perso/PNJ (jamais visibles par le
 * joueur, même sur SON PROPRE personnage), et l'import d'un deck PNJ complet
 * depuis un fichier .ydk (ou son contenu collé). Mocke `fetchCardsByIds`
 * (même pattern que collectionImport.e2e.test.ts) pour rester indépendant du
 * réseau — le vrai appel a déjà été vérifié en direct par ailleurs.
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

describe('Fonctionnalités MJ : carnet du MJ, notes MJ privées, import de deck .ydk (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let sessionId: string;
  let sessionCode: string;
  let playerCharacterId: string;
  let npcCharacterId: string;
  let knownCardEngineCode: number;
  let fetchedCardEngineCode: number;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('gmf_gm');
    player = await registerUser('gmf_player');

    const session = await request(app).post('/api/sessions').set('Authorization', `Bearer ${gm.token}`).send({ currency_name: 'Gold' }).expect(201);
    sessionId = session.body.session.id;
    sessionCode = session.body.session.code;
    await request(app).post(`/api/sessions/${sessionCode}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    const playerChar = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionId, name: 'Perso Joueur', is_npc: false, stats })
      .expect(201);
    playerCharacterId = playerChar.body.character.id;

    const npcChar = await request(app)
      .post('/api/characters')
      .set('Authorization', `Bearer ${gm.token}`)
      .send({ game_session_id: sessionId, name: 'PNJ Deck Import', is_npc: true, stats })
      .expect(201);
    npcCharacterId = npcChar.body.character.id;

    // Une carte déjà en base (résolue par engine_code, pas d'appel réseau) et
    // une autre volontairement absente, récupérée à la volée via le
    // fetchCardsByIds mocké — les deux chemins de résolution du parseur .ydk.
    knownCardEngineCode = 91000000 + rand;
    await Card.create({
      ygoprodeck_id: knownCardEngineCode,
      engine_code: knownCardEngineCode,
      name: 'Carte YDK Déjà Connue',
      type: 'Normal Monster',
      frame_type: 'normal',
      description: 'Carte de test déjà en base.',
      atk: 1000,
      def: 1000,
      level_rank: 4,
      race: 'Warrior',
      attribute: 'EARTH',
      archetype: null,
      card_sets: [],
      card_images: [{ image_id: 1, image_url: 'https://example.com/1.jpg', image_url_small: 'https://example.com/1s.jpg', image_url_cropped: 'https://example.com/1c.jpg' }],
      is_custom: false,
    });

    fetchedCardEngineCode = 91000001 + rand;
    vi.mocked(fetchCardsByIds).mockResolvedValue([
      {
        id: fetchedCardEngineCode,
        name: 'Carte YDK Récupérée En Direct',
        type: 'Normal Monster',
        frameType: 'normal',
        desc: 'Carte de test récupérée via fetchCardsByIds mocké.',
        atk: 1200,
        def: 900,
        level: 4,
        race: 'Beast',
        attribute: 'FIRE',
        card_images: [{ id: fetchedCardEngineCode, image_url: 'https://example.com/2.jpg', image_url_small: 'https://example.com/2s.jpg', image_url_cropped: 'https://example.com/2c.jpg' }],
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  describe('Carnet du MJ (Histoire/Lieu), un par partie', () => {
    it('absent (undefined) pour un joueur, même membre du salon', async () => {
      const res = await request(app).get(`/api/sessions/${sessionCode}`).set('Authorization', `Bearer ${player.token}`).expect(200);
      expect(res.body.session.gm_notebook).toBeUndefined();
    });

    it('un joueur ne peut pas modifier le carnet (403)', async () => {
      await request(app)
        .patch(`/api/sessions/${sessionCode}/gm-notebook`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ history: 'Tentative joueur' })
        .expect(403);
    });

    it('le MJ peut lire et écrire les deux sections, chacune indépendamment', async () => {
      const empty = await request(app).get(`/api/sessions/${sessionCode}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      expect(empty.body.session.gm_notebook).toEqual({ history: '', location: '' });

      const afterHistory = await request(app)
        .patch(`/api/sessions/${sessionCode}/gm-notebook`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ history: 'Le royaume est en guerre.' })
        .expect(200);
      expect(afterHistory.body.session.gm_notebook).toEqual({ history: 'Le royaume est en guerre.', location: '' });

      const afterLocation = await request(app)
        .patch(`/api/sessions/${sessionCode}/gm-notebook`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ location: 'La taverne du Dragon Ivre.' })
        .expect(200);
      expect(afterLocation.body.session.gm_notebook).toEqual({ history: 'Le royaume est en guerre.', location: 'La taverne du Dragon Ivre.' });
    });
  });

  describe('Notes MJ privées sur une fiche perso/PNJ', () => {
    it('gm_notes absent (undefined) pour le propriétaire du personnage lui-même', async () => {
      const res = await request(app).get(`/api/characters/${playerCharacterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
      expect(res.body.character.gm_notes).toBeUndefined();
      // Le champ notes partagé, lui, reste normalement présent (comportement inchangé).
      expect(res.body.character.notes).toBe('');
    });

    it('un joueur ne peut pas écrire gm_notes, même sur son propre personnage (403)', async () => {
      await request(app)
        .patch(`/api/characters/${playerCharacterId}`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ gm_notes: 'Tentative joueur' })
        .expect(403);
    });

    it('le MJ peut écrire et relire gm_notes sur un personnage JOUEUR', async () => {
      const res = await request(app)
        .patch(`/api/characters/${playerCharacterId}`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ gm_notes: 'Ce joueur cache un secret.' })
        .expect(200);
      expect(res.body.character.gm_notes).toBe('Ce joueur cache un secret.');

      // Toujours invisible pour le joueur lui-même après coup.
      const asPlayer = await request(app).get(`/api/characters/${playerCharacterId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
      expect(asPlayer.body.character.gm_notes).toBeUndefined();
    });

    it('le MJ peut écrire et relire gm_notes sur un PNJ', async () => {
      const res = await request(app)
        .patch(`/api/characters/${npcCharacterId}`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ gm_notes: 'Antagoniste secret de cette rencontre.' })
        .expect(200);
      expect(res.body.character.gm_notes).toBe('Antagoniste secret de cette rencontre.');
    });

    it("liste des personnages du salon : gm_notes présent pour le MJ, absent pour un joueur", async () => {
      const asGm = await request(app).get(`/api/characters/session/${sessionId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const npcFromGm = asGm.body.characters.find((c: { id: string }) => c.id === npcCharacterId);
      expect(npcFromGm.gm_notes).toBe('Antagoniste secret de cette rencontre.');

      const asPlayer = await request(app).get(`/api/characters/session/${sessionId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
      const npcFromPlayer = asPlayer.body.characters.find((c: { id: string }) => c.id === npcCharacterId);
      expect(npcFromPlayer.gm_notes).toBeUndefined();
    });
  });

  describe('Import de deck PNJ depuis un fichier .ydk (ou contenu collé)', () => {
    const ydkContent = (main: number[], extra: number[] = []) =>
      [`#created by DND Duel GO`, `#Deck de test`, '#main', ...main.map(String), '#extra', ...extra.map(String), '!side', '12345678'].join('\n');

    it("réservé au MJ (403 pour un joueur, même sur son propre personnage)", async () => {
      await request(app)
        .post(`/api/characters/${playerCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ name: 'Import Refusé', content: ydkContent([knownCardEngineCode]) })
        .expect(403);
    });

    it("refusé pour un personnage JOUEUR même demandé par le MJ (400) — un deck joueur reste lié à sa collection", async () => {
      await request(app)
        .post(`/api/characters/${playerCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Import Refusé', content: ydkContent([knownCardEngineCode]) })
        .expect(400);
    });

    it('fichier sans section #main/#extra exploitable est rejeté (400)', async () => {
      await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Deck Vide', content: '#created by X\n!side\n123' })
        .expect(400);
    });

    it('importe un deck réel : une carte déjà connue (par engine_code) + une récupérée à la volée (fetchCardsByIds), sans jamais appeler le réseau pour la première', async () => {
      const callsBefore = vi.mocked(fetchCardsByIds).mock.calls.length;

      const res = await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          name: 'Deck Adversaire Importé',
          content: ydkContent([knownCardEngineCode, knownCardEngineCode, fetchedCardEngineCode]),
        })
        .expect(201);

      expect(res.body.summary).toEqual({ main_count: 3, extra_count: 0, not_found: [] });
      // `importCardsByIds` (services/cardImport.ts) fait un second appel
      // fetchCardsByIds(ids, 'fr') pour peupler `translations.fr` dès qu'un
      // premier appel (anglais) retourne des cartes — ajouté en Phase 7 de
      // l'i18n, même comportement déjà vérifié pour l'import de set
      // (economy.e2e.test.ts) et l'import CSV (collectionImport.e2e.test.ts).
      // 1 id inconnu -> 1 appel anglais + 1 appel français = 2 appels.
      expect(vi.mocked(fetchCardsByIds).mock.calls.length).toBe(callsBefore + 2);

      const importedDeck = res.body.character.decks.find((d: { name: string }) => d.name === 'Deck Adversaire Importé');
      expect(importedDeck.cards).toHaveLength(3);

      // Une seconde importation référençant la MÊME carte fraîchement
      // récupérée ne doit plus jamais retoucher le réseau (déjà en base).
      await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Second Import', content: ydkContent([fetchedCardEngineCode]) })
        .expect(201);
      expect(vi.mocked(fetchCardsByIds).mock.calls.length).toBe(callsBefore + 2);
    });

    it('un passcode totalement inconnu (ni en base, ni côté YGOPRODeck) est rapporté dans not_found sans faire échouer le reste', async () => {
      const unknownCode = 77000000 + rand;
      const res = await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Deck Partiel', content: ydkContent([knownCardEngineCode, unknownCode]) })
        .expect(201);

      expect(res.body.summary.main_count).toBe(1);
      expect(res.body.summary.not_found).toEqual([unknownCode]);
    });

    it('un code custom synthétique (>= 500 000 000) absent de la base est rapporté not_found SANS déclencher fetchCardsByIds', async () => {
      const callsBefore = vi.mocked(fetchCardsByIds).mock.calls.length;
      const foreignCustomCode = 500_000_042;
      const res = await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Deck Custom Étranger', content: ydkContent([foreignCustomCode]) })
        .expect(201);

      expect(res.body.summary).toEqual({ main_count: 0, extra_count: 0, not_found: [foreignCustomCode] });
      expect(vi.mocked(fetchCardsByIds).mock.calls.length).toBe(callsBefore); // jamais tenté
    });

    it('rejette un fichier avec plus de 3 exemplaires de la même carte (copy_limit)', async () => {
      const res = await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Deck Trop de Copies', content: ydkContent([knownCardEngineCode, knownCardEngineCode, knownCardEngineCode, knownCardEngineCode]) })
        .expect(400);
      expect(res.body.error.code).toBe('copy_limit');
    });

    it('rejette un Main Deck de plus de 60 cartes (main_deck_full)', async () => {
      // 61 cartes DISTINCTES, seedées directement (pas via le réseau mocké,
      // qui renvoie toujours la même carte fixe quel que soit l'id demandé)
      // — chacune une seule fois, sous le plafond de copies, pour isoler
      // précisément la règle testée ici (taille du Main Deck).
      const base = 78_000_000 + rand;
      const codes = Array.from({ length: 61 }, (_, i) => base + i);
      await Card.insertMany(
        codes.map((code) => ({
          ygoprodeck_id: code,
          engine_code: code,
          name: `Carte Deck Trop Gros ${code}`,
          type: 'Normal Monster',
          frame_type: 'normal',
          description: 'Carte de test.',
          atk: 100,
          def: 100,
          level_rank: 1,
          race: 'Fiend',
          attribute: 'DARK',
          archetype: null,
          card_sets: [],
          card_images: [{ image_id: code, image_url: 'https://example.com/x.jpg', image_url_small: 'https://example.com/xs.jpg', image_url_cropped: 'https://example.com/xc.jpg' }],
          is_custom: false,
        })),
      );

      const res = await request(app)
        .post(`/api/characters/${npcCharacterId}/decks/import-ydk`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ name: 'Deck Trop Gros', content: ydkContent(codes) })
        .expect(400);
      expect(res.body.error.code).toBe('main_deck_full');
    });
  });
});
