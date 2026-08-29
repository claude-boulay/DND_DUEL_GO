import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';
import type { Request, Response } from 'express';
import { AppError, errorHandler, notFoundHandler } from '../errorHandler';

function fakeResponse() {
  const res: Partial<Response> & { statusCode?: number; jsonBody?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = vi.fn((body: unknown) => {
    res.jsonBody = body;
    return res as Response;
  }) as unknown as Response['json'];
  return res as Response & { statusCode: number; jsonBody: unknown };
}

describe('AppError', () => {
  it("porte le code, le statut et le message fournis", () => {
    const err = new AppError(403, 'Accès refusé', 'forbidden');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Accès refusé');
    expect(err.code).toBe('forbidden');
    expect(err).toBeInstanceOf(Error);
  });

  it("utilise 'app_error' comme code par défaut", () => {
    const err = new AppError(500, 'Oups');
    expect(err.code).toBe('app_error');
  });
});

describe('errorHandler', () => {
  it('formate une AppError avec son statut et son code propres', () => {
    const res = fakeResponse();
    errorHandler(new AppError(409, 'Conflit', 'conflict'), {} as Request, res, vi.fn());

    expect(res.statusCode).toBe(409);
    expect(res.jsonBody).toEqual({ error: { code: 'conflict', message: 'Conflit' } });
  });

  it('formate une ZodError en 400 avec le détail de validation', () => {
    const res = fakeResponse();
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 42 });
    expect(result.success).toBe(false);

    errorHandler((result as { error: ZodError }).error, {} as Request, res, vi.fn());

    expect(res.statusCode).toBe(400);
    const body = res.jsonBody as { error: { code: string; message: string; details: unknown } };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details).toBeDefined();
  });

  it('retombe sur une erreur 500 générique pour une exception non reconnue', () => {
    const res = fakeResponse();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(new Error('boom'), {} as Request, res, vi.fn());

    expect(res.statusCode).toBe(500);
    const body = res.jsonBody as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    // NODE_ENV=development dans l'environnement de test : le détail de
    // l'erreur est exposé (utile en dev), jamais en production.
    expect(body.error.message).toContain('boom');

    spy.mockRestore();
  });
});

describe('notFoundHandler', () => {
  it('renvoie 404 avec la méthode et le chemin demandés', () => {
    const res = fakeResponse();
    const req = { method: 'GET', originalUrl: '/api/inexistant' } as Request;

    notFoundHandler(req, res);

    expect(res.statusCode).toBe(404);
    const body = res.jsonBody as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('GET /api/inexistant');
  });
});
