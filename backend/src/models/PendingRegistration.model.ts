import { Schema, model, type HydratedDocument } from 'mongoose';

/**
 * Inscription en attente de vérification par email (demande utilisateur :
 * éviter de "polluer" la liste des comptes avec des emails invalides/jamais
 * relevés). Même schéma de conception que PasswordReset.model.ts (persisté
 * plutôt qu'en mémoire, pour survivre à un redémarrage du process en dev) —
 * sauf que ce document contient TOUTE l'identité en attente (username,
 * email, mot de passe déjà hashé) puisque le `User` réel n'existe pas encore
 * : il n'est créé qu'une fois le code vérifié (voir auth.routes.ts
 * POST /verify-registration).
 */
export interface PendingRegistrationAttrs {
  username: string;
  email: string;
  // Déjà hashé (bcrypt) au moment de la demande — jamais le mot de passe en clair,
  // même avant que le compte réel n'existe.
  password_hash: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
}

export type PendingRegistrationDocument = HydratedDocument<PendingRegistrationAttrs>;

const pendingRegistrationSchema = new Schema<PendingRegistrationAttrs>(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    password_hash: { type: String, required: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// TTL : Mongo supprime automatiquement le document une fois expires_at dépassé
// (même mécanisme que PasswordReset.model.ts) — l'expiration reste de toute
// façon revérifiée côté application, cet index est un ménage supplémentaire.
pendingRegistrationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
pendingRegistrationSchema.index({ email: 1 });

export const PendingRegistration = model<PendingRegistrationAttrs>('PendingRegistration', pendingRegistrationSchema);
