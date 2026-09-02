import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api, type ApiGmNotebook } from '../lib/api';
import { translateApiError } from '../lib/translateApiError';

interface GmNotebookOverlayProps {
  token: string;
  sessionCode: string;
  notebook: ApiGmNotebook;
  onNotebookUpdate: (notebook: ApiGmNotebook) => void;
  onClose: () => void;
}

/**
 * Carnet du MJ (demande utilisateur) : un par PARTIE, indépendant de tout
 * personnage — deux sections fixes, "Histoire" et "Lieu" (portée confirmée
 * via AskUserQuestion, pas de catégories supplémentaires pour l'instant).
 * Jamais visible d'un joueur — voir toSessionDto côté backend, qui n'inclut
 * `gm_notebook` dans la réponse que pour le MJ.
 */
export function GmNotebookOverlay({ token, sessionCode, notebook, onNotebookUpdate, onClose }: GmNotebookOverlayProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'history' | 'location'>('history');
  const [history, setHistory] = useState(notebook.history);
  const [location, setLocation] = useState(notebook.location);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repart de la vraie valeur si elle change ailleurs (une autre fenêtre du
  // même MJ, par exemple) — sans ça les champs garderaient un texte obsolète.
  useEffect(() => {
    setHistory(notebook.history);
    setLocation(notebook.location);
  }, [notebook]);

  const changed = tab === 'history' ? history !== notebook.history : location !== notebook.location;
  const value = tab === 'history' ? history : location;
  const setValue = tab === 'history' ? setHistory : setLocation;

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    setSubmitting(true);
    setError(null);
    try {
      const { session } = await api.updateGmNotebook(token, sessionCode, tab === 'history' ? { history } : { location });
      if (session.gm_notebook) onNotebookUpdate(session.gm_notebook);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('gmNotebook.eyebrow')}</p>
          <h2 className="font-display text-2xl text-accent-400">{t('gmNotebook.title')}</h2>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex gap-1 rounded-md border border-arena-700 bg-arena-900 p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`rounded px-3 py-1.5 transition ${tab === 'history' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300 hover:text-accent-400'}`}
            >
              {t('gmNotebook.tab_history')}
            </button>
            <button
              type="button"
              onClick={() => setTab('location')}
              className={`rounded px-3 py-1.5 transition ${tab === 'location' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300 hover:text-accent-400'}`}
            >
              {t('gmNotebook.tab_location')}
            </button>
          </nav>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('characterSheet.close')}
          </button>
        </div>
      </header>

      <form onSubmit={handleSave} className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 p-6">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={tab === 'history' ? t('gmNotebook.placeholder_history') : t('gmNotebook.placeholder_location')}
          className="min-h-0 flex-1 resize-none rounded-lg border border-arena-600 bg-arena-900 p-4 text-sm leading-relaxed text-neutral-100 outline-none focus:border-accent-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex min-h-[2rem] items-center gap-3">
          {changed && (
            <>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
              >
                {t('gmNotebook.save')}
              </button>
              <span className="text-xs text-neutral-500">{t('gmNotebook.unsaved_changes')}</span>
            </>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
