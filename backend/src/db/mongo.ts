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
      await dropLegacyCardSetCodeIndex();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mongo] Tentative ${attempt}/${retries} échouée : ${message}`);
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Migration d'index ponctuelle (voir CLAUDE.md — set_code YGOPRODeck non
 * unique dans les vraies données) : l'ancien index unique `set_code_1` sur
 * `cardsets` (posé quand le schéma déclarait `unique: true` sur ce seul
 * champ) empêcherait pour de vrai l'insertion d'un second CardSet partageant
 * un code déjà connu, même une fois le schéma corrigé — Mongoose ne
 * supprime jamais tout seul un index qui n'est plus dans le schéma, il ne
 * fait qu'ajouter les nouveaux. Sans ce nettoyage explicite, la correction
 * ne prendrait jamais effet sur une base déjà peuplée (dev ET prod).
 * Tourne à chaque démarrage, silencieusement sans effet une fois l'index
 * réellement supprimé (base neuve ou migration déjà passée) — pas besoin
 * d'étape manuelle au déploiement.
 */
async function dropLegacyCardSetCodeIndex(): Promise<void> {
  try {
    await mongoose.connection.collection('cardsets').dropIndex('set_code_1');
    console.log('[mongo] Ancien index unique set_code_1 supprimé (remplacé par (set_code, set_name))');
  } catch {
    // Déjà supprimé (redémarrage suivant, ou base neuve où il n'a jamais existé) : rien à faire.
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
