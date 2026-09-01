import type { ApiCard, ApiCustomCard } from './api';

type TranslatableCard = Pick<ApiCard | ApiCustomCard, 'name' | 'description' | 'translations'>;

/**
 * Nom affiché d'une carte selon la langue courante — retombe sur `name`
 * (anglais officiel, ou langue de saisie du MJ pour une carte custom) tant
 * qu'aucune traduction n'existe pour CETTE carte précise (voir
 * CLAUDE.md, plan d'internationalisation §4 : peuplé au fil des imports/
 * réimports côté officiel, jamais de backfill de masse — une carte pas
 * encore réimportée reste donc simplement non traduite, comportement
 * normal, pas une erreur).
 */
export function displayCardName(card: TranslatableCard, language: string): string {
  if (language === 'fr' && card.translations?.fr) return card.translations.fr.name;
  return card.name;
}

/** Même principe que `displayCardName`, pour le texte d'effet/description. */
export function displayCardDescription(card: TranslatableCard, language: string): string {
  if (language === 'fr' && card.translations?.fr) return card.translations.fr.description;
  return card.description;
}
