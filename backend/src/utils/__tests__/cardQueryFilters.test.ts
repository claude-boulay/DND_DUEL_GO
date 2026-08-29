import { describe, expect, it } from 'vitest';
import { buildCardCatalogQuery } from '../cardQueryFilters';

describe('buildCardCatalogQuery', () => {
  it('renvoie un filtre vide sans aucun paramètre', () => {
    expect(buildCardCatalogQuery({})).toEqual({});
  });

  it('catégorie monstre : exclut spell et trap par frame_type', () => {
    expect(buildCardCatalogQuery({ categories: ['monster'] })).toEqual({
      $or: [{ frame_type: { $nin: ['spell', 'trap'] } }],
    });
  });

  it('catégorie magie/piège : match direct sur frame_type', () => {
    expect(buildCardCatalogQuery({ categories: ['spell'] })).toEqual({ $or: [{ frame_type: 'spell' }] });
    expect(buildCardCatalogQuery({ categories: ['trap'] })).toEqual({ $or: [{ frame_type: 'trap' }] });
  });

  it('plusieurs catégories : OR entre elles', () => {
    expect(buildCardCatalogQuery({ categories: ['spell', 'trap'] })).toEqual({
      $or: [{ frame_type: 'spell' }, { frame_type: 'trap' }],
    });
  });

  it('type de monstre : inclut la variante Pendule du même type', () => {
    expect(buildCardCatalogQuery({ monsterKinds: ['fusion'] })).toEqual({
      frame_type: { $in: ['fusion', 'fusion_pendulum'] },
    });
  });

  it('plusieurs types de monstre : tous inclus (kind + kind_pendulum) dans un seul $in', () => {
    expect(buildCardCatalogQuery({ monsterKinds: ['normal', 'xyz'] })).toEqual({
      frame_type: { $in: ['normal', 'normal_pendulum', 'xyz', 'xyz_pendulum'] },
    });
  });

  it('pendule uniquement : frame_type se terminant par _pendulum', () => {
    expect(buildCardCatalogQuery({ pendulumOnly: true })).toEqual({ frame_type: { $regex: /_pendulum$/ } });
  });

  it('attribut : $in sur le champ attribute', () => {
    expect(buildCardCatalogQuery({ attributes: ['DARK', 'LIGHT'] })).toEqual({ attribute: { $in: ['DARK', 'LIGHT'] } });
  });

  it('race : $in sur le champ race (sert aussi au sous-type magie/piège)', () => {
    expect(buildCardCatalogQuery({ races: ['Dragon'] })).toEqual({ race: { $in: ['Dragon'] } });
    expect(buildCardCatalogQuery({ races: ['Quick-Play'] })).toEqual({ race: { $in: ['Quick-Play'] } });
  });

  it('combine plusieurs dimensions avec $and (chaque dimension reste un OR interne)', () => {
    const result = buildCardCatalogQuery({ categories: ['monster'], attributes: ['DARK'] });
    expect(result).toEqual({
      $and: [{ $or: [{ frame_type: { $nin: ['spell', 'trap'] } }] }, { attribute: { $in: ['DARK'] } }],
    });
  });

  it('ignore les tableaux vides comme absents', () => {
    expect(buildCardCatalogQuery({ categories: [], monsterKinds: [], attributes: [], races: [] })).toEqual({});
  });
});
