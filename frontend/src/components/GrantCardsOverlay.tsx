import { useEffect, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, type ApiCard, type ApiCharacter, type ApiCsvImportSummary } from '../lib/api';

interface GrantCardsOverlayProps {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: { collection?: string[] }) => void;
  onClose: () => void;
}

type Tab = 'search' | 'csv';

/**
 * Réservé au MJ (voir le bouton qui l'ouvre dans CharacterList.tsx, `isGm`
 * uniquement) — CLAUDE.md §3.5 "le MJ ajoute une ou plusieurs cartes à un
 * joueur". Deux façons d'ajouter des cartes à la collection d'UN personnage :
 * recherche + quantité pour un ajout ponctuel, import CSV pour migrer une
 * collection déjà existante (export "My Collection" de YGOPRODeck).
 */
export function GrantCardsOverlay({ token, character, onCharacterUpdate, onClose }: GrantCardsOverlayProps) {
  const [tab, setTab] = useState<Tab>('search');

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-arena-700 bg-arena-900 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-arena-700 p-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">
              Ajouter des cartes — <span className="text-accent-400">{character.name}</span>
            </h2>
            <div className="mt-2 flex gap-1 text-xs">
              <button
                type="button"
                onClick={() => setTab('search')}
                className={`rounded px-2 py-1 ${tab === 'search' ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'}`}
              >
                Rechercher une carte
              </button>
              <button
                type="button"
                onClick={() => setTab('csv')}
                className={`rounded px-2 py-1 ${tab === 'csv' ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'}`}
              >
                Importer un CSV
              </button>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'search' ? (
            <SearchTab token={token} character={character} onCharacterUpdate={onCharacterUpdate} />
          ) : (
            <CsvImportTab token={token} character={character} onCharacterUpdate={onCharacterUpdate} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SearchTab({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: { collection?: string[] }) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ApiCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<ApiCard | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<{ name: string; quantity: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .listCards(token, { search, limit: 60 })
        .then(({ cards, total: t }) => {
          setResults(cards);
          setTotal(t);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [token, search]);

  const handleAdd = async () => {
    if (!selectedCard) return;
    setSubmitting(true);
    setError(null);
    setLastAdded(null);
    try {
      const { character: updated, added } = await api.addCardToCollection(token, character.id, selectedCard.id, quantity);
      onCharacterUpdate(character.id, { collection: updated.collection });
      setLastAdded({ name: added.card.name, quantity: added.quantity });
      setQuantity(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 text-xs">
      <input
        type="text"
        placeholder="Rechercher une carte par nom"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
      />

      {!loading && <p className="text-neutral-500">{total === 0 ? 'Aucune carte trouvée.' : `${results.length} / ${total} carte${total > 1 ? 's' : ''}`}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <p className="text-neutral-500">Chargement...</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {results.map((card) => (
            <button
              type="button"
              key={card.id}
              onClick={() => setSelectedCard(card)}
              title={card.name}
              className={`overflow-hidden rounded-lg border-2 transition ${
                selectedCard?.id === card.id ? 'border-accent-400' : 'border-transparent hover:border-arena-600'
              }`}
            >
              {card.card_images[0] && <img src={card.card_images[0].image_url_small} alt={card.name} className="w-full" />}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 rounded-md border border-arena-700 bg-arena-800/60 p-3">
        {selectedCard ? (
          <div className="flex items-center gap-3">
            {selectedCard.card_images[0] && <img src={selectedCard.card_images[0].image_url_small} alt="" className="h-16 w-auto rounded" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-accent-400">{selectedCard.name}</p>
              <label className="mt-1 flex items-center gap-2 text-neutral-400">
                Quantité
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                  className="w-20 rounded border border-arena-600 bg-arena-900 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={submitting}
              className="shrink-0 rounded-md bg-accent-500 px-3 py-1.5 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
            >
              {submitting ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        ) : (
          <p className="text-neutral-500">Sélectionnez une carte ci-dessus.</p>
        )}
        {lastAdded && (
          <p className="mt-2 text-emerald-400">
            ✓ {lastAdded.quantity} × {lastAdded.name} ajouté{lastAdded.quantity > 1 ? 's' : ''} à la collection.
          </p>
        )}
        {error && <p className="mt-2 text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function CsvImportTab({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: { collection?: string[] }) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ApiCsvImportSummary | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFileName(f.name);
    setSummary(null);
    setError(null);
  };

  const handleImport = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const { character: updated, summary: result } = await api.importCollectionCsv(token, character.id, file);
      onCharacterUpdate(character.id, { collection: updated.collection });
      setSummary(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <p className="text-neutral-400">
        Pour migrer une collection déjà existante (ex. d'une partie en cours ailleurs) : importez le fichier CSV "My Collection" exporté depuis{' '}
        <a href="https://ygoprodeck.com" target="_blank" rel="noreferrer" className="text-accent-400 underline">
          ygoprodeck.com
        </a>{' '}
        (colonnes cardname, cardq, cardrarity, card_edition, cardset, cardcode, cardid, print_id). Les cartes sont reconnues par leur passcode
        (colonne <code>cardid</code>) — une carte pas encore dans la base locale est récupérée automatiquement.
      </p>

      <div className="flex items-center gap-2 rounded-md border border-arena-700 bg-arena-800/60 p-3">
        <label className="flex items-center gap-2 text-neutral-400">
          Fichier CSV
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="text-neutral-300" />
        </label>
        {fileName && <span className="text-neutral-500">{fileName}</span>}
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={!file || submitting}
          className="ml-auto shrink-0 rounded-md bg-accent-500 px-3 py-1.5 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {submitting ? 'Import...' : 'Importer'}
        </button>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {summary && (
        <div className="space-y-2 rounded-md border border-arena-700 bg-arena-800/60 p-3">
          <p className="font-semibold text-emerald-400">
            ✓ {summary.total_copies_added} carte{summary.total_copies_added > 1 ? 's' : ''} ajoutée{summary.total_copies_added > 1 ? 's' : ''} à la
            collection.
          </p>
          {summary.added.length > 0 && (
            <div>
              <p className="text-neutral-400">Ajoutées ({summary.added.length}) :</p>
              <ul className="ml-3 max-h-32 list-disc overflow-y-auto text-neutral-300">
                {summary.added.map((a, i) => (
                  <li key={i}>
                    {a.quantity} × {a.card_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.not_found.length > 0 && (
            <div>
              <p className="text-amber-400">Introuvables sur YGOPRODeck ({summary.not_found.length}) :</p>
              <ul className="ml-3 max-h-32 list-disc overflow-y-auto text-neutral-300">
                {summary.not_found.map((n, i) => (
                  <li key={i}>
                    {n.cardname} (id {n.cardid})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.skipped.length > 0 && (
            <div>
              <p className="text-red-400">Lignes ignorées ({summary.skipped.length}) :</p>
              <ul className="ml-3 max-h-32 list-disc overflow-y-auto text-neutral-300">
                {summary.skipped.map((s, i) => (
                  <li key={i}>
                    ligne {s.row} ({s.cardname}) — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
