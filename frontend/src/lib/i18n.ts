import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from '../locales/fr.json';
import en from '../locales/en.json';

export type AppLanguage = 'fr' | 'en';

// Même convention que useAuth.ts (token persisté sous ygodnd_token) : une
// préférence par navigateur, pas de champ côté serveur (voir le plan
// d'internationalisation — pas de besoin clair de synchronisation
// multi-appareil pour une appli jouée en petit groupe).
export const LANGUAGE_STORAGE_KEY = 'ygodnd_language';

function initialLanguage(): AppLanguage {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === 'en' ? 'en' : 'fr';
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà le JSX.
});

export default i18n;
