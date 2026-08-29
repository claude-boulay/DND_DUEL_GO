import { describe, expect, it } from 'vitest';
import { engineStatsForCustomCard } from '../engineCardMapping';

describe('engineStatsForCustomCard', () => {
  it('mappe un monstre Effet standard', () => {
    const stats = engineStatsForCustomCard({
      frame_type: 'effect',
      attribute: 'DARK',
      race: 'Dragon',
      level_rank: 7,
      pendulum_scale: null,
      atk: 2500,
      def: 2000,
    });
    expect(stats.type & 0x1).toBe(0x1); // TYPE_MONSTER
    expect(stats.type & 0x20).toBe(0x20); // TYPE_EFFECT
    expect(stats.type & 0x10).toBe(0); // pas TYPE_NORMAL
    expect(stats.attribute).toBe(0x20); // ATTRIBUTE_DARK
    expect(stats.race).toBe(0x2000n); // RACE_DRAGON
    expect(stats.level).toBe(7);
    expect(stats.atk).toBe(2500);
    expect(stats.def).toBe(2000);
  });

  it('mappe un monstre Normal (pas de TYPE_EFFECT)', () => {
    const stats = engineStatsForCustomCard({
      frame_type: 'normal',
      attribute: 'EARTH',
      race: 'Warrior',
      level_rank: 4,
      pendulum_scale: null,
      atk: 1900,
      def: 1200,
    });
    expect(stats.type & 0x10).toBe(0x10); // TYPE_NORMAL
    expect(stats.type & 0x20).toBe(0); // pas TYPE_EFFECT
  });

  it('ajoute TYPE_PENDULUM pour un frame_type _pendulum', () => {
    const stats = engineStatsForCustomCard({
      frame_type: 'effect_pendulum',
      attribute: 'FIRE',
      race: 'Spellcaster',
      level_rank: 5,
      pendulum_scale: 4,
      atk: 2000,
      def: 1500,
    });
    expect(stats.type & 0x1000000).toBe(0x1000000); // TYPE_PENDULUM
    expect(stats.type & 0x20).toBe(0x20); // reste TYPE_EFFECT
  });

  it('mappe Fusion/Synchro/Xyz/Link avec leur flag dédié', () => {
    expect(engineStatsForCustomCard({ frame_type: 'fusion', attribute: 'WATER', race: 'Aqua', level_rank: 8, pendulum_scale: null, atk: 2800, def: 2400 }).type & 0x40).toBe(0x40);
    expect(engineStatsForCustomCard({ frame_type: 'synchro', attribute: 'WIND', race: 'Winged Beast', level_rank: 8, pendulum_scale: null, atk: 2800, def: 2400 }).type & 0x2000).toBe(0x2000);
    expect(engineStatsForCustomCard({ frame_type: 'xyz', attribute: 'LIGHT', race: 'Fairy', level_rank: 8, pendulum_scale: null, atk: 2800, def: 2400 }).type & 0x800000).toBe(0x800000);
    expect(engineStatsForCustomCard({ frame_type: 'link', attribute: 'DARK', race: 'Fiend', level_rank: 2, pendulum_scale: null, atk: 2000, def: 0 }).type & 0x4000000).toBe(0x4000000);
  });

  it('retombe sur RACE_WARRIOR pour une race custom non reconnue', () => {
    const stats = engineStatsForCustomCard({
      frame_type: 'effect',
      attribute: 'LIGHT',
      race: 'Chimère Ancestrale',
      level_rank: 6,
      pendulum_scale: null,
      atk: 2200,
      def: 1800,
    });
    expect(stats.race).toBe(0x1n); // RACE_WARRIOR (repli)
  });

  it('reconnaît une race insensible à la casse', () => {
    expect(engineStatsForCustomCard({ frame_type: 'effect', attribute: 'DARK', race: 'dragon', level_rank: 7, pendulum_scale: null, atk: 2500, def: 2000 }).race).toBe(0x2000n);
    expect(engineStatsForCustomCard({ frame_type: 'effect', attribute: 'DARK', race: 'Beast-Warrior', level_rank: 7, pendulum_scale: null, atk: 2500, def: 2000 }).race).toBe(0x8000n);
  });

  it('mappe une Magie Normale (aucun sous-type)', () => {
    const stats = engineStatsForCustomCard({ frame_type: 'spell', attribute: null, race: 'Normal', level_rank: null, pendulum_scale: null, atk: null, def: null });
    expect(stats.type).toBe(0x2); // TYPE_SPELL seul
  });

  it('mappe une Magie Rapide (TYPE_QUICKPLAY)', () => {
    const stats = engineStatsForCustomCard({ frame_type: 'spell', attribute: null, race: 'Quick-Play', level_rank: null, pendulum_scale: null, atk: null, def: null });
    expect(stats.type).toBe(0x2 | 0x10000);
  });

  it('mappe un Piège Contre (TYPE_COUNTER)', () => {
    const stats = engineStatsForCustomCard({ frame_type: 'trap', attribute: null, race: 'Counter', level_rank: null, pendulum_scale: null, atk: null, def: null });
    expect(stats.type).toBe(0x4 | 0x100000);
  });
});
