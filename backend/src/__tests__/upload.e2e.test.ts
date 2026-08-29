import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';

/**
 * E2E : upload d'image pour les cartes custom (multer + /uploads statique).
 * PNG 1x1 transparent minimal, pour ne dépendre d'aucun fichier externe.
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const app = createApp();
const rand = Math.floor(Math.random() * 1e6);

async function registerUser(username: string): Promise<{ token: string; id: string }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `${username}_${rand}`, email: `${username}_${rand}@example.com`, password: 'supersecret123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

describe("Upload d'image pour cartes custom (E2E)", () => {
  let user: { token: string; id: string };

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();
    user = await registerUser('upload_user');
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('refuse un envoi non authentifié', async () => {
    await request(app).post('/api/uploads/card-image').attach('image', ONE_PIXEL_PNG, { filename: 'x.png', contentType: 'image/png' }).expect(401);
  });

  it('refuse une requête sans fichier', async () => {
    await request(app).post('/api/uploads/card-image').set('Authorization', `Bearer ${user.token}`).expect(400);
  });

  it('refuse un type de fichier non supporté', async () => {
    await request(app)
      .post('/api/uploads/card-image')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('image', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('accepte un PNG valide et le rend accessible via /uploads/cards/…', async () => {
    const uploadRes = await request(app)
      .post('/api/uploads/card-image')
      .set('Authorization', `Bearer ${user.token}`)
      .attach('image', ONE_PIXEL_PNG, { filename: 'dragon.png', contentType: 'image/png' })
      .expect(201);

    expect(uploadRes.body.url).toMatch(/^\/uploads\/cards\/[\w-]+\.png$/);

    const fetched = await request(app).get(uploadRes.body.url).expect(200);
    expect(fetched.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(fetched.body as Buffer, ONE_PIXEL_PNG)).toBe(0);
  });
});
