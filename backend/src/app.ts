import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { corsOrigins } from './config/env';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { gameSessionRouter } from './routes/gameSession.routes';
import { characterRouter } from './routes/character.routes';
import { cardRouter } from './routes/card.routes';
import { merchantRouter } from './routes/merchant.routes';
import { duelRouter } from './routes/duel.routes';
import { customCardRouter } from './routes/customCard.routes';
import { uploadRouter } from './routes/upload.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();

  // crossOriginResourcePolicy désactivé : les images de cartes custom sont
  // servies depuis /uploads et consommées par le front sur un autre port.
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Images uploadées pour les cartes custom (volume Docker `card_images`).
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/sessions', gameSessionRouter);
  app.use('/api/characters', characterRouter);
  app.use('/api/cards', cardRouter);
  app.use('/api/merchants', merchantRouter);
  app.use('/api/duels', duelRouter);
  app.use('/api/custom-cards', customCardRouter);
  app.use('/api/uploads', uploadRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
