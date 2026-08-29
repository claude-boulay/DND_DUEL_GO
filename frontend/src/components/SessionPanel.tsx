import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiSession } from '../lib/api';

interface SessionPanelProps {
  token: string;
  session: ApiSession | null;
  onSessionChange: (session: ApiSession | null) => void;
}

export function SessionPanel({ token, session, onSessionChange }: SessionPanelProps) {
  const [joinCode, setJoinCode] = useState('');
  const [currencyName, setCurrencyName] = useState('Gold');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [mySessions, setMySessions] = useState<ApiSession[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingMine(true);
    api
      .listMySessions(token)
      .then(({ sessions }) => {
        if (!cancelled) setMySessions(sessions);
      })
      .catch(() => {
        /* liste de confort : une erreur ici ne doit pas bloquer join/create */
      })
      .finally(() => {
        if (!cancelled) setLoadingMine(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const upsertMySessions = (updated: ApiSession) => {
    setMySessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id);
      return exists ? prev.map((s) => (s.id === updated.id ? updated : s)) : [updated, ...prev];
    });
  };

  const runAction = async (action: () => Promise<{ session: ApiSession }>) => {
    setError(null);
    setSubmitting(true);
    try {
      const { session: result } = await action();
      onSessionChange(result);
      upsertMySessions(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    void runAction(() => api.createSession(token, currencyName));
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    void runAction(() => api.joinSession(token, joinCode));
  };

  const handleDelete = async (target: ApiSession) => {
    if (!window.confirm(`Supprimer définitivement la partie ${target.code} ? Personnages et marchands associés seront aussi supprimés.`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteSession(token, target.code);
      setMySessions((prev) => prev.filter((s) => s.id !== target.id));
      if (session?.id === target.id) onSessionChange(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  if (session) {
    return (
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Salon actif</h2>
          <button
            type="button"
            onClick={() => onSessionChange(null)}
            className="text-xs text-neutral-400 underline hover:text-accent-400"
          >
            Changer de salon
          </button>
        </header>
        <div className="space-y-1 font-mono text-sm text-neutral-300">
          <p>
            code : <span className="text-accent-400">{session.code}</span>
          </p>
          <p>rôle : {session.is_gm ? 'Maître du Jeu' : 'Joueur'}</p>
          <p>monnaie : {session.currency_name}</p>
          <p>joueurs : {session.player_count}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">Salon de partie</h2>

      {!loadingMine && mySessions.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Mes parties</div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {mySessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md bg-arena-800 px-2 py-1.5 text-xs">
                <span className="text-accent-400">{s.code}</span>
                <span className="text-neutral-500">{s.is_gm ? 'MJ' : 'Joueur'}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">
                  {s.currency_name} · {s.player_count} joueur{s.player_count === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => onSessionChange(s)}
                  className="shrink-0 rounded border border-arena-600 px-2 py-0.5 text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
                >
                  Reprendre
                </button>
                {s.is_gm && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(s)}
                    className="shrink-0 text-red-400 transition hover:text-red-300"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleJoin} className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder="Code (YGO-8941)"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={submitting || !joinCode}
          className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-40"
        >
          Rejoindre
        </button>
      </form>

      <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">Ou créer un salon (MJ)</div>
      <form onSubmit={handleCreate} className="space-y-2">
        <input
          type="text"
          placeholder="Nom de la monnaie"
          value={currencyName}
          onChange={(e) => setCurrencyName(e.target.value)}
          className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-500 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          Créer le salon
        </button>
      </form>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </section>
  );
}
