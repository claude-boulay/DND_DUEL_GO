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
