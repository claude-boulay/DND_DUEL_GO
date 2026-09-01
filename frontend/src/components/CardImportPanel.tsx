import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type ApiCard, type ApiCardSet } from '../lib/api';
import { translateApiError } from '../lib/translateApiError';

interface CardImportPanelProps {
  token: string;
}

export function CardImportPanel({ token }: CardImportPanelProps) {
  const { t } = useTranslation();
  const [sets, setSets] = useState<ApiCardSet[]>([]);
  const [setsSearchInput, setSetsSearchInput] = useState('');
  const [loadingSets, setLoadingSets] = useState(false);
  const [importingSetId, setImportingSetId] = useState<string | null>(null);
  const [setsError, setSetsError] = useState<string | null>(null);
  // "Réimporter tous les boosters" (demande utilisateur : réimporter un par
  // un après chaque mise à jour, ex. pour peupler les traductions FR d'un
  // coup, était trop long) — séquentiel via la MÊME route par set que le
  // bouton individuel, pour rester sur l'unique throttle déjà partagé côté
  // ygoprodeck.ts plutôt que d'en ajouter un second.
  const [bulkReimporting, setBulkReimporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const [cards, setCards] = useState<ApiCard[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsSetFilter, setCardsSetFilter] = useState<{ id: string; name: string } | null>(null);
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
      setSetsError(translateApiError(err, t));
    } finally {
      if (requestId === setsRequestIdRef.current) setLoadingSets(false);
    }
  };

  useEffect(() => {
    void loadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadCards = async (setId?: string, search?: string) => {
    const requestId = ++cardsRequestIdRef.current;
    setLoadingCards(true);
    setCardsError(null);
    try {
      const { cards: fetched, total } = await api.listCards(token, {
        set_id: setId || undefined,
        search: search || undefined,
        limit: 24,
      });
      if (requestId !== cardsRequestIdRef.current) return;
      setCards(fetched);
      setCardsTotal(total);
    } catch (err) {
      if (requestId !== cardsRequestIdRef.current) return;
      setCardsError(translateApiError(err, t));
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
    setImportingSetId(set.id);
    setSetsError(null);
    try {
      await api.importCardSet(token, set.id);
    } catch (err) {
      // Une erreur réseau brute (ex. connexion coupée avant toute réponse,
      // serveur dev redémarré pendant la requête) n'est PAS une ApiError —
      // elle porte quand même un vrai message ("Failed to fetch"...) plus
      // utile que le texte générique, qui ne devrait rester qu'en tout
      // dernier recours (erreur qui n'est même pas un vrai Error).
      setSetsError(err instanceof ApiError ? translateApiError(err, t) : err instanceof Error ? err.message : t('common.error_generic'));
      setImportingSetId(null);
      return;
    }
    setImportingSetId(null);
    // Import réussi : le rafraîchissement de la liste de cartes a son PROPRE
    // traitement d'erreur (setCardsError) — volontairement hors du try
    // ci-dessus pour qu'un souci ici ne s'affiche jamais comme un échec de
    // l'IMPORT alors que celui-ci a en réalité fonctionné.
    setSets((prev) =>
      prev.map((s) => (s.id === set.id ? { ...s, imported: true, imported_at: new Date().toISOString(), had_code_collision: false } : s)),
    );
    setCardsSetFilter({ id: set.id, name: set.set_name });
    setCardsSearchInput('');
    await loadCards(set.id);
  };

  const handleReimportAll = async () => {
    setSetsError(null);
    setBulkSummary(null);
    setBulkReimporting(true);
    try {
      // Liste COMPLÈTE des sets déjà importés (imported_only=true, voir
      // card.routes.ts) — jamais tronquée par une recherche affichée à
      // l'écran ni par le plafond de 500 de la liste normale.
      const { sets: allImported } = await api.listCardSets(token, { imported_only: true });
      setBulkProgress({ done: 0, total: allImported.length });
      let failed = 0;
      for (let i = 0; i < allImported.length; i += 1) {
        try {
          await api.importCardSet(token, allImported[i]!.id);
        } catch {
          failed += 1;
        }
        setBulkProgress({ done: i + 1, total: allImported.length });
      }
      const succeeded = allImported.length - failed;
      setBulkSummary(t('cardImport.reimport_all_done', { count: succeeded }) + (failed > 0 ? t('cardImport.reimport_all_failed', { count: failed }) : ''));
      await loadSets(setsSearchInput);
    } catch (err) {
      setSetsError(translateApiError(err, t));
    } finally {
      setBulkReimporting(false);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('cardImport.title_sets')}</h2>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => void handleReimportAll()}
              disabled={bulkReimporting || importingSetId !== null}
              title={t('cardImport.reimport_all_tooltip')}
              className="text-xs text-neutral-400 underline transition hover:text-accent-400 disabled:opacity-40"
            >
              {bulkReimporting && bulkProgress
                ? t('cardImport.reimport_all_progress', { done: bulkProgress.done, total: bulkProgress.total })
                : t('cardImport.reimport_all_button')}
            </button>
            <button
              type="button"
              onClick={() => void loadSets(setsSearchInput, true)}
              disabled={loadingSets || bulkReimporting}
              className="text-xs text-neutral-400 underline transition hover:text-accent-400 disabled:opacity-40"
            >
              {t('cardImport.sync_button')}
            </button>
          </div>
        </header>

        {bulkSummary && <p className="mb-2 text-xs text-emerald-400">{bulkSummary}</p>}

        <form onSubmit={handleSetsSearch} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder={t('cardImport.search_set_placeholder')}
            value={setsSearchInput}
            onChange={(e) => setSetsSearchInput(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('cardImport.search_button')}
          </button>
        </form>

        {setsError && <p className="mb-2 text-xs text-red-400">{setsError}</p>}
        {loadingSets && <p className="text-xs text-neutral-500">{t('common.loading')}</p>}

        <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
          {!loadingSets && sets.length === 0 && (
            <p className="text-neutral-500">{t('cardImport.no_sets_found')}</p>
          )}
          {sets.map((set) => (
            <div key={set.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-arena-800">
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
                  {t('cardImport.num_cards', { count: set.num_of_cards })}
                  {set.tcg_date ? ` · ${set.tcg_date}` : ''}
                </div>
              </div>
              {set.imported ? (
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span
                    className={`rounded border px-2 py-1 ${
                      set.had_code_collision ? 'border-amber-600 text-amber-400' : 'border-emerald-700 text-emerald-400'
                    }`}
                    title={set.had_code_collision ? t('cardImport.collision_tooltip') : undefined}
                  >
                    {set.had_code_collision ? t('cardImport.collision_badge') : t('merchantPicker.imported_badge')}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleImport(set)}
                    disabled={importingSetId === set.id || bulkReimporting}
                    className="text-[10px] text-accent-400 underline hover:text-accent-300 disabled:opacity-50"
                  >
                    {importingSetId === set.id ? t('cardImport.reimporting') : t('cardImport.reimport')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleImport(set)}
                  disabled={importingSetId === set.id || bulkReimporting}
                  className="shrink-0 rounded-md bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
                >
                  {importingSetId === set.id ? t('cardImport.importing') : t('cardImport.import_button')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">
          {cardsSetFilter ? t('cardImport.title_cards_filtered', { name: cardsSetFilter.name }) : t('cardImport.title_cards')}
        </h2>

        <form onSubmit={handleCardsSearch} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder={t('grantCards.search_placeholder')}
            value={cardsSearchInput}
            onChange={(e) => setCardsSearchInput(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-200 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('cardImport.search_button')}
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
              {t('cardImport.clear_filter')}
            </button>
          )}
        </form>

        {cardsError && <p className="mb-2 text-xs text-red-400">{cardsError}</p>}
        {loadingCards && <p className="text-xs text-neutral-500">{t('common.loading')}</p>}
        {!loadingCards && cards.length === 0 && (
          <p className="text-xs text-neutral-500">{t('cardImport.no_cards_to_display')}</p>
        )}
        {!loadingCards && cards.length > 0 && (
          <p className="mb-2 text-xs text-neutral-500">{t('cardImport.total_cards', { count: cardsTotal })}</p>
        )}

        {/* max-h/overflow sur ce conteneur EXTÉRIEUR seulement (pas la
            grille) : la grille garde overflow:visible pour ne pas tronquer
            l'agrandissement au survol — même pattern que
            BoosterOpeningOverlay.tsx/SettledSlot. */}
        <div className="max-h-80 overflow-y-auto">
          <div className="grid grid-cols-3 gap-2 [overflow:visible] sm:grid-cols-4">
            {cards.map((card) => (
              <figure key={card.id} className="rounded-md border border-arena-700 bg-arena-800 p-1.5">
                {card.card_images[0] && (
                  // image_url (pleine résolution), pas _small : le survol
                  // grossit la carte pour lire son texte sans problème (demande
                  // utilisateur) — un agrandissement CSS d'une petite miniature
                  // serait flou.
                  <img
                    src={card.card_images[0].image_url}
                    alt={card.name}
                    loading="lazy"
                    className="w-full rounded transition duration-150 hover:z-20 hover:scale-[2.5] hover:cursor-zoom-in"
                  />
                )}
                <figcaption className="mt-1 truncate text-center text-[10px] text-neutral-300" title={card.name}>
                  {card.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
