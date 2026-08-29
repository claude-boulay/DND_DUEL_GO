import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';

export const uploadRouter = Router();
uploadRouter.use(requireAuth);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'cards');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXTENSION_BY_MIMETYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // Nom généré côté serveur (pas le nom d'origine du client) : évite tout
  // risque de traversée de chemin ou de collision.
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXTENSION_BY_MIMETYPE[file.mimetype]}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // aligné sur client_max_body_size 5m (nginx prod)
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_BY_MIMETYPE[file.mimetype]) {
      cb(new AppError(400, 'Format d’image non supporté (png, jpg, webp ou gif uniquement)', 'invalid_input'));
      return;
    }
    cb(null, true);
  },
});

uploadRouter.post('/card-image', (req, res, next) => {
  upload.single('image')(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(400, 'Image trop lourde (5 Mo maximum)', 'invalid_input'));
        return;
      }
      next(err instanceof AppError ? err : new AppError(400, 'Envoi de l’image impossible', 'invalid_input'));
      return;
    }
    if (!req.file) {
      next(new AppError(400, 'Aucune image reçue', 'invalid_input'));
      return;
    }
    res.status(201).json({ url: `/uploads/cards/${req.file.filename}` });
  });
});
