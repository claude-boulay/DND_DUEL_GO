import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';

/** Erreur métier attendue, à préférer aux `throw new Error` bruts. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = 'app_error',
    // Paramètres structurés (additif, voir plan d'internationalisation §3) —
    // seulement pour les rares codes interpolés qu'on choisit de cataloguer
    // côté front (`errors.<code>` dans locales/{fr,en}.json). `message` reste
    // TOUJOURS le repli français, jamais retiré : un code non catalogué (ou
    // dont `params` est absent) continue de s'afficher exactement comme avant.
    public readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `Route introuvable : ${req.method} ${req.originalUrl}` },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Données invalides', details: err.flatten() },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message, params: err.params } });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction ? 'Erreur interne du serveur' : String(err),
    },
  });
}
