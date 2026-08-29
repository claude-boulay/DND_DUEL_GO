import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';

/**
 * E2E : GET /api/cards filtre directement le catalogue complet côté serveur
 * (catégorie, type de monstre, Pendule, attribut, race) au lieu de renvoyer
 * une page que le front devrait ensuite filtrer lui-même — un filtre ne
 * doit jamais rater une carte simplement parce qu'elle n'était pas dans le
 * lot déjà chargé.
 */

const app = createApp();
const rand = Math.floor(Math.random() * 1e6);

async function registerUser(username: string): Promise<{ token: string }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `${username}_${rand}`, email: `${username}_${rand}@example.com`, password: 'supersecret123' })
    .expect(201);
  return { token: res.body.token as string };
}

async function seedCard(overrides: Partial<{ name: string; frame_type: string; type: string; attribute: string | null; race: string | null }>) {
  const n = Math.floor(Math.random() * 1e9);
  return Card.create({
    ygoprodeck_id: 960_000_000 + n,
    name: overrides.name,
    type: overrides.type ?? 'Normal Monster',
    frame_type: overrides.frame_type ?? 'normal',
    description: 'Carte de test filtre catalogue',
    atk: 1000,
    def: 1000,
    level_rank: 4,
    race: overrides.race ?? null,
    attribute: overrides.attribute ?? null,
    archetype: null,
    card_sets: [],
    card_images: [
      {
        image_id: n,
        image_url: 'https://images.ygoprodeck.com/images/cards/test.jpg',
        image_url_small: 'https://images.ygoprodeck.com/images/cards_small/test.jpg',
        image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/test.jpg',
      },
    ],
    is_custom: false,
  });
}

describe('GET /api/cards : filtrage du catalogue complet côté serveur (E2E)', () => {
  let token: string;
  let normalDarkDragon: Awaited<ReturnType<typeof seedCard>>;
  let effectLightSpellcaster: Awaited<ReturnType<typeof seedCard>>;
  let fusionPendulum: Awaited<ReturnType<typeof seedCard>>;
  let quickPlaySpell: Awaited<ReturnType<typeof seedCard>>;
  let counterTrap: Awaited<ReturnType<typeof seedCard>>;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    const user = await registerUser('catalog_user');
    token = user.token;

    normalDarkDragon = await seedCard({ name: `CQ Dragon Normal ${rand}`, frame_type: 'normal', type: 'Normal Monster', attribute: 'DARK', race: 'Dragon' });
    effectLightSpellcaster = await seedCard({
      name: `CQ Spellcaster Effet ${rand}`,
      frame_type: 'effect',
      type: 'Effect Monster',
      attribute: 'LIGHT',
      race: 'Spellcaster',
    });
    fusionPendulum = await seedCard({
      name: `CQ Fusion Pendule ${rand}`,
      frame_type: 'fusion_pendulum',
      type: 'Pendulum Fusion Monster',
      attribute: 'FIRE',
      race: 'Dragon',
    });
    quickPlaySpell = await seedCard({ name: `CQ Sort Rapide ${rand}`, frame_type: 'spell', type: 'Spell Card', race: 'Quick-Play' });
    counterTrap = await seedCard({ name: `CQ Contre Piege ${rand}`, frame_type: 'trap', type: 'Trap Card', race: 'Counter' });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  async function search(query: string) {
    const res = await request(app).get(`/api/cards${query}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body.cards.map((c: { id: string }) => c.id) as string[];
  }

  const nameFilter = `search=CQ%20`; // restreint aux cartes seedées par ce fichier, sans dépendre du reste du catalogue

  it('category=monster exclut les sorts et pièges', async () => {
    const ids = await search(`?${nameFilter}&category=monster&limit=50`);
    expect(ids).toEqual(
      expect.arrayContaining([normalDarkDragon._id.toString(), effectLightSpellcaster._id.toString(), fusionPendulum._id.toString()]),
    );
    expect(ids).not.toContain(quickPlaySpell._id.toString());
    expect(ids).not.toContain(counterTrap._id.toString());
  });

  it('category=spell,trap ne renvoie que les sorts et pièges', async () => {
    const ids = await search(`?${nameFilter}&category=spell,trap&limit=50`);
    expect(ids).toEqual(expect.arrayContaining([quickPlaySpell._id.toString(), counterTrap._id.toString()]));
    expect(ids).not.toContain(normalDarkDragon._id.toString());
  });

  it('monster_kind=fusion inclut la variante Pendule (fusion_pendulum)', async () => {
    const ids = await search(`?${nameFilter}&monster_kind=fusion&limit=50`);
    expect(ids).toEqual([fusionPendulum._id.toString()]);
  });

  it('pendulum=true ne renvoie que les cartes Pendule', async () => {
    const ids = await search(`?${nameFilter}&pendulum=true&limit=50`);
    expect(ids).toEqual([fusionPendulum._id.toString()]);
  });

  it('attribute=DARK,LIGHT filtre par attribut', async () => {
    const ids = await search(`?${nameFilter}&attribute=DARK,LIGHT&limit=50`);
    expect(ids).toEqual(expect.arrayContaining([normalDarkDragon._id.toString(), effectLightSpellcaster._id.toString()]));
    expect(ids).not.toContain(fusionPendulum._id.toString());
  });

  it('race=Dragon filtre par race, toutes catégories confondues (avec plusieurs matches)', async () => {
    const ids = await search(`?${nameFilter}&race=Dragon&limit=50`);
    expect(ids).toEqual(expect.arrayContaining([normalDarkDragon._id.toString(), fusionPendulum._id.toString()]));
    expect(ids).not.toContain(effectLightSpellcaster._id.toString());
  });

  it('race sert aussi au sous-type magie/piège (même champ) : race=Quick-Play', async () => {
    const ids = await search(`?${nameFilter}&race=Quick-Play&limit=50`);
    expect(ids).toEqual([quickPlaySpell._id.toString()]);
  });

  it('combine catégorie ET attribut (AND entre dimensions)', async () => {
    const ids = await search(`?${nameFilter}&category=monster&attribute=FIRE&limit=50`);
    expect(ids).toEqual([fusionPendulum._id.toString()]);
  });

  it('la pagination (total) reflète le nombre filtré, pas tout le catalogue', async () => {
    const res = await request(app)
      .get(`/api/cards?${nameFilter}&category=monster&limit=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.total).toBe(3); // les 3 cartes monstre seedées par ce fichier
    expect(res.body.cards).toHaveLength(1); // limit=1 respecté malgré total=3
  });
});
