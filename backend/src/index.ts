import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectMongo, disconnectMongo } from './db/mongo';
import { createSocketServer } from './sockets';

async function bootstrap(): Promise<void> {
  await connectMongo();

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);
  // Récupéré par les routes REST via req.app.get('io') pour diffuser les
  // changements (personnage créé, marchand créé...) aux autres membres du
  // salon déjà connectés (voir utils/broadcast.ts).
  app.set('io', io);

  httpServer.listen(env.PORT, () => {
    console.log(`[http] Serveur à l'écoute sur le port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[shutdown] Signal ${signal} reçu, arrêt en cours...`);
    io.close();
    httpServer.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('[bootstrap] Démarrage impossible :', error);
  process.exit(1);
});
