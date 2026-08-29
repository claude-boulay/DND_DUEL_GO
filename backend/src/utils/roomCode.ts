import { GameSession } from '../models/GameSession.model';

function randomCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `YGO-${digits}`;
}

/** Génère un code au format `YGO-8941`, garanti unique en base. */
export async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomCode();
    const exists = await GameSession.exists({ code });
    if (!exists) return code;
  }
  throw new Error('Impossible de générer un code de salon unique après 20 tentatives');
}
