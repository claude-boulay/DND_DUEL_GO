import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { signToken, verifyToken, type JwtPayload } from '../jwt';

describe('signToken / verifyToken', () => {
  it('fait un aller-retour fidèle sur le payload', () => {
    const payload: JwtPayload = { sub: '507f1f77bcf86cd799439011', role: 'user' };
    const token = signToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.role).toBe(payload.role);
  });

  it('produit un JWT à trois segments', () => {
    const token = signToken({ sub: 'abc', role: 'admin' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('rejette un token forgé (chaîne arbitraire)', () => {
    expect(() => verifyToken('ceci-nest-pas-un-jwt')).toThrow();
  });

  it("rejette un token signé avec un secret différent (falsification)", () => {
    const forged = jwt.sign({ sub: 'attacker', role: 'admin' }, 'un-secret-different');
    expect(() => verifyToken(forged)).toThrow();
  });

  it('rejette un token expiré', () => {
    const expired = jwt.sign({ sub: 'abc', role: 'user' }, env.JWT_SECRET, { expiresIn: -10 });
    expect(() => verifyToken(expired)).toThrow(/expired/i);
  });
});
