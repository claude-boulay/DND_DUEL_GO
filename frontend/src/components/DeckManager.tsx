import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ApiCharacter, type ApiDeck } from '../lib/api';
import { translateApiError } from '../lib/translateApiError';
import { DeckEditorOverlay } from './DeckEditorOverlay';

interface DeckManagerProps {
  token: string;
  character: ApiCharacter;
  // GM-only, PNJ uniquement : conditionne l'affichage du bloc d'import .ydk
  // ci-dessous — un deck joueur reste construit depuis sa collection (voir
  // CLAUDE.md §3.6), jamais depuis un fichier arbitraire.
  isGm: boolean;
  onCharacterUpdate: (characterId: string, patch: { decks?: ApiDeck[] }) => void;
}

export function DeckManager({ token, character, isGm, onCharacterUpdate }: DeckManagerProps) {
  const { t } = useTranslation();
  const [newDeckName, setNewDeckName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!newDeckName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { character: updated } = await api.createDeck(token, character.id, newDeckName.trim());
      onCharacterUpdate(character.id, { decks: updated.decks });
      setNewDeckName('');
      setOpenDeckId(updated.decks[updated.decks.length - 1]?.id ?? null);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDeck = async (deckId: string) => {
    setError(null);
    try {
      const { character: updated } = await api.deleteDeck(token, character.id, deckId);
      onCharacterUpdate(character.id, { decks: updated.decks });
      if (openDeckId === deckId) setOpenDeckId(null);
    } catch (err) {
      setError(translateApiError(err, t));
    }
  };

  return (
    <div className="mt-2 border-t border-arena-700 pt-2 text-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-neutral-400">{t('deckManager.title')}</span>
      </div>

      <form onSubmit={handleCreate} className="mb-2 flex gap-1.5">
        <input
          type="text"
          placeholder={t('deckManager.placeholder_new_deck')}
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {t('deckManager.create')}
        </button>
      </form>

      {error && <p className="mb-2 text-red-400">{error}</p>}

      {character.decks.length === 0 && <p className="text-neutral-500">{t('deckManager.empty')}</p>}

      <div className="space-y-1.5">
        {character.decks.map((deck) => (
          <div key={deck.id} className="flex items-center gap-2 rounded border border-arena-700 bg-arena-900 p-2">
            <span className="flex-1 truncate text-neutral-200">
              {deck.name} <span className="text-neutral-500">({t('deckManager.card_count', { count: deck.cards.length })})</span>
            </span>
            <button type="button" onClick={() => setOpenDeckId(deck.id)} className="shrink-0 text-accent-400 underline hover:text-accent-300">
              {t('deckManager.open')}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteDeck(deck.id)}
              className="shrink-0 text-red-400 hover:text-red-300"
            >
              {t('deckManager.delete')}
            </button>
          </div>
        ))}
      </div>

      {isGm && character.is_npc && <YdkImportForm token={token} character={character} onCharacterUpdate={onCharacterUpdate} />}

      {openDeckId && (
        <DeckEditorOverlay
          token={token}
          character={character}
          deckId={openDeckId}
          onClose={() => setOpenDeckId(null)}
          onCharacterUpdate={onCharacterUpdate}
        />
      )}
    </div>
  );
}

/**
 * Import d'un deck PNJ complet depuis un fichier .ydk OU son contenu collé
 * (demande utilisateur explicite : les deux doivent marcher) — composer un
 * deck adversaire carte par carte était trop long pour un deck déjà prêt
 * ailleurs (EDOPro/YGOPro, ou un export .ydk fait par cet outil lui-même,
 * voir lib/ydk.ts). GM-only + PNJ uniquement, voir DeckManagerProps.isGm.
 */
function YdkImportForm({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: { decks?: ApiDeck[] }) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ main: number; extra: number; notFound: number[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName('');
    setContent('');
    setFileName(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
    // Nom du deck pré-rempli depuis le nom du fichier si le champ est encore vide.
    if (!name.trim()) setName(file.name.replace(/\.ydk$/i, ''));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setSubmitting(true);
    setError(null);
    setSummary(null);
    try {
      const { character: updated, summary: importSummary } = await api.importYdkDeck(token, character.id, name.trim(), content);
      onCharacterUpdate(character.id, { decks: updated.decks });
      setSummary({ main: importSummary.main_count, extra: importSummary.extra_count, notFound: importSummary.not_found });
      resetForm();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded border border-dashed border-arena-600 px-2 py-1.5 text-center text-neutral-400 transition hover:border-accent-500 hover:text-accent-400"
      >
        {t('deckManager.import_ydk_button')}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 rounded border border-arena-700 bg-arena-900 p-2">
      <p className="font-semibold uppercase tracking-wide text-neutral-400">{t('deckManager.import_ydk_title')}</p>
      <input
        type="text"
        placeholder={t('deckManager.import_ydk_name_placeholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border border-arena-600 bg-arena-800 px-2 py-1 text-neutral-100 outline-none focus:border-accent-500"
      />
      <label className="flex items-center gap-2 text-neutral-400">
        <span className="shrink-0">{t('deckManager.import_ydk_file_label')}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ydk,text/plain"
          onChange={(e) => void handleFileChange(e)}
          className="min-w-0 flex-1 text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-accent-500 file:px-2 file:py-1 file:text-arena-950 file:transition hover:file:bg-accent-400"
        />
      </label>
      {fileName && <p className="text-neutral-500">{fileName}</p>}
      <p className="text-neutral-500">{t('deckManager.import_ydk_or_paste')}</p>
      <textarea
        placeholder={t('deckManager.import_ydk_paste_placeholder')}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setFileName(null);
        }}
        rows={5}
        className="w-full resize-none rounded border border-arena-600 bg-arena-800 px-2 py-1.5 font-mono text-neutral-100 outline-none focus:border-accent-500"
      />
      {error && <p className="text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim() || !content.trim()}
          className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {t('deckManager.import_ydk_submit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            resetForm();
          }}
          className="rounded border border-arena-600 px-2 py-1 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
        >
          {t('deckManager.import_ydk_cancel')}
        </button>
      </div>
      {summary && (
        <div className="rounded border border-arena-700 bg-arena-800 p-2 text-neutral-300">
          <p>{t('deckManager.import_ydk_summary', { main: summary.main, extra: summary.extra })}</p>
          {summary.notFound.length > 0 && (
            <p className="mt-1 text-amber-400">
              {t('deckManager.import_ydk_not_found', { count: summary.notFound.length, codes: summary.notFound.join(', ') })}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
