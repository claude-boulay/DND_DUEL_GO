/** Modificateur D&D standard : floor((valeur - 10) / 2). */
export function abilityModifier(effectiveValue: number): number {
  return Math.floor((effectiveValue - 10) / 2);
}
