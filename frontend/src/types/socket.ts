/**
 * Contrat des événements Socket.io — copie de `backend/src/types/socket.ts`.
 *
 * Les deux fichiers doivent rester strictement identiques (hors SocketData,
 * côté serveur uniquement). Duplication assumée pour garder des contextes de
 * build Docker indépendants ; à remplacer par un package partagé si le projet
 * passe en monorepo.
 */

/** Une entrée du journal d'action temps réel (jet initial ou reroll). */
export interface ActionLogEntry {
  roll_id: string;
  user_id: string;
  username: string;
  character_id: string | null;
  character_name: string | null;
  sides: number;
  result: number;
  is_reroll: boolean;
  previous_result: number | null;
  rerolls_remaining: number | null;
  label: string | null;
  rolled_at: string;
}

/** Ressources REST dont la liste peut devenir périmée pour les autres membres du salon. */
export type SessionResource = 'characters' | 'merchants' | 'duels';

/** Serveur -> Client */
export interface ServerToClientEvents {
  server_hello: (payload: { socket_id: string; server_time: string }) => void;
  pong_server: (payload: { sent_at: number; server_time: string }) => void;
  error_message: (payload: { code: string; message: string }) => void;
  game_joined: (payload: { session_id: string; code: string; recent_actions: ActionLogEntry[] }) => void;
  dice_rolled: (payload: ActionLogEntry) => void;
  dice_rerolled: (payload: ActionLogEntry) => void;
  // Émis quand un membre du salon crée/modifie/supprime une ressource REST
  // (personnage, marchand, duel...) : les autres membres doivent recharger
  // leur liste, faute de quoi ces changements restent invisibles sans
  // quitter/revenir le salon. Pour 'duels', c'est aussi ce qui relaie en
  // temps réel les actions du moteur ocgcore (prompt suivant, PV, phase...)
  // à tout participant qui n'est pas l'auteur de l'action.
  session_resource_changed: (payload: { resource: SessionResource; session_id: string }) => void;
}

/** Client -> Serveur */
export interface ClientToServerEvents {
  ping_server: (payload: { sent_at: number }) => void;
  join_game: (payload: { token: string; code: string }) => void;
  roll_dice: (payload: { sides?: number; character_id?: string; label?: string }) => void;
  reroll_dice: (payload: { roll_id: string }) => void;
}
