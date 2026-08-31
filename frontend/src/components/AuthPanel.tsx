import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';

interface AuthPanelProps {
  onLogin: (email: string, password: string) => Promise<void>;
  // `pending: true` = un code de vérification vient d'être envoyé (SMTP
  // configuré côté serveur), le compte n'existe pas encore — voir
  // auth.routes.ts. `pending: false` = comportement historique (SMTP non
  // configuré), déjà connecté.
  onRegister: (username: string, email: string, password: string) => Promise<{ pending: boolean }>;
  onVerifyRegistration: (email: string, code: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
}

type Mode = 'login' | 'register' | 'register-verify' | 'forgot-request' | 'forgot-reset';

export function AuthPanel({ onLogin, onRegister, onVerifyRegistration, onForgotPassword, onResetPassword }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else if (mode === 'register') {
        const result = await onRegister(username, email, password);
        if (result.pending) {
          setInfo(`Un code de vérification vient d'être envoyé à ${email} — vérifiez votre boîte mail (et les spams).`);
          setMode('register-verify');
        }
        // sinon (pending: false, SMTP non configuré côté serveur) : déjà
        // connecté par onRegister, App.tsx bascule automatiquement de vue.
      } else if (mode === 'register-verify') {
        await onVerifyRegistration(email, code);
      } else if (mode === 'forgot-request') {
        await onForgotPassword(email);
        setInfo("Si un compte existe avec cet email, un code de réinitialisation vient d'être envoyé — vérifiez votre boîte mail (et les spams).");
        setMode('forgot-reset');
      } else {
        await onResetPassword(email, code, newPassword);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  const isForgotFlow = mode === 'forgot-request' || mode === 'forgot-reset';
  // Écrans "code à saisir" (un pour chaque flux) : même traitement pour la
  // barre d'onglets (masquée) et le bouton "Retour à la connexion".
  const showsCode = mode === 'forgot-reset' || mode === 'register-verify';
  const hidesTabs = isForgotFlow || mode === 'register-verify';

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      {!hidesTabs && (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
              mode === 'login' ? 'bg-accent-500 text-arena-950' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
              mode === 'register' ? 'bg-accent-500 text-arena-950' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Inscription
          </button>
        </div>
      )}

      {isForgotFlow && (
        <h3 className="mb-4 font-display text-sm uppercase tracking-wider text-accent-400">Mot de passe oublié</h3>
      )}
      {mode === 'register-verify' && (
        <h3 className="mb-4 font-display text-sm uppercase tracking-wider text-accent-400">Vérification de l'email</h3>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'register' && (
          <input
            type="text"
            placeholder="Nom d'utilisateur"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
        )}

        {!showsCode && (
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
        )}

        {(mode === 'login' || mode === 'register') && (
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 8 : undefined}
            className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
        )}

        {showsCode && (
          <>
            <p className="text-xs text-neutral-400">
              Code envoyé à <span className="text-neutral-200">{email}</span>
            </p>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-center text-lg tracking-[0.5em] text-neutral-100 outline-none focus:border-accent-500"
            />
          </>
        )}

        {mode === 'forgot-reset' && (
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
        )}

        {mode === 'login' && (
          <button
            type="button"
            onClick={() => switchMode('forgot-request')}
            className="text-xs text-neutral-400 underline hover:text-accent-400"
          >
            Mot de passe oublié ?
          </button>
        )}

        {info && <p className="text-xs text-emerald-400">{info}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-500 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {submitting
            ? 'Chargement...'
            : mode === 'login'
              ? 'Se connecter'
              : mode === 'register'
                ? "S'inscrire"
                : mode === 'register-verify'
                  ? 'Vérifier le code'
                  : mode === 'forgot-request'
                    ? 'Envoyer le code'
                    : 'Réinitialiser le mot de passe'}
        </button>

        {(isForgotFlow || mode === 'register-verify') && (
          <button type="button" onClick={() => switchMode('login')} className="w-full text-center text-xs text-neutral-400 underline hover:text-accent-400">
            Retour à la connexion
          </button>
        )}
        {mode === 'register-verify' && (
          <button
            type="button"
            onClick={() =>
              void onRegister(username, email, password)
                .then(() => setInfo('Nouveau code envoyé.'))
                .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
            }
            className="w-full text-center text-xs text-neutral-400 underline hover:text-accent-400"
          >
            Renvoyer le code
          </button>
        )}
        {mode === 'forgot-reset' && (
          <button
            type="button"
            onClick={() => void onForgotPassword(email).then(() => setInfo('Nouveau code envoyé.')).catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))}
            className="w-full text-center text-xs text-neutral-400 underline hover:text-accent-400"
          >
            Renvoyer le code
          </button>
        )}
      </form>
    </section>
  );
}
