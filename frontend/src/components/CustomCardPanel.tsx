import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  api,
  ApiError,
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

  // Le MJ courant est le propriétaire de chaque carte listée ici (la liste
  // côté serveur est déjà filtrée sur owner_id === gm_id de ce salon) : pas
  // besoin de vérifier l'appartenance carte par carte pour afficher les actions.
  const existingBoosterSets = Array.from(
    new Map(cards.flatMap((c) => c.card_sets).map((s) => [s.set_code, s])).values(),
  );

  const handleDelete = async (cardId: string) => {
    try {
      await api.deleteCustomCard(token, cardId);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Cartes custom</h2>
        {isGm && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="text-xs text-accent-400 underline hover:text-accent-300"
          >
            {showCreate ? 'Annuler' : '+ Créer une carte'}
          </button>
        )}
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

      <div className="mt-1 space-y-2">
        {cards.map((card) => (
          <CustomCardRow
            key={card.id}
            token={token}
            card={card}
            isGm={isGm}
            existingBoosterSets={existingBoosterSets}
            onUpdated={(updated) => setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))}
            onDeleted={() => void handleDelete(card.id)}
            onError={setError}
          />
        ))}
      </div>
    </section>
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

function CustomCardRow({
  token,
  card,
  isGm,
  existingBoosterSets,
  onUpdated,
  onDeleted,
  onError,
}: {
  token: string;
  card: ApiCustomCard;
  isGm: boolean;
  existingBoosterSets: ApiCustomCard['card_sets'];
  onUpdated: (card: ApiCustomCard) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [showBoosterLink, setShowBoosterLink] = useState(false);

  const handleUnlink = async (setCode: string) => {
    try {
      const { card: updated } = await api.unlinkCustomCardFromBooster(token, card.id, setCode);
      onUpdated(updated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <article className="rounded-lg border border-arena-700 bg-arena-800 p-3 text-xs">
      <div className="flex flex-wrap items-start gap-2">
        {card.card_images[0] && (
          <img src={card.card_images[0].image_url_small} alt={card.name} className="h-16 w-auto rounded" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-accent-400">{card.name}</span>
            <span className="rounded bg-arena-900 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">custom</span>
            {card.created_in_this_session === false && (
              <span className="text-[10px] text-neutral-500">réutilisée d'une autre partie</span>
            )}
          </div>
          <div className="text-neutral-400">{cardSubtitle(card)}</div>
          <p className="mt-1 whitespace-pre-wrap text-neutral-300">{card.description}</p>
          {card.card_sets.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {card.card_sets.map((s) => (
                <span key={s.set_code} className="rounded bg-arena-900 px-1.5 py-0.5 text-[10px] text-neutral-400">
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
        </div>

        {isGm && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button type="button" onClick={() => setShowBoosterLink((v) => !v)} className="text-accent-400 underline hover:text-accent-300">
              {showBoosterLink ? 'Fermer' : 'Lier à un booster'}
            </button>
            <button type="button" onClick={onDeleted} className="text-red-400 hover:text-red-300">
              Supprimer
            </button>
          </div>
        )}
      </div>

      {showBoosterLink && isGm && (
        <BoosterLinkForm
          token={token}
          card={card}
          existingBoosterSets={existingBoosterSets}
          onLinked={(updated) => {
            onUpdated(updated);
            setShowBoosterLink(false);
          }}
          onError={onError}
        />
      )}
    </article>
  );
}

function BoosterLinkForm({
  token,
  card,
  existingBoosterSets,
  onLinked,
  onError,
}: {
  token: string;
  card: ApiCustomCard;
  existingBoosterSets: ApiCustomCard['card_sets'];
  onLinked: (card: ApiCustomCard) => void;
  onError: (message: string) => void;
}) {
  const linkedCodes = new Set(card.card_sets.map((s) => s.set_code));
  const linkableExisting = existingBoosterSets.filter((s) => !linkedCodes.has(s.set_code));

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

      const { card: created } = await api.createCustomCard(token, sessionId, card);
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
