import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * Code de réinitialisation de mot de passe (voir auth.routes.ts). En base
 * plutôt qu'en mémoire (contrairement à rollStore.ts/haggleStore.ts) : ces
 * codes doivent survivre à un redémarrage du process (`tsx watch` en dev
 * redémarre à chaque sauvegarde de fichier) sans casser un flux en cours
 * pour un vrai utilisateur.
 */
export interface PasswordResetAttrs {
  user_id: Types.ObjectId;
  // Jamais le code en clair (même logique que password_hash sur User) —
  // hashé avec bcrypt.
  code_hash: string;
  expires_at: Date;
  // Nombre de tentatives ratées — le code est invalidé après quelques
  // essais pour limiter le brute-force d'un code à 6 chiffres (1 000 000 de
  // combinaisons, pas assez pour se reposer uniquement sur le hash).
  attempts: number;
}

export type PasswordResetDocument = HydratedDocument<PasswordResetAttrs>;

const passwordResetSchema = new Schema<PasswordResetAttrs>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// TTL : Mongo supprime automatiquement le document une fois expires_at
// dépassé (nettoyage natif, exécuté par un job interne toutes les ~60s) —
// l'expiration reste de toute façon revérifiée côté application
// (auth.routes.ts), cet index est une protection/un ménage supplémentaire,
// pas le seul rempart.
passwordResetSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
passwordResetSchema.index({ user_id: 1 });

export const PasswordReset = model<PasswordResetAttrs>('PasswordReset', passwordResetSchema);
