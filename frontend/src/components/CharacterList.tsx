import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type ApiCharacter,
  type ApiCollectionEntry,
  type ApiDeck,
  type ApiOpenedCard,
  type ApiSealedBooster,
} from '../lib/api';
import { translateApiError } from '../lib/translateApiError';
import { STAT_NAMES, STAT_SHORT_LABELS } from '../lib/pointBuy';
import { DeckManager } from './DeckManager';
import { BoosterOpeningOverlay } from './BoosterOpeningOverlay';
import { GrantCardsOverlay } from './GrantCardsOverlay';
import { CharacterSheetOverlay } from './CharacterSheetOverlay';

type CharacterUpdatePatch = Partial<
  Pick<
    ApiCharacter,
    'money' | 'collection' | 'sealed_boosters' | 'decks' | 'name' | 'backstory' | 'personality' | 'visual_description' | 'notes' | 'gm_notes' | 'inventory'
  >
>;

interface CharacterListProps {
  token: string;
  characters: ApiCharacter[];
  currentUserId: string;
  isGm: boolean;
  currencyName: string;
  onDelete: (id: string) => void;
  onCharacterUpdate: (characterId: string, patch: CharacterUpdatePatch) => void;
}

export function CharacterList({ token, characters, currentUserId, isGm, currencyName, onDelete, onCharacterUpdate }: CharacterListProps) {
  const { t } = useTranslation();
  const [grantCardsFor, setGrantCardsFor] = useState<string | null>(null);
  // Fiche de personnage stylisée (demande utilisateur) : ouvrable depuis
  // n'importe quelle carte compacte ci-dessous, ou depuis le bouton flottant
  // toujours visible (voir plus bas) pour le joueur sur son propre personnage.
  const [sheetFor, setSheetFor] = useState<string | null>(null);

  // Un joueur n'a jamais qu'un seul personnage joueur par salon (règle déjà
  // en place, voir CLAUDE.md) : ce bouton flottant n'a donc jamais besoin de
  // choisir entre plusieurs — il cible directement ce personnage unique.
  // Absent pour le MJ (qui n'a pas "son" personnage) et pour un joueur sans
  // personnage dans ce salon.
  const ownCharacter = characters.find((c) => !c.is_npc && c.user_id === currentUserId) ?? null;

  if (characters.length === 0) {
    return <p className="text-sm text-neutral-500">{t('characterList.empty')}</p>;
  }

  const grantCardsCharacter = characters.find((c) => c.id === grantCardsFor) ?? null;
  const sheetCharacter = characters.find((c) => c.id === sheetFor) ?? null;

  return (
    <div className="space-y-3">
      {ownCharacter && (
        <button
          type="button"
          onClick={() => setSheetFor(ownCharacter.id)}
          className="fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-accent-500 bg-arena-900/95 px-4 py-2 text-sm font-semibold text-accent-400 shadow-xl backdrop-blur transition hover:bg-accent-500 hover:text-arena-950"
        >
          <span aria-hidden>🧙</span> {ownCharacter.name}
        </button>
      )}

      {characters.map((character) => {
        const canManage = isGm || character.user_id === currentUserId;
        return (
          <article key={character.id} className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
            <header className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-accent-400">
                {character.name}
                {character.is_npc && <span className="ml-2 text-xs uppercase text-neutral-500">{t('characterSheet.npc_badge')}</span>}
              </h3>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{t('characterList.level_label', { level: character.level })}</span>
                <button type="button" onClick={() => setSheetFor(character.id)} className="text-accent-400 underline hover:text-accent-300">
                  {t('characterList.view_sheet')}
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDelete(character.id)}
                    className="text-red-400 transition hover:text-red-300"
                  >
                    {t('characterList.delete')}
                  </button>
                )}
              </div>
            </header>
            <div className="grid grid-cols-5 gap-2 font-mono text-xs text-neutral-300">
              {STAT_NAMES.map((stat) => (
                <div key={stat} className="text-center">
                  <div className="text-neutral-500">{t(STAT_SHORT_LABELS[stat])}</div>
                  <div>{character.stats[stat]}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {t('characterList.rerolls_money', { count: character.remaining_luck_rerolls })}{' '}
              <span className="font-semibold text-accent-400">
                {character.money} {currencyName}
              </span>
            </p>

            {isGm && (
              <>
                <MoneyEditor token={token} character={character} currencyName={currencyName} onCharacterUpdate={onCharacterUpdate} />
                <button
                  type="button"
                  onClick={() => setGrantCardsFor(character.id)}
                  className="mt-2 text-xs text-accent-400 underline hover:text-accent-300"
                >
                  {t('characterList.add_cards_gm')}
                </button>
              </>
            )}

            {canManage && <CharacterEconomy token={token} character={character} isGm={isGm} onCharacterUpdate={onCharacterUpdate} />}
          </article>
        );
      })}

      {grantCardsCharacter && (
        <GrantCardsOverlay
          token={token}
          character={grantCardsCharacter}
          onCharacterUpdate={onCharacterUpdate}
          onClose={() => setGrantCardsFor(null)}
        />
      )}

      {sheetCharacter && (
        <CharacterSheetOverlay
          token={token}
          character={sheetCharacter}
          currentUserId={currentUserId}
          isGm={isGm}
          currencyName={currencyName}
          onCharacterUpdate={onCharacterUpdate}
          onClose={() => setSheetFor(null)}
        />
      )}
    </div>
  );
}

/**
 * Réservé au MJ (voir le garde `isGm` dans CharacterList) : un joueur ne peut
 * plus se créditer lui-même, seulement faire baisser son solde en achetant
 * chez un marchand (route distincte, server-authoritative). Comme le
 * niveau/l'XP, l'argent reste sous le contrôle du MJ, comme à la table.
 */
export function MoneyEditor({
  token,
  character,
  currencyName,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  currencyName: string;
  onCharacterUpdate: (characterId: string, patch: { money?: number }) => void;
}) {
  const { t } = useTranslation();
  const [creditAmount, setCreditAmount] = useState('');
  const [exactAmount, setExactAmount] = useState(String(character.money));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repart de la vraie valeur si elle change ailleurs (achat, autre onglet du
  // MJ...) — sans ça le champ garderait un texte devenu obsolète.
  useEffect(() => {
    setExactAmount(String(character.money));
  }, [character.money]);

  const applyMoney = async (newAmount: number) => {
    setError(null);
    setSubmitting(true);
    try {
      const { character: updated } = await api.updateCharacterMoney(token, character.id, newAmount);
      onCharacterUpdate(character.id, { money: updated.money });
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCredit = async () => {
    const amount = Number(creditAmount);
    if (!Number.isInteger(amount) || amount <= 0) return;
    await applyMoney(character.money + amount);
    setCreditAmount('');
  };

  const parsedExact = Number(exactAmount);
  const exactIsValid = Number.isInteger(parsedExact) && parsedExact >= 0;
  const exactChanged = exactAmount.trim() !== '' && exactIsValid && parsedExact !== character.money;

  const handleSetExact = async () => {
    if (!exactChanged) return;
    await applyMoney(parsedExact);
  };

  return (
    <div className="mt-2 rounded-md border border-arena-600 bg-arena-800/60 p-2 text-xs">
      <p className="mb-1.5 font-semibold uppercase tracking-wide text-neutral-400">{t('characterList.money_gm_title')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-neutral-400">
          {t('characterList.credit_label')}
          <input
            type="number"
            min={1}
            placeholder={t('characterList.amount_placeholder')}
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            className="w-20 rounded border border-arena-600 bg-arena-900 px-1.5 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleCredit()}
          disabled={submitting || !creditAmount}
          className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {t('characterList.add_button')}
        </button>
        <span className="text-neutral-600">|</span>
        <label className="flex items-center gap-1 text-neutral-400">
          {t('characterList.set_exact_label')}
          <input
            type="number"
            min={0}
            value={exactAmount}
            onChange={(e) => setExactAmount(e.target.value)}
            title={t('characterList.set_exact_tooltip', { currency: currencyName })}
            className="w-20 rounded border border-arena-600 bg-arena-900 px-1.5 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
          />
        </label>
        {/* Bouton explicite (demande utilisateur) — plus d'application
            silencieuse à la perte de focus du champ. */}
        {exactChanged && (
          <button
            type="button"
            onClick={() => void handleSetExact()}
            disabled={submitting}
            className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            {t('duelBoard.validate')}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-red-400">{error}</p>}
    </div>
  );
}

function CharacterEconomy({
  token,
  character,
  isGm,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  isGm: boolean;
  onCharacterUpdate: (
    characterId: string,
    patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[]; decks?: ApiDeck[] },
  ) => void;
}) {
  const { t } = useTranslation();
  const [showCollection, setShowCollection] = useState(false);
  const [collection, setCollection] = useState<ApiCollectionEntry[] | null>(null);
  const [loadingCollection, setLoadingCollection] = useState(false);
  // Clé sur card_set_id (repli sur set_code pour une entrée héritée d'avant
  // ce correctif) — set_code seul ne distingue pas deux entrées différentes
  // qui le partagent (voir CLAUDE.md).
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ setCode: string; setName: string; cardSetId: string | null; cards: ApiOpenedCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keyFor = (b: { card_set_id: string | null; set_code: string }) => b.card_set_id ?? b.set_code;

  const fetchCollection = async () => {
    setLoadingCollection(true);
    setError(null);
    try {
      const { collection: fetched } = await api.getCharacterCollection(token, character.id);
      setCollection(fetched);
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setLoadingCollection(false);
    }
  };

  const toggleCollection = async () => {
    if (showCollection) {
      setShowCollection(false);
      return;
    }
    setShowCollection(true);
    await fetchCollection();
  };

  const handleOpen = async (setCode: string, setName: string, cardSetId: string | null) => {
    setOpeningKey(cardSetId ?? setCode);
    setError(null);
    try {
      // Le tirage est déterminé et validé côté serveur (anti-triche) dès cet
      // appel ; l'overlay ne fait que rejouer une mise en scène de ce
      // résultat déjà acquis, pas une seconde requête différée.
      const { character: updated, opened_cards } = await api.openBooster(token, character.id, setCode, 1, cardSetId);
      onCharacterUpdate(character.id, { collection: updated.collection, sealed_boosters: updated.sealed_boosters });
      setOpening({ setCode, setName, cardSetId, cards: opened_cards });
      if (showCollection) await fetchCollection();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setOpeningKey(null);
    }
  };

  return (
    <div className="mt-2 border-t border-arena-700 pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void toggleCollection()}
          className="text-accent-400 underline hover:text-accent-300"
        >
          {showCollection ? t('characterList.hide_collection') : t('characterList.show_collection')}
        </button>
        {character.sealed_boosters.length > 0 && (
          <span className="flex flex-wrap items-center gap-2 text-neutral-500">
            {t('characterList.sealed_boosters_label')}
            {character.sealed_boosters.map((b) => (
              <span key={keyFor(b)} className="flex items-center gap-1">
                {b.set_name} ×{b.quantity}
                <button
                  type="button"
                  onClick={() => void handleOpen(b.set_code, b.set_name, b.card_set_id)}
                  disabled={openingKey === keyFor(b)}
                  className="text-accent-400 underline hover:text-accent-300 disabled:opacity-50"
                >
                  {openingKey === keyFor(b) ? t('characterSheet.opening') : t('characterSheet.open')}
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      {error && <p className="mt-1 text-red-400">{error}</p>}

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

      {showCollection && (
        <div className="mt-2">
          {loadingCollection && <p className="text-neutral-500">{t('common.loading')}</p>}
          {!loadingCollection && collection && collection.length === 0 && (
            <p className="text-neutral-500">{t('collectionBrowser.empty_collection')}</p>
          )}
          {!loadingCollection && collection && collection.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {collection.map((entry) => (
                <div key={entry.card.id} className="relative">
                  {entry.card.card_images[0] && (
                    <img
                      src={entry.card.card_images[0].image_url_small}
                      alt={entry.card.name}
                      title={entry.card.name}
                      className="w-full rounded"
                    />
                  )}
                  {entry.quantity > 1 && (
                    <span className="absolute bottom-0 right-0 rounded bg-arena-950 px-1 text-[10px] text-accent-400">
                      x{entry.quantity}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DeckManager token={token} character={character} isGm={isGm} onCharacterUpdate={onCharacterUpdate} />
    </div>
  );
}
