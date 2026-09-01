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
  // Référence sans ambiguïté LE CardSet précis (voir CLAUDE.md — set_code
  // seul n'identifie pas un set de façon fiable) — null seulement pour une
  // entrée créée avant ce correctif (donnée historique).
  card_set_id: string | null;
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
  notes: string;
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
  // Identifiant stable (voir CLAUDE.md — set_code seul n'est pas unique dans
  // les vraies données) : à utiliser pour toute référence précise à CE set
  // précis (import, filtrage de cartes, article marchand...).
  id: string;
  set_code: string;
  set_name: string;
  num_of_cards: number;
  tcg_date: string | null;
  // Visuel officiel du boîtier/pack (YGOPRODeck) — null pour un set custom ou un vieux set sans image fournie.
  set_image: string | null;
  imported: boolean;
  imported_at: string | null;
  is_custom: boolean;
  // Voir CLAUDE.md — bug réel du set_code YGOPRODeck non-unique (ex. "LOB"
  // partagé entre le vrai set et sa réédition 25th Anniversary) : true si ce
  // set_code était partagé par 2+ sets lors de la dernière synchronisation.
  // Un set déjà importé (imported: true) avec ce flag peut porter les
  // mauvaises cartes et mérite un réimport.
  had_code_collision: boolean;
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

export interface ApiCardTranslations {
  // Officielle : peuplée au fil des imports/réimports (voir CardImportPanel.tsx
  // "Réimporter" — aucun backfill de masse). Custom : saisie par le MJ
  // créateur. Absente tant qu'aucune traduction n'existe pour cette carte —
  // voir lib/cardTranslation.ts pour l'affichage (repli sur name/description).
  fr?: { name: string; description: string };
}

export interface ApiCard {
  id: string;
  ygoprodeck_id: number | null;
  // Passcode moteur — identique à ygoprodeck_id pour une carte officielle,
  // synthétique pour une carte custom (voir CLAUDE.md §5). Utilisé pour
  // l'export YDK, qui a besoin d'un vrai passcode même pour une carte custom.
  engine_code: number | null;
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
  translations: ApiCardTranslations;
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
  // Second langue, optionnelle, saisie par le MJ (voir CLAUDE.md §3.4/§5 —
  // aucune traduction automatique possible pour du contenu inventé). Les
  // deux doivent être fournis ensemble pour que le backend enregistre la
  // traduction (voir customCard.routes.ts buildTranslations).
  name_fr?: string;
  effect_text_fr?: string;
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
  translations: ApiCardTranslations;
}

export type ApiMerchantItemType = 'card' | 'booster';

export interface ApiMerchantItem {
  id: string;
  item_type: ApiMerchantItemType;
  card_id: string | null;
  set_code: string | null;
  // Référence sans ambiguïté LE CardSet précis vendu (booster uniquement,
  // voir CLAUDE.md — set_code seul n'identifie pas un set de façon fiable) —
  // null pour un article carte, ou un article booster ajouté avant ce correctif.
  card_set_id: string | null;
  name: string;
  image_url: string | null;
  price: number;
  stock: number | null;
  // Marchandage propre à CET article (CLAUDE.md §3.5) — null sur l'un ou
  // l'autre = article non négociable (prix plein uniquement).
  haggle_dc: number | null;
  haggle_discount_percent: number | null;
  // Offre "achetés/offerts" propre à CET article (ex. "10 achetés, 1
  // offert") — null sur l'un ou l'autre = pas d'offre, même convention que
  // haggle_dc/haggle_discount_percent.
  promo_buy_quantity: number | null;
  promo_free_quantity: number | null;
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
  // Exemplaires offerts en plus par l'offre "achetés/offerts" de l'article
  // (0 si l'article n'en a pas), jamais facturés — voir promo_buy_quantity.
  bonus_quantity: number;
  // quantity + bonus_quantity : ce qui a réellement été livré (collection/sealed_boosters).
  delivered_quantity: number;
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

/** Résultat d'un import CSV de collection (voir CharacterList.tsx/GrantCardsOverlay.tsx). */
export interface ApiCsvImportSummary {
  total_copies_added: number;
  added: Array<{ card_name: string; quantity: number }>;
  not_found: Array<{ cardname: string; cardid: string }>;
  skipped: Array<{ row: number; cardname: string; reason: string }>;
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

export interface ApiDuelPromptSelectUnselectCard {
  type: 'select_unselect_card';
  playerid: number;
  /** Terminer avec la sélection actuelle (même sous `min`) sans annuler tout à fait — distinct de `cancelable`. */
  finishable: boolean;
  cancelable: boolean;
  min: number;
  max: number;
  // Un coût "release" scripté (ex. Crush Card Virus) : cartes déjà
  // "sélectionnées" (à désélectionner) séparées de celles pas encore
  // choisies — l'API répond par un index dans la liste CONCATÉNÉE
  // select_cards ++ unselect_cards (voir duelSelectUnselectCard).
  select_cards: (ApiPromptCardOption & { position: number })[];
  unselect_cards: (ApiPromptCardOption & { position: number })[];
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
  | ApiDuelPromptSelectUnselectCard
  | ApiDuelPromptSelectPosition
  | ApiDuelPromptSelectOption
  | ApiDuelPromptYesNo
  | ApiDuelPromptEffectYesNo
  | ApiDuelPromptUnhandled;

export interface ApiDuelEvent {
  message: string;
  // Additif (voir DuelEventAttrs côté backend, plan d'internationalisation
  // §6) : présents seulement pour un évènement catalogué — `message` reste
  // le repli français pour tout le reste (évènements plus anciens compris).
  code?: string;
  params?: Record<string, string | number>;
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
    // Code machine renvoyé par errorHandler.ts (déjà sur le fil aujourd'hui,
    // auparavant jeté ici) — sert de clé de traduction FR/EN, voir
    // lib/translateApiError.ts. Absent pour une erreur réseau/parsing pure
    // (ex. `Erreur HTTP 500` sans corps JSON exploitable).
    public readonly code?: string,
    // Paramètres structurés pour les rares codes AppError interpolés qu'on a
    // choisi de cataloguer (voir AppError côté backend) — absent pour tous
    // les autres codes, `translateApiError` retombe alors sur `message`.
    public readonly params?: Record<string, string | number>,
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
    throw new ApiError(response.status, message, body?.error?.code, body?.error?.params);
  }

  return body as T;
}

export const api = {
  /**
   * Deux issues possibles (voir auth.routes.ts) : `pending: true` (SMTP
   * configuré côté serveur — un code de vérification vient d'être envoyé,
   * le compte n'existe pas encore) ou `pending: false` avec token+user
   * (SMTP non configuré — comportement historique, création immédiate).
   */
  register: (username: string, email: string, password: string, lang?: 'fr' | 'en') =>
    request<{ pending: true; message: string } | { pending: false; token: string; user: ApiUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, lang }),
    }),

  verifyRegistration: (email: string, code: string) =>
    request<{ token: string; user: ApiUser }>('/auth/verify-registration', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: ApiUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) => request<{ user: ApiUser }>('/auth/me', {}, token),

  /** Toujours { message } même si l'email n'existe pas (anti-énumération de comptes) — voir auth.routes.ts. */
  forgotPassword: (email: string, lang?: 'fr' | 'en') =>
    request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email, lang }) }),

  resetPassword: (email: string, code: string, newPassword: string) =>
    request<{ token: string; user: ApiUser }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password: newPassword }),
    }),

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

  /** GM-only — "long repos" : recharge les rerolls de Chance de TOUS les personnages du salon à leur maximum en une seule action. */
  longRestSession: (token: string, sessionId: string) =>
    request<{ characters: ApiCharacter[] }>(
      `/characters/session/${encodeURIComponent(sessionId)}/long-rest`,
      { method: 'POST' },
      token,
    ),

  updateCharacterMoney: (token: string, characterId: string, money: number) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}`,
      { method: 'PATCH', body: JSON.stringify({ money }) },
      token,
    ),

  /** Champs RP/inventaire uniquement (voir la fiche de personnage stylisée) — le nom/le niveau/l'argent/les stats restent gérés par leurs propres contrôles dédiés. */
  updateCharacterProfile: (
    token: string,
    characterId: string,
    input: Partial<{ name: string; backstory: string; personality: string; visual_description: string; notes: string; inventory: string[] }>,
  ) =>
    request<{ character: ApiCharacter }>(
      `/characters/${encodeURIComponent(characterId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      token,
    ),

  /** GM-only — voir CLAUDE.md §3.5 "le MJ ajoute une ou plusieurs cartes à un joueur". */
  addCardToCollection: (token: string, characterId: string, cardId: string, quantity: number) =>
    request<{ character: ApiCharacter; added: { card: ApiCard; quantity: number } }>(
      `/characters/${encodeURIComponent(characterId)}/collection/add-card`,
      { method: 'POST', body: JSON.stringify({ card_id: cardId, quantity }) },
      token,
    ),

  /** GM-only — migration d'une collection existante (export "My Collection" YGOPRODeck). Upload multipart : ne passe pas par `request()`. */
  importCollectionCsv: async (token: string, characterId: string, file: File): Promise<{ character: ApiCharacter; summary: ApiCsvImportSummary }> => {
    const formData = new FormData();
    formData.append('csv', file);
    const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/collection/import-csv`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = body?.error?.message ?? `Erreur HTTP ${response.status}`;
      throw new ApiError(response.status, message);
    }
    return body as { character: ApiCharacter; summary: ApiCsvImportSummary };
  },

  listCardSets: (token: string, params?: { refresh?: boolean; search?: string; include_custom?: boolean }) =>
    request<{ sets: ApiCardSet[] }>(`/cards/sets${buildQuery(params)}`, {}, token),

  /** Booster custom vide (pas encore de carte liée) — voir CustomCardPanel.tsx, la gestion des cartes qu'il contient passe par linkCustomCardToBooster/unlinkCustomCardFromBooster. */
  createCustomBooster: (token: string, sessionId: string, name: string) =>
    request<{ card_set: { set_code: string; set_name: string } }>(
      '/custom-cards/boosters',
      { method: 'POST', body: JSON.stringify({ game_session_id: sessionId, name }) },
      token,
    ),

  /** 409 (booster_in_use) si un marchand le vend encore ou qu'un personnage en possède des exemplaires scellés non ouverts. */
  deleteCustomBooster: (token: string, setCode: string) =>
    request<null>(`/custom-cards/boosters/${encodeURIComponent(setCode)}`, { method: 'DELETE' }, token),

  /** Prend l'`id` du set (voir ApiCardSet), pas son set_code — voir CLAUDE.md. */
  importCardSet: (token: string, setId: string) =>
    request<{ set_name: string; imported_count: number }>(
      `/cards/sets/${encodeURIComponent(setId)}/import`,
      { method: 'POST' },
      token,
    ),

  listCards: (
    token: string,
    params?: {
      // Préféré (voir CLAUDE.md — set_code seul est ambigu).
      set_id?: string;
      // Repli précis quand set_id est absent : (set_code, set_name) ensemble
      // reste fiable même pour un article/booster créé avant l'introduction
      // de set_id (set_name est déjà un snapshot connu dans ce cas).
      set_name?: string;
      // Dernier repli seul (ambigu — résout arbitrairement vers le premier
      // set trouvé avec ce code) : à éviter si set_name est disponible.
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
      ability?: string; // "flip,tuner,..." — voir ABILITY_OPTIONS (cardFilters.ts)
      atk_min?: number;
      atk_max?: number;
      level_min?: number;
      level_max?: number;
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
    input: {
      item_type: ApiMerchantItemType;
      card_id?: string;
      // Préféré pour un article booster (voir CLAUDE.md). set_code reste
      // accepté seul en repli, ambigu si ce code est partagé.
      set_id?: string;
      set_code?: string;
      price: number;
      stock?: number | null;
      haggle_dc?: number | null;
      haggle_discount_percent?: number | null;
      promo_buy_quantity?: number | null;
      promo_free_quantity?: number | null;
    },
  ) =>
    request<{ merchant: ApiMerchant }>(
      `/merchants/${encodeURIComponent(merchantId)}/items`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  /** Rattrapage pour les articles carte ajoutés avant le passage à l'image pleine résolution (voir CLAUDE.md) — sans effet sur les articles booster. */
  refreshMerchantCardImages: (token: string, merchantId: string) =>
    request<{ merchant: ApiMerchant; updated_count: number }>(
      `/merchants/${encodeURIComponent(merchantId)}/refresh-card-images`,
      { method: 'POST' },
      token,
    ),

  updateMerchantItem: (
    token: string,
    merchantId: string,
    itemId: string,
    input: {
      price?: number;
      stock?: number | null;
      haggle_dc?: number | null;
      haggle_discount_percent?: number | null;
      promo_buy_quantity?: number | null;
      promo_free_quantity?: number | null;
    },
  ) =>
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

  // haggle: {} (juste "je marchande") suffit — le modificateur (Charisme du
  // personnage) est désormais calculé côté serveur, jamais fourni ici.
  purchaseMerchantItem: (
    token: string,
    merchantId: string,
    itemId: string,
    input: { character_id: string; quantity?: number; haggle?: object; haggle_id?: string },
  ) =>
    request<ApiPurchaseResponse>(
      `/merchants/${encodeURIComponent(merchantId)}/items/${encodeURIComponent(itemId)}/purchase`,
      { method: 'POST', body: JSON.stringify(input) },
      token,
    ),

  /** Lance le marchandage SANS acheter — le résultat peut être relancé (Chance) avant de confirmer l'achat via purchaseMerchantItem's haggle_id. Le modificateur (Charisme du personnage) est calculé côté serveur. */
  haggleMerchantItem: (
    token: string,
    merchantId: string,
    itemId: string,
    input: { character_id: string },
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

  // cardSetId préféré (voir CLAUDE.md — set_code seul est ambigu) : passer
  // l'entrée sealed_boosters.card_set_id quand elle est connue.
  openBooster: (token: string, characterId: string, setCode: string, quantity?: number, cardSetId?: string | null) =>
    request<{ character: ApiCharacter; opened_cards: ApiOpenedCard[] }>(
      `/characters/${encodeURIComponent(characterId)}/open-booster`,
      { method: 'POST', body: JSON.stringify({ set_code: setCode, quantity, card_set_id: cardSetId ?? undefined }) },
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

  duelSelectUnselectCard: (token: string, duelId: string, participantId: string, index: number | null) =>
    request<{ duel: ApiDuel }>(
      `/duels/${encodeURIComponent(duelId)}/select-unselect-card`,
      { method: 'POST', body: JSON.stringify(index === null ? { participant_id: participantId, cancel: true } : { participant_id: participantId, index }) },
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

  // lua_script est obligatoire côté serveur (CLAUDE.md §3.4 : jamais de repli
  // "vanille" pour une carte custom) — un paramètre séparé de `card` plutôt
  // qu'un champ dedans, pour matcher exactement la forme attendue par la
  // route ({ game_session_id, card, lua_script }).
  createCustomCard: (token: string, sessionId: string, card: CustomCardInput, luaScript: string) =>
    request<{ card: ApiCustomCard }>(
      '/custom-cards',
      { method: 'POST', body: JSON.stringify({ game_session_id: sessionId, card, lua_script: luaScript }) },
      token,
    ),

  updateCustomCard: (token: string, cardId: string, card: CustomCardInput, luaScript: string) =>
    request<{ card: ApiCustomCard }>(
      `/custom-cards/${encodeURIComponent(cardId)}`,
      { method: 'PATCH', body: JSON.stringify({ card, lua_script: luaScript }) },
      token,
    ),

  deleteCustomCard: (token: string, cardId: string) =>
    request<null>(`/custom-cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' }, token),

  /** Change uniquement l'image — pas besoin de renvoyer toute la carte + un script Lua comme updateCustomCard. */
  updateCustomCardImage: (token: string, cardId: string, imageUrl: string) =>
    request<{ card: ApiCustomCard }>(
      `/custom-cards/${encodeURIComponent(cardId)}/image`,
      { method: 'PATCH', body: JSON.stringify({ image_url: imageUrl }) },
      token,
    ),

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

  /** Lie une carte EXISTANTE — officielle OU custom — à un booster custom déjà créé (par set_code, pas par carte) — voir CLAUDE.md. */
  linkCardToCustomBooster: (token: string, setCode: string, cardId: string, rarity: CustomCardRarity) =>
    request<{ card: ApiCard }>(
      `/custom-cards/boosters/${encodeURIComponent(setCode)}/cards`,
      { method: 'POST', body: JSON.stringify({ card_id: cardId, rarity }) },
      token,
    ),

  unlinkCardFromCustomBooster: (token: string, setCode: string, cardId: string) =>
    request<{ card: ApiCard }>(
      `/custom-cards/boosters/${encodeURIComponent(setCode)}/cards/${encodeURIComponent(cardId)}`,
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
