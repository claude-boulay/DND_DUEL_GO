import { describe, expect, it } from 'vitest';
import { isSessionGm, isSessionMember, isSessionPlayer } from '../sessionMembership';
import type { GameSessionDocument } from '../../models/GameSession.model';

function idLike(value: string) {
  return { toString: () => value };
}

function fakeSession(gmId: string, playerIds: string[]): GameSessionDocument {
  return {
    gm_id: idLike(gmId),
    players: playerIds.map(idLike),
  } as unknown as GameSessionDocument;
}

describe('isSessionGm', () => {
  it('est vrai pour le MJ du salon', () => {
    const session = fakeSession('gm-1', []);
    expect(isSessionGm(session, 'gm-1')).toBe(true);
  });

  it("est faux pour n'importe qui d'autre", () => {
    const session = fakeSession('gm-1', ['player-1']);
    expect(isSessionGm(session, 'player-1')).toBe(false);
  });
});

describe('isSessionPlayer', () => {
  it('est vrai pour un joueur inscrit sur le salon', () => {
    const session = fakeSession('gm-1', ['player-1', 'player-2']);
    expect(isSessionPlayer(session, 'player-2')).toBe(true);
  });

  it('est faux pour le MJ (le MJ ne fait pas partie de players)', () => {
    const session = fakeSession('gm-1', ['player-1']);
    expect(isSessionPlayer(session, 'gm-1')).toBe(false);
  });

  it("est faux pour un utilisateur totalement étranger au salon", () => {
    const session = fakeSession('gm-1', ['player-1']);
    expect(isSessionPlayer(session, 'outsider')).toBe(false);
  });
});

describe('isSessionMember', () => {
  it('est vrai pour le MJ', () => {
    const session = fakeSession('gm-1', []);
    expect(isSessionMember(session, 'gm-1')).toBe(true);
  });

  it('est vrai pour un joueur', () => {
    const session = fakeSession('gm-1', ['player-1']);
    expect(isSessionMember(session, 'player-1')).toBe(true);
  });

  it('est faux pour un utilisateur ni MJ ni joueur', () => {
    const session = fakeSession('gm-1', ['player-1']);
    expect(isSessionMember(session, 'outsider')).toBe(false);
  });
});
