import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  api,
  ApiError,
  type ApiCard,
  type ApiCardSet,
  type ApiCustomCard,
  type CardAttribute,
  type CustomCardCategory,
  type CustomCardInput,
  type CustomCardRarity,
  type LinkArrow,
  type MonsterKind,
  type SpellType,
  type TrapType,
} from '../lib/api';
import { translateApiError } from '../lib/translateApiError';

// `label` : clé de traduction i18next, réutilise le même catalogue que
// cardFilters.ts (`cardFilters.monsterKind/spellType/trapType.*`) — texte
// identique, seules les `value` diffèrent (convention de création de carte
// custom, distincte du filtrage par `race` des cartes officielles).
const MONSTER_KINDS: { value: MonsterKind; label: string }[] = [
  { value: 'normal', label: 'cardFilters.monsterKind.normal' },
  { value: 'effect', label: 'cardFilters.monsterKind.effect' },
  { value: 'ritual', label: 'cardFilters.monsterKind.ritual' },
  { value: 'fusion', label: 'cardFilters.monsterKind.fusion' },
  { value: 'synchro', label: 'cardFilters.monsterKind.synchro' },
  { value: 'xyz', label: 'cardFilters.monsterKind.xyz' },
  { value: 'link', label: 'cardFilters.monsterKind.link' },
];
const ATTRIBUTES: CardAttribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
const SPELL_TYPES: { value: SpellType; label: string }[] = [
  { value: 'normal', label: 'cardFilters.spellType.normal' },
  { value: 'continuous', label: 'cardFilters.spellType.continuous' },
  { value: 'quick-play', label: 'cardFilters.spellType.quickPlay' },
  { value: 'equip', label: 'cardFilters.spellType.equip' },
  { value: 'field', label: 'cardFilters.spellType.field' },
  { value: 'ritual', label: 'cardFilters.spellType.ritual' },
];
const TRAP_TYPES: { value: TrapType; label: string }[] = [
  { value: 'normal', label: 'cardFilters.trapType.normal' },
  { value: 'continuous', label: 'cardFilters.trapType.continuous' },
  { value: 'counter', label: 'cardFilters.trapType.counter' },
];
const LINK_ARROWS: LinkArrow[] = ['top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const LINK_ARROW_SYMBOLS: Record<LinkArrow, string> = {
  'top-left': '↖',
  top: '↑',
  'top-right': '↗',
  left: '←',
  right: '→',
  'bottom-left': '↙',
  bottom: '↓',
  'bottom-right': '↘',
};
const RARITIES: CustomCardRarity[] = [
  'Common',
  'Rare',
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Ultimate Rare',
  'Ghost Rare',
  'Starlight Rare',
];

interface CustomCardPanelProps {
  token: string;
  sessionId: string;
  isGm: boolean;
}

export function CustomCardPanel({ token, sessionId, isGm }: CustomCardPanelProps) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<ApiCustomCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Overlay détaillé (demande utilisateur) : non-null = overlay ouvert, avec
  // la carte à présélectionner (celle cliquée dans la liste compacte, ou la
  // première du salon si ouvert via le bouton générique "voir toutes").
  const [detailInitialId, setDetailInitialId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listCustomCards(token, sessionId)
      .then(({ cards: fetched }) => {
        if (!cancelled) setCards(fetched);
      })
      .catch((err) => {
        if (!cancelled) setError(translateApiError(err, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, sessionId]);

  // Liste des boosters custom remontée ici (au lieu d'être re-dérivée /
  // re-fetchée séparément par CustomBoosterManager et par BoosterLinkForm) :
  // les deux interfaces de liaison (depuis une carte, ou depuis un booster)
  // écrivent la même donnée, elles doivent donc lire la même source et se
  // rafraîchir ensemble — sinon un booster créé/lié d'un côté reste invisible
  // de l'autre jusqu'au rechargement de la page.
  const [boosters, setBoosters] = useState<ApiCardSet[]>([]);
  const [boostersLoading, setBoostersLoading] = useState(false);

  const loadBoosters = useCallback(() => {
    setBoostersLoading(true);
    api
      .listCardSets(token, { include_custom: true })
      .then(({ sets }) => setBoosters(sets.filter((s) => s.is_custom)))
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setBoostersLoading(false));
  }, [token]);

  useEffect(() => {
    loadBoosters();
  }, [loadBoosters]);

  const handleDelete = async (cardId: string) => {
    try {
      await api.deleteCustomCard(token, cardId);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch (err) {
      setError(translateApiError(err, t));
    }
  };

  const updateCard = (updated: ApiCustomCard) => setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('customCards.title')}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setDetailInitialId(cards[0]!.id)}
                className="text-xs text-accent-400 underline hover:text-accent-300"
              >
                {t('customCards.view_all')}
              </button>
            )}
            {isGm && (
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="text-xs text-accent-400 underline hover:text-accent-300"
              >
                {showCreate ? t('duelBoard.cancel') : t('customCards.create_button')}
              </button>
            )}
          </div>
        </header>

        {showCreate && isGm && (
          <div className="mb-4">
            <CreateCustomCardForm
              token={token}
              sessionId={sessionId}
              onCreated={(card) => {
                setCards((prev) => [...prev, card]);
                setShowCreate(false);
              }}
              onError={setError}
            />
          </div>
        )}

        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        {loading && <p className="text-xs text-neutral-500">{t('common.loading')}</p>}
        {!loading && cards.length === 0 && <p className="text-xs text-neutral-500">{t('customCards.empty')}</p>}

        {/* Liste compacte (demande utilisateur) : nom + type seulement, plus
            de détail/actions inline — voir CustomCardDetailOverlay pour ça.
            Plafonnée à ~10 lignes visibles, le reste défile (même demande). */}
        <div className="mt-1 max-h-[22rem] space-y-1 overflow-y-auto pr-1">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setDetailInitialId(card.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-arena-700 bg-arena-800 px-2.5 py-1.5 text-left text-xs transition hover:border-accent-500"
            >
              <span className="min-w-0 truncate text-neutral-200">{card.name}</span>
              <span className="shrink-0 text-neutral-500">{card.type}</span>
            </button>
          ))}
        </div>
      </section>

      {detailInitialId !== undefined && (
        <CustomCardDetailOverlay
          token={token}
          cards={cards}
          isGm={isGm}
          boosters={boosters}
          initialCardId={detailInitialId}
          onBoosterLinked={loadBoosters}
          onUpdated={updateCard}
          onDeleted={(cardId) => void handleDelete(cardId)}
          onError={setError}
          onClose={() => setDetailInitialId(undefined)}
        />
      )}

      <CustomBoosterManager
        token={token}
        sessionId={sessionId}
        isGm={isGm}
        boosters={boosters}
        loading={boostersLoading}
        onRefresh={loadBoosters}
        onError={setError}
      />
    </div>
  );
}

/**
 * Un booster custom se crée D'ABORD (vide), puis se remplit en y ajoutant
 * des cartes custom existantes — l'inverse du flux "Lier à un booster" par
 * carte (toujours disponible, ci-dessus) qui, lui, ne peut naître qu'à
 * l'occasion de la première carte liée. Les deux écrivent dans la même
 * donnée (card_sets d'une Card + CardSet.is_custom), juste par des chemins
 * différents.
 */
function CustomBoosterManager({
  token,
  sessionId,
  isGm,
  boosters,
  loading,
  onRefresh,
  onError,
}: {
  token: string;
  sessionId: string;
  isGm: boolean;
  boosters: ApiCardSet[];
  loading: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Interface détaillée (demande utilisateur) : non-null = overlay ouvert sur
  // ce booster, avec visuel des cartes dedans / à ajouter, scindé officiel/custom.
  const [detailBoosterCode, setDetailBoosterCode] = useState<string | null>(null);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      await api.createCustomBooster(token, sessionId, newName);
      setNewName('');
      setShowCreate(false);
      onRefresh();
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setCreating(false);
    }
  };

  const detailBooster = boosters.find((b) => b.set_code === detailBoosterCode) ?? null;

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('customBooster.title')}</h2>
        {isGm && (
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="text-xs text-accent-400 underline hover:text-accent-300">
            {showCreate ? t('duelBoard.cancel') : t('customBooster.create_toggle')}
          </button>
        )}
      </header>

      {showCreate && isGm && (
        <form onSubmit={handleCreate} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder={t('customBooster.name_placeholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-xs text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-accent-500 px-3 py-2 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            {t('merchantPanel.create')}
          </button>
        </form>
      )}

      {loading && <p className="text-xs text-neutral-500">{t('common.loading')}</p>}
      {!loading && boosters.length === 0 && <p className="text-xs text-neutral-500">{t('customBooster.empty')}</p>}

      {/* Plafonné à ~10 boosters visibles, le reste défile (demande utilisateur). */}
      <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
        {boosters.map((booster) => (
          <CustomBoosterRow
            key={booster.set_code}
            token={token}
            booster={booster}
            isGm={isGm}
            onOpen={() => setDetailBoosterCode(booster.set_code)}
            onDeleted={onRefresh}
            onError={onError}
          />
        ))}
      </div>

      {detailBooster && (
        <CustomBoosterDetailOverlay
          token={token}
          booster={detailBooster}
          isGm={isGm}
          onDeleted={() => {
            setDetailBoosterCode(null);
            onRefresh();
          }}
          onError={onError}
          onClose={() => setDetailBoosterCode(null)}
        />
      )}
    </section>
  );
}

/** Ligne compacte (demande utilisateur, même idiome que les cartes custom) : nom + suppression seulement, le détail visuel vit dans CustomBoosterDetailOverlay. */
function CustomBoosterRow({
  token,
  booster,
  isGm,
  onOpen,
  onDeleted,
  onError,
}: {
  token: string;
  booster: ApiCardSet;
  isGm: boolean;
  onOpen: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteCustomBooster(token, booster.set_code);
      onDeleted();
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-arena-700 bg-arena-800 px-2.5 py-1.5 text-xs">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-neutral-200 hover:text-accent-400">
        {booster.set_name} <span className="text-neutral-500">({booster.set_code})</span>
      </button>
      {isGm && (
        <div className="flex shrink-0 items-center gap-1">
          {confirmingDelete ? (
            <>
              <span className="text-neutral-400">{t('customBooster.confirm_delete_question')}</span>
              <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="text-red-400 hover:text-red-300 disabled:opacity-50">
                {t('customBooster.confirm')}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="text-neutral-400 hover:text-neutral-300">
                {t('duelBoard.cancel')}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="text-red-400 hover:text-red-300">
              {t('merchantPanel.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Interface détaillée d'un booster custom (demande utilisateur) : visuel des
 * cartes déjà dedans ET de celles à ajouter, scindé officielles/custom dans
 * les deux cas. Contenu résolu en direct depuis le catalogue complet
 * (`GET /cards?set_code=`, même route que BoosterContentsPreview côté
 * marchand) — jamais dérivé d'une liste custom-only, qui ne pouvait de toute
 * façon jamais refléter les cartes officielles liées.
 */
function CustomBoosterDetailOverlay({
  token,
  booster,
  isGm,
  onDeleted,
  onError,
  onClose,
}: {
  token: string;
  booster: ApiCardSet;
  isGm: boolean;
  onDeleted: () => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cardsInBooster, setCardsInBooster] = useState<ApiCard[] | null>(null);
  const [loadingContents, setLoadingContents] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ApiCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [rarity, setRarity] = useState<CustomCardRarity>('Common');
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const loadContents = useCallback(() => {
    setLoadingContents(true);
    api
      .listCards(token, { set_code: booster.set_code, limit: 300 })
      .then(({ cards: fetched }) => setCardsInBooster(fetched))
      .catch((err) => onError(translateApiError(err, t)))
      .finally(() => setLoadingContents(false));
  }, [token, booster.set_code, onError]);

  useEffect(() => {
    loadContents();
  }, [loadContents]);

  // Recherche débounced dans le catalogue COMPLET (officielles + custom du
  // salon, GET /cards ne filtre pas is_custom) — ne tarit jamais, contrairement
  // à l'ancienne liste dérivée des seules cartes custom déjà créées.
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .listCards(token, { search, limit: 30 })
        .then(({ cards: fetched }) => setSearchResults(fetched))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [token, search]);

  const linkedIds = new Set((cardsInBooster ?? []).map((c) => c.id));
  const officialInBooster = (cardsInBooster ?? []).filter((c) => !c.is_custom);
  const customInBooster = (cardsInBooster ?? []).filter((c) => c.is_custom);
  const addableResults = searchResults.filter((c) => !linkedIds.has(c.id));
  const officialResults = addableResults.filter((c) => !c.is_custom);
  const customResults = addableResults.filter((c) => c.is_custom);

  const handleAdd = async (cardId: string) => {
    setAddingId(cardId);
    try {
      await api.linkCardToCustomBooster(token, booster.set_code, cardId, rarity);
      loadContents();
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (cardId: string) => {
    setRemovingId(cardId);
    try {
      await api.unlinkCardFromCustomBooster(token, booster.set_code, cardId);
      loadContents();
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setRemovingId(null);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteCustomBooster(token, booster.set_code);
      onDeleted();
    } catch (err) {
      onError(translateApiError(err, t));
      setDeleting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('customBoosterDetail.eyebrow')}</p>
          <h2 className="font-display text-xl text-accent-400">
            {booster.set_name} <span className="text-sm text-neutral-500">({booster.set_code})</span>
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isGm &&
            (confirmingDelete ? (
              <>
                <span className="text-sm text-neutral-400">{t('customBoosterDetail.confirm_delete_question')}</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="rounded-md border border-red-700 px-3 py-2 text-sm text-red-400 transition hover:bg-red-900/40 disabled:opacity-50"
                >
                  {t('customBooster.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-md border border-arena-600 px-3 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
                >
                  {t('duelBoard.cancel')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-800 px-3 py-2 text-sm text-red-400 transition hover:bg-red-900/30"
              >
                {t('customBoosterDetail.delete_booster')}
              </button>
            ))}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('characterSheet.close')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <main className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {t('customBoosterDetail.contents_title')} {cardsInBooster && `(${cardsInBooster.length})`}
          </h3>
          {loadingContents && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
          {!loadingContents && cardsInBooster && cardsInBooster.length === 0 && (
            <p className="text-sm text-neutral-500">{t('customBoosterDetail.empty_contents')}</p>
          )}
          {!loadingContents && officialInBooster.length > 0 && (
            <BoosterCardGrid title={t('customBoosterDetail.official_count', { count: officialInBooster.length })} cards={officialInBooster} booster={booster}>
              {(c) =>
                isGm && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(c.id)}
                    disabled={removingId === c.id}
                    className="absolute inset-x-0 bottom-0 bg-red-950/90 py-0.5 text-center text-[10px] text-red-300 opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                  >
                    {t('customBoosterDetail.remove')}
                  </button>
                )
              }
            </BoosterCardGrid>
          )}
          {!loadingContents && customInBooster.length > 0 && (
            <BoosterCardGrid title={t('customBoosterDetail.custom_count', { count: customInBooster.length })} cards={customInBooster} booster={booster}>
              {(c) =>
                isGm && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(c.id)}
                    disabled={removingId === c.id}
                    className="absolute inset-x-0 bottom-0 bg-red-950/90 py-0.5 text-center text-[10px] text-red-300 opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                  >
                    {t('customBoosterDetail.remove')}
                  </button>
                )
              }
            </BoosterCardGrid>
          )}
        </main>

        {isGm && (
          <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-arena-700 bg-arena-900 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('customBoosterDetail.add_cards_title')}</h3>
            <div className="mb-2 flex shrink-0 items-center gap-2 text-xs">
              <input
                type="text"
                placeholder={t('customBoosterDetail.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-2 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
              />
              <select value={rarity} onChange={(e) => setRarity(e.target.value as CustomCardRarity)} className="rounded border border-arena-600 bg-arena-800 px-2 py-1.5 text-neutral-100">
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!search.trim() && <p className="text-xs text-neutral-500">{t('customBoosterDetail.search_hint')}</p>}
              {searching && <p className="text-xs text-neutral-500">{t('customBoosterDetail.searching')}</p>}
              {!searching && search.trim() && addableResults.length === 0 && <p className="text-xs text-neutral-500">{t('grantCards.no_cards_found')}</p>}
              {!searching && officialResults.length > 0 && (
                <BoosterCardGrid title={t('customBoosterDetail.official_count', { count: officialResults.length })} cards={officialResults} compact>
                  {(c) => (
                    <button
                      type="button"
                      onClick={() => void handleAdd(c.id)}
                      disabled={addingId === c.id}
                      className="absolute inset-x-0 bottom-0 bg-emerald-950/90 py-0.5 text-center text-[10px] text-emerald-300 opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                    >
                      {addingId === c.id ? '...' : t('customBoosterDetail.add_short')}
                    </button>
                  )}
                </BoosterCardGrid>
              )}
              {!searching && customResults.length > 0 && (
                <BoosterCardGrid title={t('customBoosterDetail.custom_count', { count: customResults.length })} cards={customResults} compact>
                  {(c) => (
                    <button
                      type="button"
                      onClick={() => void handleAdd(c.id)}
                      disabled={addingId === c.id}
                      className="absolute inset-x-0 bottom-0 bg-emerald-950/90 py-0.5 text-center text-[10px] text-emerald-300 opacity-0 transition group-hover:opacity-100 disabled:opacity-50"
                    >
                      {addingId === c.id ? '...' : t('customBoosterDetail.add_short')}
                    </button>
                  )}
                </BoosterCardGrid>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Grille visuelle de cartes (image + nom), une section titrée à la fois — partagée entre le contenu du booster et les résultats de recherche. */
function BoosterCardGrid({
  title,
  cards,
  booster,
  compact,
  children,
}: {
  title: string;
  cards: ApiCard[];
  booster?: ApiCardSet;
  compact?: boolean;
  children: (card: ApiCard) => React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">{title}</p>
      <div className={`grid gap-2 ${compact ? 'grid-cols-[repeat(auto-fill,minmax(72px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(90px,1fr))]'}`}>
        {cards.map((c) => {
          const entry = booster ? c.card_sets.find((s) => s.set_code === booster.set_code) : undefined;
          return (
            <div key={c.id} className="group relative overflow-hidden rounded border border-arena-700 bg-arena-800">
              {c.card_images[0] ? (
                <img src={c.card_images[0].image_url_small} alt={c.name} title={c.name} className="w-full" />
              ) : (
                <div className="flex aspect-[59/86] w-full items-center justify-center p-1 text-center text-[9px] text-neutral-500">{c.name}</div>
              )}
              {entry && (
                <p className="truncate bg-arena-900/95 px-1 py-0.5 text-center text-[9px] text-neutral-400" title={c.name}>
                  {entry.set_rarity}
                </p>
              )}
              {children(c)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cardSubtitle(card: ApiCustomCard, t: TFunction): string {
  if (card.frame_type === 'spell' || card.frame_type === 'trap') {
    return `${card.race ?? ''} ${card.type}`.trim();
  }
  const parts: string[] = [card.type];
  if (card.frame_type === 'link') {
    parts.push(t('customCards.link_rating', { n: card.level_rank ?? '?' }), `ATK ${card.atk ?? '?'}`);
  } else {
    parts.push(t('cardPreview.level_rank', { level: card.level_rank ?? '?' }), `ATK ${card.atk ?? '?'} / DEF ${card.def ?? '?'}`);
  }
  if (card.pendulum_scale !== null) parts.push(t('cardPreview.pendulum_scale', { scale: card.pendulum_scale }));
  return parts.join(' · ');
}

/**
 * Interface détaillée "voir toutes les cartes custom" (demande utilisateur) :
 * liste complète à gauche (cliquable), et pour la carte sélectionnée l'image
 * en grand à gauche du panneau principal, les actions à droite — remplace
 * l'ancien affichage (image+description+actions inline dans chaque ligne de
 * la liste principale, désormais compacte, voir CustomCardPanel ci-dessus).
 */
function CustomCardDetailOverlay({
  token,
  cards,
  isGm,
  boosters,
  initialCardId,
  onBoosterLinked,
  onUpdated,
  onDeleted,
  onError,
  onClose,
}: {
  token: string;
  cards: ApiCustomCard[];
  isGm: boolean;
  boosters: ApiCardSet[];
  initialCardId: string | null;
  onBoosterLinked: () => void;
  onUpdated: (card: ApiCustomCard) => void;
  onDeleted: (cardId: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(initialCardId);
  const [showBoosterLink, setShowBoosterLink] = useState(false);
  const [showImageEdit, setShowImageEdit] = useState(false);

  const selected = cards.find((c) => c.id === selectedId) ?? null;

  const handleUnlink = async (setCode: string) => {
    if (!selected) return;
    try {
      const { card: updated } = await api.unlinkCustomCardFromBooster(token, selected.id, setCode);
      onUpdated(updated);
    } catch (err) {
      onError(translateApiError(err, t));
    }
  };

  const selectCard = (id: string) => {
    setSelectedId(id);
    setShowBoosterLink(false);
    setShowImageEdit(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('customCards.title')}</p>
          <h2 className="font-display text-xl text-accent-400">{t('customCardDetail.title')}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
        >
          {t('characterSheet.close')}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="w-72 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-3">
          {cards.length === 0 && <p className="text-xs text-neutral-500">{t('customCards.empty')}</p>}
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => selectCard(card.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                selectedId === card.id ? 'border-accent-500 bg-arena-800' : 'border-arena-700 bg-arena-800/60 hover:border-accent-500'
              }`}
            >
              <span className="min-w-0 truncate text-neutral-200">{card.name}</span>
              <span className="shrink-0 text-neutral-500">{card.type}</span>
            </button>
          ))}
        </aside>

        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">{t('customCardDetail.select_prompt')}</div>
        ) : (
          <>
            <main className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4 text-sm">
              {selected.card_images[0] && (
                <img src={selected.card_images[0].image_url} alt={selected.name} className="mb-3 w-full max-w-xs rounded-lg shadow-lg" />
              )}
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg text-accent-400">{selected.name}</h3>
                <span className="rounded bg-arena-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">{t('customCardDetail.custom_badge')}</span>
                {selected.created_in_this_session === false && (
                  <span className="text-[10px] text-neutral-500">{t('customCardDetail.reused_note')}</span>
                )}
              </div>
              <p className="mb-2 text-neutral-400">{cardSubtitle(selected, t)}</p>
              <p className="whitespace-pre-wrap leading-relaxed text-neutral-300">{selected.description}</p>
              {selected.card_sets.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {selected.card_sets.map((s) => (
                    <span key={s.set_code} className="rounded bg-arena-800 px-1.5 py-0.5 text-xs text-neutral-400">
                      {s.set_name} ({s.set_rarity}){' '}
                      {isGm && (
                        <button type="button" onClick={() => void handleUnlink(s.set_code)} className="ml-1 text-red-400 hover:text-red-300">
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </main>

            <aside className="w-80 shrink-0 space-y-3 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-3 text-xs">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('customCardDetail.actions_title')}</h3>
              {!isGm && <p className="text-neutral-500">{t('customCardDetail.gm_only')}</p>}
              {isGm && (
                <>
                  <div>
                    <button type="button" onClick={() => setShowImageEdit((v) => !v)} className="text-accent-400 underline hover:text-accent-300">
                      {showImageEdit ? t('characterSheet.close') : t('customCardDetail.change_image')}
                    </button>
                    {showImageEdit && <ImageEditForm token={token} card={selected} onUpdated={onUpdated} onError={onError} />}
                  </div>

                  <div>
                    <button type="button" onClick={() => setShowBoosterLink((v) => !v)} className="text-accent-400 underline hover:text-accent-300">
                      {showBoosterLink ? t('characterSheet.close') : t('customCardDetail.link_to_booster')}
                    </button>
                    {showBoosterLink && (
                      <BoosterLinkForm
                        token={token}
                        card={selected}
                        boosters={boosters}
                        onLinked={(updated) => {
                          onUpdated(updated);
                          onBoosterLinked();
                          setShowBoosterLink(false);
                        }}
                        onError={onError}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const id = selected.id;
                      setSelectedId((current) => (current === id ? cards.find((c) => c.id !== id)?.id ?? null : current));
                      onDeleted(id);
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    {t('customCardDetail.delete_card')}
                  </button>
                </>
              )}
            </aside>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ImageEditForm({
  token,
  card,
  onUpdated,
  onError,
}: {
  token: string;
  card: ApiCustomCard;
  onUpdated: (card: ApiCustomCard) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState(card.card_images[0]?.image_url ?? '');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadCardImage(token, file);
      setImageUrl(url);
    } catch (err) {
      onError(err instanceof ApiError ? translateApiError(err, t) : t('imageEditForm.upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { card: updated } = await api.updateCustomCardImage(token, card.id, imageUrl);
      onUpdated(updated);
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-center gap-2 border-t border-arena-700 pt-2">
      <label className="flex items-center gap-2 text-neutral-400">
        {t('imageEditForm.new_image_label')}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void handleFileChange(e)} className="text-neutral-300" />
      </label>
      {uploading && <span className="text-neutral-500">{t('imageEditForm.uploading')}</span>}
      {imageUrl && <img src={imageUrl} alt="" className="h-10 w-auto rounded" />}
      <button
        type="submit"
        disabled={submitting || uploading || !imageUrl}
        className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        {t('imageEditForm.save')}
      </button>
    </form>
  );
}

function BoosterLinkForm({
  token,
  card,
  boosters,
  onLinked,
  onError,
}: {
  token: string;
  card: ApiCustomCard;
  boosters: ApiCardSet[];
  onLinked: (card: ApiCustomCard) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const linkedCodes = new Set(card.card_sets.map((s) => s.set_code));
  const linkableExisting = boosters.filter((s) => !linkedCodes.has(s.set_code));

  const [mode, setMode] = useState<'existing' | 'new'>(linkableExisting.length > 0 ? 'existing' : 'new');
  const [setCode, setSetCode] = useState(linkableExisting[0]?.set_code ?? '');
  const [newSetName, setNewSetName] = useState('');
  const [rarity, setRarity] = useState<CustomCardRarity>('Common');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { card: updated } = await api.linkCustomCardToBooster(token, card.id, {
        set_code: mode === 'existing' ? setCode : undefined,
        new_set_name: mode === 'new' ? newSetName : undefined,
        rarity,
      });
      onLinked(updated);
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-center gap-2 border-t border-arena-700 pt-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode('existing')}
          disabled={linkableExisting.length === 0}
          className={`rounded px-2 py-1 ${mode === 'existing' ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'} disabled:opacity-40`}
        >
          {t('boosterLinkForm.existing_booster')}
        </button>
        <button
          type="button"
          onClick={() => setMode('new')}
          className={`rounded px-2 py-1 ${mode === 'new' ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'}`}
        >
          {t('boosterLinkForm.new_booster')}
        </button>
      </div>

      {mode === 'existing' ? (
        <select
          value={setCode}
          onChange={(e) => setSetCode(e.target.value)}
          className="rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100"
        >
          {linkableExisting.map((s) => (
            <option key={s.set_code} value={s.set_code}>
              {s.set_name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          placeholder={t('boosterLinkForm.new_booster_name_placeholder')}
          value={newSetName}
          onChange={(e) => setNewSetName(e.target.value)}
          required
          className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100"
        />
      )}

      <select
        value={rarity}
        onChange={(e) => setRarity(e.target.value as CustomCardRarity)}
        className="rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100"
      >
        {RARITIES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={submitting || (mode === 'existing' && !setCode)}
        className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        {t('boosterLinkForm.link')}
      </button>
    </form>
  );
}

function CreateCustomCardForm({
  token,
  sessionId,
  onCreated,
  onError,
}: {
  token: string;
  sessionId: string;
  onCreated: (card: ApiCustomCard) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<CustomCardCategory>('monster');
  const [name, setName] = useState('');
  const [effectText, setEffectText] = useState('');
  const [archetype, setArchetype] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  // Script Lua réel obligatoire (CLAUDE.md §3.4) : sans lui, la carte ne
  // peut pas tourner dans un vrai duel (voir customCard.routes.ts, jamais de
  // repli "vanille"). Fournissable en collant le texte directement, ou en
  // important un fichier .lua (son contenu remplit le même champ).
  const [luaScript, setLuaScript] = useState('');
  const [luaFileName, setLuaFileName] = useState<string | null>(null);

  const [monsterKind, setMonsterKind] = useState<MonsterKind>('normal');
  const [attribute, setAttribute] = useState<CardAttribute>('DARK');
  const [race, setRace] = useState('');
  const [atk, setAtk] = useState(0);
  const [def, setDef] = useState(0);
  const [levelRank, setLevelRank] = useState(4);
  const [linkRating, setLinkRating] = useState(1);
  const [linkArrows, setLinkArrows] = useState<LinkArrow[]>([]);
  const [isPendulum, setIsPendulum] = useState(false);
  const [pendulumScale, setPendulumScale] = useState(1);

  const [spellType, setSpellType] = useState<SpellType>('normal');
  const [trapType, setTrapType] = useState<TrapType>('normal');

  const [submitting, setSubmitting] = useState(false);

  const isLink = monsterKind === 'link';

  const handleImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadCardImage(token, file);
      setImageUrl(url);
    } catch (err) {
      onError(err instanceof ApiError ? translateApiError(err, t) : t('imageEditForm.upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  // Lit le fichier .lua choisi directement dans le navigateur (pas d'envoi
  // au serveur ici : le script part avec le reste du formulaire à la
  // soumission, comme s'il avait été tapé/collé dans le champ).
  const handleLuaFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setLuaScript(text);
      setLuaFileName(file.name);
    } catch {
      onError(t('createCustomCard.lua_read_error'));
    } finally {
      event.target.value = ''; // permet de resélectionner le même fichier après une modif manuelle
    }
  };

  const toggleLinkArrow = (arrow: LinkArrow) => {
    setLinkArrows((prev) => (prev.includes(arrow) ? prev.filter((a) => a !== arrow) : [...prev, arrow]));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const common = { name, effect_text: effectText, image_url: imageUrl || undefined, archetype: archetype || undefined };
      let card: CustomCardInput;
      if (category === 'monster') {
        card = {
          category: 'monster',
          monster_kind: monsterKind,
          is_pendulum: isPendulum,
          attribute,
          race,
          atk,
          def: isLink ? undefined : def,
          level_rank: isLink ? undefined : levelRank,
          link_rating: isLink ? linkRating : undefined,
          link_arrows: isLink ? linkArrows : undefined,
          pendulum_scale: isPendulum ? pendulumScale : undefined,
          ...common,
        };
      } else if (category === 'spell') {
        card = { category: 'spell', spell_type: spellType, ...common };
      } else {
        card = { category: 'trap', trap_type: trapType, ...common };
      }

      const { card: created } = await api.createCustomCard(token, sessionId, card, luaScript);
      onCreated(created);
    } catch (err) {
      onError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-accent-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-arena-600 bg-arena-900 p-3 text-xs">
      <div className="flex gap-1">
        {(['monster', 'spell', 'trap'] as CustomCardCategory[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded px-2 py-1 ${category === cat ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'}`}
          >
            {cat === 'monster' ? t('cardFilters.category.monster') : cat === 'spell' ? t('cardFilters.category.spell') : t('cardFilters.category.trap')}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder={t('createCustomCard.name_placeholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <input
          type="text"
          placeholder={t('createCustomCard.archetype_placeholder')}
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          className={`min-w-0 flex-1 ${inputClass}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-neutral-400">
          {t('createCustomCard.image_label')}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void handleImageChange(e)} className="text-neutral-300" />
        </label>
        {uploading && <span className="text-neutral-500">{t('imageEditForm.uploading')}</span>}
        {imageUrl && <img src={imageUrl} alt="" className="h-10 w-auto rounded" />}
      </div>

      {category === 'monster' && (
        <div className="space-y-2 rounded border border-arena-700 p-2">
          <div className="flex flex-wrap gap-2">
            <select value={monsterKind} onChange={(e) => setMonsterKind(e.target.value as MonsterKind)} className={inputClass}>
              {MONSTER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {t(k.label)}
                </option>
              ))}
            </select>
            <select value={attribute} onChange={(e) => setAttribute(e.target.value as CardAttribute)} className={inputClass}>
              {ATTRIBUTES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t('createCustomCard.type_placeholder')}
              value={race}
              onChange={(e) => setRace(e.target.value)}
              required
              className={`min-w-0 flex-1 ${inputClass}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-neutral-400">
              ATK
              <input type="number" min={0} value={atk} onChange={(e) => setAtk(Number(e.target.value))} className={`w-20 ${inputClass}`} />
            </label>
            {!isLink && (
              <>
                <label className="flex items-center gap-1 text-neutral-400">
                  DEF
                  <input type="number" min={0} value={def} onChange={(e) => setDef(Number(e.target.value))} className={`w-20 ${inputClass}`} />
                </label>
                <label className="flex items-center gap-1 text-neutral-400">
                  {t('createCustomCard.level_rank_label')}
                  <input
                    type="number"
                    min={0}
                    max={13}
                    value={levelRank}
                    onChange={(e) => setLevelRank(Number(e.target.value))}
                    className={`w-16 ${inputClass}`}
                  />
                </label>
              </>
            )}
            {isLink && (
              <label className="flex items-center gap-1 text-neutral-400">
                {t('createCustomCard.link_rating_label')}
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={linkRating}
                  onChange={(e) => setLinkRating(Number(e.target.value))}
                  className={`w-16 ${inputClass}`}
                />
              </label>
            )}
          </div>

          {isLink && (
            <div>
              <p className="mb-1 text-neutral-400">{t('createCustomCard.link_arrows_label')}</p>
              <div className="grid w-32 grid-cols-3 gap-1 text-center">
                {LINK_ARROWS.map((arrow) => (
                  <button
                    key={arrow}
                    type="button"
                    onClick={() => toggleLinkArrow(arrow)}
                    className={`rounded border px-2 py-1 ${
                      linkArrows.includes(arrow) ? 'border-accent-500 bg-accent-500 text-arena-950' : 'border-arena-600 text-neutral-300'
                    }`}
                  >
                    {LINK_ARROW_SYMBOLS[arrow]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isLink && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-neutral-400">
                <input type="checkbox" checked={isPendulum} onChange={(e) => setIsPendulum(e.target.checked)} />
                {t('createCustomCard.pendulum_label')}
              </label>
              {isPendulum && (
                <label className="flex items-center gap-1 text-neutral-400">
                  {t('createCustomCard.pendulum_scale_label')}
                  <input
                    type="number"
                    min={0}
                    max={13}
                    value={pendulumScale}
                    onChange={(e) => setPendulumScale(Number(e.target.value))}
                    className={`w-16 ${inputClass}`}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {category === 'spell' && (
        <select value={spellType} onChange={(e) => setSpellType(e.target.value as SpellType)} className={inputClass}>
          {SPELL_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.label)}
            </option>
          ))}
        </select>
      )}

      {category === 'trap' && (
        <select value={trapType} onChange={(e) => setTrapType(e.target.value as TrapType)} className={inputClass}>
          {TRAP_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.label)}
            </option>
          ))}
        </select>
      )}

      <textarea
        placeholder={t('createCustomCard.effect_text_placeholder')}
        value={effectText}
        onChange={(e) => setEffectText(e.target.value)}
        required
        rows={3}
        className={`w-full ${inputClass}`}
      />

      <div className="space-y-1 rounded border border-arena-700 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-neutral-400">
            {t('createCustomCard.lua_script_label')}
            <input type="file" accept=".lua,text/x-lua,text/plain" onChange={(e) => void handleLuaFileChange(e)} className="text-neutral-300" />
          </label>
          {luaFileName && <span className="text-neutral-500">{t('createCustomCard.lua_file_loaded', { name: luaFileName })}</span>}
        </div>
        <textarea
          placeholder={t('createCustomCard.lua_placeholder')}
          value={luaScript}
          onChange={(e) => {
            setLuaScript(e.target.value);
            setLuaFileName(null); // édité à la main : le nom de fichier affiché n'a plus de sens
          }}
          required
          rows={8}
          spellCheck={false}
          className={`w-full font-mono ${inputClass}`}
        />
        <p className="text-[10px] leading-snug text-neutral-500">
          {t('createCustomCard.lua_help_before')} <code>initial_effect</code> {t('createCustomCard.lua_help_after')}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting || uploading}
        className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        {t('createCustomCard.create_card_button')}
      </button>
    </form>
  );
}
