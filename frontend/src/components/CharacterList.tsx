import { useState } from 'react';
import {
  api,
  ApiError,
  type ApiCharacter,
  type ApiCollectionEntry,
  type ApiDeck,
  type ApiOpenedCard,
  type ApiSealedBooster,
} from '../lib/api';
import { STAT_NAMES, STAT_SHORT_LABELS } from '../lib/pointBuy';
import { DeckManager } from './DeckManager';
import { BoosterOpeningOverlay } from './BoosterOpeningOverlay';
import { GrantCardsOverlay } from './GrantCardsOverlay';

interface CharacterListProps {
  token: string;
  characters: ApiCharacter[];
  currentUserId: string;
  isGm: boolean;
  currencyName: string;
  onDelete: (id: string) => void;
  onCharacterUpdate: (
    characterId: string,
    patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[]; decks?: ApiDeck[] },
  ) => void;
}

export function CharacterList({ token, characters, currentUserId, isGm, currencyName, onDelete, onCharacterUpdate }: CharacterListProps) {
  const [grantCardsFor, setGrantCardsFor] = useState<string | null>(null);

  if (characters.length === 0) {
    return <p className="text-sm text-neutral-500">Aucun personnage dans ce salon pour l'instant.</p>;
  }

  const grantCardsCharacter = characters.find((c) => c.id === grantCardsFor) ?? null;

  return (
    <div className="space-y-3">
      {characters.map((character) => {
        const canManage = isGm || character.user_id === currentUserId;
        return (
          <article key={character.id} className="rounded-xl border border-arena-700 bg-arena-900 p-4 shadow-lg">
            <header className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-accent-400">
                {character.name}
                {character.is_npc && <span className="ml-2 text-xs uppercase text-neutral-500">NPC</span>}
              </h3>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>niv. {character.level}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onDelete(character.id)}
                    className="text-red-400 transition hover:text-red-300"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </header>
            <div className="grid grid-cols-5 gap-2 font-mono text-xs text-neutral-300">
              {STAT_NAMES.map((stat) => (
                <div key={stat} className="text-center">
                  <div className="text-neutral-500">{STAT_SHORT_LABELS[stat]}</div>
                  <div>{character.stats[stat]}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              rerolls de Chance : {character.remaining_luck_rerolls} · argent :{' '}
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
                  + Ajouter des cartes (MJ)
                </button>
              </>
            )}

            {canManage && <CharacterEconomy token={token} character={character} onCharacterUpdate={onCharacterUpdate} />}
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
    </div>
  );
}

/**
 * Réservé au MJ (voir le garde `isGm` dans CharacterList) : un joueur ne peut
 * plus se créditer lui-même, seulement faire baisser son solde en achetant
 * chez un marchand (route distincte, server-authoritative). Comme le
 * niveau/l'XP, l'argent reste sous le contrôle du MJ, comme à la table.
 */
function MoneyEditor({
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
  const [creditAmount, setCreditAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyMoney = async (newAmount: number) => {
    setError(null);
    setSubmitting(true);
    try {
      const { character: updated } = await api.updateCharacterMoney(token, character.id, newAmount);
      onCharacterUpdate(character.id, { money: updated.money });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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

  const handleSetExact = async (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed === character.money) return;
    await applyMoney(parsed);
  };

  return (
    <div className="mt-2 rounded-md border border-arena-600 bg-arena-800/60 p-2 text-xs">
      <p className="mb-1.5 font-semibold uppercase tracking-wide text-neutral-400">Argent (MJ)</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-neutral-400">
          Créditer
          <input
            type="number"
            min={1}
            placeholder="montant"
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
          + Ajouter
        </button>
        <span className="text-neutral-600">|</span>
        <label className="flex items-center gap-1 text-neutral-400">
          Fixer le total
          <input
            type="number"
            min={0}
            defaultValue={character.money}
            key={character.money}
            onBlur={(e) => void handleSetExact(e.target.value)}
            title={`Nouveau total exact en ${currencyName}`}
            className="w-20 rounded border border-arena-600 bg-arena-900 px-1.5 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
          />
        </label>
      </div>
      {error && <p className="mt-1 text-red-400">{error}</p>}
    </div>
  );
}

function CharacterEconomy({
  token,
  character,
  onCharacterUpdate,
}: {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (
    characterId: string,
    patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[]; decks?: ApiDeck[] },
  ) => void;
}) {
  const [showCollection, setShowCollection] = useState(false);
  const [collection, setCollection] = useState<ApiCollectionEntry[] | null>(null);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [openingSet, setOpeningSet] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ setCode: string; setName: string; cards: ApiOpenedCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCollection = async () => {
    setLoadingCollection(true);
    setError(null);
    try {
      const { collection: fetched } = await api.getCharacterCollection(token, character.id);
      setCollection(fetched);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
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

  const handleOpen = async (setCode: string, setName: string) => {
    setOpeningSet(setCode);
    setError(null);
    try {
      // Le tirage est déterminé et validé côté serveur (anti-triche) dès cet
      // appel ; l'overlay ne fait que rejouer une mise en scène de ce
      // résultat déjà acquis, pas une seconde requête différée.
      const { character: updated, opened_cards } = await api.openBooster(token, character.id, setCode, 1);
      onCharacterUpdate(character.id, { collection: updated.collection, sealed_boosters: updated.sealed_boosters });
      setOpening({ setCode, setName, cards: opened_cards });
      if (showCollection) await fetchCollection();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setOpeningSet(null);
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
          {showCollection ? 'Masquer la collection' : 'Voir la collection'}
        </button>
        {character.sealed_boosters.length > 0 && (
          <span className="flex flex-wrap items-center gap-2 text-neutral-500">
            boosters scellés :
            {character.sealed_boosters.map((b) => (
              <span key={b.set_code} className="flex items-center gap-1">
                {b.set_name} ×{b.quantity}
                <button
                  type="button"
                  onClick={() => void handleOpen(b.set_code, b.set_name)}
                  disabled={openingSet === b.set_code}
                  className="text-accent-400 underline hover:text-accent-300 disabled:opacity-50"
                >
                  {openingSet === b.set_code ? 'ouverture...' : 'ouvrir'}
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
            openingSet === null && (character.sealed_boosters.find((b) => b.set_code === opening.setCode)?.quantity ?? 0) > 0
              ? () => void handleOpen(opening.setCode, opening.setName)
              : undefined
          }
          otherSets={
            openingSet === null ? character.sealed_boosters.filter((b) => b.set_code !== opening.setCode && b.quantity > 0) : []
          }
          onOpenOther={(setCode, setName) => void handleOpen(setCode, setName)}
        />
      )}

      {showCollection && (
        <div className="mt-2">
          {loadingCollection && <p className="text-neutral-500">Chargement...</p>}
          {!loadingCollection && collection && collection.length === 0 && (
            <p className="text-neutral-500">Aucune carte dans la collection.</p>
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

      <DeckManager token={token} character={character} onCharacterUpdate={onCharacterUpdate} />
    </div>
  );
}
