import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { User, type UserDocument } from '../models/User.model';
import { PasswordReset } from '../models/PasswordReset.model';
import { PendingRegistration } from '../models/PendingRegistration.model';
import { signToken } from '../utils/jwt';
import { sendPasswordResetEmail, sendRegistrationVerificationEmail, isEmailConfigured } from '../services/email';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';

export const authRouter = Router();

function toUserDto(user: UserDocument) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

/** `randomInt` (crypto), pas Math.random — code non prévisible côté serveur, même logique que rollDie (dice.ts). Partagé entre inscription et mot de passe oublié : même format dans les deux cas. */
function generateSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

const REGISTRATION_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_REGISTRATION_ATTEMPTS = 5;

// Langue de l'email envoyé (vérification d'inscription / réinitialisation) —
// le frontend envoie sa langue actuelle (useLanguage.ts) ; absent (ancien
// client, appel direct de l'API) retombe sur le français, voir email.ts.
const langSchema = z.enum(['fr', 'en']).optional();

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
  lang: langSchema,
});

/**
 * Vérification d'email à l'inscription (demande utilisateur : éviter de
 * polluer la liste des comptes avec des emails invalides/jamais relevés) —
 * mais SEULEMENT quand un vrai envoi est possible (SMTP configuré, voir
 * isEmailConfigured) : sans ça, la vérification serait bloquante pour rien.
 * Comportement historique inchangé dans ce cas (création immédiate).
 */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, email, password, lang } = registerSchema.parse(req.body);

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      throw new AppError(409, "Nom d'utilisateur ou email déjà utilisé", 'conflict');
    }

    const password_hash = await bcrypt.hash(password, 12);

    if (!isEmailConfigured()) {
      const user = await User.create({ username, email, password_hash, role: 'user' });
      const token = signToken({ sub: user._id.toString(), role: user.role });
      res.status(201).json({ pending: false, token, user: toUserDto(user) });
      return;
    }

    // Empêche un AUTRE email de "réserver" ce username pendant qu'une
    // vérification est en attente — sinon POST /verify-registration
    // échouerait sur l'index unique de User sans explication claire pour
    // celui qui a pourtant fourni le bon code.
    const conflictingPending = await PendingRegistration.findOne({
      username,
      email: { $ne: email },
      expires_at: { $gt: new Date() },
    });
    if (conflictingPending) {
      throw new AppError(409, "Nom d'utilisateur ou email déjà utilisé", 'conflict');
    }

    // Une nouvelle demande pour le MÊME email remplace toute demande encore
    // en attente (permet un "renvoyer le code" tout simple depuis le front :
    // resoumettre le même formulaire) — jamais deux codes valides en même temps.
    await PendingRegistration.deleteMany({ email });
    const code = generateSixDigitCode();
    const code_hash = await bcrypt.hash(code, 10);
    await PendingRegistration.create({
      username,
      email,
      password_hash,
      code_hash,
      expires_at: new Date(Date.now() + REGISTRATION_CODE_TTL_MS),
    });
    await sendRegistrationVerificationEmail(email, code, lang);

    res.json({ pending: true, message: `Un code de vérification vient d'être envoyé à ${email}.` });
  }),
);

const verifyRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().length(6, 'Le code fait 6 chiffres'),
});

authRouter.post(
  '/verify-registration',
  asyncHandler(async (req, res) => {
    const { email, code } = verifyRegistrationSchema.parse(req.body);
    const invalid = () => new AppError(400, 'Code invalide ou expiré', 'invalid_verification_code');

    const pending = await PendingRegistration.findOne({ email, expires_at: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!pending) throw invalid();

    if (pending.attempts >= MAX_REGISTRATION_ATTEMPTS) {
      await pending.deleteOne();
      throw invalid();
    }

    const valid = await bcrypt.compare(code, pending.code_hash);
    if (!valid) {
      pending.attempts += 1;
      await pending.save();
      throw invalid();
    }

    // Re-vérifié au moment de la création réelle : un autre compte aurait pu
    // prendre ce username/email entre la demande et la vérification (course
    // rare, mais le message doit rester clair plutôt qu'une 500 sur l'index
    // unique de User).
    const existing = await User.findOne({ $or: [{ email: pending.email }, { username: pending.username }] });
    if (existing) {
      await pending.deleteOne();
      throw new AppError(409, "Nom d'utilisateur ou email déjà utilisé", 'conflict');
    }

    const user = await User.create({
      username: pending.username,
      email: pending.email,
      password_hash: pending.password_hash,
      role: 'user',
    });
    await pending.deleteOne();

    // Connecte directement (même forme de réponse que /login) : pas besoin
    // de se reconnecter juste après avoir vérifié son email.
    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.status(201).json({ token, user: toUserDto(user) });
  }),
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ email }).select('+password_hash');
    if (!user) throw new AppError(401, 'Identifiants invalides', 'invalid_credentials');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError(401, 'Identifiants invalides', 'invalid_credentials');

    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.json({ token, user: toUserDto(user) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const user = await User.findById(req.user?.sub);
    if (!user) throw new AppError(404, 'Utilisateur introuvable', 'not_found');
    res.json({ user: toUserDto(user) });
  }),
);

// --- Mot de passe oublié ---

const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email(), lang: langSchema });

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email, lang } = forgotPasswordSchema.parse(req.body);
    const user = await User.findOne({ email });

    // Réponse IDENTIQUE que l'email existe ou non, dans tous les cas — sinon
    // n'importe qui pourrait déduire quels emails sont enregistrés
    // (énumération de comptes) juste en regardant si la réponse diffère.
    if (user) {
      // Invalide tout code de réinitialisation précédent encore actif pour
      // ce compte : une nouvelle demande remplace l'ancienne, jamais deux
      // codes valides en même temps.
      await PasswordReset.deleteMany({ user_id: user._id });
      const code = generateSixDigitCode();
      const code_hash = await bcrypt.hash(code, 10);
      await PasswordReset.create({ user_id: user._id, code_hash, expires_at: new Date(Date.now() + RESET_CODE_TTL_MS) });
      await sendPasswordResetEmail(user.email, code, lang);
    }

    res.json({ message: "Si un compte existe avec cet email, un code de réinitialisation vient d'être envoyé." });
  }),
);

const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().length(6, 'Le code fait 6 chiffres'),
  new_password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
});

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { email, code, new_password } = resetPasswordSchema.parse(req.body);
    // Message générique dans tous les cas d'échec (email inconnu, code
    // expiré, code faux, trop de tentatives) — ne jamais laisser deviner
    // LAQUELLE de ces raisons s'applique.
    const invalid = () => new AppError(400, 'Code invalide ou expiré', 'invalid_reset_code');

    const user = await User.findOne({ email });
    if (!user) throw invalid();

    const pending = await PasswordReset.findOne({ user_id: user._id, expires_at: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!pending) throw invalid();

    if (pending.attempts >= MAX_RESET_ATTEMPTS) {
      await pending.deleteOne();
      throw invalid();
    }

    const valid = await bcrypt.compare(code, pending.code_hash);
    if (!valid) {
      pending.attempts += 1;
      await pending.save();
      throw invalid();
    }

    user.password_hash = await bcrypt.hash(new_password, 12);
    await user.save();
    await pending.deleteOne();

    // Connecte directement (même forme de réponse que /login) : pas besoin
    // de resaisir ses identifiants juste après avoir choisi un nouveau mot de passe.
    const token = signToken({ sub: user._id.toString(), role: user.role });
    res.json({ token, user: toUserDto(user) });
  }),
);
