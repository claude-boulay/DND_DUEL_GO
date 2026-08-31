import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError, type ApiCard, type ApiCardSet, type ApiMerchant, type ApiMerchantItemType } from '../lib/api';
import {
  EMPTY_FILTERS,
  MERCHANT_CARD_SORT_OPTIONS,
  activeFilterCount,
  compareEntries,
  filtersToQueryParams,
  type CollectionFilters,
  type SortKey,
} from '../lib/cardFilters';
import { CollectionFilterModal } from './CollectionFilterModal';

interface MerchantItemPickerOverlayProps {
  token: string;
  merchant: ApiMerchant;
  onAdded: (merchant: ApiMerchant) => void;
  onClose: () => void;
}

type BoosterSortKey = 'name' | 'release_date';

export function MerchantItemPickerOverlay({ token, merchant, onAdded, onClose }: MerchantItemPickerOverlayProps) {
  const [itemType, setItemType] = useState<ApiMerchantItemType>('card');
  const [price, setPrice] = useState(100);
  const [stock, setStock] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Cartes ---
  const CARDS_PER_PAGE = 100; // plafond autorisé par GET /api/cards (voir listCardsSchema)
  const [cardSearch, setCardSearch] = useState('');
  const [cardResults, setCardResults] = useState<ApiCard[]>([]);
  const [cardTotal, setCardTotal] = useState(0);
  const [cardPage, setCardPage] = useState(1);
  const [loadingCards, setLoadingCards] = useState(true);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [cardFilters, setCardFilters] = useState<CollectionFilters>(EMPTY_FILTERS);
  const [showCardFilterModal, setShowCardFilterModal] = useState(false);
  const [cardSortKey, setCardSortKey] = useState<SortKey>('type');
  const [cardSortDir, setCardSortDir] = useState<1 | -1>(1);
  const [selectedCard, setSelectedCard] = useState<ApiCard | null>(null);

  // --- Boosters ---
  const [setSearch, setSetSearch] = useState('');
  const [setResults, setSetResults] = useState<ApiCardSet[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [boosterSortKey, setBoosterSortKey] = useState<BoosterSortKey>('release_date');
  const [boosterSortDir, setBoosterSortDir] = useState<1 | -1>(-1); // les plus récents d'abord par défaut
  const [selectedSet, setSelectedSet] = useState<ApiCardSet | null>(null);

  // Nouvelle recherche/filtre (ou changement de mode) : repart de la page 1
  // et remplace les résultats. Le filtre est envoyé au serveur (voir
  // filtersToQueryParams) pour interroger le catalogue complet — sans ça,
  // filtrer ne faisait que réduire la page déjà chargée, ratant toute carte
  // correspondante qui n'y figurait pas encore.
  useEffect(() => {
    if (itemType !== 'card') return;
    setLoadingCards(true);
    setCardPage(1);
    const handle = setTimeout(() => {
      api
        .listCards(token, { search: cardSearch, limit: CARDS_PER_PAGE, page: 1, ...filtersToQueryParams(cardFilters) })
        .then(({ cards, total }) => {
          setCardResults(cards);
          setCardTotal(total);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
        .finally(() => setLoadingCards(false));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, itemType, cardSearch, cardFilters]);

  const loadMoreCards = () => {
    const nextPage = cardPage + 1;
    setLoadingMoreCards(true);
    api
      .listCards(token, { search: cardSearch, limit: CARDS_PER_PAGE, page: nextPage, ...filtersToQueryParams(cardFilters) })
      .then(({ cards, total }) => {
        setCardResults((prev) => [...prev, ...cards]);
        setCardTotal(total);
        setCardPage(nextPage);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
      .finally(() => setLoadingMoreCards(false));
  };

  useEffect(() => {
    if (itemType !== 'booster') return;
    setLoadingSets(true);
    const handle = setTimeout(() => {
      api
        // include_custom : un booster custom du MJ (créé depuis le panneau
        // de cartes custom, voir CustomCardPanel.tsx) doit pouvoir être
        // stocké dans un marchand comme n'importe quel set officiel.
        .listCardSets(token, { search: setSearch, include_custom: true })
        .then(({ sets }) => setSetResults(sets))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
        .finally(() => setLoadingSets(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [token, itemType, setSearch]);

  // Le filtrage a déjà eu lieu côté serveur (voir l'effet ci-dessus) : ne
  // reste qu'à trier le lot chargé.
  const visibleCards = useMemo(
    () =>
      [...cardResults].sort((a, b) =>
        compareEntries({ card: a, releaseDate: null, acquiredOrder: null }, { card: b, releaseDate: null, acquiredOrder: null }, cardSortKey, cardSortDir),
      ),
    [cardResults, cardSortKey, cardSortDir],
  );

  // Dérivées du lot chargé (avant filtrage) : la liste de races proposées
  // dans la modale ne doit pas rétrécir au fur et à mesure qu'on filtre.
  const availableRaces = useMemo(() => {
    const races = new Set<string>();
    for (const card of cardResults) {
      if (card.frame_type !== 'spell' && card.frame_type !== 'trap' && card.race) races.add(card.race);
    }
    return [...races].sort();
  }, [cardResults]);

  const visibleSets = useMemo(() => {
    return setResults
      .filter((set) => {
        if (dateFrom && (!set.tcg_date || set.tcg_date < dateFrom)) return false;
        if (dateBefore && (!set.tcg_date || set.tcg_date > dateBefore)) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp: number;
        if (boosterSortKey === 'name') {
          cmp = a.set_name.localeCompare(b.set_name);
        } else {
          const da = a.tcg_date;
          const db = b.tcg_date;
          if (!da && !db) cmp = a.set_name.localeCompare(b.set_name);
          else if (!da) return 1;
          else if (!db) return -1;
          else cmp = da.localeCompare(db);
        }
        return cmp * boosterSortDir;
      });
  }, [setResults, dateFrom, dateBefore, boosterSortKey, boosterSortDir]);

  const handleAdd = async () => {
    if (itemType === 'card' && !selectedCard) return;
    if (itemType === 'booster' && !selectedSet) return;
    setSubmitting(true);
    setError(null);
    try {
      const { merchant: updated } = await api.addMerchantItem(token, merchant.id, {
        item_type: itemType,
        card_id: itemType === 'card' ? selectedCard!.id : undefined,
        // set_id (voir CLAUDE.md — set_code seul n'identifie pas un set de
        // façon fiable) : essentiel ici, la recherche peut renvoyer 2+ sets
        // partageant le même set_code.
        set_id: itemType === 'booster' ? selectedSet!.id : undefined,
        price,
        stock: stock.trim() === '' ? null : Number(stock),
      });
      onAdded(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">Marchand — {merchant.name}</p>
          <h2 className="font-display text-xl text-accent-400">Ajouter un article</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-md border border-arena-600 p-0.5">
            <button
              type="button"
              onClick={() => {
                setItemType('card');
                setSelectedSet(null);
              }}
              className={`rounded px-3 py-1.5 text-sm ${itemType === 'card' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300'}`}
            >
              Carte
            </button>
            <button
              type="button"
              onClick={() => {
                setItemType('booster');
                setSelectedCard(null);
              }}
              className={`rounded px-3 py-1.5 text-sm ${itemType === 'booster' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300'}`}
            >
              Booster
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            Fermer
          </button>
        </div>
      </header>

      {error && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4">
          {itemType === 'card' ? (
            <CardSelectionPreview card={selectedCard} />
          ) : (
            <BoosterSelectionPreview set={selectedSet} />
          )}

          <div className="mt-auto space-y-2 border-t border-arena-700 pt-3 text-sm">
            <label className="flex items-center justify-between gap-2 text-neutral-300">
              Prix
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="w-24 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-neutral-300">
              Stock
              <input
                type="number"
                min={0}
                placeholder="illimité"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-24 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={submitting || (itemType === 'card' ? !selectedCard : !selectedSet)}
              className="w-full rounded-md bg-accent-500 py-2 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
            >
              Ajouter au marchand
            </button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-arena-700 bg-arena-900/30 p-4">
          {itemType === 'card' ? (
            <>
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                <input
                  type="text"
                  placeholder="Rechercher une carte par nom"
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
                />
                <select
                  value={cardSortKey}
                  onChange={(e) => setCardSortKey(e.target.value as SortKey)}
                  className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
                >
                  {MERCHANT_CARD_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setCardSortDir((d) => (d === 1 ? -1 : 1))}
                  title={cardSortDir === 1 ? 'Ordre croissant — cliquer pour inverser' : 'Ordre décroissant — cliquer pour inverser'}
                  className="rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
                >
                  {cardSortDir === 1 ? '↑' : '↓'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCardFilterModal(true)}
                  className="flex items-center gap-1 rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
                >
                  Filtrer
                  {activeFilterCount(cardFilters) > 0 && (
                    <span className="rounded-full bg-accent-500 px-1.5 text-[10px] font-semibold text-arena-950">
                      {activeFilterCount(cardFilters)}
                    </span>
                  )}
                </button>
                {activeFilterCount(cardFilters) > 0 && (
                  <button
                    type="button"
                    onClick={() => setCardFilters(EMPTY_FILTERS)}
                    className="rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-red-400 hover:text-red-400"
                  >
                    Reset
                  </button>
                )}
              </div>

              {!loadingCards && (
                <p className="mb-2 shrink-0 text-xs text-neutral-500">
                  {cardTotal === 0
                    ? 'Aucune carte ne correspond au catalogue filtré.'
                    : `${cardResults.length} / ${cardTotal} carte${cardTotal > 1 ? 's' : ''} chargée${cardResults.length > 1 ? 's' : ''}${
                        activeFilterCount(cardFilters) > 0 ? ' (filtre appliqué au catalogue complet)' : ''
                      }`}
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loadingCards && <p className="text-sm text-neutral-500">Chargement...</p>}
                {!loadingCards && visibleCards.length === 0 && <p className="text-sm text-neutral-500">Aucune carte trouvée.</p>}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                  {visibleCards.map((card) => (
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
                {!loadingCards && cardResults.length < cardTotal && (
                  <button
                    type="button"
                    onClick={loadMoreCards}
                    disabled={loadingMoreCards}
                    className="mt-3 w-full rounded-md border border-arena-600 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-50"
                  >
                    {loadingMoreCards ? 'Chargement...' : `Charger plus de cartes (${cardTotal - cardResults.length} restantes)`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                <input
                  type="text"
                  placeholder="Rechercher un booster par nom"
                  value={setSearch}
                  onChange={(e) => setSetSearch(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
                />
                <select
                  value={boosterSortKey}
                  onChange={(e) => setBoosterSortKey(e.target.value as BoosterSortKey)}
                  className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
                >
                  <option value="release_date">Date de sortie</option>
                  <option value="name">Nom (A → Z)</option>
                </select>
                <button
                  type="button"
                  onClick={() => setBoosterSortDir((d) => (d === 1 ? -1 : 1))}
                  title={boosterSortDir === 1 ? 'Ordre croissant — cliquer pour inverser' : 'Ordre décroissant — cliquer pour inverser'}
                  className="rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
                >
                  {boosterSortDir === 1 ? '↑' : '↓'}
                </button>
              </div>

              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 text-xs text-neutral-400">
                <label className="flex items-center gap-1.5">
                  Depuis le
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1 text-neutral-100 outline-none focus:border-accent-500"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  Jusqu'au
                  <input
                    type="date"
                    value={dateBefore}
                    onChange={(e) => setDateBefore(e.target.value)}
                    className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1 text-neutral-100 outline-none focus:border-accent-500"
                  />
                </label>
                {(dateFrom || dateBefore) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFrom('');
                      setDateBefore('');
                    }}
                    className="rounded border border-arena-600 px-2 py-1 text-neutral-300 transition hover:border-red-400 hover:text-red-400"
                  >
                    Reset dates
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loadingSets && <p className="text-sm text-neutral-500">Chargement...</p>}
                {!loadingSets && visibleSets.length === 0 && <p className="text-sm text-neutral-500">Aucun booster trouvé.</p>}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                  {visibleSets.map((set) => (
                    <BoosterTile key={set.id} set={set} selected={selectedSet?.id === set.id} onClick={() => setSelectedSet(set)} />
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {showCardFilterModal && (
        <CollectionFilterModal
          filters={cardFilters}
          onChange={setCardFilters}
          onClose={() => setShowCardFilterModal(false)}
          availableRaces={availableRaces}
        />
      )}
    </div>,
    document.body,
  );
}

function CardSelectionPreview({ card }: { card: ApiCard | null }) {
  if (!card) return <p className="text-sm text-neutral-500">Cliquez sur une carte pour la sélectionner.</p>;
  const image = card.card_images[0];
  return (
    <div className="text-sm">
      {image && <img src={image.image_url} alt={card.name} className="mb-3 w-full rounded-lg shadow-lg" />}
      <h3 className="mb-1 font-display text-lg text-accent-400">{card.name}</h3>
      <p className="mb-2 text-neutral-400">
        {card.type}
        {card.race ? ` · ${card.race}` : ''}
        {card.attribute ? ` · ${card.attribute}` : ''}
      </p>
      {(card.atk !== null || card.def !== null) && (
        <p className="text-neutral-300">
          {card.atk !== null && `ATK ${card.atk}`}
          {card.def !== null && ` / DEF ${card.def}`}
        </p>
      )}
    </div>
  );
}

function BoosterSelectionPreview({ set }: { set: ApiCardSet | null }) {
  if (!set) return <p className="text-sm text-neutral-500">Cliquez sur un booster pour le sélectionner.</p>;
  return (
    <div className="text-sm">
      <div className="relative mb-3 flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-lg border-2 border-accent-500 bg-gradient-to-br from-arena-800 via-arena-900 to-black p-4">
        {set.set_image && <img src={set.set_image} alt={set.set_name} className="absolute inset-0 h-full w-full object-cover" />}
        <div className="relative flex flex-1 flex-col justify-between bg-gradient-to-t from-black/85 via-black/10 to-black/60">
          <p className="text-xs uppercase tracking-widest text-accent-500">{set.set_code}</p>
          <div>
            <p className="font-display text-xl leading-tight text-neutral-100">{set.set_name}</p>
            <div className="text-xs text-neutral-300">
              <p title="Décompte brut YGOPRODeck (toutes raretés/variantes confondues) — peut différer du nombre de cartes réellement distinctes une fois importées.">
                {set.num_of_cards} entrées (YGOPRODeck)
              </p>
              <p>{set.tcg_date ?? 'date inconnue'}</p>
            </div>
          </div>
        </div>
      </div>
      {set.is_custom ? (
        <span className="inline-block rounded bg-accent-900 px-2 py-1 text-xs text-accent-300">Booster custom</span>
      ) : (
        <span className={`inline-block rounded px-2 py-1 text-xs ${set.imported ? 'bg-emerald-900 text-emerald-300' : 'bg-arena-700 text-neutral-400'}`}>
          {set.imported ? 'Cartes déjà importées' : 'Cartes importées à la volée à la première ouverture'}
        </span>
      )}
    </div>
  );
}

function BoosterTile({ set, selected, onClick }: { set: ApiCardSet; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-lg border-2 p-3 text-left transition ${
        selected ? 'border-accent-400 bg-arena-800' : 'border-arena-700 bg-gradient-to-br from-arena-800 to-arena-900 hover:border-accent-500'
      }`}
    >
      {set.set_image && <img src={set.set_image} alt={set.set_name} className="absolute inset-0 h-full w-full object-cover" />}
      {!set.set_image && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rotate-45 bg-accent-500/10 transition group-hover:bg-accent-500/20"
        />
      )}
      <div className="relative flex flex-1 flex-col justify-between bg-gradient-to-t from-black/85 via-black/5 to-black/50">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-accent-500">{set.set_code}</p>
          <p className="mt-1 font-display text-sm leading-tight text-neutral-100">{set.set_name}</p>
        </div>
        <div className="text-[10px] text-neutral-300">
          <p title="Décompte brut YGOPRODeck (toutes raretés/variantes confondues) — peut différer du nombre de cartes réellement distinctes.">
            {set.num_of_cards} entrées
          </p>
          <p>{set.tcg_date ?? 'date inconnue'}</p>
          <span
            className={`mt-1 inline-block rounded px-1.5 py-0.5 ${
              set.is_custom ? 'bg-accent-900 text-accent-300' : set.imported ? 'bg-emerald-900 text-emerald-300' : 'bg-arena-700 text-neutral-400'
            }`}
          >
            {set.is_custom ? 'Custom' : set.imported ? 'Importé' : 'À importer'}
          </span>
        </div>
      </div>
    </button>
  );
}
