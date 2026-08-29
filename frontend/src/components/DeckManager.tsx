import { useState, type FormEvent } from 'react';
import { api, ApiError, type ApiCharacter, type ApiDeck } from '../lib/api';
import { DeckEditorOverlay } from './DeckEditorOverlay';

interface DeckManagerProps {
  token: string;
  character: ApiCharacter;
  onCharacterUpdate: (characterId: string, patch: { decks?: ApiDeck[] }) => void;
}

export function DeckManager({ token, character, onCharacterUpdate }: DeckManagerProps) {
  const [newDeckName, setNewDeckName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!newDeckName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { character: updated } = await api.createDeck(token, character.id, newDeckName.trim());
      onCharacterUpdate(character.id, { decks: updated.decks });
      setNewDeckName('');
      setOpenDeckId(updated.decks[updated.decks.length - 1]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDeck = async (deckId: string) => {
    setError(null);
    try {
      const { character: updated } = await api.deleteDeck(token, character.id, deckId);
      onCharacterUpdate(character.id, { decks: updated.decks });
      if (openDeckId === deckId) setOpenDeckId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <div className="mt-2 border-t border-arena-700 pt-2 text-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-neutral-400">Decks</span>
      </div>

      <form onSubmit={handleCreate} className="mb-2 flex gap-1.5">
        <input
          type="text"
          placeholder="Nom du nouveau deck"
          value={newDeckName}
          onChange={(e) => setNewDeckName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-neutral-100 outline-none focus:border-accent-500"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          Créer
        </button>
      </form>

      {error && <p className="mb-2 text-red-400">{error}</p>}

      {character.decks.length === 0 && <p className="text-neutral-500">Aucun deck pour l'instant.</p>}

      <div className="space-y-1.5">
        {character.decks.map((deck) => (
          <div key={deck.id} className="flex items-center gap-2 rounded border border-arena-700 bg-arena-900 p-2">
            <span className="flex-1 truncate text-neutral-200">
              {deck.name} <span className="text-neutral-500">({deck.cards.length} cartes)</span>
            </span>
            <button type="button" onClick={() => setOpenDeckId(deck.id)} className="shrink-0 text-accent-400 underline hover:text-accent-300">
              Ouvrir
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteDeck(deck.id)}
              className="shrink-0 text-red-400 hover:text-red-300"
            >
              Supprimer
            </button>
          </div>
        ))}
      </div>

      {openDeckId && (
        <DeckEditorOverlay
          token={token}
          character={character}
          deckId={openDeckId}
          onClose={() => setOpenDeckId(null)}
          onCharacterUpdate={onCharacterUpdate}
        />
      )}
    </div>
  );
}
