import type { Request } from 'express';
import type { GameServer } from '../sockets';
import type { SessionResource } from '../types/socket';

/**
 * Prévient les autres membres du salon (déjà connectés en socket, ce qui est
 * le cas dès qu'une session est chargée côté front — voir DicePanel) qu'une
 * ressource REST du salon a changé, pour qu'ils rechargent leur liste au lieu
 * de rester sur des données périmées jusqu'à quitter/revenir dans le salon.
 * `req.app.get('io')` est absent dans les tests (createApp() sans
 * createSocketServer) : no-op silencieux dans ce cas.
 */
export function broadcastSessionResourceChanged(req: Request, sessionId: string, resource: SessionResource): void {
  const io = req.app.get('io') as GameServer | undefined;
  io?.to(sessionId).emit('session_resource_changed', { resource, session_id: sessionId });
}
