export interface ApiUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
}

export interface ApiSession {
  id: string;
  code: string;
  currency_name: string;
  custom_banlist: string[];
  player_count: number;
  is_gm: boolean;
}

export interface ApiCharacterStats {
  history: number;
  perception: number;
  intelligence: number;
  charisma: number;
  luck: number;
}

export interface ApiDeck {
  id: string;
  name: string;
  cards: string[];
}

export interface ApiDeckCardEntry {
  card: ApiCard;
  quantity: number;
}

export interface ApiDeckDetail {
  id: string;
  name: string;
  main: ApiDeckCardEntry[];
  extra: ApiDeckCardEntry[];
  main_count: number;
  extra_count: number;
  main_min: number;
  main_max: number;
  extra_max: number;
  is_valid: boolean;
}

export interface ApiSealedBooster {
  set_code: string;
  set_name: string;
  quantity: number;
}

export interface ApiCharacter {
  id: string;
  user_id: string;
  game_session_id: string;
  name: string;
  is_npc: boolean;
  level: number;
  experience: number;
  money: number;
  backstory: string;
  personality: string;
  visual_description: string;
  stats: ApiCharacterStats;
  remaining_luck_rerolls: number;
  inventory: string[];
  collection: string[];
  sealed_boosters: ApiSealedBooster[];
  decks: ApiDeck[];
}

export interface CreateCharacterInput {
  game_session_id: string;
  name: string;
  is_npc: boolean;
  stats: ApiCharacterStats;
  backstory: string;
  personality: string;
  visual_description: string;
}

export interface ApiCardSet {
  set_code: string;
  set_name: string;
  num_of_cards: number;
  tcg_date: string | null;
  imported: boolean;
  imported_at: string | null;
}

export interface ApiCardSetRef {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code: string;
  set_price: string;
}

export interface ApiCardImage {
  image_id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

export interface ApiCard {
  id: string;
  ygoprodeck_id: number | null;
  name: string;
  type: string;
  frame_type: string;
  description: string;
  atk: number | null;
  def: number | null;
  level_rank: number | null;
  race: string | null;
  attribute: string | null;
  archetype: string | null;
  pendulum_scale: number | null;
  link_arrows: string[];
  card_sets: ApiCardSetRef[];
  card_images: ApiCardImage[];
  is_custom: boolean;
}

export type CustomCardCategory = 'monster' | 'spell' | 'trap';
export type MonsterKind = 'normal' | 'effect' | 'ritual' | 'fusion' | 'synchro' | 'xyz' | 'link';
export type CardAttribute = 'DARK' | 'LIGHT' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';
export type SpellType = 'normal' | 'continuous' | 'quick-play' | 'equip' | 'field' | 'ritual';
export type TrapType = 'normal' | 'continuous' | 'counter';
export type LinkArrow = 'top' | 'top-left' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom-right' | 'bottom';
export type CustomCardRarity =
  | 'Common'
  | 'Rare'
  | 'Super Rare'
  | 'Ultra Rare'
  | 'Secret Rare'
  | 'Ultimate Rare'
  | 'Ghost Rare'
  | 'Starlight Rare';

interface CustomCardCommonInput {
  name: string;
  effect_text: string;
  image_url?: string;
  archetype?: string;
}

export interface CustomCardMonsterInput extends CustomCardCommonInput {
  category: 'monster';
  monster_kind: MonsterKind;
  is_pendulum?: boolean;
  attribute: CardAttribute;
  race: string;
  atk: number;
  def?: number;
  level_rank?: number;
  link_rating?: number;
  link_arrows?: LinkArrow[];
  pendulum_scale?: number;
}

export interface CustomCardSpellInput extends CustomCardCommonInput {
  category: 'spell';
  spell_type: SpellType;
}

export interface CustomCardTrapInput extends CustomCardCommonInput {
  category: 'trap';
  trap_type: TrapType;
}

export type CustomCardInput = CustomCardMonsterInput | CustomCardSpellInput | CustomCardTrapInput;

export interface ApiCustomCard {
  id: string;
  name: string;
  type: string;
  frame_type: string;
  description: string;
  atk: number | null;
  def: number | null;
  level_rank: number | null;
  race: string | null;
  attribute: string | null;
  archetype: string | null;
  pendulum_scale: number | null;
  link_arrows: string[];
  card_sets: ApiCardSetRef[];
  card_images: ApiCardImage[];
  is_custom: true;
  owner_id: string | null;
  created_in_session_id: string | null;
  created_in_this_session?: boolean;
}

export type ApiMerchantItemType = 'card' | 'booster';

export interface ApiMerchantItem {
  id: string;
  item_type: ApiMerchantItemType;
  card_id: string | null;
  set_code: string | null;
  name: string;
  image_url: string | null;
  price: number;
  stock: number | null;
}

export interface ApiMerchant {
  id: string;
  game_session_id: string;
  name: string;
  description: string;
  haggle_dc: number;
  items: ApiMerchantItem[];
}

export interface ApiHaggleResult {
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  discount_percent: number;
}

/** Négociation déjà lancée (POST .../haggle), pas encore consommée par un achat — voir POST .../haggle/:id/reroll et purchaseMerchantItem's haggle_id. */
export interface ApiPendingHaggle {
  id: string;
  item_id: string;
  character_id: string;
  modifier: number;
  discount_percent: number;
  dc: number;
  roll: number;
  total: number;
  success: boolean;
}

export interface ApiPurchaseResult {
  item_type: ApiMerchantItemType;
  quantity: number;
  unit_price: number;
  total_price: number;
  haggle: ApiHaggleResult | null;
}

export interface ApiPurchaseResponse {
  merchant: ApiMerchant;
  character: { id: string; money: number; collection: string[]; sealed_boosters: ApiSealedBooster[] };
  purchase: ApiPurchaseResult;
}

export interface ApiCollectionEntry {
  card: ApiCard;
  quantity: number;
  // Date de sortie connue la plus ancienne parmi les sets où la carte
  // apparaît (null si aucun set référencé n'a de tcg_date connue).
  release_date: string | null;
  // Position de la première occurrence dans la collection brute : proxy
  // pour "ordre d'acquisition" (pas de vrai timestamp par carte).
  acquired_order: number;
}

export interface ApiOpenedCard {
  id: string;
  name: string;
  type: string;
  card_images: ApiCardImage[];
  rarity: string;
  // Super Rare et plus rare : déclenche la grande révélation (agrandissement + brillance) côté front.
  is_rare_reveal: boolean;
}

/**
 * Duel piloté par le vrai moteur ocgcore (EDOPro) — voir CLAUDE.md §7.
 * v1 : 1v1 uniquement (2 équipes, 1 participant chacune). Le plateau
 * détaillé (terrain, main) n'est PAS embarqué dans ce DTO : il se récupère à
 * la demande via `getDuelField` (round-trip séparé vers le process moteur),
 * voir ApiDuelField plus bas.
 */
export interface ApiDuelRules {
  starting_lp: number;
  hand_size: number;
  draw_count_per_turn: number;
  skip_first_battle_phase: boolean;
}

export interface ApiDuelTeam {
  name: string;
  life_points: number | null;
}

export interface ApiDuelParticipant {
  id: string;
  character_id: string;
  character_name: string;
  is_npc: boolean;
  team: 0 | 1;
  // Duel Tag (voir CLAUDE.md §7) : rang de ce participant au sein de son
  // camp (0 = premier ajouté). Plusieurs participants peuvent partager le
  // même `team` — PV et terrain sont alors communs à toute l'équipe.
  duelist_index: number;
  deck_id: string;
  hand_count: number | null;
  deck_remaining: number | null;
  // true si c'est CE participant qui a la main/le deck en jeu en ce moment
  // pour son équipe (un seul actif à la fois par camp — tourne
  // automatiquement au fil des tours, voir DuelBoardOverlay.tsx).
  is_active: boolean;
}

/** Une option de prompt (carte concernée par un choix moteur), résolue côté serveur (nom/image/stats attachés, pas juste un code). */
export interface ApiPromptCardOption {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  card: ApiCard | null;
}

export interface ApiDuelPromptIdle {
  type: 'idle';
  playerid: number;
  summonable: ApiPromptCardOption[];
  sp_summonable: ApiPromptCardOption[];
  repositionable: ApiPromptCardOption[];
  msetable: ApiPromptCardOption[];
  ssetable: ApiPromptCardOption[];
  activatable: (ApiPromptCardOption & { description: string })[];
  can_battle_phase: boolean;
  can_end_phase: boolean;
  can_shuffle_hand: boolean;
}

export interface ApiDuelPromptBattle {
  type: 'battle';
  playerid: number;
  activatable: (ApiPromptCardOption & { description: string })[];
  attackable: (ApiPromptCardOption & { directAttackable: boolean })[];
  can_main2: boolean;
  can_end_phase: boolean;
}

export interface ApiDuelPromptSelectCard {
  type: 'select_card';
  playerid: number;
  cancelable: boolean;
  min: number;
  max: number;
  cards: (ApiPromptCardOption & { position: number })[];
}

export interface ApiDuelPromptSelectPlace {
  type: 'select_place';
  playerid: number;
  count: number;
  /** Bit à 1 = zone indisponible (voir firstAvailablePlace côté logique). */
  flag: number;
}

export interface ApiDuelPromptChain {
  type: 'chain';
  playerid: number;
  /** Si vrai, cette invite ne peut pas être passée. */
  forced: boolean;
  options: (ApiPromptCardOption & { position: number; description: string })[];
}

export interface ApiTributeCardOption {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  /** Nombre de "points" de tribut que compte cette carte (quasi toujours 1). */
  releaseParam: number;
  card: ApiCard | null;
}

export interface ApiDuelPromptSelectTribute {
  type: 'select_tribute';
  playerid: number;
  cancelable: boolean;
  min: number;
  max: number;
  cards: ApiTributeCardOption[];
}

export interface ApiDuelPromptSelectPosition {
  type: 'select_position';
  playerid: number;
  code: number;
  card: ApiCard | null;
  /** Bitmask des positions légales — voir Position (FACEUP_ATTACK/FACEDOWN_ATTACK/FACEUP_DEFENSE/FACEDOWN_DEFENSE). */
  positions: number;
}

export interface ApiDuelPromptSelectOption {
  type: 'select_option';
  playerid: number;
  /** Un identifiant d'effet par option, pas de texte : aucune donnée structurée d'effet n'existe pour le décoder (voir CLAUDE.md §7). */
  options: string[];
}

export interface ApiDuelPromptYesNo {
  type: 'yesno';
  playerid: number;
}

export interface ApiDuelPromptEffectYesNo {
  type: 'effectyn';
  playerid: number;
  code: number;
  card: ApiCard | null;
}

export interface ApiDuelPromptUnhandled {
  type: 'unhandled';
  raw_type: number;
}

export type ApiDuelPrompt =
  | ApiDuelPromptIdle
  | ApiDuelPromptBattle
  | ApiDuelPromptSelectCard
  | ApiDuelPromptSelectPlace
  | ApiDuelPromptChain
  | ApiDuelPromptSelectTribute
  | ApiDuelPromptSelectPosition
  | ApiDuelPromptSelectOption
  | ApiDuelPromptYesNo
  | ApiDuelPromptEffectYesNo
  | ApiDuelPromptUnhandled;

export interface ApiDuelEvent {
  message: string;
  created_at: string;
}

export interface ApiDuel {
  id: string;
  game_session_id: string;
  name: string;
  status: 'active' | 'finished' | 'lost';
  starting_lp: number;
  hand_size: number;
  draw_count_per_turn: number;
  teams: [ApiDuelTeam, ApiDuelTeam];
  participants: ApiDuelParticipant[];
  phase: string | null;
  turn_number: number | null;
  current_team: 0 | 1 | null;
  pending_prompt: ApiDuelPrompt | null;
  winner_team: number | null;
  events: ApiDuelEvent[];
}

/** Une carte sur une zone publique (terrain/cimetière/bannis) ou une zone secrète autorisée (main/Extra du contrôleur+MJ). */
export interface ApiDuelBoardCard {
  code: number;
  position: number;
  face_down: boolean;
  attack: number | null;
  defense: number | null;
  overlay_count: number;
  counters: number[];
  card: ApiCard | null;
}

export interface ApiDuelFieldTeam {
  monster_zones: Array<ApiDuelBoardCard | null>;
  spell_trap_zones: Array<ApiDuelBoardCard | null>;
  graveyard: ApiDuelBoardCard[];
  banished: ApiDuelBoardCard[];
  // null = non autorisé à voir cette zone secrète (ni MJ, ni contrôleur) — le compte reste dans ApiDuelParticipant.hand_count.
  hand: ApiDuelBoardCard[] | null;
  extra_deck: ApiDuelBoardCard[] | null;
}

export interface ApiDuelField {
  teams: [ApiDuelFieldTeam, ApiDuelFieldTeam];
}

export interface CreateDuelTeamInput {
  name: string;
  // 1 à 5 participants (Duel Tag : PV/terrain partagés par camp, decks qui
  // tournent au fil des tours — voir CLAUDE.md §7). L'ordre dans ce tableau
  // devient `duelist_index`.
  participants: Array<{ character_id: string; deck_id: string }>;
}

export interface CreateDuelInput {
  game_session_id: string;
  name: string;
  rules?: Partial<ApiDuelRules>;
  teams: [CreateDuelTeamInput, CreateDuelTeamInput];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

/** Requêtes relatives : le proxy Vite (dev) ou Nginx (prod) route vers le backend. */
async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...options, headers });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message ?? `Erreur HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }

  return body as T;
}

export const api = {
  register: (username: string, email: string, password: string) =>
    request<{ token: string; user: ApiUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) => request<{ user: ApiUser }>('/auth/me', {}, token),

  createSession: (token: string, currencyName: string) =>
    request<{ session: ApiSession }>(
      '/sessions',
      { method: 'POST', body: JSON.stringify({ currency_name: currencyName }) },
      token,
    ),

  joinSession: (token: string, code: string) =>
    request<{ session: ApiSession }>(`/sessions/${encodeURIComponent(code)}/join`, { method: 'POST' }, token),

  getSession: (token: string, code: string) =>
    request<{ session: ApiSession }>(`/sessions/${encodeURIComponent(code)}`, {}, token),

  listMySessions: (token: string) => request<{ sessions: ApiSession[] }>('/sessions/mine', {}, token),

  deleteSession: (token: string, code: string) =>
    request<null>(`/sessions/${encodeURIComponent(code)}`, { method: 'DELETE' }, token),

  listCharacters: (token: string, sessionId: string) =>
    request<{ characters: ApiCharacter[] }>(`/characters/session/${encodeURIComponent(sessionId)}`, {}, token),

  createCharacter: (token: string, input: CreateCharacterInput) =>
    request<{ character: ApiCharacter }>('/characters', { method: 'POST', body: JSON.stringify(input) }, token),

  deleteCharacter: (token: string, characterId: string) =>
    request<null>(`/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' }, token),

  updateCharacterMoney: (token: string, characterId: string, money: number) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}`,
      { method: 'PATCH', body: JSON.stringify({ money }) },
      token,
    ),

  listCardSets: (token: string, params?: { refresh?: boolean; search?: string }) =>
    request<{ sets: ApiCardSet[] }>(`/cards/sets${buildQuery(params)}`, {}, token),

  importCardSet: (token: string, setCode: string) =>
    request<{ set_name: string; imported_count: number }>(
      `/cards/sets/${encodeURIComponent(setCode)}/import`,
      { method: 'POST' },
      token,
    ),

  listCards: (
    token: string,
    params?: {
      set_code?: string;
      search?: string;
      // Filtre directement le catalogue côté serveur (mêmes dimensions que
      // CollectionFilters) : évite de filtrer côté client une page qui ne
      // représente qu'une fraction du catalogue complet.
      category?: string; // "monster,spell,trap"
      monster_kind?: string; // "normal,effect,..."
      pendulum?: boolean;
      attribute?: string; // "DARK,LIGHT,..."
      race?: string; // races monstres ET sous-types magie/piège, comma-séparés
      page?: number;
      limit?: number;
    },
  ) => request<{ cards: ApiCard[]; total: number; page: number; limit: number }>(`/cards${buildQuery(params)}`, {}, token),

  listMerchants: (token: string, sessionId: string) =>
    request<{ merchants: ApiMerchant[] }>(`/merchants/session/${encodeURIComponent(sessionId)}`, {}, token),

  createMerchant: (token: string, sessionId: string, name: string, description: string, haggleDc: number) =>
    request<{ merchant: ApiMerchant }>(
      '/merchants',
      { method: 'POST', body: JSON.stringify({ game_session_id: sessionId, name, description, haggle_dc: haggleDc }) },
      token,
    ),

  deleteMerchant: (token: string, merchantId: string) =>
    request<null>(`/merchants/${encodeURIComponent(merchantId)}`, { method: 'DELETE' }, token),

  addMerchantItem: (
    token: string,
    merchantId: string,
    input: { item_type: ApiMerchantItemType; card_id?: string; set_code?: string; price: number; stock?: number | null },
  ) =>
    request<{ merchant: ApiMerchant }>(
      `/merchants/${encodeURIComponent(merchantId)}/items`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  updateMerchantItem: (token: string, merchantId: string, itemId: string, input: { price?: number; stock?: number | null }) =>
    request<{ merchant: ApiMerchant }>(
      `/merchants/${encodeURIComponent(merchantId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      token,
    ),

  deleteMerchantItem: (token: string, merchantId: string, itemId: string) =>
    request<{ merchant: ApiMerchant }>(
      `/merchants/${encodeURIComponent(merchantId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
      token,
    ),

  purchaseMerchantItem: (
    token: string,
    merchantId: string,
    itemId: string,
    input: { character_id: string; quantity?: number; haggle?: { modifier: number; discount_percent: number }; haggle_id?: string },
  ) =>
    request<ApiPurchaseResponse>(
      `/merchants/${encodeURIComponent(merchantId)}/items/${encodeURIComponent(itemId)}/purchase`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  /** Lance le marchandage SANS acheter — le résultat peut être relancé (Chance) avant de confirmer l'achat via purchaseMerchantItem's haggle_id. */
  haggleMerchantItem: (
    token: string,
    merchantId: string,
    itemId: string,
    input: { character_id: string; modifier: number; discount_percent: number },
  ) =>
    request<{ haggle: ApiPendingHaggle; remaining_luck_rerolls: number }>(
      `/merchants/${encodeURIComponent(merchantId)}/items/${encodeURIComponent(itemId)}/haggle`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  /** Dépense un reroll de Chance sur une négociation déjà lancée (pas encore utilisée pour un achat). */
  rerollMerchantHaggle: (token: string, merchantId: string, haggleId: string) =>
    request<{ haggle: ApiPendingHaggle; remaining_luck_rerolls: number }>(
      `/merchants/${encodeURIComponent(merchantId)}/haggle/${encodeURIComponent(haggleId)}/reroll`,
      { method: 'POST', body: JSON.stringify({}) },
      token,
    ),

  getCharacterCollection: (token: string, characterId: string) =>
    request<{ collection: ApiCollectionEntry[] }>(`/characters/${encodeURIComponent(characterId)}/collection`, {}, token),

  openBooster: (token: string, characterId: string, setCode: string, quantity?: number) =>
    request<{ character: ApiCharacter; opened_cards: ApiOpenedCard[] }>(
      `/characters/${encodeURIComponent(characterId)}/open-booster`,
      { method: 'POST', body: JSON.stringify({ set_code: setCode, quantity }) },
      token,
    ),

  createDeck: (token: string, characterId: string, name: string) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}/decks`,
      { method: 'POST', body: JSON.stringify({ name }) },
      token,
    ),

  renameDeck: (token: string, characterId: string, deckId: string, name: string) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}/decks/${encodeURIComponent(deckId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      token,
    ),

  deleteDeck: (token: string, characterId: string, deckId: string) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}/decks/${encodeURIComponent(deckId)}`,
      { method: 'DELETE' },
      token,
    ),

  getDeck: (token: string, characterId: string, deckId: string) =>
    request<{ deck: ApiDeckDetail }>(
      `/characters/${encodeURIComponent(characterId)}/decks/${encodeURIComponent(deckId)}`,
      {},
      token,
    ),

  addDeckCard: (token: string, characterId: string, deckId: string, cardId: string, quantity: number) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}/decks/${encodeURIComponent(deckId)}/cards`,
      { method: 'POST', body: JSON.stringify({ card_id: cardId, quantity }) },
      token,
    ),

  removeDeckCard: (token: string, characterId: string, deckId: string, cardId: string, quantity = 1) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}${buildQuery({ quantity })}`,
      { method: 'DELETE' },
      token,
    ),

  listDuels: (token: string, sessionId: string) =>
    request<{ duels: ApiDuel[] }>(`/duels/session/${encodeURIComponent(sessionId)}`, {}, token),

  getDuel: (token: string, duelId: string) => request<{ duel: ApiDuel }>(`/duels/${encodeURIComponent(duelId)}`, {}, token),

  getDuelField: (token: string, duelId: string) =>
    request<{ field: ApiDuelField }>(`/duels/${encodeURIComponent(duelId)}/field`, {}, token),

  createDuel: (token: string, input: CreateDuelInput) =>
    request<{ duel: ApiDuel }>('/duels', { method: 'POST', body: JSON.stringify(input) }, token),

  endDuel: (token: string, duelId: string, winnerTeam?: number | null) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/end`,
      { method: 'POST', body: JSON.stringify({ winner_team: winnerTeam ?? null }) },
      token,
    ),

  deleteDuel: (token: string, duelId: string) => request<null>(`/duels/${encodeURIComponent(duelId)}`, { method: 'DELETE' }, token),

  duelIdleAction: (token: string, duelId: string, participantId: string, category: number, index = 0) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/idle-action`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, category, index }) },
      token,
    ),

  duelBattleAction: (token: string, duelId: string, participantId: string, category: number, index = 0) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/battle-action`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, category, index }) },
      token,
    ),

  duelSelectPlace: (
    token: string,
    duelId: string,
    participantId: string,
    selections: Array<{ player: 0 | 1; location: number; sequence: number }>,
  ) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-place`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, selections }) },
      token,
    ),

  duelSelectCard: (token: string, duelId: string, participantId: string, indices: number[] | null) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-card`,
      { method: 'POST', body: JSON.stringify(indices === null ? { participant_id: participantId, cancel: true } : { participant_id: participantId, indices }) },
      token,
    ),

  duelChainAction: (token: string, duelId: string, participantId: string, index: number) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/chain-action`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, index }) },
      token,
    ),

  duelSelectTribute: (token: string, duelId: string, participantId: string, indices: number[] | null) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-tribute`,
      { method: 'POST', body: JSON.stringify(indices === null ? { participant_id: participantId, cancel: true } : { participant_id: participantId, indices }) },
      token,
    ),

  duelSelectPosition: (token: string, duelId: string, participantId: string, position: 0x1 | 0x2 | 0x4 | 0x8) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-position`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, position }) },
      token,
    ),

  duelSelectOption: (token: string, duelId: string, participantId: string, index: number) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-option`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, index }) },
      token,
    ),

  duelYesNo: (token: string, duelId: string, participantId: string, yes: boolean) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/yesno`,
      { method: 'POST', body: JSON.stringify({ participant_id: participantId, yes }) },
      token,
    ),

  listCustomCards: (token: string, sessionId: string) =>
    request<{ cards: ApiCustomCard[] }>(`/custom-cards/session/${encodeURIComponent(sessionId)}`, {}, token),

  createCustomCard: (token: string, sessionId: string, card: CustomCardInput) =>
    request<{ card: ApiCustomCard }>(
      '/custom-cards',
      { method: 'POST', body: JSON.stringify({ game_session_id: sessionId, card }) },
      token,
    ),

  updateCustomCard: (token: string, cardId: string, card: CustomCardInput) =>
    request<{ card: ApiCustomCard }>(
      `/custom-cards/${encodeURIComponent(cardId)}`,
      { method: 'PATCH', body: JSON.stringify({ card }) },
      token,
    ),

  deleteCustomCard: (token: string, cardId: string) =>
    request<null>(`/custom-cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' }, token),

  linkCustomCardToBooster: (
    token: string,
    cardId: string,
    input: { set_code?: string; new_set_name?: string; rarity?: CustomCardRarity },
  ) =>
    request<{ card: ApiCustomCard; card_set: { set_code: string; set_name: string } }>(
      `/custom-cards/${encodeURIComponent(cardId)}/booster-link`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  unlinkCustomCardFromBooster: (token: string, cardId: string, setCode: string) =>
    request<{ card: ApiCustomCard }>(
      `/custom-cards/${encodeURIComponent(cardId)}/booster-link/${encodeURIComponent(setCode)}`,
      { method: 'DELETE' },
      token,
    ),

  /** Upload multipart : ne passe pas par `request()`, qui force Content-Type JSON. */
  uploadCardImage: async (token: string, file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch('/api/uploads/card-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.error?.message ?? `Erreur HTTP ${response.status}`;
      throw new ApiError(response.status, message);
    }
    return body as { url: string };
  },
};
