import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  ApiError,
  type ApiCard,
  type ApiCharacter,
  type ApiMerchant,
  type ApiMerchantItem,
  type ApiPendingHaggle,
  type ApiSealedBooster,
} from '../lib/api';
import { MerchantItemPickerOverlay } from './MerchantItemPickerOverlay';

interface MerchantShopOverlayProps {
  token: string;
  merchant: ApiMerchant;
  currencyName: string;
  isGm: boolean;
  characters: ApiCharacter[];
  currentUserId: string;
  onMerchantUpdate: (merchant: ApiMerchant) => void;
  onCharacterUpdate: (characterId: string, patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[] }) => void;
  onClose: () => void;
}

/** Plein écran : parcourir la boutique d'un marchand, l'acheter (avec marchandage), et pour le MJ éditer stock/prix/DC de négociation directement, voir CLAUDE.md §3.5. */
export function MerchantShopOverlay({
  token,
  merchant,
  currencyName,
  isGm,
  characters,
  currentUserId,
  onMerchantUpdate,
  onCharacterUpdate,
  onClose,
}: MerchantShopOverlayProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(merchant.items[0]?.id ?? null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingImages, setRefreshingImages] = useState(false);

  // Reste calé sur un article encore présent si la liste change (achat qui
  // épuise le stock, suppression par le MJ...) — jamais un id fantôme.
  useEffect(() => {
    if (selectedItemId && !merchant.items.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(merchant.items[0]?.id ?? null);
    }
  }, [merchant.items, selectedItemId]);

  const selectedItem = merchant.items.find((i) => i.id === selectedItemId) ?? null;
  // MJ = achète pour ses propres PNJ (contrôlés comme n'importe quel joueur
  // contrôle son propre personnage) — jamais pour un personnage joué par
  // quelqu'un d'autre, voir merchant.routes.ts loadOwnedCharacterOrThrow.
  const buyableCharacters = characters.filter((c) => c.user_id === currentUserId);

  const handleDeleteItem = async (itemId: string) => {
    try {
      const { merchant: updated } = await api.deleteMerchantItem(token, merchant.id, itemId);
      onMerchantUpdate(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  // Rattrapage pour les articles carte ajoutés avant le passage à l'image
  // pleine résolution (demande utilisateur : le zoom au survol restait flou)
  // — voir merchant.routes.ts POST /:id/refresh-card-images.
  const hasCardItems = merchant.items.some((i) => i.item_type === 'card');
  const handleRefreshImages = async () => {
    setRefreshingImages(true);
    setError(null);
    try {
      const { merchant: updated } = await api.refreshMerchantCardImages(token, merchant.id);
      onMerchantUpdate(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setRefreshingImages(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">Boutique</p>
          <h2 className="font-display text-2xl text-accent-400">{merchant.name}</h2>
          {merchant.description && <p className="mt-0.5 max-w-xl truncate text-sm text-neutral-400">{merchant.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isGm && hasCardItems && (
            <button
              type="button"
              onClick={() => void handleRefreshImages()}
              disabled={refreshingImages}
              title="Réimporte les images des articles carte ajoutés avant le passage à la pleine résolution — sans effet sur les boosters"
              className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-50"
            >
              {refreshingImages ? 'Rafraîchissement...' : 'Rafraîchir les images'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            Fermer
          </button>
        </div>
      </header>

      {error && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {merchant.items.length === 0 ? (
            <p className="text-sm text-neutral-500">Aucun article en vente pour l'instant.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
              {merchant.items.map((item) => (
                <ItemTile key={item.id} item={item} selected={item.id === selectedItemId} onClick={() => setSelectedItemId(item.id)} />
              ))}
            </div>
          )}

          {isGm && (
            <div className="mt-4 border-t border-arena-800 pt-3">
              {showAddItem ? (
                <MerchantItemPickerOverlay
                  token={token}
                  merchant={merchant}
                  onAdded={(updated) => {
                    onMerchantUpdate(updated);
                    setShowAddItem(false);
                    const added = updated.items[updated.items.length - 1];
                    if (added) setSelectedItemId(added.id);
                  }}
                  onClose={() => setShowAddItem(false)}
                />
              ) : (
                <button type="button" onClick={() => setShowAddItem(true)} className="text-sm text-accent-400 underline hover:text-accent-300">
                  + Ajouter un article
                </button>
              )}
            </div>
          )}
        </main>

        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4">
          {selectedItem ? (
            <ItemDetailPanel
              token={token}
              merchant={merchant}
              item={selectedItem}
              currencyName={currencyName}
              isGm={isGm}
              buyableCharacters={buyableCharacters}
              onMerchantUpdate={onMerchantUpdate}
              onCharacterUpdate={onCharacterUpdate}
              onDeleted={() => void handleDeleteItem(selectedItem.id)}
            />
          ) : (
            <p className="text-sm text-neutral-500">Sélectionnez un article pour voir son détail.</p>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Zoom au survol centré au milieu de l'écran, en grand — demande utilisateur
 * (le zoom en place existant, ex. BoosterContentsPreview ci-dessous, restait
 * trop petit/coupé en bordure de grille). `pointer-events-none` sur l'overlay
 * : c'est le survol de la MINIATURE qui déclenche/arrête l'affichage, jamais
 * l'agrandissement lui-même — il ne doit intercepter aucun clic/survol.
 */
function HoverZoomImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={className}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-10">
            <img src={src} alt={alt} className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl" />
          </div>,
          document.body,
        )}
    </>
  );
}

function ItemTile({ item, selected, onClick }: { item: ApiMerchantItem; selected: boolean; onClick: () => void }) {
  const soldOut = item.stock === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex aspect-[3/4] flex-col overflow-hidden rounded-lg border-2 text-left transition ${
        selected ? 'border-accent-400' : 'border-arena-700 hover:border-arena-500'
      }`}
    >
      <div className="min-h-0 flex-1 overflow-hidden bg-arena-800">
        {item.image_url ? (
          // Zoom au survol réservé aux cartes (leur texte a besoin d'être
          // lu en grand) — demande utilisateur : l'illustration d'un
          // booster est déjà assez visible telle quelle, pas de zoom dessus.
          item.item_type === 'card' ? (
            <HoverZoomImage src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-arena-800 via-arena-900 to-black p-2 text-center">
            <span className="text-[9px] uppercase tracking-widest text-accent-500">{item.set_code}</span>
            <span className="font-display text-xs leading-tight text-neutral-100">{item.name}</span>
          </div>
        )}
        {item.haggle_dc !== null && (
          <span className="absolute left-1 top-1 rounded bg-arena-950/85 px-1 py-0.5 text-[8px] uppercase tracking-wide text-accent-400">Négociable</span>
        )}
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] uppercase tracking-widest text-red-400">Épuisé</span>
        )}
      </div>
      <div className="shrink-0 bg-arena-900/95 px-1.5 py-1 text-[10px]">
        <p className="truncate text-neutral-200">{item.name}</p>
        <div className="flex items-center justify-between text-neutral-500">
          <span className="font-semibold text-accent-400">{item.price}</span>
          <span>{item.stock === null ? '∞' : item.stock}</span>
        </div>
      </div>
    </button>
  );
}

function ItemDetailPanel({
  token,
  merchant,
  item,
  currencyName,
  isGm,
  buyableCharacters,
  onMerchantUpdate,
  onCharacterUpdate,
  onDeleted,
}: {
  token: string;
  merchant: ApiMerchant;
  item: ApiMerchantItem;
  currencyName: string;
  isGm: boolean;
  buyableCharacters: ApiCharacter[];
  onMerchantUpdate: (merchant: ApiMerchant) => void;
  onCharacterUpdate: (characterId: string, patch: { money?: number; collection?: string[]; sealed_boosters?: ApiSealedBooster[] }) => void;
  onDeleted: () => void;
}) {
  const [price, setPrice] = useState(item.price);
  const [stock, setStock] = useState(item.stock === null ? '' : String(item.stock));
  const [negotiable, setNegotiable] = useState(item.haggle_dc !== null);
  const [haggleDc, setHaggleDc] = useState(item.haggle_dc ?? 15);
  const [haggleDiscount, setHaggleDiscount] = useState(item.haggle_discount_percent ?? 20);
  const [savingError, setSavingError] = useState<string | null>(null);

  // Repart des vraies valeurs de l'article à chaque changement de sélection
  // (ou après une mise à jour reçue d'ailleurs) — sans ça, les champs
  // garderaient l'état du PRÉCÉDENT article sélectionné.
  useEffect(() => {
    setPrice(item.price);
    setStock(item.stock === null ? '' : String(item.stock));
    setNegotiable(item.haggle_dc !== null);
    setHaggleDc(item.haggle_dc ?? 15);
    setHaggleDiscount(item.haggle_discount_percent ?? 20);
  }, [item.id, item.price, item.stock, item.haggle_dc, item.haggle_discount_percent]);

  const commit = async (patch: { price?: number; stock?: number | null; haggle_dc?: number | null; haggle_discount_percent?: number | null }) => {
    try {
      const { merchant: updated } = await api.updateMerchantItem(token, merchant.id, item.id, patch);
      onMerchantUpdate(updated);
      setSavingError(null);
    } catch (err) {
      setSavingError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  return (
    <div className="flex flex-1 flex-col text-sm">
      {item.image_url ? (
        <img src={item.image_url} alt={item.name} className="mb-3 w-full rounded-lg shadow-lg" />
      ) : (
        <div className="mb-3 flex aspect-[3/4] flex-col justify-between rounded-lg border-2 border-accent-500 bg-gradient-to-br from-arena-800 via-arena-900 to-black p-4">
          <p className="text-xs uppercase tracking-widest text-accent-500">{item.set_code}</p>
          <p className="font-display text-lg leading-tight text-neutral-100">{item.name}</p>
        </div>
      )}
      <h3 className="font-display text-lg text-accent-400">{item.name}</h3>
      <p className="mb-1 text-xs text-neutral-500">{item.item_type === 'card' ? 'Carte' : 'Booster'}</p>

      {item.item_type === 'booster' && item.set_code && <BoosterContentsPreview token={token} setCode={item.set_code} setId={item.card_set_id} />}

      {isGm && (
        <div className="space-y-2 border-t border-arena-700 pt-3">
          <label className="flex items-center justify-between gap-2 text-neutral-300">
            Prix
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                onBlur={() => price !== item.price && void commit({ price })}
                className="w-20 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
              />
              {currencyName}
            </span>
          </label>
          <label className="flex items-center justify-between gap-2 text-neutral-300">
            Stock
            <input
              type="number"
              min={0}
              placeholder="illimité"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              onBlur={() => {
                const parsed = stock.trim() === '' ? null : Number(stock);
                if (parsed !== item.stock) void commit({ stock: parsed });
              }}
              className="w-24 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
            />
          </label>

          <label className="flex items-center gap-2 pt-1 text-neutral-300">
            <input
              type="checkbox"
              checked={negotiable}
              onChange={(e) => {
                const checked = e.target.checked;
                setNegotiable(checked);
                if (checked) void commit({ haggle_dc: haggleDc, haggle_discount_percent: haggleDiscount });
                else void commit({ haggle_dc: null, haggle_discount_percent: null });
              }}
            />
            Négociable
          </label>
          {negotiable && (
            <>
              <label className="flex items-center justify-between gap-2 text-neutral-300">
                Dé minimum (DC)
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={haggleDc}
                  onChange={(e) => setHaggleDc(Number(e.target.value))}
                  className="w-16 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-neutral-300">
                Réduction si succès
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={haggleDiscount}
                    onChange={(e) => setHaggleDiscount(Number(e.target.value))}
                    className="w-16 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
                  />
                  %
                </span>
              </label>
              {/* Bouton explicite (demande utilisateur) — plus d'application
                  silencieuse à la perte de focus, il fallait valider pour de
                  vrai qu'un changement de DC/réduction était voulu. */}
              {(haggleDc !== item.haggle_dc || haggleDiscount !== item.haggle_discount_percent) && (
                <button
                  type="button"
                  onClick={() => void commit({ haggle_dc: haggleDc, haggle_discount_percent: haggleDiscount })}
                  className="w-full rounded bg-accent-500 px-2 py-1 text-xs font-semibold text-arena-950 transition hover:bg-accent-400"
                >
                  Valider le marchandage
                </button>
              )}
            </>
          )}
          {savingError && <p className="text-xs text-red-400">{savingError}</p>}

          <button type="button" onClick={onDeleted} className="mt-2 text-xs text-red-400 hover:text-red-300">
            Retirer l'article de la boutique
          </button>
        </div>
      )}

      {!isGm && (
        <div className="border-t border-arena-700 pt-3 text-neutral-300">
          <p className="text-lg font-semibold text-accent-400">
            {item.price} {currencyName}
          </p>
          <p className="text-xs text-neutral-500">{item.stock === null ? 'Stock illimité' : `Stock : ${item.stock}`}</p>
          {item.haggle_dc !== null && (
            <p className="mt-1 text-xs text-neutral-500">
              Négociable : dé {item.haggle_dc}+ → -{item.haggle_discount_percent}%
            </p>
          )}
        </div>
      )}

      {buyableCharacters.length > 0 && item.stock !== 0 && (
        <div className="mt-3 border-t border-arena-700 pt-3">
          <PurchaseWidget
            token={token}
            merchantId={merchant.id}
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
      )}
    </div>
  );
}

/**
 * Voir le contenu possible d'un booster avant de l'acheter — demande
 * utilisateur (feedback de ses amis) : jusqu'ici il fallait acheter à
 * l'aveugle pour savoir ce qu'un set pouvait contenir. Grille avec zoom au
 * survol pour lire les cartes, chargée à la demande (pas au premier rendu du
 * panneau détail) pour ne pas interroger le catalogue pour rien tant que
 * personne ne clique.
 */
function BoosterContentsPreview({ token, setCode, setId }: { token: string; setCode: string; setId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (cards !== null) return; // déjà chargé une fois
    setLoading(true);
    // setId préféré (voir CLAUDE.md — set_code seul est ambigu) ; set_code
    // reste le seul repère pour un article booster ajouté avant ce correctif.
    api
      .listCards(token, setId ? { set_id: setId, limit: 100 } : { set_code: setCode, limit: 100 })
      .then(({ cards: fetched }) => setCards(fetched))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="mb-3">
      <button type="button" onClick={toggle} className="text-xs text-accent-400 underline hover:text-accent-300">
        {expanded ? 'Masquer le contenu possible' : 'Voir le contenu possible'}
      </button>
      {expanded && (
        // Pas de scroll/overflow imbriqué ici : le panneau détail (le
        // <aside> parent) défile déjà lui-même — un conteneur overflow-auto
        // ici couperait le zoom au survol des cartes en bordure.
        <div className="mt-2 rounded-md border border-arena-700 bg-arena-800/60 p-2">
          {loading && <p className="text-xs text-neutral-500">Chargement...</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!loading && cards && cards.length === 0 && <p className="text-xs text-neutral-500">Aucune carte trouvée pour ce set.</p>}
          {!loading && cards && cards.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
              {cards.map((card) =>
                card.card_images[0] ? (
                  // image_url (pleine résolution), pas _small : le zoom centré
                  // (HoverZoomImage) affiche la carte en grand au milieu de
                  // l'écran au survol (demande utilisateur), une petite
                  // miniature serait floue une fois agrandie.
                  <HoverZoomImage key={card.id} src={card.card_images[0].image_url} alt={card.name} className="w-full cursor-zoom-in rounded" />
                ) : null,
              )}
            </div>
          )}
        </div>
      )}
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
  // Négociation déjà lancée (roll fait), pas encore utilisée pour acheter —
  // sépare le jet de la confirmation d'achat pour laisser le temps de voir
  // le résultat et de dépenser un reroll de Chance avant de valider.
  const [pendingHaggle, setPendingHaggle] = useState<ApiPendingHaggle | null>(null);
  const [rerollsLeft, setRerollsLeft] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeCharacterId = characterId || buyableCharacters[0]!.id;
  const negotiable = item.haggle_dc !== null;

  const resetHaggle = () => {
    setPendingHaggle(null);
    setRerollsLeft(null);
  };

  const handleRollHaggle = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const { haggle, remaining_luck_rerolls } = await api.haggleMerchantItem(token, merchantId, item.id, {
        character_id: activeCharacterId,
      });
      setPendingHaggle(haggle);
      setRerollsLeft(remaining_luck_rerolls);
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof ApiError ? err.message : 'Une erreur est survenue' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReroll = async () => {
    if (!pendingHaggle) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const { haggle, remaining_luck_rerolls } = await api.rerollMerchantHaggle(token, merchantId, pendingHaggle.id);
      setPendingHaggle(haggle);
      setRerollsLeft(remaining_luck_rerolls);
    } catch (err) {
      setFeedback({ ok: false, message: err instanceof ApiError ? err.message : 'Une erreur est survenue' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuy = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const data = await api.purchaseMerchantItem(token, merchantId, item.id, {
        character_id: activeCharacterId,
        quantity,
        haggle: haggling && !pendingHaggle ? {} : undefined,
        haggle_id: pendingHaggle?.id,
      });
      onPurchased(data);
      resetHaggle();
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
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={activeCharacterId}
          onChange={(e) => {
            setCharacterId(e.target.value);
            resetHaggle();
          }}
          className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-800 px-1.5 py-1 text-neutral-100"
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
          max={item.stock ?? undefined}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          className="w-14 rounded border border-arena-600 bg-arena-800 px-1.5 py-1 text-right text-neutral-100"
        />
      </div>

      {negotiable && (
        <label className="flex items-center gap-1.5 text-neutral-400">
          <input
            type="checkbox"
            checked={haggling}
            onChange={(e) => {
              setHaggling(e.target.checked);
              resetHaggle();
            }}
          />
          Marchander (dé {item.haggle_dc}+ → -{item.haggle_discount_percent}%)
        </label>
      )}

      {pendingHaggle && (
        <p className={`rounded border px-1.5 py-1 ${pendingHaggle.success ? 'border-emerald-700 text-emerald-400' : 'border-red-800 text-red-400'}`}>
          {pendingHaggle.roll}+{pendingHaggle.modifier}={pendingHaggle.total} contre DC {pendingHaggle.dc} →{' '}
          {pendingHaggle.success ? `réussi, -${pendingHaggle.discount_percent}%` : 'échoué, prix plein'}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {haggling && !pendingHaggle && (
          <button
            type="button"
            onClick={() => void handleRollHaggle()}
            disabled={submitting}
            className="rounded border border-accent-500 px-2 py-1 text-accent-400 transition hover:bg-accent-500 hover:text-arena-950 disabled:opacity-50"
          >
            Lancer le marchandage
          </button>
        )}
        {pendingHaggle && !pendingHaggle.success && (rerollsLeft ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => void handleReroll()}
            disabled={submitting}
            className="rounded border border-accent-500 px-2 py-1 text-accent-400 transition hover:bg-accent-500 hover:text-arena-950 disabled:opacity-50"
          >
            Relancer (Chance : {rerollsLeft})
          </button>
        )}
        {(!haggling || pendingHaggle) && (
          <button
            type="button"
            onClick={() => void handleBuy()}
            disabled={submitting}
            className="rounded bg-accent-500 px-3 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            Acheter
          </button>
        )}
      </div>
      {feedback && <p className={feedback.ok ? 'text-emerald-400' : 'text-red-400'}>{feedback.message}</p>}
    </div>
  );
}
