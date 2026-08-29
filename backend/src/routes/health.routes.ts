import { Router, type Request, type Response } from 'express';
import { mongoStatus } from '../db/mongo';
import { env } from '../config/env';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  const db = mongoStatus();
  const healthy = db === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'ygodnd-backend',
    env: env.NODE_ENV,
    database: db,
    uptime_seconds: Math.round(process.uptime()),
    server_time: new Date().toISOString(),
  });
});
