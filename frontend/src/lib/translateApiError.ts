import type { TFunction } from 'i18next';
import { ApiError } from './api';

/**
 * Traduit une erreur d'API si son `code` a une entrée dans le catalogue
 * `errors.<code>` (voir locales/fr.json, en.json) ; repli sur le message brut
 * déjà envoyé par le serveur sinon — jamais "à moitié cassé", une erreur non
 * encore cataloguée s'affiche simplement comme aujourd'hui (voir le plan
 * d'internationalisation, §3).
 *
 * ATTENTION lors de l'ajout d'entrées à `errors.*` : certains `code` sont
 * réutilisés par des dizaines de sites `AppError` avec un message DIFFÉRENT
 * à chaque fois (ex. `not_found`, `forbidden`, `invalid_input` — confirmé
 * en comptant les occurrences côté backend). Ne jamais cataloguer un code
 * générique sans avoir vérifié que TOUS ses sites d'appel partagent le même
 * texte, sous peine de traduire FAUX pour la plupart de ses usages.
 */
export function translateApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.code) {
      const translated = t(`errors.${err.code}`, { ...err.params, defaultValue: '' });
      if (translated) return translated;
    }
    return err.message;
  }
  return t('common.error_generic');
}
