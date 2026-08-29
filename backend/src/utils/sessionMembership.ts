import type { GameSessionDocument } from '../models/GameSession.model';

export function isSessionGm(session: GameSessionDocument, userId: string): boolean {
  return session.gm_id.toString() === userId;
}

export function isSessionPlayer(session: GameSessionDocument, userId: string): boolean {
  return session.players.some((p) => p.toString() === userId);
}

export function isSessionMember(session: GameSessionDocument, userId: string): boolean {
  return isSessionGm(session, userId) || isSessionPlayer(session, userId);
}
