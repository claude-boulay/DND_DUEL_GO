import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';

interface AuthPanelProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (username: string, email: string, password: string) => Promise<void>;
}

export function AuthPanel({ onLogin, onRegister }: AuthPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister(username, email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            mode === 'login' ? 'bg-accent-500 text-arena-950' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Connexion
        </button>
        <button
          type="button"
          onClick={() => setMode('register')}
          className={`flex-1 rounded-md py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            mode === 'register' ? 'bg-accent-500 text-arena-950' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Inscription
        </button>
      </div>

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
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === 'register' ? 8 : undefined}
          className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-500 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {submitting ? 'Chargement...' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
        </button>
      </form>
    </section>
  );
}
