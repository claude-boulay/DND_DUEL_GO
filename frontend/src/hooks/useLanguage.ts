import { useCallback, useEffect, useState } from 'react';
import i18n, { LANGUAGE_STORAGE_KEY, type AppLanguage } from '../lib/i18n';

/** Bascule FR/EN — même pattern que useAuth.ts (état React + persistance localStorage). */
export function useLanguage() {
  const [language, setLanguageState] = useState<AppLanguage>((i18n.language === 'en' ? 'en' : 'fr') as AppLanguage);

  useEffect(() => {
    const handleChanged = (lng: string) => setLanguageState(lng === 'en' ? 'en' : 'fr');
    i18n.on('languageChanged', handleChanged);
    return () => {
      i18n.off('languageChanged', handleChanged);
    };
  }, []);

  const setLanguage = useCallback((lang: AppLanguage) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    void i18n.changeLanguage(lang);
  }, []);

  return { language, setLanguage };
}
