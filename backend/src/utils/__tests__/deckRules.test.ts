import { describe, expect, it } from 'vitest';
import { EXTRA_DECK_MAX, MAIN_DECK_MAX, MAIN_DECK_MIN, MAX_COPIES_PER_CARD, isExtraDeckFrameType } from '../deckRules';

describe('isExtraDeckFrameType', () => {
  it('classe les monstres Extra Deck standards', () => {
    expect(isExtraDeckFrameType('fusion')).toBe(true);
    expect(isExtraDeckFrameType('synchro')).toBe(true);
    expect(isExtraDeckFrameType('xyz')).toBe(true);
    expect(isExtraDeckFrameType('link')).toBe(true);
  });

  it('classe les variantes Pendule Fusion/Synchro/Xyz comme Extra Deck', () => {
    expect(isExtraDeckFrameType('fusion_pendulum')).toBe(true);
    expect(isExtraDeckFrameType('synchro_pendulum')).toBe(true);
    expect(isExtraDeckFrameType('xyz_pendulum')).toBe(true);
  });

  it('classe les monstres Main Deck classiques comme Main Deck', () => {
    expect(isExtraDeckFrameType('normal')).toBe(false);
    expect(isExtraDeckFrameType('effect')).toBe(false);
    expect(isExtraDeckFrameType('ritual')).toBe(false);
  });

  it('classe les Pendules "simples" (non Fusion/Synchro/Xyz) comme Main Deck', () => {
    // Un monstre Pendule Normal/Effect/Ritual se pioche normalement : il va
    // au Main Deck, contrairement aux rares Pendules Fusion/Synchro/Xyz.
    expect(isExtraDeckFrameType('normal_pendulum')).toBe(false);
    expect(isExtraDeckFrameType('effect_pendulum')).toBe(false);
    expect(isExtraDeckFrameType('ritual_pendulum')).toBe(false);
  });

  it('classe les sorts/pièges comme Main Deck', () => {
    expect(isExtraDeckFrameType('spell')).toBe(false);
    expect(isExtraDeckFrameType('trap')).toBe(false);
  });
});

describe('constantes de règles de deck', () => {
  it('respecte les tailles standard Yu-Gi-Oh', () => {
    expect(MAIN_DECK_MIN).toBe(40);
    expect(MAIN_DECK_MAX).toBe(60);
    expect(EXTRA_DECK_MAX).toBe(15);
    expect(MAX_COPIES_PER_CARD).toBe(3);
  });
});
