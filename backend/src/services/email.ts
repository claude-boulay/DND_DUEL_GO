import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporter: Transporter | null | undefined; // undefined = pas encore résolu, null = SMTP non configuré

/** SMTP non configuré (dev sans compte réel) : `null`, résolu une seule fois. */
function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/**
 * Vrai seulement si un vrai envoi est possible (SMTP_HOST renseigné) —
 * utilisé par auth.routes.ts pour décider si l'inscription doit exiger une
 * vérification par email (demande utilisateur) : sans SMTP configuré, il n'y
 * a de toute façon aucun moyen de faire parvenir un code, la vérification
 * resterait donc bloquante pour rien.
 */
export function isEmailConfigured(): boolean {
  return !!env.SMTP_HOST;
}

/**
 * Envoie le code de réinitialisation de mot de passe (voir auth.routes.ts).
 * Sans SMTP configuré (SMTP_HOST absent), le code part en console au lieu
 * d'un vrai email — utile en dev local sans compte SMTP réel ; ne doit
 * jamais être le cas une fois SMTP_HOST renseigné en prod.
 */
export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  const transport = getTransporter();
  const subject = 'Réinitialisation de votre mot de passe';
  const text = [
    `Voici votre code de réinitialisation : ${code}`,
    '',
    'Ce code expire dans 15 minutes.',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email — votre mot de passe ne changera pas.",
  ].join('\n');

  if (!transport) {
    console.log(`[email] SMTP non configuré — code de réinitialisation pour ${to} : ${code}`);
    return;
  }

  await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text });
}

/**
 * Envoie le code de vérification d'inscription (voir auth.routes.ts
 * POST /register puis /verify-registration) — évite qu'un email invalide/
 * jamais relevé ne pollue la liste des comptes (demande utilisateur) : le
 * compte n'est créé qu'une fois ce code confirmé. Ne devrait jamais être
 * appelée sans SMTP configuré (voir isEmailConfigured) : la route /register
 * garde son comportement historique (création immédiate) dans ce cas.
 */
export async function sendRegistrationVerificationEmail(to: string, code: string): Promise<void> {
  const transport = getTransporter();
  const subject = 'Vérifiez votre adresse email';
  const text = [
    `Voici votre code de vérification : ${code}`,
    '',
    'Ce code expire dans 15 minutes.',
    "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet email.",
  ].join('\n');

  if (!transport) {
    console.log(`[email] SMTP non configuré — code de vérification pour ${to} : ${code}`);
    return;
  }

  await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text });
}
