import { env } from '../config/env';

// ~4 req/s : largement sous la limite de 20 req/s de l'API (CLAUDE.md §4).
const MIN_INTERVAL_MS = 260;
let lastCallAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
  return fetch(url);
}

export interface YgoCardSet {
  set_name: string;
  set_code: string;
  num_of_cards: number;
  tcg_date?: string;
  // Visuel officiel du boîtier/pack, hébergé par YGOPRODeck — absent pour de
  // très vieux sets (pas systématiquement fourni côté YGOPRODeck).
  set_image?: string;
}

export interface YgoCardSetRef {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code: string;
  set_price: string;
}

export interface YgoCardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface YgoCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  atk?: number;
  def?: number;
  level?: number;
  race?: string;
  attribute?: string;
  archetype?: string;
  // Échelle Pendule (monstres Pendule uniquement) et flèches Link (monstres
  // Link uniquement) — confirmés en direct contre le vrai endpoint
  // cardinfo.php ("scale": 4 pour Odd-Eyes Pendulum Dragon ; "linkmarkers":
  // ["Top","Bottom-Left","Bottom-Right"] pour Decode Talker), absents du
  // reste des cartes plutôt que null.
  scale?: number;
  linkval?: number;
  linkmarkers?: string[];
  card_sets?: YgoCardSetRef[];
  card_images: YgoCardImage[];
}

export async function fetchCardSets(): Promise<YgoCardSet[]> {
  const res = await throttledFetch(`${env.YGOPRODECK_API_URL}/cardsets.php`);
  if (!res.ok) throw new Error(`YGOPRODeck cardsets.php a répondu ${res.status}`);
  return (await res.json()) as YgoCardSet[];
}

export async function fetchCardsBySet(setName: string): Promise<YgoCard[]> {
  const url = `${env.YGOPRODECK_API_URL}/cardinfo.php?cardset=${encodeURIComponent(setName)}`;
  const res = await throttledFetch(url);
  if (res.status === 400) {
    // YGOPRODeck répond 400 (pas 200 avec liste vide) quand aucune carte ne correspond.
    return [];
  }
  if (!res.ok) throw new Error(`YGOPRODeck cardinfo.php a répondu ${res.status}`);
  const body = (await res.json()) as { data?: YgoCard[] };
  return body.data ?? [];
}
