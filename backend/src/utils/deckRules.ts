/**
 * Types de frame YGOPRODeck qui vont à l'Extra Deck. Les monstres Pendule
 * "simples" (normal/effect/ritual_pendulum) restent au Main Deck ; seuls les
 * Pendules qui sont AUSSI Fusion/Synchro/Xyz vont à l'Extra.
 */
const EXTRA_DECK_FRAME_TYPES = new Set([
  'fusion',
  'synchro',
  'xyz',
  'link',
  'fusion_pendulum',
  'synchro_pendulum',
  'xyz_pendulum',
]);

export function isExtraDeckFrameType(frameType: string): boolean {
  return EXTRA_DECK_FRAME_TYPES.has(frameType);
}

export const MAIN_DECK_MIN = 40;
export const MAIN_DECK_MAX = 60;
export const EXTRA_DECK_MAX = 15;
export const MAX_COPIES_PER_CARD = 3;
