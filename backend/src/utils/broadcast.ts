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

/**
 * Prévient explicitement chaque joueur convoqué (pas le MJ créateur, pas les
 * PNJ — voir duel.routes.ts) qu'un duel vient d'être créé et qu'il y
 * participe, en plus du `session_resource_changed('duels')` déjà émis (qui ne
 * dit que "la liste a changé", pas "c'est VOUS qu'on attend"). Diffusé à tout
 * le salon comme le reste (pas de salle par utilisateur) : chaque client
 * filtre sur son propre user_id dans `participants`.
 */
export function notifyDuelInvite(
  req: Request,
  sessionId: string,
  payload: {
    duel_id: string;
    duel_name: string;
    participants: Array<{ user_id: string; character_id: string; character_name: string; team: 0 | 1 }>;
  },
): void {
  const io = req.app.get('io') as GameServer | undefined;
  io?.to(sessionId).emit('duel_invite', { session_id: sessionId, ...payload });
}
