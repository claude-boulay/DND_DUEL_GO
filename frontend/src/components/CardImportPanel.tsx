import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiCard, type ApiCardSet } from '../lib/api';

interface CardImportPanelProps {
  token: string;
}

export function CardImportPanel({ token }: CardImportPanelProps) {
  const [sets, setSets] = useState<ApiCardSet[]>([]);
  const [setsSearchInput, setSetsSearchInput] = useState('');
  const [loadingSets, setLoadingSets] = useState(false);
  const [importingCode, setImportingCode] = useState<string | null>(null);
  const [setsError, setSetsError] = useState<string | null>(null);

  const [cards, setCards] = useState<ApiCard[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsSetFilter, setCardsSetFilter] = useState<{ code: string; name: string } | null>(null);
  const [cardsSearchInput, setCardsSearchInput] = useState('');
  const [loadingCards, setLoadingCards] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);

  // Compteurs de requête : une réponse en retard (StrictMode double-effet,
  // recherche relancée avant la fin de la précédente) ne doit jamais écraser
  // un état plus récent. Seule la dernière requête émise a le droit d'écrire.
  const setsRequestIdRef = useRef(0);
  const cardsRequestIdRef = useRef(0);

  const loadSets = async (search?: string, refresh?: boolean) => {
    const requestId = ++setsRequestIdRef.current;
    setLoadingSets(true);
    setSetsError(null);
    try {
      const { sets: fetched } = await api.listCardSets(token, { search: search || undefined, refresh });
      if (requestId !== setsRequestIdRef.current) return;
      setSets(fetched);
    } catch (err) {
      if (requestId !== setsRequestIdRef.current) return;
      setSetsError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      if (requestId === setsRequestIdRef.current) setLoadingSets(false);
    }
  };

  useEffect(() => {
    void loadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadCards = async (setCode?: string, search?: string) => {
    const requestId = ++cardsRequestIdRef.current;
    setLoadingCards(true);
    setCardsError(null);
    try {
      const { cards: fetched, total } = await api.listCards(token, {
        set_code: setCode || undefined,
        search: search || undefined,
        limit: 24,
      });
      if (requestId !== cardsRequestIdRef.current) return;
      setCards(fetched);
      setCardsTotal(total);
    } catch (err) {
      if (requestId !== cardsRequestIdRef.current) return;
      setCardsError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      if (requestId === cardsRequestIdRef.current) setLoadingCards(false);
    }
  };

  const handleSetsSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadSets(setsSearchInput);
  };

  const handleCardsSearch = (event: FormEvent) => {
    event.preventDefault();
    setCardsSetFilter(null);
    void loadCards(undefined, cardsSearchInput);
  };

  const handleImport = async (set: ApiCardSet) => {
    setImportingCode(set.set_code);
    setSetsError(null);
    try {
      await api.importCardSet(token, set.set_code);
    } catch (err) {
      // Une erreur réseau brute (ex. connexion coupée avant toute réponse,
      // serveur dev redémarré pendant la requête) n'est PAS une ApiError —
      // elle porte quand même un vrai message ("Failed to fetch"...) plus
      // utile que le texte générique, qui ne devrait rester qu'en tout
      // dernier recours (erreur qui n'est même pas un vrai Error).
      setSetsError(err instanceof Error ? err.message : 'Une erreur est survenue');
      setImportingCode(null);
      return;
    }
    setImportingCode(null);
    // Import réussi : le rafraîchissement de la liste de cartes a son PROPRE
    // traitement d'erreur (setCardsError) — volontairement hors du try
    // ci-dessus pour qu'un souci ici ne s'affiche jamais comme un échec de
    // l'IMPORT alors que celui-ci a en réalité fonctionné.
    setSets((prev) => prev.map((s) => (s.set_code === set.set_code ? { ...s, imported: true, imported_at: new Date().toISOString() } : s)));
    setCardsSetFilter({ code: set.set_code, name: set.set_name });
    setCardsSearchInput('');
    await loadCards(set.set_code);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Sets de cartes (boosters)</h2>
          <button
            type="button"
            onClick={() => void loadSets(setsSearchInput, true)}
            disabled={loadingSets}
            className="text-xs text-neutral-400 underline transition hover:text-accent-400 disabled:opacity-40"
          >
            Synchroniser depuis YGOPRODeck
          </button>
        </header>

        <form onSubmit={handleSetsSearch} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder="Rechercher un set (ex. Legend of Blue Eyes)"
            value={setsSearchInput}
            onChange={(e) => setSetsSearchInput(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
          >
            Chercher
          </button>
        </form>

        {setsError && <p className="mb-2 text-xs text-red-400">{setsError}</p>}
        {loadingSets && <p className="text-xs text-neutral-500">Chargement...</p>}

        <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
          {!loadingSets && sets.length === 0 && (
            <p className="text-neutral-500">Aucun set trouvé, essayez une autre recherche.</p>
          )}
          {sets.map((set) => (
            <div key={set.set_code} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-arena-800">
              {set.set_image ? (
                <img src={set.set_image} alt={set.set_name} className="h-10 w-10 shrink-0 rounded object-contain" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-arena-800 text-[8px] text-arena-600">
                  {set.set_code}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-neutral-200">
                  {set.set_name} <span className="text-neutral-500">({set.set_code})</span>
                </div>
                <div className="text-neutral-500">
                  {set.num_of_cards} cartes{set.tcg_date ? ` · ${set.tcg_date}` : ''}
                </div>
              </div>
              {set.imported ? (
                <span className="shrink-0 rounded border border-emerald-700 px-2 py-1 text-emerald-400">Importé</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleImport(set)}
                  disabled={importingCode === set.set_code}
                  className="shrink-0 rounded-md bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
                >
                  {importingCode === set.set_code ? 'Import...' : 'Importer'}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">
          Cartes importées{cardsSetFilter ? ` — ${cardsSetFilter.name}` : ''}
        </h2>

        <form onSubmit={handleCardsSearch} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder="Rechercher une carte par nom"
            value={cardsSearchInput}
            onChange={(e) => setCardsSearchInput(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
          >
            Chercher
          </button>
          {cardsSetFilter && (
            <button
              type="button"
              onClick={() => {
                setCardsSetFilter(null);
                setCards([]);
                setCardsTotal(0);
              }}
              className="shrink-0 text-xs text-neutral-400 underline hover:text-accent-400"
            >
              Effacer le filtre
            </button>
          )}
        </form>

        {cardsError && <p className="mb-2 text-xs text-red-400">{cardsError}</p>}
        {loadingCards && <p className="text-xs text-neutral-500">Chargement...</p>}
        {!loadingCards && cards.length === 0 && (
          <p className="text-xs text-neutral-500">Aucune carte à afficher — importez un set ou lancez une recherche.</p>
        )}
        {!loadingCards && cards.length > 0 && (
          <p className="mb-2 text-xs text-neutral-500">{cardsTotal} carte(s) au total</p>
        )}

        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {cards.map((card) => (
            <figure key={card.id} className="rounded-md border border-arena-700 bg-arena-800 p-1.5">
              {card.card_images[0] && (
                <img
                  src={card.card_images[0].image_url_small}
                  alt={card.name}
                  loading="lazy"
                  className="w-full rounded"
                />
              )}
              <figcaption className="mt-1 truncate text-center text-[10px] text-neutral-300" title={card.name}>
                {card.name}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
