import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { socket } from '../lib/socket';
import { api, ApiError, type ApiCharacter, type ApiMerchant, type ApiSealedBooster } from '../lib/api';
import { MerchantShopOverlay } from './MerchantShopOverlay';

interface MerchantPanelProps {
  token: string;
  sessionId: string;
  currencyName: string;
  isGm: boolean;
  characters: ApiCharacter[];
  currentUserId: string;
  onCharacterUpdate: (characterId: string, patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[] }) => void;
}

export function MerchantPanel({
  token,
  sessionId,
  currencyName,
  isGm,
  characters,
  currentUserId,
  onCharacterUpdate,
}: MerchantPanelProps) {
  const [merchants, setMerchants] = useState<ApiMerchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openMerchantId, setOpenMerchantId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newHaggleDc, setNewHaggleDc] = useState(15);
  const [creating, setCreating] = useState(false);

  const fetchMerchants = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      return api
        .listMerchants(token, sessionId)
        .then(({ merchants: fetched }) => setMerchants(fetched))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
        .finally(() => setLoading(false));
    },
    [token, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listMerchants(token, sessionId)
      .then(({ merchants: fetched }) => {
        if (!cancelled) setMerchants(fetched);
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

  // Un autre membre du salon (déjà connecté) peut créer/supprimer un
  // marchand, ou modifier son stock : sans ça, ce changement resterait
  // invisible ici jusqu'à quitter/revenir dans le salon.
  useEffect(() => {
    const onChanged = (payload: { resource: string; session_id: string }) => {
      if (payload.resource === 'merchants' && payload.session_id === sessionId) void fetchMerchants({ silent: true });
    };
    socket.on('session_resource_changed', onChanged);
    return () => {
      socket.off('session_resource_changed', onChanged);
    };
  }, [sessionId, fetchMerchants]);

  const handleCreateMerchant = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const { merchant } = await api.createMerchant(token, sessionId, newName, newDescription, newHaggleDc);
      setMerchants((prev) => [...prev, merchant]);
      setNewName('');
      setNewDescription('');
      setNewHaggleDc(15);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteMerchant = async (merchantId: string) => {
    if (!window.confirm('Supprimer ce marchand ?')) return;
    try {
      await api.deleteMerchant(token, merchantId);
      setMerchants((prev) => prev.filter((m) => m.id !== merchantId));
      if (openMerchantId === merchantId) setOpenMerchantId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const updateMerchantInList = (updated: ApiMerchant) => {
    setMerchants((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

  const openMerchant = merchants.find((m) => m.id === openMerchantId) ?? null;

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">Marchands</h2>

      {isGm && (
        <form onSubmit={handleCreateMerchant} className="mb-4 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Nom du marchand"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <input
            type="text"
            placeholder="Description (optionnelle)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-400" title="DC proposé par défaut quand un nouvel article négociable est ajouté à ce marchand — chaque article garde ensuite son propre DC/remise.">
            DC par défaut
            <input
              type="number"
              min={1}
              max={30}
              value={newHaggleDc}
              onChange={(e) => setNewHaggleDc(Number(e.target.value))}
              className="w-14 rounded-md border border-arena-600 bg-arena-800 px-2 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-accent-500 px-3 py-2 text-xs font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            Créer
          </button>
        </form>
      )}

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      {loading && <p className="text-xs text-neutral-500">Chargement...</p>}
      {!loading && merchants.length === 0 && <p className="text-xs text-neutral-500">Aucun marchand dans ce salon.</p>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {merchants.map((merchant) => (
          <article key={merchant.id} className="flex flex-col rounded-lg border border-arena-700 bg-arena-800 p-3 text-sm">
            <h3 className="truncate font-semibold text-accent-400">{merchant.name}</h3>
            {merchant.description && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-400">{merchant.description}</p>}
            <p className="mt-1 text-xs text-neutral-500">
              {merchant.items.length} article{merchant.items.length > 1 ? 's' : ''}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpenMerchantId(merchant.id)}
                className="flex-1 rounded-md bg-accent-500 py-1.5 text-xs font-semibold text-arena-950 transition hover:bg-accent-400"
              >
                Ouvrir la boutique
              </button>
              {isGm && (
                <button type="button" onClick={() => void handleDeleteMerchant(merchant.id)} className="shrink-0 text-xs text-red-400 hover:text-red-300">
                  Supprimer
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {openMerchant && (
        <MerchantShopOverlay
          token={token}
          merchant={openMerchant}
          currencyName={currencyName}
          isGm={isGm}
          characters={characters}
          currentUserId={currentUserId}
          onMerchantUpdate={updateMerchantInList}
          onCharacterUpdate={onCharacterUpdate}
          onClose={() => setOpenMerchantId(null)}
        />
      )}
    </section>
  );
}
