import { describe, expect, it } from 'vitest';
import { customCardInputSchema, deriveCardFields } from '../customCardRules';
import { isExtraDeckFrameType } from '../deckRules';

const baseMonster = {
  category: 'monster' as const,
  monster_kind: 'normal' as const,
  attribute: 'DARK' as const,
  race: 'Dragon',
  atk: 2500,
  def: 2000,
  level_rank: 7,
  effect_text: 'Un dragon custom.',
  name: 'Dragon de Test',
};

describe('customCardInputSchema', () => {
  it('accepte un monstre Normal minimal', () => {
    const parsed = customCardInputSchema.parse(baseMonster);
    expect(parsed.category).toBe('monster');
  });

  it('refuse un monstre non-Link sans niveau/rang', () => {
    const { level_rank, ...rest } = baseMonster;
    expect(() => customCardInputSchema.parse(rest)).toThrow();
  });

  it('refuse un monstre non-Link sans DEF', () => {
    const { def, ...rest } = baseMonster;
    expect(() => customCardInputSchema.parse(rest)).toThrow();
  });

  it('refuse un monstre Link sans link_rating ni link_arrows', () => {
    expect(() =>
      customCardInputSchema.parse({ ...baseMonster, monster_kind: 'link', level_rank: undefined, def: undefined }),
    ).toThrow();
  });

  it('accepte un monstre Link avec link_rating et link_arrows', () => {
    const parsed = customCardInputSchema.parse({
      ...baseMonster,
      monster_kind: 'link',
      level_rank: undefined,
      def: undefined,
      link_rating: 2,
      link_arrows: ['top', 'bottom'],
    });
    expect(parsed.category).toBe('monster');
  });

  it('refuse des flèches Link en double', () => {
    expect(() =>
      customCardInputSchema.parse({
        ...baseMonster,
        monster_kind: 'link',
        level_rank: undefined,
        def: undefined,
        link_rating: 2,
        link_arrows: ['top', 'top'],
      }),
    ).toThrow();
  });

  it('refuse un monstre Pendule sans échelle', () => {
    expect(() => customCardInputSchema.parse({ ...baseMonster, is_pendulum: true })).toThrow();
  });

  it('refuse un monstre Link Pendule (incompatible)', () => {
    expect(() =>
      customCardInputSchema.parse({
        ...baseMonster,
        monster_kind: 'link',
        level_rank: undefined,
        def: undefined,
        link_rating: 2,
        link_arrows: ['top'],
        is_pendulum: true,
        pendulum_scale: 4,
      }),
    ).toThrow();
  });

  it('accepte un sort avec un sous-type valide', () => {
    const parsed = customCardInputSchema.parse({
      category: 'spell',
      spell_type: 'quick-play',
      effect_text: 'Effet de sort.',
      name: 'Sort de Test',
    });
    expect(parsed.category).toBe('spell');
  });

  it('accepte un piège avec un sous-type valide', () => {
    const parsed = customCardInputSchema.parse({
      category: 'trap',
      trap_type: 'counter',
      effect_text: 'Effet de piège.',
      name: 'Piège de Test',
    });
    expect(parsed.category).toBe('trap');
  });

  it('refuse une catégorie inconnue', () => {
    // Simule un payload HTTP non typé (JSON arbitraire), d'où le cast : le
    // point testé est le rejet à l'exécution, pas la vérification TypeScript.
    expect(() => customCardInputSchema.parse({ ...baseMonster, category: 'equipment' } as unknown)).toThrow();
  });
});

describe('deriveCardFields', () => {
  it('dérive un monstre Fusion vers l’Extra Deck', () => {
    const derived = deriveCardFields(customCardInputSchema.parse({ ...baseMonster, monster_kind: 'fusion' }));
    expect(derived.type).toBe('Fusion Monster');
    expect(derived.frame_type).toBe('fusion');
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(true);
  });

  it('dérive un monstre Normal vers le Main Deck', () => {
    const derived = deriveCardFields(customCardInputSchema.parse(baseMonster));
    expect(derived.type).toBe('Normal Monster');
    expect(derived.frame_type).toBe('normal');
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(false);
  });

  it('dérive un monstre Pendule Synchro (Extra Deck) avec le bon frame_type', () => {
    const derived = deriveCardFields(
      customCardInputSchema.parse({ ...baseMonster, monster_kind: 'synchro', is_pendulum: true, pendulum_scale: 3 }),
    );
    expect(derived.type).toBe('Pendulum Synchro Monster');
    expect(derived.frame_type).toBe('synchro_pendulum');
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(true);
    expect(derived.pendulum_scale).toBe(3);
  });

  it('dérive un monstre Pendule Normal (Main Deck malgré le Pendule)', () => {
    const derived = deriveCardFields(customCardInputSchema.parse({ ...baseMonster, is_pendulum: true, pendulum_scale: 8 }));
    expect(derived.frame_type).toBe('normal_pendulum');
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(false);
  });

  it('dérive un monstre Link avec Link Rating dans level_rank, DEF nulle, flèches conservées', () => {
    const derived = deriveCardFields(
      customCardInputSchema.parse({
        ...baseMonster,
        monster_kind: 'link',
        level_rank: undefined,
        def: undefined,
        link_rating: 3,
        link_arrows: ['top', 'left', 'right'],
      }),
    );
    expect(derived.type).toBe('Link Monster');
    expect(derived.frame_type).toBe('link');
    expect(derived.level_rank).toBe(3);
    expect(derived.def).toBeNull();
    expect(derived.link_arrows).toEqual(['top', 'left', 'right']);
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(true);
  });

  it('dérive une carte Magie avec le sous-type en guise de race', () => {
    const derived = deriveCardFields(
      customCardInputSchema.parse({ category: 'spell', spell_type: 'field', effect_text: 'Effet.', name: 'Terrain de Test' }),
    );
    expect(derived.type).toBe('Spell Card');
    expect(derived.frame_type).toBe('spell');
    expect(derived.race).toBe('Field');
    expect(derived.attribute).toBeNull();
    expect(isExtraDeckFrameType(derived.frame_type)).toBe(false);
  });

  it('dérive une carte Piège avec le sous-type en guise de race', () => {
    const derived = deriveCardFields(
      customCardInputSchema.parse({ category: 'trap', trap_type: 'continuous', effect_text: 'Effet.', name: 'Piège de Test' }),
    );
    expect(derived.type).toBe('Trap Card');
    expect(derived.frame_type).toBe('trap');
    expect(derived.race).toBe('Continuous');
  });
});
