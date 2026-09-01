import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { translateAttribute, translateRace } from '../lib/cardLabels';
import { displayCardName, displayCardDescription } from '../lib/cardTranslation';
import {
  api,
  type ApiCard,
  type ApiCharacter,
  type ApiCollectionEntry,
  type ApiDeck,
  type ApiDeckCardEntry,
  type ApiDeckDetail,
} from '../lib/api';
import { translateApiError } from '../lib/translateApiError';
import {
  DECK_SORT_OPTIONS,
  EMPTY_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  cardCategory,
  compareEntries,
  filtersToQueryParams,
  matchesFilters,
  type CollectionFilters,
  type SortKey,
} from '../lib/cardFilters';
import { CollectionFilterModal } from './CollectionFilterModal';
import { downloadYdk } from '../lib/ydk';

interface DeckEditorOverlayProps {
  token: string;
  character: ApiCharacter;
  deckId: string;
  onClose: () => void;
  onCharacterUpdate: (characterId: string, patch: { decks?: ApiDeck[] }) => void;
}

interface BrowsableEntry {
  card: ApiCard;
  // null = pas de plafond affiché (recherche PNJ, dispensée de collection).
  quantity: number | null;
  releaseDate: string | null;
  acquiredOrder: number | null;
}

export function DeckEditorOverlay({ token, character, deckId, onClose, onCharacterUpdate }: DeckEditorOverlayProps) {
  const { t } = useTranslation();
  const [deck, setDeck] = useState<ApiDeckDetail | null>(null);
  const [loadingDeck, setLoadingDeck] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<ApiCard | null>(null);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const NPC_CARDS_PER_PAGE = 100; // plafond autorisé par GET /api/cards
  const [collection, setCollection] = useState<ApiCollectionEntry[]>([]);
  const [npcResults, setNpcResults] = useState<ApiCard[]>([]);
  const [npcTotal, setNpcTotal] = useState(0);
  const [npcPage, setNpcPage] = useState(1);
  const [loadingMoreNpc, setLoadingMoreNpc] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingRight, setLoadingRight] = useState(true);
  const [filters, setFilters] = useState<CollectionFilters>(EMPTY_FILTERS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('type');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // Tri de l'affichage DANS le deck (Main/Extra) — indépendant du tri de la
  // colonne de recherche à droite ci-dessus (demande utilisateur distincte).
  const [deckSortKey, setDeckSortKey] = useState<SortKey>('type');
  const [deckSortDir, setDeckSortDir] = useState<1 | -1>(1);

  const loadDeck = () => {
    setLoadingDeck(true);
    api
      .getDeck(token, character.id, deckId)
      .then(({ deck: fetched }) => {
        setDeck(fetched);
        setPreviewCard((prev) => prev ?? fetched.main[0]?.card ?? fetched.extra[0]?.card ?? null);
      })
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setLoadingDeck(false));
  };

  useEffect(() => {
    loadDeck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, character.id, deckId]);

  // Joueur : sa collection complète (bornée, déjà chargée en entier), filtrée
  // côté client. PNJ : dispensé de collection (CLAUDE.md §3.6), recherche
  // dans le catalogue complet — le filtre est envoyé au serveur (voir
  // filtersToQueryParams) pour ne pas se limiter à la page déjà chargée.
  useEffect(() => {
    if (character.is_npc) return;
    setLoadingRight(true);
    api
      .getCharacterCollection(token, character.id)
      .then(({ collection: fetched }) => setCollection(fetched))
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setLoadingRight(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, character.id, character.is_npc]);

  useEffect(() => {
    if (!character.is_npc) return;
    setLoadingRight(true);
    setNpcPage(1);
    const handle = setTimeout(() => {
      api
        .listCards(token, { search, limit: NPC_CARDS_PER_PAGE, page: 1, ...filtersToQueryParams(filters) })
        .then(({ cards, total }) => {
          setNpcResults(cards);
          setNpcTotal(total);
        })
        .catch((err) => setError(translateApiError(err, t)))
        .finally(() => setLoadingRight(false));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, character.id, character.is_npc, search, filters]);

  const loadMoreNpcCards = () => {
    const nextPage = npcPage + 1;
    setLoadingMoreNpc(true);
    api
      .listCards(token, { search, limit: NPC_CARDS_PER_PAGE, page: nextPage, ...filtersToQueryParams(filters) })
      .then(({ cards, total }) => {
        setNpcResults((prev) => [...prev, ...cards]);
        setNpcTotal(total);
        setNpcPage(nextPage);
      })
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setLoadingMoreNpc(false));
  };

  const searchedEntries: BrowsableEntry[] = character.is_npc
    ? npcResults.map((card) => ({ card, quantity: null, releaseDate: null, acquiredOrder: null }))
    : collection
        .filter((e) => !search.trim() || e.card.name.toLowerCase().includes(search.trim().toLowerCase()))
        .map((e) => ({ card: e.card, quantity: e.quantity, releaseDate: e.release_date, acquiredOrder: e.acquired_order }));

  // Dérivées de la recherche AVANT filtrage : la liste de races proposées
  // dans la modale ne doit pas rétrécir au fur et à mesure qu'on filtre.
  const availableRaces = useMemo(() => {
    const races = new Set<string>();
    for (const entry of searchedEntries) {
      if (cardCategory(entry.card) === 'monster' && entry.card.race) races.add(entry.card.race);
    }
    return [...races].sort();
  }, [searchedEntries]);

  const rightEntries = useMemo(
    () =>
      searchedEntries
        .filter((entry) => matchesFilters(entry.card, filters))
        .sort((a, b) => compareEntries(a, b, sortKey, sortDir)),
    // searchedEntries est recréé à chaque rendu (nouveau tableau) mais son
    // contenu ne change que lorsque collection/npcResults/search changent :
    // on dépend directement de ces sources plutôt que de la référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, npcResults, search, character.is_npc, filters, sortKey, sortDir],
  );

  const addCard = async (cardId: string) => {
    if (busyCardId) return;
    setBusyCardId(cardId);
    setError(null);
    try {
      const { character: updated } = await api.addDeckCard(token, character.id, deckId, cardId, 1);
      onCharacterUpdate(character.id, { decks: updated.decks });
      loadDeck();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusyCardId(null);
    }
  };

  const removeCard = async (cardId: string) => {
    if (busyCardId) return;
    setBusyCardId(cardId);
    setError(null);
    try {
      const { character: updated } = await api.removeDeckCard(token, character.id, deckId, cardId, 1);
      onCharacterUpdate(character.id, { decks: updated.decks });
      loadDeck();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setBusyCardId(null);
    }
  };

  const sortDeckEntries = (entries: ApiDeckCardEntry[]) =>
    [...entries].sort((a, b) =>
      compareEntries({ card: a.card, releaseDate: null, acquiredOrder: null }, { card: b.card, releaseDate: null, acquiredOrder: null }, deckSortKey, deckSortDir),
    );
  const sortedMain = useMemo(() => (deck ? sortDeckEntries(deck.main) : []), [deck, deckSortKey, deckSortDir]);
  const sortedExtra = useMemo(() => (deck ? sortDeckEntries(deck.extra) : []), [deck, deckSortKey, deckSortDir]);

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const cardId = event.dataTransfer.getData('text/plain');
    if (cardId) void addCard(cardId);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('deckEditor.eyebrow')}</p>
          <h2 className="font-display text-xl text-accent-400">{deck?.name ?? '…'}</h2>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {deck && (
            <>
              <span className={deck.main_count >= deck.main_min && deck.main_count <= deck.main_max ? 'text-emerald-400' : 'text-accent-400'}>
                {t('deckEditor.main_count', { count: deck.main_count, min: deck.main_min, max: deck.main_max })}
              </span>
              <span className={deck.extra_count <= deck.extra_max ? 'text-emerald-400' : 'text-red-400'}>
                {t('deckEditor.extra_count', { count: deck.extra_count, max: deck.extra_max })}
              </span>
              {deck.is_valid && <span className="text-emerald-400">{t('deckEditor.legal')}</span>}
              <button
                type="button"
                onClick={() => downloadYdk(deck)}
                title={t('deckEditor.export_ydk_tooltip')}
                className="rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
              >
                {t('deckEditor.export_ydk')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('characterSheet.close')}
          </button>
        </div>
      </header>

      {error && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="w-64 shrink-0 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4">
          <CardPreview card={previewCard} />
        </aside>

        <main
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`min-w-0 flex-1 overflow-y-auto rounded-lg border-2 border-dashed p-4 transition-colors ${
            isDragOver ? 'border-accent-400 bg-arena-900/70' : 'border-arena-700 bg-arena-900/30'
          }`}
        >
          {loadingDeck && !deck && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
          {deck && (
            <>
              <div className="mb-3 flex items-center gap-1.5 text-xs">
                <span className="text-neutral-500">{t('deckEditor.sort_deck_label')}</span>
                <select
                  value={deckSortKey}
                  onChange={(e) => setDeckSortKey(e.target.value as SortKey)}
                  className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1 text-neutral-100 outline-none focus:border-accent-500"
                >
                  {DECK_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.label)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDeckSortDir((d) => (d === 1 ? -1 : 1))}
                  title={deckSortDir === 1 ? t('collectionBrowser.sort_asc_tooltip') : t('collectionBrowser.sort_desc_tooltip')}
                  className="rounded border border-arena-600 px-2 py-1 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
                >
                  {deckSortDir === 1 ? '↑' : '↓'}
                </button>
              </div>
              <DeckZone
                title={t('deckEditor.main_deck_title')}
                entries={sortedMain}
                onCardClick={setPreviewCard}
                onCardDoubleClick={(id) => void removeCard(id)}
                busyCardId={busyCardId}
              />
              <DeckZone
                title={t('deckEditor.extra_deck_title')}
                entries={sortedExtra}
                onCardClick={setPreviewCard}
                onCardDoubleClick={(id) => void removeCard(id)}
                busyCardId={busyCardId}
              />
            </>
          )}
          <p className="mt-4 text-center text-xs text-neutral-600">{t('deckEditor.drag_drop_help')}</p>
        </main>

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-arena-700 bg-arena-900 p-3">
          <input
            type="text"
            placeholder={character.is_npc ? t('deckEditor.search_placeholder_npc') : t('collectionBrowser.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 shrink-0 rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />

          <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-1.5 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
              title={sortDir === 1 ? t('collectionBrowser.sort_asc_tooltip') : t('collectionBrowser.sort_desc_tooltip')}
              className="rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
            >
              {sortDir === 1 ? '↑' : '↓'}
            </button>
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              className="flex items-center gap-1 rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
            >
              {t('collectionBrowser.filter_button')}
              {activeFilterCount(filters) > 0 && (
                <span className="rounded-full bg-accent-500 px-1.5 text-[10px] font-semibold text-arena-950">
                  {activeFilterCount(filters)}
                </span>
              )}
            </button>
            {activeFilterCount(filters) > 0 && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                title={t('deckEditor.reset_filters_tooltip')}
                className="rounded border border-arena-600 px-2 py-1.5 text-neutral-300 transition hover:border-red-400 hover:text-red-400"
              >
                {t('deckEditor.reset')}
              </button>
            )}
          </div>

          {character.is_npc && !loadingRight && (
            <p className="mb-2 shrink-0 text-xs text-neutral-500">
              {npcTotal === 0 ? t('deckEditor.no_cards_match_catalog') : t('deckEditor.cards_loaded', { loaded: npcResults.length, total: npcTotal })}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingRight && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
            {!loadingRight && searchedEntries.length === 0 && <p className="text-sm text-neutral-500">{t('deckEditor.no_cards')}</p>}
            {!loadingRight && searchedEntries.length > 0 && rightEntries.length === 0 && (
              <p className="text-sm text-neutral-500">{t('collectionBrowser.empty_filtered')}</p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {rightEntries.map((entry) => (
                <CollectionCard
                  key={entry.card.id}
                  entry={entry}
                  busy={busyCardId === entry.card.id}
                  onClick={() => setPreviewCard(entry.card)}
                  onDoubleClick={() => void addCard(entry.card.id)}
                />
              ))}
            </div>
            {character.is_npc && !loadingRight && npcResults.length < npcTotal && (
              <button
                type="button"
                onClick={loadMoreNpcCards}
                disabled={loadingMoreNpc}
                className="mt-3 w-full rounded-md border border-arena-600 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-50"
              >
                {loadingMoreNpc ? t('common.loading') : t('deckEditor.load_more_cards', { count: npcTotal - npcResults.length })}
              </button>
            )}
          </div>
        </aside>
      </div>

      {showFilterModal && (
        <CollectionFilterModal filters={filters} onChange={setFilters} onClose={() => setShowFilterModal(false)} availableRaces={availableRaces} />
      )}
    </div>,
    document.body,
  );
}

function CardPreview({ card }: { card: ApiCard | null }) {
  const { t, i18n } = useTranslation();
  if (!card) {
    return <p className="text-sm text-neutral-500">{t('cardPreview.empty')}</p>;
  }
  const image = card.card_images[0];
  const displayName = displayCardName(card, i18n.language);
  return (
    <div className="text-sm">
      {image && <img src={image.image_url} alt={displayName} className="mb-3 w-full rounded-lg shadow-lg" />}
      <h3 className="mb-1 font-display text-lg text-accent-400">{displayName}</h3>
      <p className="mb-2 text-neutral-400">
        {/* card.type reste en anglais brut pour l'instant (combinatoire trop
            large pour ce lot — voir le plan d'internationalisation) ; race et
            attribut, eux, ont une énumération bornée et sont traduits. */}
        {card.type}
        {card.race ? ` · ${translateRace(card.race, t)}` : ''}
        {card.attribute ? ` · ${translateAttribute(card.attribute, t)}` : ''}
      </p>
      {(card.atk !== null || card.def !== null || card.level_rank !== null) && (
        <p className="mb-2 text-neutral-300">
          {card.atk !== null && `ATK ${card.atk}`}
          {card.def !== null && ` / DEF ${card.def}`}
          {card.level_rank !== null && ` · ${t('cardPreview.level_rank', { level: card.level_rank })}`}
        </p>
      )}
      {card.pendulum_scale !== null && <p className="mb-2 text-neutral-300">{t('cardPreview.pendulum_scale', { scale: card.pendulum_scale })}</p>}
      <p className="whitespace-pre-wrap leading-relaxed text-neutral-300">{displayCardDescription(card, i18n.language)}</p>
    </div>
  );
}

function DeckZone({
  title,
  entries,
  onCardClick,
  onCardDoubleClick,
  busyCardId,
}: {
  title: string;
  entries: ApiDeckCardEntry[];
  onCardClick: (card: ApiCard) => void;
  onCardDoubleClick: (cardId: string) => void;
  busyCardId: string | null;
}) {
  const { t } = useTranslation();
  const count = entries.reduce((sum, e) => sum + e.quantity, 0);
  // Demande utilisateur : chaque exemplaire affiché côte à côte comme une
  // vraie carte séparée, plus juste une seule vignette avec un badge "×N".
  const copies = entries.flatMap((entry) =>
    Array.from({ length: entry.quantity }, (_, i) => ({ entry, copyIndex: i })),
  );
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-300">
        {title} <span className="text-neutral-500">({count})</span>
      </h3>
      {entries.length === 0 ? (
        <p className="text-xs text-neutral-600">{t('deckEditor.empty_zone')}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
          {copies.map(({ entry, copyIndex }) => (
            <button
              type="button"
              key={`${entry.card.id}-${copyIndex}`}
              onClick={() => onCardClick(entry.card)}
              onDoubleClick={() => onCardDoubleClick(entry.card.id)}
              disabled={busyCardId === entry.card.id}
              title={t('deckEditor.remove_copy_tooltip', { name: entry.card.name })}
              className="group relative disabled:opacity-50"
            >
              {entry.card.card_images[0] && (
                <img src={entry.card.card_images[0].image_url_small} alt={entry.card.name} className="w-full rounded" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCard({
  entry,
  busy,
  onClick,
  onDoubleClick,
}: {
  entry: BrowsableEntry;
  busy: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', entry.card.id)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={busy}
      title={t('deckEditor.add_card_tooltip', { name: entry.card.name })}
      className="group relative rounded border border-arena-700 transition hover:border-accent-500 disabled:opacity-50"
    >
      {entry.card.card_images[0] && (
        <img src={entry.card.card_images[0].image_url_small} alt={entry.card.name} className="w-full rounded" />
      )}
      {entry.quantity !== null && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-arena-950/90 px-1 text-[10px] text-neutral-300">
          ×{entry.quantity}
        </span>
      )}
    </button>
  );
}
