import { randomUUID } from 'node:crypto';

export interface PendingRoll {
  rollId: string;
  sessionId: string;
  characterId: string | null;
  sides: number;
  result: number;
  // Modificateur de stat + nom de la stat (voir sockets/index.ts) figés au
  // moment du premier jet — un reroll ré-utilise CES valeurs (le personnage
  // ne change pas entre-temps), pas besoin de re-résoudre la stat d'origine.
  modifier: number | null;
  stat: string | null;
  createdAt: number;
}

// État en mémoire, pas en base : un jet n'a de sens que pendant la session
// temps réel qui l'a produit. Purge large (2h) pour ne pas fuir la mémoire
// sur un process longue durée sans complexifier avec un job planifié.
const ROLL_TTL_MS = 2 * 60 * 60 * 1000;
const rolls = new Map<string, PendingRoll>();

function pruneExpired(): void {
  const cutoff = Date.now() - ROLL_TTL_MS;
  for (const [id, roll] of rolls) {
    if (roll.createdAt < cutoff) rolls.delete(id);
  }
}

export function recordRoll(
  sessionId: string,
  characterId: string | null,
  sides: number,
  result: number,
  modifier: number | null = null,
  stat: string | null = null,
): PendingRoll {
  pruneExpired();
  const roll: PendingRoll = { rollId: randomUUID(), sessionId, characterId, sides, result, modifier, stat, createdAt: Date.now() };
  rolls.set(roll.rollId, roll);
  return roll;
}

export function getRoll(rollId: string): PendingRoll | undefined {
  return rolls.get(rollId);
}

export function updateRollResult(rollId: string, result: number): void {
  const roll = rolls.get(rollId);
  if (roll) roll.result = result;
}
