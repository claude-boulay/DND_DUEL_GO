import { describe, expect, it } from 'vitest';
import { AppError } from '../../middleware/errorHandler';
import {
  POINT_BUY_BUDGET,
  STAT_MAX,
  STAT_MIN,
  totalPointBuyCost,
  validatePointBuy,
  type CharacterStats,
} from '../pointBuy';

const baseline: CharacterStats = { history: STAT_MIN, perception: STAT_MIN, intelligence: STAT_MIN, charisma: STAT_MIN, luck: STAT_MIN };

describe('totalPointBuyCost', () => {
  it('vaut 0 quand toutes les stats sont au plancher', () => {
    expect(totalPointBuyCost(baseline)).toBe(0);
  });

  it('coûte exactement 1 point de budget par point au-dessus du plancher', () => {
    const stats: CharacterStats = { ...baseline, charisma: STAT_MIN + 5 };
    expect(totalPointBuyCost(stats)).toBe(5);
  });

  it('additionne le coût de toutes les stats', () => {
    const stats: CharacterStats = { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 };
    // (13-8)*3 + (20-8) + (8-8) = 15 + 12 + 0 = 27
    expect(totalPointBuyCost(stats)).toBe(27);
  });
});

describe('validatePointBuy', () => {
  it('accepte une répartition qui utilise exactement le budget, plafond inclus', () => {
    const stats: CharacterStats = { history: 20, perception: 20, intelligence: 11, charisma: 8, luck: 8 };
    expect(totalPointBuyCost(stats)).toBe(POINT_BUY_BUDGET);
    expect(() => validatePointBuy(stats)).not.toThrow();
  });

  it('rejette un total inférieur au budget', () => {
    expect(() => validatePointBuy(baseline)).toThrow(AppError);
  });

  it('rejette un total supérieur au budget', () => {
    const stats: CharacterStats = { ...baseline, charisma: STAT_MAX, luck: STAT_MAX };
    expect(() => validatePointBuy(stats)).toThrow(AppError);
  });

  it('rejette une stat en dessous du plancher', () => {
    const stats: CharacterStats = { history: STAT_MIN - 1, perception: 13, intelligence: 13, charisma: 13, luck: 13 };
    expect(() => validatePointBuy(stats)).toThrow(AppError);
  });

  it('rejette une stat au-dessus du plafond, même si le total tombe juste', () => {
    const stats: CharacterStats = { history: STAT_MAX + 1, perception: 8, intelligence: 8, charisma: 8, luck: 8 };
    expect(() => validatePointBuy(stats)).toThrow(AppError);
  });

  it('rejette une valeur non entière', () => {
    const stats: CharacterStats = { history: 13.5, perception: 13, intelligence: 13, charisma: 13, luck: 8 };
    expect(() => validatePointBuy(stats)).toThrow(AppError);
  });

  it("lève une AppError 400 avec le code 'invalid_point_buy'", () => {
    try {
      validatePointBuy(baseline);
      throw new Error('validatePointBuy aurait dû lever une erreur');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appError = err as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.code).toBe('invalid_point_buy');
    }
  });
});
