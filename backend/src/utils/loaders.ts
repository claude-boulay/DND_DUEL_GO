import { GameSession, type GameSessionDocument } from '../models/GameSession.model';
import { AppError } from '../middleware/errorHandler';

export async function loadSessionOrThrow(sessionId: string): Promise<GameSessionDocument> {
  const session = await GameSession.findById(sessionId);
  if (!session) throw new AppError(404, 'Salon introuvable', 'not_found');
  return session;
}
