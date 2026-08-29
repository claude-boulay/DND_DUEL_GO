import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../../config/env';
import { connectMongo, disconnectMongo } from '../../db/mongo';
import { Card } from '../../models/Card.model';
import { CardSet } from '../../models/CardSet.model';
import { importCardsForSet } from '../cardImport';
import { fetchCardsBySet, type YgoCard } from '../ygoprodeck';

// Réel bug corrigé (rapporté par l'utilisateur : invocation Pendule
// impossible) : `pendulum_scale`/`link_arrows` n'étaient JAMAIS renseignés
// pour une carte officielle importée — `YgoCard` ne déclarait même pas les
// champs `scale`/`linkmarkers` de YGOPRODeck, donc `importCardsForSet` ne
// pouvait pas les recopier. Ce test mocke `fetchCardsBySet` avec des valeurs
// confirmées en direct contre le vrai endpoint cardinfo.php (scale=4 pour
// Odd-Eyes Pendulum Dragon, linkmarkers=["Top","Bottom-Left","Bottom-Right"]
// pour Decode Talker) plutôt que de dépendre du réseau ici.
vi.mock('../ygoprodeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ygoprodeck')>();
  return { ...actual, fetchCardsBySet: vi.fn() };
});

const rand = Math.floor(Math.random() * 1e6);

describe("importCardsForSet : mapping des champs YGOPRODeck (échelle Pendule, flèches Link)", () => {
  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('recopie pendulum_scale pour un monstre Pendule, et link_arrows (en minuscules) pour un monstre Link', async () => {
    const setName = `Set de Test Import ${rand}`;
    const setCode = `TIMP-${rand}`;
    await CardSet.create({ set_code: setCode, set_name: setName, num_of_cards: 2, tcg_date: null, is_custom: false });

    const pendulumCard: YgoCard = {
      id: 900_000_001 + rand,
      name: 'Odd-Eyes Pendulum Dragon (test)',
      type: 'Pendulum Effect Monster',
      frameType: 'effect_pendulum',
      desc: 'Carte de test.',
      atk: 2500,
      def: 2000,
      level: 7,
      race: 'Dragon',
      attribute: 'FIRE',
      scale: 4,
      card_images: [{ id: 1, image_url: 'https://example.com/1.jpg', image_url_small: 'https://example.com/1s.jpg', image_url_cropped: 'https://example.com/1c.jpg' }],
    };
    const linkCard: YgoCard = {
      id: 900_000_002 + rand,
      name: 'Decode Talker (test)',
      type: 'Link Monster',
      frameType: 'link',
      desc: 'Carte de test.',
      atk: 2300,
      race: 'Cyberse',
      attribute: 'DARK',
      linkval: 3,
      linkmarkers: ['Top', 'Bottom-Left', 'Bottom-Right'],
      card_images: [{ id: 2, image_url: 'https://example.com/2.jpg', image_url_small: 'https://example.com/2s.jpg', image_url_cropped: 'https://example.com/2c.jpg' }],
    };
    vi.mocked(fetchCardsBySet).mockResolvedValue([pendulumCard, linkCard]);

    const result = await importCardsForSet(setCode);
    expect(result.importedCount).toBe(2);

    const savedPendulum = await Card.findOne({ ygoprodeck_id: pendulumCard.id });
    expect(savedPendulum?.pendulum_scale).toBe(4);
    expect(savedPendulum?.link_arrows).toEqual([]);

    const savedLink = await Card.findOne({ ygoprodeck_id: linkCard.id });
    expect(savedLink?.link_arrows).toEqual(['top', 'bottom-left', 'bottom-right']);
    expect(savedLink?.pendulum_scale).toBeNull();
  });

  it('laisse pendulum_scale null et link_arrows vide pour une carte sans ces champs', async () => {
    const setName = `Set de Test Import Normal ${rand}`;
    const setCode = `TIMN-${rand}`;
    await CardSet.create({ set_code: setCode, set_name: setName, num_of_cards: 1, tcg_date: null, is_custom: false });

    const normalCard: YgoCard = {
      id: 900_000_003 + rand,
      name: 'Carte Normale de Test',
      type: 'Normal Monster',
      frameType: 'normal',
      desc: 'Carte de test.',
      atk: 1000,
      def: 1000,
      level: 4,
      race: 'Dragon',
      attribute: 'EARTH',
      card_images: [{ id: 3, image_url: 'https://example.com/3.jpg', image_url_small: 'https://example.com/3s.jpg', image_url_cropped: 'https://example.com/3c.jpg' }],
    };
    vi.mocked(fetchCardsBySet).mockResolvedValue([normalCard]);

    await importCardsForSet(setCode);

    const saved = await Card.findOne({ ygoprodeck_id: normalCard.id });
    expect(saved?.pendulum_scale).toBeNull();
    expect(saved?.link_arrows).toEqual([]);
  });
});
