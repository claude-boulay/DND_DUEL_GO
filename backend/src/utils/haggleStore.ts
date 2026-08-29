import { randomUUID } from 'node:crypto';

/**
 * Négociation en attente : le jet est déjà lancé (server-authoritative), mais
 * l'achat n'est pas encore finalisé — laisse le joueur voir le résultat et
 * décider de dépenser un reroll de Chance avant de confirmer l'achat, comme
 * pour n'importe quel autre jet (voir rollStore.ts, même principe mais des
 * champs propres au marchandage : modificateur/DC/remise négociés avec le
 * MJ, item concerné). État en mémoire, pas en base : une négociation n'a de
 * sens que pendant la session qui l'a produite.
 */
export interface PendingHaggle {
  haggleId: string;
  merchantId: string;
  itemId: string;
  characterId: string;
  modifier: number;
  discountPercent: number;
  dc: number;
  roll: number;
  total: number;
  success: boolean;
  createdAt: number;
}

const HAGGLE_TTL_MS = 30 * 60 * 1000; // 30 min : une négociation ne traîne pas des heures
const haggles = new Map<string, PendingHaggle>();

function pruneExpired(): void {
  const cutoff = Date.now() - HAGGLE_TTL_MS;
  for (const [id, haggle] of haggles) {
    if (haggle.createdAt < cutoff) haggles.delete(id);
  }
}

export function recordHaggle(input: {
  merchantId: string;
  itemId: string;
  characterId: string;
  modifier: number;
  discountPercent: number;
  dc: number;
  roll: number;
}): PendingHaggle {
  pruneExpired();
  const total = input.roll + input.modifier;
  const haggle: PendingHaggle = {
    haggleId: randomUUID(),
    merchantId: input.merchantId,
    itemId: input.itemId,
    characterId: input.characterId,
    modifier: input.modifier,
    discountPercent: input.discountPercent,
    dc: input.dc,
    roll: input.roll,
    total,
    success: total >= input.dc,
    createdAt: Date.now(),
  };
  haggles.set(haggle.haggleId, haggle);
  return haggle;
}

export function getHaggle(haggleId: string): PendingHaggle | undefined {
  return haggles.get(haggleId);
}

/** Remplace le jet d'une négociation déjà enregistrée (reroll de Chance) — recalcule `total`/`success`. */
export function updateHaggleRoll(haggleId: string, roll: number): PendingHaggle | undefined {
  const haggle = haggles.get(haggleId);
  if (!haggle) return undefined;
  haggle.roll = roll;
  haggle.total = roll + haggle.modifier;
  haggle.success = haggle.total >= haggle.dc;
  return haggle;
}

/** À appeler une fois la négociation consommée par un achat (réussi ou non) — une négociation ne sert qu'une fois. */
export function consumeHaggle(haggleId: string): void {
  haggles.delete(haggleId);
}
