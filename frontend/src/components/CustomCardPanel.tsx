import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  ApiError,
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

const MONSTER_KINDS: { value: MonsterKind; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'effect', label: 'Effet' },
  { value: 'ritual', label: 'Rituel' },
  { value: 'fusion', label: 'Fusion' },
  { value: 'synchro', label: 'Synchro' },
  { value: 'xyz', label: 'Xyz' },
  { value: 'link', label: 'Lien' },
];
const ATTRIBUTES: CardAttribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
const SPELL_TYPES: { value: SpellType; label: string }[] = [
  { value: 'normal', label: 'Normale' },
  { value: 'continuous', label: 'Continue' },
  { value: 'quick-play', label: 'Jeu Rapide' },
  { value: 'equip', label: 'Équipement' },
  { value: 'field', label: 'Terrain' },
  { value: 'ritual', label: 'Rituelle' },
];
const TRAP_TYPES: { value: TrapType; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'continuous', label: 'Continu' },
  { value: 'counter', label: 'Contre-piège' },
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
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
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
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const updateCard = (updated: ApiCustomCard) => setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Cartes custom</h2>
          <div className="flex shrink-0 items-center gap-3">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setDetailInitialId(cards[0]!.id)}
                className="text-xs text-accent-400 underline hover:text-accent-300"
              >
                Voir toutes les cartes custom
              </button>
            )}
            {isGm && (
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="text-xs text-accent-400 underline hover:text-accent-300"
              >
                {showCreate ? 'Annuler' : '+ Créer une carte'}
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
        {loading && <p className="text-xs text-neutral-500">Chargement...</p>}
        {!loading && cards.length === 0 && <p className="text-xs text-neutral-500">Aucune carte custom dans ce salon.</p>}

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
        cards={cards}
        boosters={boosters}
        loading={boostersLoading}
        onRefresh={loadBoosters}
        onCardUpdated={updateCard}
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
  cards,
  boosters,
  loading,
  onRefresh,
  onCardUpdated,
  onError,
}: {
  token: string;
  sessionId: string;
  isGm: boolean;
  cards: ApiCustomCard[];
  boosters: ApiCardSet[];
  loading: boolean;
  onRefresh: () => void;
  onCardUpdated: (card: ApiCustomCard) => void;
  onError: (message: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      await api.createCustomBooster(token, sessionId, newName);
      setNewName('');
      setShowCreate(false);
      onRefresh();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Boosters custom</h2>
        {isGm && (
          <button type="button" onClick={() => setShowCreate((v) => !v)} className="text-xs text-accent-400 underline hover:text-accent-300">
            {showCreate ? 'Annuler' : '+ Créer un booster'}
          </button>
        )}
      </header>

      {showCreate && isGm && (
        <form onSubmit={handleCreate} className="mb-3 flex gap-2">
          <input
            type="text"
            placeholder="Nom du booster"
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
            Créer
          </button>
        </form>
      )}

      {loading && <p className="text-xs text-neutral-500">Chargement...</p>}
      {!loading && boosters.length === 0 && (
        <p className="text-xs text-neutral-500">
          Aucun booster custom pour l'instant — créez-en un ici, ou depuis "Lier à un booster" sur une carte.
        </p>
      )}

      {/* Plafonné à ~10 boosters visibles, le reste défile (demande utilisateur). */}
      <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
        {boosters.map((booster) => (
          <CustomBoosterRow
            key={booster.set_code}
            token={token}
            booster={booster}
            isGm={isGm}
            cards={cards}
            onCardUpdated={onCardUpdated}
            onDeleted={onRefresh}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function CustomBoosterRow({
  token,
  booster,
  isGm,
  cards,
  onCardUpdated,
  onDeleted,
  onError,
}: {
  token: string;
  booster: ApiCardSet;
  isGm: boolean;
  cards: ApiCustomCard[];
  onCardUpdated: (card: ApiCustomCard) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingCardId, setAddingCardId] = useState('');
  const [rarity, setRarity] = useState<CustomCardRarity>('Common');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const cardsInBooster = cards.filter((c) => c.card_sets.some((s) => s.set_code === booster.set_code));
  const linkableCards = cards.filter((c) => !c.card_sets.some((s) => s.set_code === booster.set_code));

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!addingCardId) return;
    setSubmitting(true);
    try {
      const { card } = await api.linkCustomCardToBooster(token, addingCardId, { set_code: booster.set_code, rarity });
      onCardUpdated(card);
      setAddingCardId('');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteCustomBooster(token, booster.set_code);
      onDeleted();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleRemove = async (cardId: string) => {
    try {
      const { card } = await api.unlinkCustomCardFromBooster(token, cardId, booster.set_code);
      onCardUpdated(card);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <article className="rounded-lg border border-arena-700 bg-arena-800 p-3 text-xs">
      <div className="flex w-full items-center justify-between gap-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 truncate">
            <span className="font-semibold text-accent-400">{booster.set_name}</span>{' '}
            <span className="text-neutral-500">
              ({cardsInBooster.length} carte{cardsInBooster.length !== 1 ? 's' : ''})
            </span>
          </span>
          <span className="shrink-0 text-neutral-500">{expanded ? '▲' : '▼'}</span>
        </button>

        {isGm && (
          <div className="flex shrink-0 items-center gap-1">
            {confirmingDelete ? (
              <>
                <span className="text-neutral-400">Supprimer ?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="text-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  Confirmer
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="text-neutral-400 hover:text-neutral-300">
                  Annuler
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)} className="text-red-400 hover:text-red-300">
                Supprimer
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-arena-700 pt-2">
          {cardsInBooster.length === 0 && <p className="text-neutral-500">Aucune carte dans ce booster pour l'instant.</p>}
          {cardsInBooster.map((c) => {
            const entry = c.card_sets.find((s) => s.set_code === booster.set_code);
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded bg-arena-900 px-2 py-1">
                <span className="text-neutral-200">
                  {c.name} <span className="text-neutral-500">({entry?.set_rarity})</span>
                </span>
                {isGm && (
                  <button type="button" onClick={() => void handleRemove(c.id)} className="shrink-0 text-red-400 hover:text-red-300">
                    Retirer
                  </button>
                )}
              </div>
            );
          })}

          {isGm && linkableCards.length > 0 && (
            <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2 border-t border-arena-800 pt-2">
              <select
                value={addingCardId}
                onChange={(e) => setAddingCardId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100"
              >
                <option value="">Ajouter une carte...</option>
                {linkableCards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select value={rarity} onChange={(e) => setRarity(e.target.value as CustomCardRarity)} className="rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100">
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={submitting || !addingCardId}
                className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
              >
                Ajouter
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function cardSubtitle(card: ApiCustomCard): string {
  if (card.frame_type === 'spell' || card.frame_type === 'trap') {
    return `${card.race ?? ''} ${card.type}`.trim();
  }
  const parts: string[] = [card.type];
  if (card.frame_type === 'link') {
    parts.push(`Link ${card.level_rank ?? '?'}`, `ATK ${card.atk ?? '?'}`);
  } else {
    parts.push(`Niv./Rang ${card.level_rank ?? '?'}`, `ATK ${card.atk ?? '?'} / DEF ${card.def ?? '?'}`);
  }
  if (card.pendulum_scale !== null) parts.push(`Échelle ${card.pendulum_scale}`);
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
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">Cartes custom</p>
          <h2 className="font-display text-xl text-accent-400">Toutes les cartes custom</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
        >
          Fermer
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="w-72 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-3">
          {cards.length === 0 && <p className="text-xs text-neutral-500">Aucune carte custom dans ce salon.</p>}
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
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            Sélectionnez une carte à gauche pour l'afficher en détail.
          </div>
        ) : (
          <>
            <main className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4 text-sm">
              {selected.card_images[0] && (
                <img src={selected.card_images[0].image_url} alt={selected.name} className="mb-3 w-full max-w-xs rounded-lg shadow-lg" />
              )}
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg text-accent-400">{selected.name}</h3>
                <span className="rounded bg-arena-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">custom</span>
                {selected.created_in_this_session === false && (
                  <span className="text-[10px] text-neutral-500">réutilisée d'une autre partie</span>
                )}
              </div>
              <p className="mb-2 text-neutral-400">{cardSubtitle(selected)}</p>
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Actions</h3>
              {!isGm && <p className="text-neutral-500">Réservé au MJ.</p>}
              {isGm && (
                <>
                  <div>
                    <button type="button" onClick={() => setShowImageEdit((v) => !v)} className="text-accent-400 underline hover:text-accent-300">
                      {showImageEdit ? 'Fermer' : "Changer l'image"}
                    </button>
                    {showImageEdit && <ImageEditForm token={token} card={selected} onUpdated={onUpdated} onError={onError} />}
                  </div>

                  <div>
                    <button type="button" onClick={() => setShowBoosterLink((v) => !v)} className="text-accent-400 underline hover:text-accent-300">
                      {showBoosterLink ? 'Fermer' : 'Lier à un booster'}
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
                    Supprimer la carte
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
      onError(err instanceof ApiError ? err.message : "Échec de l'envoi de l'image");
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
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-wrap items-center gap-2 border-t border-arena-700 pt-2">
      <label className="flex items-center gap-2 text-neutral-400">
        Nouvelle image
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void handleFileChange(e)} className="text-neutral-300" />
      </label>
      {uploading && <span className="text-neutral-500">envoi...</span>}
      {imageUrl && <img src={imageUrl} alt="" className="h-10 w-auto rounded" />}
      <button
        type="submit"
        disabled={submitting || uploading || !imageUrl}
        className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        Enregistrer
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
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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
          Booster existant
        </button>
        <button
          type="button"
          onClick={() => setMode('new')}
          className={`rounded px-2 py-1 ${mode === 'new' ? 'bg-accent-500 text-arena-950' : 'border border-arena-600 text-neutral-300'}`}
        >
          Nouveau booster
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
          placeholder="Nom du nouveau booster"
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
        Lier
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
      onError(err instanceof ApiError ? err.message : "Échec de l'envoi de l'image");
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
      onError('Impossible de lire ce fichier');
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
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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
            {cat === 'monster' ? 'Monstre' : cat === 'spell' ? 'Magie' : 'Piège'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Nom de la carte"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <input
          type="text"
          placeholder="Archétype (optionnel)"
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          className={`min-w-0 flex-1 ${inputClass}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-neutral-400">
          Image
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void handleImageChange(e)} className="text-neutral-300" />
        </label>
        {uploading && <span className="text-neutral-500">envoi...</span>}
        {imageUrl && <img src={imageUrl} alt="" className="h-10 w-auto rounded" />}
      </div>

      {category === 'monster' && (
        <div className="space-y-2 rounded border border-arena-700 p-2">
          <div className="flex flex-wrap gap-2">
            <select value={monsterKind} onChange={(e) => setMonsterKind(e.target.value as MonsterKind)} className={inputClass}>
              {MONSTER_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
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
              placeholder="Type (ex. Dragon)"
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
                  Niveau/Rang
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
                Link Rating
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
              <p className="mb-1 text-neutral-400">Flèches Link</p>
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
                Pendule
              </label>
              {isPendulum && (
                <label className="flex items-center gap-1 text-neutral-400">
                  Échelle
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
          {SPELL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      )}

      {category === 'trap' && (
        <select value={trapType} onChange={(e) => setTrapType(e.target.value as TrapType)} className={inputClass}>
          {TRAP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      )}

      <textarea
        placeholder="Texte d'effet"
        value={effectText}
        onChange={(e) => setEffectText(e.target.value)}
        required
        rows={3}
        className={`w-full ${inputClass}`}
      />

      <div className="space-y-1 rounded border border-arena-700 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-neutral-400">
            Script Lua (.lua)
            <input type="file" accept=".lua,text/x-lua,text/plain" onChange={(e) => void handleLuaFileChange(e)} className="text-neutral-300" />
          </label>
          {luaFileName && <span className="text-neutral-500">{luaFileName} chargé</span>}
        </div>
        <textarea
          placeholder="function s.initial_effect(c) ... end — obligatoire, voir scrapi-book / CardScripts pour la syntaxe Project Ignis"
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
          Obligatoire — sans lui la carte ne peut pas tourner dans un vrai duel (pas de repli "vanille"). Importez un fichier .lua ci-dessus ou collez le
          script directement ; il doit définir <code>initial_effect</code> (convention Project Ignis).
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting || uploading}
        className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        Créer la carte
      </button>
    </form>
  );
}
