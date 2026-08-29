/**
 * +0.5 par niveau gagné au-delà du niveau 1 (CLAUDE.md §3.2) : un personnage
 * niveau 1 joue donc sur ses statistiques de base pures.
 */
export function effectiveStat(base: number, level: number): number {
  return base + (level - 1) * 0.5;
}

/** CLAUDE.md §3.3 : floor(max(0, (Chance effective - 10) / 2)). */
export function maxLuckRerolls(baseLuck: number, level: number): number {
  const effectiveLuck = effectiveStat(baseLuck, level);
  return Math.max(0, Math.floor((effectiveLuck - 10) / 2));
}
