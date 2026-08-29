import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { socket } from '../lib/socket';
import {
  api,
  ApiError,
  type ApiCharacter,
  type ApiMerchant,
  type ApiMerchantItem,
  type ApiSealedBooster,
} from '../lib/api';
import { MerchantItemPickerOverlay } from './MerchantItemPickerOverlay';

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
  // marchand : sans ça, ce changement resterait invisible ici jusqu'à
  // quitter/revenir dans le salon.
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
    try {
      await api.deleteMerchant(token, merchantId);
      setMerchants((prev) => prev.filter((m) => m.id !== merchantId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const updateMerchantInList = (updated: ApiMerchant) => {
    setMerchants((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  };

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
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-400">
            DC marchandage
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

      <div className="space-y-4">
        {merchants.map((merchant) => (
          <MerchantCard
            key={merchant.id}
            token={token}
            merchant={merchant}
            currencyName={currencyName}
            isGm={isGm}
            characters={characters}
            currentUserId={currentUserId}
            onCharacterUpdate={onCharacterUpdate}
            onUpdated={updateMerchantInList}
            onDeleted={() => void handleDeleteMerchant(merchant.id)}
          />
        ))}
      </div>
    </section>
  );
}

function MerchantCard({
  token,
  merchant,
  currencyName,
  isGm,
  characters,
  currentUserId,
  onCharacterUpdate,
  onUpdated,
  onDeleted,
}: {
  token: string;
  merchant: ApiMerchant;
  currencyName: string;
  isGm: boolean;
  characters: ApiCharacter[];
  currentUserId: string;
  onCharacterUpdate: (characterId: string, patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[] }) => void;
  onUpdated: (merchant: ApiMerchant) => void;
  onDeleted: () => void;
}) {
  const [showAddItem, setShowAddItem] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteItem = async (itemId: string) => {
    try {
      const { merchant: updated } = await api.deleteMerchantItem(token, merchant.id, itemId);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const handleUpdateItem = async (itemId: string, input: { price?: number; stock?: number | null }) => {
    try {
      const { merchant: updated } = await api.updateMerchantItem(token, merchant.id, itemId, input);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <article className="rounded-lg border border-arena-700 bg-arena-800 p-4">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-accent-400">{merchant.name}</h3>
          {merchant.description && <p className="text-xs text-neutral-400">{merchant.description}</p>}
          <p className="text-xs text-neutral-500">DC marchandage : {merchant.haggle_dc}</p>
        </div>
        {isGm && (
          <button type="button" onClick={onDeleted} className="shrink-0 text-xs text-red-400 hover:text-red-300">
            Supprimer le marchand
          </button>
        )}
      </header>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      <div className="space-y-2">
        {merchant.items.length === 0 && <p className="text-xs text-neutral-500">Aucun article en vente.</p>}
        {merchant.items.map((item) => (
          <MerchantItemRow
            key={item.id}
            token={token}
            merchantId={merchant.id}
            item={item}
            currencyName={currencyName}
            isGm={isGm}
            characters={characters}
            currentUserId={currentUserId}
            onCharacterUpdate={onCharacterUpdate}
            onMerchantUpdate={onUpdated}
            onDelete={() => void handleDeleteItem(item.id)}
            onUpdate={(input) => void handleUpdateItem(item.id, input)}
          />
        ))}
      </div>

      {isGm && (
        <div className="mt-3">
          {showAddItem ? (
            <MerchantItemPickerOverlay
              token={token}
              merchant={merchant}
              onAdded={onUpdated}
              onClose={() => setShowAddItem(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAddItem(true)}
              className="text-xs text-accent-400 underline hover:text-accent-300"
            >
              + Ajouter un article
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function MerchantItemRow({
  token,
  merchantId,
  item,
  currencyName,
  isGm,
  characters,
  currentUserId,
  onCharacterUpdate,
  onMerchantUpdate,
  onDelete,
  onUpdate,
}: {
  token: string;
  merchantId: string;
  item: ApiMerchantItem;
  currencyName: string;
  isGm: boolean;
  characters: ApiCharacter[];
  currentUserId: string;
  onCharacterUpdate: (characterId: string, patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[] }) => void;
  onMerchantUpdate: (merchant: ApiMerchant) => void;
  onDelete: () => void;
  onUpdate: (input: { price?: number; stock?: number | null }) => void;
}) {
  const [price, setPrice] = useState(item.price);
  const [stock, setStock] = useState<string>(item.stock === null ? '' : String(item.stock));

  const commitPrice = () => {
    if (price !== item.price) onUpdate({ price });
  };

  const commitStock = () => {
    const parsed = stock.trim() === '' ? null : Number(stock);
    if (parsed !== item.stock) onUpdate({ stock: parsed });
  };

  const buyableCharacters = characters.filter((c) => c.user_id === currentUserId);

  return (
    <div className="rounded-md bg-arena-900 px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {item.image_url && <img src={item.image_url} alt={item.name} className="h-10 w-auto rounded" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-neutral-200">{item.name}</div>
          <div className="text-neutral-500">{item.item_type === 'card' ? 'Carte' : 'Booster'}</div>
        </div>

        {isGm ? (
          <>
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              onBlur={commitPrice}
              className="w-16 rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-right text-neutral-100"
            />
            <span className="text-neutral-500">{currencyName}</span>
            <input
              type="number"
              min={0}
              placeholder="illimité"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              onBlur={commitStock}
              className="w-20 rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-right text-neutral-100"
            />
            <span className="text-neutral-500">stock</span>
            <button type="button" onClick={onDelete} className="text-red-400 hover:text-red-300">
              Retirer
            </button>
          </>
        ) : (
          <>
            <span className="text-accent-400">
              {item.price} {currencyName}
            </span>
            <span className="text-neutral-500">{item.stock === null ? 'stock illimité' : `stock : ${item.stock}`}</span>
          </>
        )}
      </div>

      <PurchaseWidget
        token={token}
        merchantId={merchantId}
        item={item}
        currencyName={currencyName}
        buyableCharacters={buyableCharacters}
        onPurchased={(data) => {
          onCharacterUpdate(data.character.id, {
            money: data.character.money,
            collection: data.character.collection,
            sealed_boosters: data.character.sealed_boosters,
          });
          onMerchantUpdate(data.merchant);
        }}
      />
    </div>
  );
}

function PurchaseWidget({
  token,
  merchantId,
  item,
  currencyName,
  buyableCharacters,
  onPurchased,
}: {
  token: string;
  merchantId: string;
  item: ApiMerchantItem;
  currencyName: string;
  buyableCharacters: ApiCharacter[];
  onPurchased: (data: Awaited<ReturnType<typeof api.purchaseMerchantItem>>) => void;
}) {
  const [characterId, setCharacterId] = useState(buyableCharacters[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [haggling, setHaggling] = useState(false);
  const [modifier, setModifier] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(20);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (buyableCharacters.length === 0) return null;

  const handleBuy = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const data = await api.purchaseMerchantItem(token, merchantId, item.id, {
        character_id: characterId || buyableCharacters[0]!.id,
        quantity,
        haggle: haggling ? { modifier, discount_percent: discountPercent } : undefined,
      });
      onPurchased(data);
      const h = data.purchase.haggle;
      const message = h
        ? `Acheté pour ${data.purchase.total_price} ${currencyName} — marchandage : ${h.roll}+${h.modifier}=${h.total} contre DC ${h.dc} → ${
            h.success ? `réussi, -${h.discount_percent}%` : 'échoué, prix plein'
          }`
        : `Acheté pour ${data.purchase.total_price} ${currencyName}`;
      setFeedback({ ok: true, message });
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof ApiError ? err.message : 'Une erreur est survenue' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-arena-700 pt-1.5">
      <select
        value={characterId || buyableCharacters[0]!.id}
        onChange={(e) => setCharacterId(e.target.value)}
        className="rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-neutral-100"
      >
        {buyableCharacters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.money} {currencyName})
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
        className="w-12 rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-right text-neutral-100"
      />
      <label className="flex items-center gap-1 text-neutral-400">
        <input type="checkbox" checked={haggling} onChange={(e) => setHaggling(e.target.checked)} />
        Marchander
      </label>

      {haggling && (
        <span className="flex flex-wrap items-center gap-1 text-neutral-400">
          <span>modificateur (MJ)</span>
          <input
            type="number"
            value={modifier}
            onChange={(e) => setModifier(Number(e.target.value))}
            className="w-12 rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-right text-neutral-100"
          />
          <span>remise si succès %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-14 rounded border border-arena-600 bg-arena-800 px-1 py-0.5 text-right text-neutral-100"
          />
        </span>
      )}

      <button
        type="button"
        onClick={() => void handleBuy()}
        disabled={submitting}
        className="rounded bg-accent-500 px-2 py-0.5 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
      >
        Acheter
      </button>
      {feedback && (
        <p className={`w-full ${feedback.ok ? 'text-emerald-400' : 'text-red-400'}`}>{feedback.message}</p>
      )}
    </div>
  );
}
