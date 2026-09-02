import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api, type ApiCharacter, type ApiCollectionEntry, type ApiOpenedCard, type ApiSealedBooster } from '../lib/api';
import { STAT_LABELS, STAT_NAMES, abilityModifier, effectiveStat } from '../lib/pointBuy';
import { translateAttribute, translateRace } from '../lib/cardLabels';
import { displayCardName, displayCardDescription } from '../lib/cardTranslation';
import { translateApiError } from '../lib/translateApiError';
import {
  EMPTY_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  cardCategory,
  compareEntries,
  matchesFilters,
  type CollectionFilters,
  type SortKey,
} from '../lib/cardFilters';
import { CollectionFilterModal } from './CollectionFilterModal';
import { DeckManager } from './DeckManager';
import { BoosterOpeningOverlay } from './BoosterOpeningOverlay';
import { MoneyEditor } from './CharacterList';

type CharacterUpdatePatch = Partial<
  Pick<
    ApiCharacter,
    'money' | 'collection' | 'sealed_boosters' | 'decks' | 'name' | 'backstory' | 'personality' | 'visual_description' | 'notes' | 'gm_notes' | 'inventory'
  >
>;

interface CharacterSheetOverlayProps {
  token: string;
  character: ApiCharacter;
  currentUserId: string;
  isGm: boolean;
  currencyName: string;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
  onClose: () => void;
}

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}

/**
 * Fiche de personnage stylisée (demande utilisateur — bouton toujours
 * visible pour le joueur + interface complète). Deux onglets : "Fiche"
 * (identité, stats mises en valeur, RP, inventaire, économie) et
 * "Collection" (grille filtrable avec la carte sélectionnée en grand à
 * gauche — même idiome que DeckEditorOverlay). Remplace l'ancien néant :
 * backstory/personality/visual_description/inventory n'avaient jusqu'ici
 * aucun affichage ni édition après la création du personnage.
 */
export function CharacterSheetOverlay({ token, character, currentUserId, isGm, currencyName, onCharacterUpdate, onClose }: CharacterSheetOverlayProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'fiche' | 'collection'>('fiche');
  const canManage = isGm || character.user_id === currentUserId;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('characterSheet.eyebrow')}</p>
          <h2 className="font-display text-2xl text-accent-400">
            {character.name}
            {character.is_npc && <span className="ml-2 align-middle text-xs uppercase text-neutral-500">{t('characterSheet.npc_badge')}</span>}
          </h2>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex gap-1 rounded-md border border-arena-700 bg-arena-900 p-1 text-sm">
            <button
              type="button"
              onClick={() => setTab('fiche')}
              className={`rounded px-3 py-1.5 transition ${tab === 'fiche' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300 hover:text-accent-400'}`}
            >
              {t('characterSheet.tab_sheet')}
            </button>
            <button
              type="button"
              onClick={() => setTab('collection')}
              className={`rounded px-3 py-1.5 transition ${tab === 'collection' ? 'bg-accent-500 text-arena-950' : 'text-neutral-300 hover:text-accent-400'}`}
            >
              {t('characterSheet.tab_collection')}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'fiche' ? (
          <FicheTab
            token={token}
            character={character}
            isGm={isGm}
            canManage={canManage}
            currencyName={currencyName}
            onCharacterUpdate={onCharacterUpdate}
          />
        ) : (
          <CollectionTab token={token} character={character} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function FicheTab({
  token,
  character,
  isGm,
  canManage,
  currencyName,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  isGm: boolean;
  canManage: boolean;
  currencyName: string;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <StatsPanel character={character} />
        <RpPanel token={token} character={character} canManage={canManage} onCharacterUpdate={onCharacterUpdate} />
        <NotesPanel token={token} character={character} canManage={canManage} onCharacterUpdate={onCharacterUpdate} />
        {isGm && <GmNotesPanel token={token} character={character} onCharacterUpdate={onCharacterUpdate} />}
        <InventoryPanel token={token} character={character} canManage={canManage} onCharacterUpdate={onCharacterUpdate} />
      </div>
      <div className="space-y-4">
        <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.economy')}</h3>
          <p className="mb-2 text-sm text-neutral-300">
            {t('characterSheet.level_money', { level: character.level })}{' '}
            <span className="font-semibold text-accent-400">
              {character.money} {currencyName}
            </span>
          </p>
          {isGm && <MoneyEditor token={token} character={character} currencyName={currencyName} onCharacterUpdate={onCharacterUpdate} />}
        </section>

        {canManage && <BoostersPanel token={token} character={character} onCharacterUpdate={onCharacterUpdate} />}

        {canManage && (
          <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('deckManager.title')}</h3>
            <DeckManager token={token} character={character} isGm={isGm} onCharacterUpdate={onCharacterUpdate} />
          </section>
        )}
      </div>
    </div>
  );
}

function StatsPanel({ character }: { character: ApiCharacter }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.statistics')}</h3>
      <div className="grid grid-cols-5 gap-2">
        {STAT_NAMES.map((stat) => {
          const modifier = abilityModifier(effectiveStat(character.stats[stat], character.level));
          return (
            <div key={stat} className="rounded-lg border border-arena-700 bg-arena-800 py-3 text-center">
              <div className="text-[10px] uppercase tracking-wide text-neutral-500">{t(STAT_LABELS[stat])}</div>
              <div className="font-display text-2xl text-neutral-100">{character.stats[stat]}</div>
              <div className="text-xs text-accent-400">{formatModifier(modifier)}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-500">{t('characterSheet.luck_rerolls_remaining', { count: character.remaining_luck_rerolls })}</p>
    </section>
  );
}

function RpPanel({
  token,
  character,
  canManage,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  canManage: boolean;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [backstory, setBackstory] = useState(character.backstory);
  const [personality, setPersonality] = useState(character.personality);
  const [visualDescription, setVisualDescription] = useState(character.visual_description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setBackstory(character.backstory);
    setPersonality(character.personality);
    setVisualDescription(character.visual_description);
    setError(null);
    setEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { character: updated } = await api.updateCharacterProfile(token, character.id, {
        backstory,
        personality,
        visual_description: visualDescription,
      });
      onCharacterUpdate(character.id, {
        backstory: updated.backstory,
        personality: updated.personality,
        visual_description: updated.visual_description,
      });
      setEditing(false);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const fields: { label: string; value: string }[] = [
    { label: t('characterForm.placeholder_backstory'), value: character.backstory },
    { label: t('characterForm.placeholder_personality'), value: character.personality },
    { label: t('characterForm.placeholder_visual_description'), value: character.visual_description },
  ];

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.roleplay')}</h3>
        {canManage && !editing && (
          <button type="button" onClick={startEditing} className="text-xs text-accent-400 underline hover:text-accent-300">
            {t('characterSheet.edit')}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.label} className="rounded-lg border border-arena-700 bg-arena-800 p-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">{f.label}</div>
              <p className="whitespace-pre-wrap text-sm text-neutral-300">{f.value || '—'}</p>
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <textarea
              placeholder={t('characterForm.placeholder_backstory')}
              value={backstory}
              onChange={(e) => setBackstory(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
            />
            <textarea
              placeholder={t('characterForm.placeholder_personality')}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
            />
            <textarea
              placeholder={t('characterForm.placeholder_visual_description')}
              value={visualDescription}
              onChange={(e) => setVisualDescription(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
            >
              {t('characterSheet.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
            >
              {t('characterSheet.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Bloc libre pour noter des informations importantes en cours de partie
 * (demande utilisateur) — distinct du bloc RP ci-dessus (backstory/
 * personnalité/description visuelle, plutôt figés à la création) : pensé
 * pour être modifié souvent, sans repasser par tout le formulaire RP.
 */
function NotesPanel({
  token,
  character,
  canManage,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  canManage: boolean;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(character.notes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setNotes(character.notes);
    setError(null);
    setEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { character: updated } = await api.updateCharacterProfile(token, character.id, { notes });
      onCharacterUpdate(character.id, { notes: updated.notes });
      setEditing(false);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.notes')}</h3>
        {canManage && !editing && (
          <button type="button" onClick={startEditing} className="text-xs text-accent-400 underline hover:text-accent-300">
            {t('characterSheet.edit')}
          </button>
        )}
      </div>

      {!editing ? (
        <p className="whitespace-pre-wrap text-sm text-neutral-300">{character.notes || '—'}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-2">
          <textarea
            placeholder={t('characterSheet.notes_placeholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
            >
              {t('characterSheet.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
            >
              {t('characterSheet.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Bloc SÉPARÉ du bloc "Notes" ci-dessus (demande utilisateur, tranchée via
 * AskUserQuestion) : réservé au MJ, jamais exposé au propriétaire du
 * personnage — même pour son propre personnage joueur. Ce composant n'est
 * monté du tout que quand `isGm` (voir FicheTab), donc pas de garde
 * `canManage` séparée ici : tout visiteur qui atteint ce composant est déjà
 * le MJ, avec droit de lecture ET d'écriture.
 */
function GmNotesPanel({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [gmNotes, setGmNotes] = useState(character.gm_notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setGmNotes(character.gm_notes ?? '');
    setError(null);
    setEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { character: updated } = await api.updateCharacterProfile(token, character.id, { gm_notes: gmNotes });
      onCharacterUpdate(character.id, { gm_notes: updated.gm_notes });
      setEditing(false);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-amber-700/60 bg-arena-900 p-4 shadow-lg">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">{t('characterSheet.gm_notes_title')}</h3>
        {!editing && (
          <button type="button" onClick={startEditing} className="text-xs text-accent-400 underline hover:text-accent-300">
            {t('characterSheet.edit')}
          </button>
        )}
      </div>
      <p className="mb-2 text-[11px] text-neutral-500">{t('characterSheet.gm_notes_hint')}</p>

      {!editing ? (
        <p className="whitespace-pre-wrap text-sm text-neutral-300">{character.gm_notes || '—'}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-2">
          <textarea
            placeholder={t('characterSheet.gm_notes_placeholder')}
            value={gmNotes}
            onChange={(e) => setGmNotes(e.target.value)}
            rows={5}
            className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
            >
              {t('characterSheet.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-arena-600 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
            >
              {t('characterSheet.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function InventoryPanel({
  token,
  character,
  canManage,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  canManage: boolean;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  const [newItem, setNewItem] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveInventory = async (inventory: string[]) => {
    setSubmitting(true);
    setError(null);
    try {
      const { character: updated } = await api.updateCharacterProfile(token, character.id, { inventory });
      onCharacterUpdate(character.id, { inventory: updated.inventory });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!newItem.trim()) return;
    void saveInventory([...character.inventory, newItem.trim()]);
    setNewItem('');
  };

  const handleRemove = (index: number) => {
    void saveInventory(character.inventory.filter((_, i) => i !== index));
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.inventory')}</h3>
      {character.inventory.length === 0 && <p className="text-sm text-neutral-500">{t('characterSheet.inventory_empty')}</p>}
      {character.inventory.length > 0 && (
        <ul className="mb-2 space-y-1">
          {character.inventory.map((item, index) => (
            <li key={index} className="flex items-center justify-between gap-2 rounded-md border border-arena-700 bg-arena-800 px-3 py-1.5 text-sm text-neutral-200">
              <span className="min-w-0 truncate">{item}</span>
              {canManage && (
                <button type="button" onClick={() => handleRemove(index)} disabled={submitting} className="shrink-0 text-red-400 hover:text-red-300 disabled:opacity-50">
                  {t('characterSheet.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            placeholder={t('characterSheet.add_item_placeholder')}
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <button
            type="submit"
            disabled={submitting || !newItem.trim()}
            className="rounded-md bg-accent-500 px-3 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            {t('characterSheet.add')}
          </button>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </section>
  );
}

function BoostersPanel({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}) {
  const { t } = useTranslation();
  // Clé sur card_set_id (repli sur set_code pour une entrée héritée d'avant
  // ce correctif) — set_code seul ne distingue pas deux entrées différentes
  // qui le partagent (voir CLAUDE.md).
  const keyFor = (b: ApiSealedBooster) => b.card_set_id ?? b.set_code;
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ setCode: string; setName: string; cardSetId: string | null; cards: ApiOpenedCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Demande utilisateur : afficher l'image du booster, pas juste son nom en
  // texte — ApiSealedBooster n'a pas d'image directement, donc on la résout
  // ici via le catalogue de sets. Par set_name exact (jamais set_code, voir
  // CLAUDE.md — deux sets peuvent partager le même code mais jamais le même
  // nom), clé sur card_set_id pour rester correct même dans ce cas.
  const [images, setImages] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    if (character.sealed_boosters.length === 0) return;
    Promise.all(
      character.sealed_boosters.map((b) =>
        api
          .listCardSets(token, { search: b.set_name, include_custom: true })
          .then(({ sets }): [string, string | null] => [keyFor(b), sets.find((s) => s.set_name === b.set_name)?.set_image ?? null])
          .catch((): [string, string | null] => [keyFor(b), null]),
      ),
    ).then((entries) => {
      if (!cancelled) setImages(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, character.sealed_boosters]);

  if (character.sealed_boosters.length === 0) return null;

  // quantity par défaut à 1 (bouton "ouvrir" simple) — le bouton "tout
  // ouvrir" (demande utilisateur) passe le nombre réel de boosters scellés
  // détenus, plafonné à 20 (max accepté par POST .../open-booster).
  const handleOpen = async (setCode: string, setName: string, cardSetId: string | null, quantity = 1) => {
    setOpeningKey(cardSetId ?? setCode);
    setError(null);
    try {
      const { character: updated, opened_cards } = await api.openBooster(token, character.id, setCode, quantity, cardSetId);
      onCharacterUpdate(character.id, { collection: updated.collection, sealed_boosters: updated.sealed_boosters });
      setOpening({ setCode, setName, cardSetId, cards: opened_cards });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setOpeningKey(null);
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{t('characterSheet.sealed_boosters')}</h3>
      {/* Scrollbar si la liste devient trop haute (demande utilisateur) — max-h
          tuné à ~5 lignes à cette hauteur de ligne, le reste défile. */}
      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-sm">
        {character.sealed_boosters.map((b: ApiSealedBooster) => (
          <div key={keyFor(b)} className="flex items-center gap-2 rounded-md border border-arena-700 bg-arena-800 px-2 py-1.5">
            {images[keyFor(b)] ? (
              <img src={images[keyFor(b)]!} alt={b.set_name} className="h-10 w-10 shrink-0 rounded object-contain" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-arena-900 text-[8px] text-arena-600">{b.set_code}</div>
            )}
            <span className="min-w-0 flex-1 truncate text-neutral-200">
              {b.set_name} <span className="text-neutral-500">×{b.quantity}</span>
            </span>
            <button
              type="button"
              onClick={() => void handleOpen(b.set_code, b.set_name, b.card_set_id)}
              disabled={openingKey === keyFor(b)}
              className="shrink-0 text-accent-400 underline hover:text-accent-300 disabled:opacity-50"
            >
              {openingKey === keyFor(b) ? t('characterSheet.opening') : t('characterSheet.open')}
            </button>
            {b.quantity > 1 && (
              <button
                type="button"
                onClick={() => void handleOpen(b.set_code, b.set_name, b.card_set_id, Math.min(b.quantity, 20))}
                disabled={openingKey === keyFor(b)}
                title={b.quantity > 20 ? t('characterSheet.open_capped_tooltip') : undefined}
                className="shrink-0 text-accent-400 underline hover:text-accent-300 disabled:opacity-50"
              >
                {t('characterSheet.open_all', { count: Math.min(b.quantity, 20) })}
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {opening && (
        <BoosterOpeningOverlay
          setName={opening.setName}
          cards={opening.cards}
          onClose={() => setOpening(null)}
          onNext={
            openingKey === null && (character.sealed_boosters.find((b) => keyFor(b) === (opening.cardSetId ?? opening.setCode))?.quantity ?? 0) > 0
              ? () => void handleOpen(opening.setCode, opening.setName, opening.cardSetId)
              : undefined
          }
          otherSets={
            openingKey === null ? character.sealed_boosters.filter((b) => keyFor(b) !== (opening.cardSetId ?? opening.setCode) && b.quantity > 0) : []
          }
          onOpenOther={(setCode, setName, cardSetId) => void handleOpen(setCode, setName, cardSetId)}
        />
      )}
    </section>
  );
}

/**
 * Onglet "Collection" (demande utilisateur — "affichage des cartes en grand
 * à gauche") : même idiome que DeckEditorOverlay (aperçu grand format à
 * gauche, grille filtrable à droite), sans les actions d'ajout/retrait de
 * deck — ici on parcourt, on ne construit pas.
 */
function CollectionTab({ token, character }: { token: string; character: ApiCharacter }) {
  const { t, i18n } = useTranslation();
  const [collection, setCollection] = useState<ApiCollectionEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<ApiCollectionEntry['card'] | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CollectionFilters>(EMPTY_FILTERS);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('type');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCharacterCollection(token, character.id)
      .then(({ collection: fetched }) => {
        if (cancelled) return;
        setCollection(fetched);
        setPreviewCard((prev) => prev ?? fetched[0]?.card ?? null);
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
  }, [token, character.id]);

  const availableRaces = useMemo(() => {
    const races = new Set<string>();
    for (const entry of collection ?? []) {
      if (cardCategory(entry.card) === 'monster' && entry.card.race) races.add(entry.card.race);
    }
    return [...races].sort();
  }, [collection]);

  const entries = useMemo(() => {
    return (collection ?? [])
      .filter((e) => !search.trim() || e.card.name.toLowerCase().includes(search.trim().toLowerCase()))
      .filter((e) => matchesFilters(e.card, filters))
      .sort((a, b) => compareEntries({ card: a.card, releaseDate: a.release_date, acquiredOrder: a.acquired_order }, { card: b.card, releaseDate: b.release_date, acquiredOrder: b.acquired_order }, sortKey, sortDir));
  }, [collection, search, filters, sortKey, sortDir]);

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <aside className="w-72 shrink-0 overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4">
        {previewCard ? (
          <div className="text-sm">
            {previewCard.card_images[0] && (
              <img src={previewCard.card_images[0].image_url} alt={displayCardName(previewCard, i18n.language)} className="mb-3 w-full rounded-lg shadow-lg" />
            )}
            <h3 className="mb-1 font-display text-lg text-accent-400">{displayCardName(previewCard, i18n.language)}</h3>
            <p className="mb-2 text-neutral-400">
              {previewCard.type}
              {previewCard.race ? ` · ${translateRace(previewCard.race, t)}` : ''}
              {previewCard.attribute ? ` · ${translateAttribute(previewCard.attribute, t)}` : ''}
            </p>
            {(previewCard.atk !== null || previewCard.def !== null || previewCard.level_rank !== null) && (
              <p className="mb-2 text-neutral-300">
                {previewCard.atk !== null && `ATK ${previewCard.atk}`}
                {previewCard.def !== null && ` / DEF ${previewCard.def}`}
                {previewCard.level_rank !== null && ` · ${t('cardPreview.level_rank', { level: previewCard.level_rank })}`}
              </p>
            )}
            {previewCard.pendulum_scale !== null && <p className="mb-2 text-neutral-300">{t('cardPreview.pendulum_scale', { scale: previewCard.pendulum_scale })}</p>}
            <p className="whitespace-pre-wrap leading-relaxed text-neutral-300">{displayCardDescription(previewCard, i18n.language)}</p>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('cardPreview.empty')}</p>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-arena-700 bg-arena-900 p-3">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
          <input
            type="text"
            placeholder={t('collectionBrowser.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded border border-arena-600 bg-arena-800 px-1.5 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
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
              <span className="rounded-full bg-accent-500 px-1.5 text-[10px] font-semibold text-arena-950">{activeFilterCount(filters)}</span>
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && collection && collection.length === 0 && <p className="text-sm text-neutral-500">{t('collectionBrowser.empty_collection')}</p>}
          {!loading && collection && collection.length > 0 && entries.length === 0 && (
            <p className="text-sm text-neutral-500">{t('collectionBrowser.empty_filtered')}</p>
          )}
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
            {entries.map((entry) => (
              <button
                key={entry.card.id}
                type="button"
                onClick={() => setPreviewCard(entry.card)}
                title={entry.card.name}
                className="group relative rounded border border-arena-700 transition hover:border-accent-500"
              >
                {entry.card.card_images[0] && (
                  <img src={entry.card.card_images[0].image_url_small} alt={entry.card.name} className="w-full rounded" />
                )}
                {entry.quantity > 1 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-arena-950/90 px-1 text-[10px] text-neutral-300">×{entry.quantity}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </main>

      {showFilterModal && (
        <CollectionFilterModal filters={filters} onChange={setFilters} onClose={() => setShowFilterModal(false)} availableRaces={availableRaces} />
      )}
    </div>
  );
}
