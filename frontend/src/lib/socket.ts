import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../types/socket';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Instance unique et typée du client Socket.io.
 * URL relative : le proxy Vite (dev) ou Nginx (prod) route vers le backend,
 * ce qui évite toute variable d'environnement d'URL côté navigateur.
 */
export const socket: GameSocket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
