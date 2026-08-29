import mongoose from 'mongoose';
import { env } from '../config/env';

mongoose.set('strictQuery', true);

/**
 * Connexion à MongoDB avec retry : au premier démarrage, Compose peut lancer
 * le backend avant que Mongo n'accepte réellement les connexions.
 */
export async function connectMongo(retries = 10, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      console.log('[mongo] Connecté à la base de données');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mongo] Tentative ${attempt}/${retries} échouée : ${message}`);
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.connection.close();
  console.log('[mongo] Connexion fermée');
}

export type MongoStatus =
  | 'disconnected'
  | 'connected'
  | 'connecting'
  | 'disconnecting'
  | 'uninitialized';

/** État lisible de la connexion, exposé par le healthcheck. */
export function mongoStatus(): MongoStatus {
  switch (mongoose.connection.readyState) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      // 99 = uninitialized côté Mongoose.
      return 'uninitialized';
  }
}
