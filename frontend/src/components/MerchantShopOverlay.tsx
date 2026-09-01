import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type ApiCard,
  type ApiCharacter,
  type ApiMerchant,
  type ApiMerchantItem,
  type ApiPendingHaggle,
  type ApiSealedBooster,
} from '../lib/api';
import { translateApiError } from '../lib/translateApiError';
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
  const { t } = useTranslation();
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
      setError(translateApiError(err, t));
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
      setError(translateApiError(err, t));
    } finally {
      setRefreshingImages(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('merchantShop.eyebrow')}</p>
          <h2 className="font-display text-2xl text-accent-400">{merchant.name}</h2>
          {merchant.description && <p className="mt-0.5 max-w-xl truncate text-sm text-neutral-400">{merchant.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isGm && hasCardItems && (
            <button
              type="button"
              onClick={() => void handleRefreshImages()}
              disabled={refreshingImages}
              title={t('merchantShop.refresh_images_tooltip')}
              className="rounded-md border border-arena-600 px-3 py-2 text-xs text-neutral-300 transition hover:border-accent-500 hover:text-accent-400 disabled:opacity-50"
            >
              {refreshingImages ? t('merchantShop.refreshing') : t('merchantShop.refresh_images')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
          >
            {t('characterSheet.close')}
          </button>
        </div>
      </header>

      {error && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {merchant.items.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('merchantShop.no_items_yet')}</p>
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
                  {t('merchantShop.add_item')}
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
            <p className="text-sm text-neutral-500">{t('merchantShop.select_item_prompt')}</p>
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
  const { t } = useTranslation();
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
          <span className="absolute left-1 top-1 rounded bg-arena-950/85 px-1 py-0.5 text-[8px] uppercase tracking-wide text-accent-400">
            {t('merchantShop.negotiable_badge')}
          </span>
        )}
        {item.promo_buy_quantity !== null && item.promo_free_quantity !== null && (
          <span className="absolute right-1 top-1 rounded bg-arena-950/85 px-1 py-0.5 text-[8px] uppercase tracking-wide text-emerald-400">
            {item.promo_buy_quantity}+{item.promo_free_quantity}
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] uppercase tracking-widest text-red-400">
            {t('merchantShop.sold_out_badge')}
          </span>
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
  const { t } = useTranslation();
  const [price, setPrice] = useState(item.price);
  const [stock, setStock] = useState(item.stock === null ? '' : String(item.stock));
  const [negotiable, setNegotiable] = useState(item.haggle_dc !== null);
  const [haggleDc, setHaggleDc] = useState(item.haggle_dc ?? 15);
  const [haggleDiscount, setHaggleDiscount] = useState(item.haggle_discount_percent ?? 20);
  // Offre "achetés/offerts" (ex. "10 achetés, 1 offert") — même convention
  // que le marchandage ci-dessus : case à cocher + deux champs révélés,
  // bouton "Valider" explicite (pas d'application silencieuse au blur).
  const [hasPromo, setHasPromo] = useState(item.promo_buy_quantity !== null);
  const [promoBuyQuantity, setPromoBuyQuantity] = useState(item.promo_buy_quantity ?? 10);
  const [promoFreeQuantity, setPromoFreeQuantity] = useState(item.promo_free_quantity ?? 1);
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
    setHasPromo(item.promo_buy_quantity !== null);
    setPromoBuyQuantity(item.promo_buy_quantity ?? 10);
    setPromoFreeQuantity(item.promo_free_quantity ?? 1);
  }, [
    item.id,
    item.price,
    item.stock,
    item.haggle_dc,
    item.haggle_discount_percent,
    item.promo_buy_quantity,
    item.promo_free_quantity,
  ]);

  const commit = async (patch: {
    price?: number;
    stock?: number | null;
    haggle_dc?: number | null;
    haggle_discount_percent?: number | null;
    promo_buy_quantity?: number | null;
    promo_free_quantity?: number | null;
  }) => {
    try {
      const { merchant: updated } = await api.updateMerchantItem(token, merchant.id, item.id, patch);
      onMerchantUpdate(updated);
      setSavingError(null);
    } catch (err) {
      setSavingError(translateApiError(err, t));
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
      <p className="mb-1 text-xs text-neutral-500">{item.item_type === 'card' ? t('merchantPicker.type_card') : t('merchantPicker.type_booster')}</p>

      {item.item_type === 'booster' && item.set_code && (
        <BoosterContentsButton token={token} setCode={item.set_code} setId={item.card_set_id} setName={item.name} />
      )}

      {isGm && (
        <div className="space-y-2 border-t border-arena-700 pt-3">
          <label className="flex items-center justify-between gap-2 text-neutral-300">
            {t('merchantPicker.price')}
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
            {t('merchantPicker.stock')}
            <input
              type="number"
              min={0}
              placeholder={t('merchantPicker.stock_placeholder')}
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
            {t('merchantShop.negotiable_badge')}
          </label>
          {negotiable && (
            <>
              <label className="flex items-center justify-between gap-2 text-neutral-300">
                {t('merchantShop.haggle_dc_label')}
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
                {t('merchantShop.haggle_discount_label')}
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
                  {t('merchantShop.validate_haggle')}
                </button>
              )}
            </>
          )}

          <label className="flex items-center gap-2 pt-1 text-neutral-300">
            <input
              type="checkbox"
              checked={hasPromo}
              onChange={(e) => {
                const checked = e.target.checked;
                setHasPromo(checked);
                if (checked) void commit({ promo_buy_quantity: promoBuyQuantity, promo_free_quantity: promoFreeQuantity });
                else void commit({ promo_buy_quantity: null, promo_free_quantity: null });
              }}
            />
            {t('merchantShop.promo_checkbox')}
          </label>
          {hasPromo && (
            <>
              <label className="flex items-center justify-between gap-2 text-neutral-300">
                {t('merchantShop.promo_buy_label')}
                <input
                  type="number"
                  min={1}
                  value={promoBuyQuantity}
                  onChange={(e) => setPromoBuyQuantity(Number(e.target.value))}
                  className="w-16 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-neutral-300">
                {t('merchantShop.promo_free_label')}
                <input
                  type="number"
                  min={1}
                  value={promoFreeQuantity}
                  onChange={(e) => setPromoFreeQuantity(Number(e.target.value))}
                  className="w-16 rounded border border-arena-600 bg-arena-800 px-2 py-1 text-right text-neutral-100 outline-none focus:border-accent-500"
                />
              </label>
              {(promoBuyQuantity !== item.promo_buy_quantity || promoFreeQuantity !== item.promo_free_quantity) && (
                <button
                  type="button"
                  onClick={() => void commit({ promo_buy_quantity: promoBuyQuantity, promo_free_quantity: promoFreeQuantity })}
                  className="w-full rounded bg-accent-500 px-2 py-1 text-xs font-semibold text-arena-950 transition hover:bg-accent-400"
                >
                  {t('merchantShop.validate_promo')}
                </button>
              )}
            </>
          )}
          {savingError && <p className="text-xs text-red-400">{savingError}</p>}

          <button type="button" onClick={onDeleted} className="mt-2 text-xs text-red-400 hover:text-red-300">
            {t('merchantShop.remove_item')}
          </button>
        </div>
      )}

      {!isGm && (
        <div className="border-t border-arena-700 pt-3 text-neutral-300">
          <p className="text-lg font-semibold text-accent-400">
            {item.price} {currencyName}
          </p>
          <p className="text-xs text-neutral-500">{item.stock === null ? t('merchantShop.unlimited_stock') : t('merchantShop.stock_count', { count: item.stock })}</p>
          {item.haggle_dc !== null && (
            <p className="mt-1 text-xs text-neutral-500">
              {t('merchantShop.negotiable_terms', { dc: item.haggle_dc, discount: item.haggle_discount_percent })}
            </p>
          )}
          {item.promo_buy_quantity !== null && item.promo_free_quantity !== null && (
            <p className="mt-1 text-xs text-emerald-400">
              {t('merchantShop.promo_terms', { buy: item.promo_buy_quantity, free: item.promo_free_quantity, count: item.promo_free_quantity })}
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

/** Ouvre BoosterContentsOverlay — bouton simple, l'overlay porte tout le chargement. */
function BoosterContentsButton({ token, setCode, setId, setName }: { token: string; setCode: string; setId: string | null; setName: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-400 underline hover:text-accent-300">
        {t('merchantShop.view_booster_contents')}
      </button>
      {open && <BoosterContentsOverlay token={token} setCode={setCode} setId={setId} setName={setName} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * Interface dédiée pour voir l'ENTIÈRETÉ du contenu d'un booster avant de
 * l'acheter (demande utilisateur — pouvoir peser le pour et contre entre
 * différents boosters, pas juste un aperçu partiel) : plein écran, grille
 * scindée par rareté avec un compteur par groupe (pour comparer d'un coup
 * d'œil la répartition d'un booster à l'autre), zoom au survol pour lire
 * chaque carte. Chargé à l'ouverture, pas au premier rendu du panneau détail.
 */
function BoosterContentsOverlay({
  token,
  setCode,
  setId,
  setName,
  onClose,
}: {
  token: string;
  setCode: string;
  setId: string | null;
  setName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<ApiCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // setId préféré (voir CLAUDE.md — set_code seul est ambigu). Pour un
    // article booster ajouté avant ce correctif (setId absent), setName
    // (déjà le nom exact capturé à l'ajout de l'article) résout quand même
    // précisément — jamais besoin de retomber sur set_code seul, ambigu.
    // limit à 300 : la totalité d'un vrai set officiel connu (ex. LOB, 126
    // cartes distinctes), jamais tronquée.
    api
      .listCards(token, setId ? { set_id: setId, limit: 300 } : { set_code: setCode, set_name: setName, limit: 300 })
      .then(({ cards: fetched }) => setCards(fetched))
      .catch((err) => setError(translateApiError(err, t)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, setId, setCode, setName]);

  // La rareté d'une carte dépend du PRODUIT dans lequel elle est vendue —
  // une carte peut être réimprimée ailleurs avec une autre rareté, donc on
  // relit card_sets pour CE set précis (par nom, jamais par set_code seul
  // ambigu — voir CLAUDE.md) plutôt que d'afficher une rareté au hasard.
  const rarityFor = (card: ApiCard) => card.card_sets.find((s) => s.set_name === setName)?.set_rarity ?? t('merchantShop.unknown_rarity');

  const groups = new Map<string, ApiCard[]>();
  for (const card of cards ?? []) {
    const rarity = rarityFor(card);
    const bucket = groups.get(rarity);
    if (bucket) bucket.push(card);
    else groups.set(rarity, [card]);
  }
  // Le plus gros groupe (typiquement Common) en premier — la répartition en
  // un coup d'œil est justement le point de cette vue (comparer un booster à
  // l'autre), pas un ordre alphabétique arbitraire.
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">{t('merchantShop.booster_contents_title')}</p>
          <h2 className="font-display text-xl text-accent-400">{setName}</h2>
          {cards && (
            <p className="mt-1 text-xs text-neutral-500">
              {t('merchantShop.distinct_cards', { count: cards.length })} ·{' '}
              {orderedGroups.map(([rarity, group], i) => (
                <span key={rarity}>
                  {i > 0 && ' · '}
                  {rarity} : {group.length}
                </span>
              ))}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-arena-600 px-4 py-2 text-sm text-neutral-300 transition hover:border-accent-500 hover:text-accent-400"
        >
          {t('characterSheet.close')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && cards && cards.length === 0 && <p className="text-sm text-neutral-500">{t('merchantShop.no_cards_for_set')}</p>}

        {!loading &&
          orderedGroups.map(([rarity, group]) => (
            <div key={rarity} className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {rarity} <span className="text-neutral-600">({group.length})</span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
                {group.map((card) =>
                  card.card_images[0] ? (
                    <div key={card.id} className="text-center">
                      {/* image_url (pleine résolution), pas _small : le zoom
                          centré (HoverZoomImage) affiche la carte en grand au
                          milieu de l'écran au survol, une petite miniature
                          serait floue une fois agrandie. */}
                      <HoverZoomImage src={card.card_images[0].image_url} alt={card.name} className="w-full cursor-zoom-in rounded" />
                      <p className="mt-1 truncate text-[10px] text-neutral-400" title={card.name}>
                        {card.name}
                      </p>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          ))}
      </div>
    </div>,
    document.body,
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
  const { t } = useTranslation();
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
  // Aperçu client de l'offre "achetés/offerts" — purement cosmétique, le
  // serveur recalcule et livre les exemplaires offerts pour de vrai
  // (voir merchant.routes.ts POST .../purchase, bonus_quantity/delivered_quantity).
  const bonusPreview =
    item.promo_buy_quantity && item.promo_free_quantity
      ? Math.floor(quantity / item.promo_buy_quantity) * item.promo_free_quantity
      : 0;

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
      setFeedback({ ok: false, message: translateApiError(err, t) });
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
      setFeedback({ ok: false, message: translateApiError(err, t) });
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
      const bonus =
        data.purchase.bonus_quantity > 0
          ? t('merchantShop.bonus_included', { count: data.purchase.bonus_quantity })
          : '';
      const message = h
        ? t('merchantShop.bought_with_haggle_message', {
            delivered: data.purchase.delivered_quantity,
            bonus,
            total: data.purchase.total_price,
            currency: currencyName,
            haggleDetail: `${t('merchantShop.haggle_roll_result', { roll: h.roll, modifier: h.modifier, total: h.total, dc: h.dc })} ${
              h.success ? t('merchantShop.haggle_success', { discount: h.discount_percent }) : t('merchantShop.haggle_failure')
            }`,
          })
        : t('merchantShop.bought_message', { delivered: data.purchase.delivered_quantity, bonus, total: data.purchase.total_price, currency: currencyName });
      setFeedback({ ok: true, message });
    } catch (err) {
      setFeedback({ ok: false, message: translateApiError(err, t) });
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

      {item.promo_buy_quantity !== null && item.promo_free_quantity !== null && (
        <p className="text-neutral-400">
          {t('merchantShop.promo_terms', { buy: item.promo_buy_quantity, free: item.promo_free_quantity, count: item.promo_free_quantity })}
          {bonusPreview > 0 && <span className="text-emerald-400">{t('merchantShop.promo_bonus_preview', { count: bonusPreview })}</span>}
        </p>
      )}

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
          {t('merchantShop.haggle_toggle', { dc: item.haggle_dc, discount: item.haggle_discount_percent })}
        </label>
      )}

      {pendingHaggle && (
        <p className={`rounded border px-1.5 py-1 ${pendingHaggle.success ? 'border-emerald-700 text-emerald-400' : 'border-red-800 text-red-400'}`}>
          {t('merchantShop.haggle_roll_result', { roll: pendingHaggle.roll, modifier: pendingHaggle.modifier, total: pendingHaggle.total, dc: pendingHaggle.dc })}{' '}
          {pendingHaggle.success ? t('merchantShop.haggle_success', { discount: pendingHaggle.discount_percent }) : t('merchantShop.haggle_failure')}
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
            {t('merchantShop.roll_haggle')}
          </button>
        )}
        {pendingHaggle && !pendingHaggle.success && (rerollsLeft ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => void handleReroll()}
            disabled={submitting}
            className="rounded border border-accent-500 px-2 py-1 text-accent-400 transition hover:bg-accent-500 hover:text-arena-950 disabled:opacity-50"
          >
            {t('merchantShop.reroll_luck', { count: rerollsLeft })}
          </button>
        )}
        {(!haggling || pendingHaggle) && (
          <button
            type="button"
            onClick={() => void handleBuy()}
            disabled={submitting}
            className="rounded bg-accent-500 px-3 py-1 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
          >
            {t('merchantShop.buy')}
          </button>
        )}
      </div>
      {feedback && <p className={feedback.ok ? 'text-emerald-400' : 'text-red-400'}>{feedback.message}</p>}
    </div>
  );
}
