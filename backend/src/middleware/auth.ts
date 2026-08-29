import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler';
import { verifyToken, type JwtPayload } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/** Exige un Bearer token valide. Lève une AppError (capturée par errorHandler) sinon. */
export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentification requise', 'unauthorized');
  }

  const token = header.slice('Bearer '.length);
  try {
    req.user = verifyToken(token);
  } catch {
    throw new AppError(401, 'Token invalide ou expiré', 'unauthorized');
  }

  next();
}
