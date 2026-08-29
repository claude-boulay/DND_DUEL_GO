import 'dotenv/config';
import { z } from 'zod';

/**
 * Toute la configuration passe par ici : aucun `process.env` ailleurs dans le code.
 * Le serveur refuse de démarrer si une variable est manquante ou invalide.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URI: z.string().min(1, 'MONGO_URI est requis'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET doit faire au moins 8 caractères'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  YGOPRODECK_API_URL: z.string().url().default('https://db.ygoprodeck.com/api/v7'),
  // Envoi d'email (mot de passe oublié, voir services/email.ts) — tous
  // optionnels : si SMTP_HOST est absent, le code de réinitialisation part
  // en console au lieu d'un vrai email (utile en dev sans compte SMTP réel),
  // jamais le cas en prod une fois ces variables renseignées.
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // z.coerce.boolean() convertirait à tort la CHAÎNE "false" en `true`
  // (toute chaîne non vide est "truthy") — comparaison explicite à la
  // chaîne littérale "true" à la place.
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Adresse "From" affichée au destinataire — replie sur SMTP_USER si absente.
  SMTP_FROM: z.string().trim().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[config] Variables d\'environnement invalides :');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/** CORS_ORIGIN accepte une liste séparée par des virgules. */
export const corsOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
