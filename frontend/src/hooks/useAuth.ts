import { useCallback, useEffect, useState } from 'react';
import { api, type ApiUser } from '../lib/api';
import i18n from '../lib/i18n';

/** Langue actuelle (voir useLanguage.ts) — lue directement sur le singleton i18next plutôt que via le hook, pour ne pas coupler useAuth à un re-render sur changement de langue. */
function currentEmailLang(): 'fr' | 'en' {
  return i18n.language === 'en' ? 'en' : 'fr';
}

const TOKEN_KEY = 'ygodnd_token';

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .me(token)
      .then(({ user: fetchedUser }) => setUser(fetchedUser))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const applySession = useCallback((newToken: string, newUser: ApiUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token: newToken, user: newUser } = await api.login(email, password);
      applySession(newToken, newUser);
    },
    [applySession],
  );

  // Retourne `pending: true` quand SMTP est configuré côté serveur (voir
  // auth.routes.ts) : le compte n'est pas encore créé, un code de
  // vérification vient de partir — AuthPanel bascule alors vers l'écran de
  // saisie du code au lieu de se connecter directement.
  const register = useCallback(async (username: string, email: string, password: string): Promise<{ pending: boolean }> => {
    const result = await api.register(username, email, password, currentEmailLang());
    if (result.pending) return { pending: true };
    applySession(result.token, result.user);
    return { pending: false };
  }, [applySession]);

  const verifyRegistration = useCallback(
    async (email: string, code: string) => {
      const { token: newToken, user: newUser } = await api.verifyRegistration(email, code);
      applySession(newToken, newUser);
    },
    [applySession],
  );

  const forgotPassword = useCallback(async (email: string) => {
    await api.forgotPassword(email, currentEmailLang());
  }, []);

  const resetPassword = useCallback(
    async (email: string, code: string, newPassword: string) => {
      const { token: newToken, user: newUser } = await api.resetPassword(email, code, newPassword);
      applySession(newToken, newUser); // connecté directement, comme après login/register
    },
    [applySession],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return { token, user, loading, login, register, verifyRegistration, logout, forgotPassword, resetPassword };
}
