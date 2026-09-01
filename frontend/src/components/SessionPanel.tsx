import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ApiSession } from '../lib/api';
import { translateApiError } from '../lib/translateApiError';

interface SessionPanelProps {
  token: string;
  session: ApiSession | null;
  onSessionChange: (session: ApiSession | null) => void;
}

export function SessionPanel({ token, session, onSessionChange }: SessionPanelProps) {
  const { t } = useTranslation();
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
      setError(translateApiError(err, t));
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
    if (!window.confirm(t('sessionPanel.confirm_delete', { code: target.code }))) {
      return;
    }
    setError(null);
    try {
      await api.deleteSession(token, target.code);
      setMySessions((prev) => prev.filter((s) => s.id !== target.id));
      if (session?.id === target.id) onSessionChange(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  };

  if (session) {
    return (
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('sessionPanel.active_session')}</h2>
          <button
            type="button"
            onClick={() => onSessionChange(null)}
            className="text-xs text-neutral-400 underline hover:text-accent-400"
          >
            {t('sessionPanel.change_session')}
          </button>
        </header>
        <div className="space-y-1 font-mono text-sm text-neutral-300">
          <p>
            {t('sessionPanel.code_label')} <span className="text-accent-400">{session.code}</span>
          </p>
          <p>
            {t('sessionPanel.role_label')} {session.is_gm ? t('sessionPanel.role_gm') : t('sessionPanel.role_player')}
          </p>
          <p>
            {t('sessionPanel.currency_label')} {session.currency_name}
          </p>
          <p>
            {t('sessionPanel.players_label')} {session.player_count}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('sessionPanel.title')}</h2>

      {!loadingMine && mySessions.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">{t('sessionPanel.my_sessions')}</div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {mySessions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md bg-arena-800 px-2 py-1.5 text-xs">
                <span className="text-accent-400">{s.code}</span>
                <span className="text-neutral-500">{s.is_gm ? t('sessionPanel.role_gm_short') : t('sessionPanel.role_player_short')}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">
                  {s.currency_name} · {t('sessionPanel.player_count', { count: s.player_count })}
                </span>
                <button
                  type="button"
                  onClick={() => onSessionChange(s)}
                  className="shrink-0 rounded border border-arena-600 px-2 py-0.5 text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
                >
                  {t('sessionPanel.resume')}
                </button>
                {s.is_gm && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(s)}
                    className="shrink-0 text-red-400 transition hover:text-red-300"
                  >
                    {t('sessionPanel.delete')}
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
          placeholder={t('sessionPanel.join_code_placeholder')}
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={submitting || !joinCode}
          className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-40"
        >
          {t('sessionPanel.join')}
        </button>
      </form>

      <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">{t('sessionPanel.or_create_session')}</div>
      <form onSubmit={handleCreate} className="space-y-2">
        <input
          type="text"
          placeholder={t('sessionPanel.currency_name_placeholder')}
          value={currencyName}
          onChange={(e) => setCurrencyName(e.target.value)}
          className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-500 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {t('sessionPanel.create_session')}
        </button>
      </form>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </section>
  );
}
