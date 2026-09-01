import type { TFunction } from 'i18next';

/**
 * Traduit des valeurs affichées brutes en anglais aujourd'hui (attribut,
 * race de monstre, phase de duel) — jamais les valeurs STOCKÉES elles-mêmes
 * (voir CLAUDE.md, plan d'internationalisation §6 : `race`/`attribute` sont
 * des données fonctionnelles côté serveur — filtres Mongo, bitflags moteur
 * de duel — qui doivent rester en anglais). `defaultValue` retombe sur la
 * valeur brute si non cataloguée : une race custom (texte libre côté MJ) ou
 * une race officielle oubliée ne casse jamais l'affichage, elle reste
 * simplement non traduite (comportement actuel).
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function translateAttribute(attribute: string, t: TFunction): string {
  return t(`cardLabels.attribute.${slug(attribute)}`, { defaultValue: attribute });
}

export function translateRace(race: string, t: TFunction): string {
  return t(`cardLabels.race.${slug(race)}`, { defaultValue: race });
}

/** `duel.phase` (voir PHASE_LABELS côté backend, duelEngine.ts) — déjà une clé anglaise stable, jamais affichée traduite jusqu'ici. */
export function translateDuelPhase(phase: string, t: TFunction): string {
  return t(`cardLabels.duelPhase.${slug(phase)}`, { defaultValue: phase });
}
