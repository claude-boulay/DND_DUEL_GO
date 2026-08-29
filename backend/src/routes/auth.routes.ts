import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { User, type UserDocument } from '../models/User.model';
import { signToken } from '../utils/jwt';
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

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, email, password } = registerSchema.parse(req.body);

    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      throw new AppError(409, "Nom d'utilisateur ou email déjà utilisé", 'conflict');
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, password_hash, role: 'user' });

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
