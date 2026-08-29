import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Client du moteur de duel réel (ocgcore, cœur d'EDOPro — voir
 * engine/ocgcore/ pour la preuve de faisabilité et le détail des formats de
 * message reverse-engineered depuis playerop.cpp, aucune doc externe ne les
 * couvrant correctement). Un process `ocgcore_server` (binaire statique
 * compilé dans backend/Dockerfile, stage `ocgcore-build`) par duel actif,
 * piloté par un protocole texte ligne-par-ligne sur stdin/stdout.
 *
 * Ce module ne connaît QUE le protocole bas niveau du moteur (locations,
 * positions, messages MSG_*). Le mapping avec les personnages/decks/l'API
 * REST du duel vit dans les routes (voir duel.routes.ts).
 */

const OCGCORE_BINARY = '/ocgcore/ocgcore_server';
const OCGCORE_CWD = '/ocgcore';

// --- Constantes du protocole (voir engine/ocgcore/poc/*.cpp, valeurs tirées
// directement de ocgapi_constants.h — aucune doc externe fiable). ---

export const Location = {
  DECK: 0x01,
  HAND: 0x02,
  MZONE: 0x04,
  SZONE: 0x08,
  GRAVE: 0x10,
  REMOVED: 0x20,
  EXTRA: 0x40,
} as const;

export const Position = {
  FACEUP_ATTACK: 0x1,
  FACEDOWN_ATTACK: 0x2,
  FACEUP_DEFENSE: 0x4,
  FACEDOWN_DEFENSE: 0x8,
} as const;

export const CardType = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
} as const;

// DUEL_PZONE | DUEL_EMZONE | DUEL_FSX_MMZONE | DUEL_TRAP_MONSTERS_NOT_USE_ZONE
// | DUEL_TRIGGER_ONLY_IN_LOCATION — préréglage "Master Rule 5" du moteur.
export const DUEL_MODE_MR5 = 0x2e800;

// Sous-ensemble de QUERY_* (ocgapi_constants.h) demandé pour afficher une
// carte sur le terrain : identité, position, ATK/DEF live, matériaux Xyz,
// compteurs. QUERY_IS_PUBLIC est toujours inclus par le moteur quel que soit
// le flag demandé (voir card::get_infos dans card.cpp), inutile de le lister.
export const QUERY_CODE = 0x1;
export const QUERY_POSITION = 0x2;
export const QUERY_ATTACK = 0x100;
export const QUERY_DEFENSE = 0x200;
export const QUERY_OVERLAY_CARD = 0x10000;
export const QUERY_COUNTERS = 0x20000;
export const QUERY_IS_PUBLIC = 0x100000;
export const QUERY_END = 0x80000000;
export const BOARD_QUERY_FLAGS = QUERY_CODE | QUERY_POSITION | QUERY_ATTACK | QUERY_DEFENSE | QUERY_OVERLAY_CARD | QUERY_COUNTERS;

export const MessageType = {
  RETRY: 1,
  HINT: 2,
  WAITING: 3,
  START: 4,
  WIN: 5,
  SELECT_BATTLECMD: 10,
  SELECT_IDLECMD: 11,
  SELECT_EFFECTYN: 12,
  SELECT_YESNO: 13,
  SELECT_OPTION: 14,
  SELECT_CARD: 15,
  SELECT_CHAIN: 16,
  SELECT_PLACE: 18,
  SELECT_POSITION: 19,
  SELECT_TRIBUTE: 20,
  NEW_TURN: 40,
  NEW_PHASE: 41,
  MOVE: 50,
  SUMMONING: 60,
  SUMMONED: 61,
  CHAINING: 70,
  CHAINED: 71,
  CHAIN_SOLVING: 72,
  CHAIN_SOLVED: 73,
  CHAIN_END: 74,
  DRAW: 90,
  DAMAGE: 91,
  RECOVER: 92,
  LPUPDATE: 94,
  ATTACK: 110,
  BATTLE: 111,
  DAMAGE_STEP_START: 113,
  DAMAGE_STEP_END: 114,
  /** Duel Tag (plusieurs duelists/decks par camp, voir CLAUDE.md §7) : rotation vers le duelist suivant du camp — émis par field::tag_swap(). */
  TAG_SWAP: 161,
} as const;

/** Statut renvoyé par CREATE/START/PROCESS : voir OCG_DuelStatus. */
export const DuelStatus = {
  END: 0,
  AWAITING: 1,
  CONTINUE: 2,
} as const;

export interface EngineMessage {
  type: number;
  /** Payload complet, type inclus en premier octet (comme renvoyé par le process). */
  raw: Buffer;
}

export interface ProcessResult {
  status: number;
  messages: EngineMessage[];
}

export interface CustomCardStats {
  type: number;
  level: number;
  attribute: number;
  race: bigint;
  atk: number;
  def: number;
}

export interface NewCardInput {
  team: 0 | 1;
  code: number;
  con: 0 | 1;
  loc: number;
  seq: number;
  pos: number;
  /**
   * Tag Duel (plusieurs decks/mains/Extra Decks partageant un même camp/PV,
   * voir OCG_DuelNewCard dans ocgapi.cpp) : 0 (défaut) = deck "principal" du
   * camp, placé directement via loc/seq/pos comme d'habitude. >=1 = un deck
   * supplémentaire du MÊME camp (un participant de plus dans l'équipe) —
   * `loc` doit alors être DECK ou EXTRA uniquement (jamais HAND : la main
   * d'un duelist "additionnel" reste vide tant qu'il n'est pas devenu actif
   * via une rotation MSG_TAG_SWAP, confirmé en pilotant le moteur réel), et
   * seq/pos sont ignorés par le moteur dans ce cas.
   */
  duelist?: number;
}

// --- Parseurs "état" (LP, phase, tour, déplacements) — messages informatifs
// diffusés au fil du duel, utilisés pour reconstruire un état affichable côté
// backend sans interroger le moteur (OCG_DuelQuery*) à chaque requête. ---

export interface ParsedDamage {
  team: number;
  amount: number;
}

/** MSG_DAMAGE et MSG_RECOVER partagent le même format : team(u8) + amount(u32 LE). */
export function parseDamageOrRecover(raw: Buffer): ParsedDamage {
  return { team: raw.readUInt8(1), amount: raw.readUInt32LE(2) };
}

/** MSG_NEW_PHASE : phase(u16 LE) — voir les constantes PHASE_* (bitflag, une seule à la fois ici). */
export function parseNewPhase(raw: Buffer): number {
  return raw.readUInt16LE(1);
}

/** MSG_NEW_TURN : team(u8) du joueur dont c'est maintenant le tour. */
export function parseNewTurn(raw: Buffer): number {
  return raw.readUInt8(1);
}

export interface ParsedMove {
  code: number;
  previous: { controller: number; location: number; sequence: number; position: number };
  current: { controller: number; location: number; sequence: number; position: number };
  /** Bitflags REASON_* (voir ocgapi_constants.h) : pourquoi la carte a bougé (destruction, combat, effet...). */
  reason: number;
}

/** MSG_MOVE : code(u32), deux loc_info (controller(u8) location(u8) sequence(u32) position(u32)), puis reason(u32). */
export function parseMove(raw: Buffer): ParsedMove {
  let off = 1;
  const code = raw.readUInt32LE(off);
  off += 4;
  function readLocInfo() {
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const position = raw.readUInt32LE(off);
    off += 4;
    return { controller, location, sequence, position };
  }
  const previous = readLocInfo();
  const current = readLocInfo();
  const reason = raw.readUInt32LE(off);
  return { code, previous, current, reason };
}

/** MSG_DRAW : team(u8) count(u32 LE) puis count*(code(u32) position(u32)). */
export function parseDraw(raw: Buffer): { team: number; codes: number[] } {
  let off = 1;
  const team = raw.readUInt8(off);
  off += 1;
  const count = raw.readUInt32LE(off);
  off += 4;
  const codes: number[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(raw.readUInt32LE(off));
    off += 8; // code(4) + position(4)
  }
  return { team, codes };
}

export interface ParsedTagSwap {
  team: number;
  /** Compte de deck (non détaillé — trop volumineux/inutile à transmettre carte par carte) du duelist qui vient de devenir actif. */
  mainCount: number;
  extraCount: number;
  extraMonsterCount: number;
  /** Contenu réel de la main du duelist qui vient de devenir actif — resynchronisation "vérité terrain", pas juste un compteur. */
  hand: Array<{ code: number; position: number }>;
  extra: Array<{ code: number; position: number }>;
}

/**
 * MSG_TAG_SWAP (161) : rotation du duelist actif d'un camp (Duel Tag, voir
 * CLAUDE.md §7) — émis par field::tag_swap() (field.cpp), format confirmé en
 * lisant le code source ET en le rejouant contre le vrai moteur (payload
 * capturé, décodé avec ce parseur avant d'écrire ce commentaire) :
 * playerid(u8) main_count(u32) extra_count(u32) extra_monster_count(u32)
 * hand_count(u32) reversed_top_code(u32, 0 si le deck n'est pas retourné —
 * non exploité ici) puis hand_count*(code(u32) position(u32)) puis
 * extra_count*(code(u32) position(u32)).
 */
export function parseTagSwap(raw: Buffer): ParsedTagSwap {
  let off = 1;
  const team = raw.readUInt8(off);
  off += 1;
  const mainCount = raw.readUInt32LE(off);
  off += 4;
  const extraCount = raw.readUInt32LE(off);
  off += 4;
  const extraMonsterCount = raw.readUInt32LE(off);
  off += 4;
  const handCount = raw.readUInt32LE(off);
  off += 4;
  off += 4; // reversed_top_code — non exploité ici
  const hand: Array<{ code: number; position: number }> = [];
  for (let i = 0; i < handCount; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const position = raw.readUInt32LE(off);
    off += 4;
    hand.push({ code, position });
  }
  const extra: Array<{ code: number; position: number }> = [];
  for (let i = 0; i < extraCount; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const position = raw.readUInt32LE(off);
    off += 4;
    extra.push({ code, position });
  }
  return { team, mainCount, extraCount, extraMonsterCount, hand, extra };
}

// --- Parseurs des prompts interactifs, formats retrouvés dans playerop.cpp
// (field::process(SelectIdleCmd/SelectPlace/SelectChain)) — voir le plan
// d'intégration pour le détail de la démarche. ---

export interface IdleCmdCardOption {
  code: number;
  controller: number;
  location: number;
  sequence: number;
}

export interface IdleCmdChainOption extends IdleCmdCardOption {
  description: bigint;
}

export interface ParsedIdleCmd {
  playerid: number;
  summonable: IdleCmdCardOption[];
  spSummonable: IdleCmdCardOption[];
  repositionable: IdleCmdCardOption[];
  msetable: IdleCmdCardOption[];
  ssetable: IdleCmdCardOption[];
  activatable: IdleCmdChainOption[];
  canBattlePhase: boolean;
  canEndPhase: boolean;
  canShuffleHand: boolean;
}

/** Catégories de réponse pour MSG_SELECT_IDLECMD (encodage : (index << 16) | catégorie). */
export const IdleCmdCategory = {
  SUMMON: 0,
  SPSUMMON: 1,
  REPOSITION: 2,
  MSET: 3,
  SSET: 4,
  ACTIVATE: 5,
  TO_BATTLE: 6,
  TO_END: 7,
  SHUFFLE_HAND: 8,
} as const;

export function parseIdleCmd(raw: Buffer): ParsedIdleCmd {
  let off = 1; // saute le byte de type
  const playerid = raw.readUInt8(off);
  off += 1;

  function readCardList(seqBytes: 1 | 4): IdleCmdCardOption[] {
    const count = raw.readUInt32LE(off);
    off += 4;
    const list: IdleCmdCardOption[] = [];
    for (let i = 0; i < count; i += 1) {
      const code = raw.readUInt32LE(off);
      off += 4;
      const controller = raw.readUInt8(off);
      off += 1;
      const location = raw.readUInt8(off);
      off += 1;
      const sequence = seqBytes === 1 ? raw.readUInt8(off) : raw.readUInt32LE(off);
      off += seqBytes;
      list.push({ code, controller, location, sequence });
    }
    return list;
  }

  const summonable = readCardList(4);
  const spSummonable = readCardList(4);
  const repositionable = readCardList(1); // seule catégorie où sequence est un uint8 (voir playerop.cpp)
  const msetable = readCardList(4);
  const ssetable = readCardList(4);

  const activateCount = raw.readUInt32LE(off);
  off += 4;
  const activatable: IdleCmdChainOption[] = [];
  for (let i = 0; i < activateCount; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const description = raw.readBigUInt64LE(off);
    off += 8;
    off += 1; // client_mode, pas exploité ici
    activatable.push({ code, controller, location, sequence, description });
  }

  const canBattlePhase = raw.readUInt8(off) === 1;
  off += 1;
  const canEndPhase = raw.readUInt8(off) === 1;
  off += 1;
  const canShuffleHand = raw.readUInt8(off) === 1;

  return { playerid, summonable, spSummonable, repositionable, msetable, ssetable, activatable, canBattlePhase, canEndPhase, canShuffleHand };
}

/** Réponse à MSG_SELECT_IDLECMD : int32 LE = (index << 16) | catégorie. */
export function encodeIdleCmdResponse(category: number, index: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(((index & 0xffff) << 16) | (category & 0xffff), 0);
  return buf;
}

export interface ParsedSelectPlace {
  playerid: number;
  count: number;
  /** Bit à 1 = zone indisponible (voir field::process(SelectPlace) dans playerop.cpp). */
  flag: number;
}

export function parseSelectPlace(raw: Buffer): ParsedSelectPlace {
  return { playerid: raw.readUInt8(1), count: raw.readUInt8(2), flag: raw.readUInt32LE(3) };
}

/**
 * Premier emplacement libre (priorité Monstre puis Magie/Piège, côté
 * demandeur) déduit du flag — suffisant pour poser une carte qui n'exige pas
 * un choix de zone stratégique (Magie/Piège normales, Invocation Normale
 * sans zone préférée). Retourne null si aucune zone propre n'est libre.
 */
export function firstAvailablePlace(flag: number): { location: number; sequence: number } | null {
  const available = ~flag >>> 0;
  const mzoneBits = available & 0x7f;
  if (mzoneBits) return { location: Location.MZONE, sequence: Math.log2(mzoneBits & -mzoneBits) };
  const szoneBits = available & 0x1f00;
  if (szoneBits) return { location: Location.SZONE, sequence: Math.log2(szoneBits & -szoneBits) - 8 };
  return null;
}

/** Réponse à MSG_SELECT_PLACE : `count` triplets (select_player, location, sequence), 1 octet chacun. */
export function encodeSelectPlaceResponse(selections: Array<{ player: 0 | 1; location: number; sequence: number }>): Buffer {
  const buf = Buffer.alloc(selections.length * 3);
  selections.forEach((s, i) => {
    buf.writeUInt8(s.player, i * 3);
    buf.writeUInt8(s.location, i * 3 + 1);
    buf.writeUInt8(s.sequence, i * 3 + 2);
  });
  return buf;
}

export interface SelectChainOption {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  position: number;
  description: bigint;
}

export interface ParsedSelectChain {
  playerid: number;
  /** Nombre d'options "spécifiques" en tête de liste (voir field::process(SelectChain), non exploité ici). */
  speCount: number;
  /** Si vrai, cette invite ne peut pas être passée (-1 sera rejeté par le moteur, MSG_RETRY). */
  forced: boolean;
  options: SelectChainOption[];
}

/**
 * MSG_SELECT_CHAIN : format retrouvé en lisant field::process(SelectChain)
 * dans playerop.cpp (édo9300/ygopro-core) — DIFFÉRENT de la liste
 * "activatable" de MSG_SELECT_IDLECMD/MSG_SELECT_BATTLECMD (celles-ci
 * omettent `position`, ici `pcard->get_info_location()` l'inclut).
 * playerid(u8) spe_count(u8) forced(u8) hint_timing(u32) hint_timing_opp(u32)
 * count(u32) puis count * { code(u32) controller(u8) location(u8)
 * sequence(u32) position(u32) description(u64) client_mode(u8) }.
 */
export function parseSelectChain(raw: Buffer): ParsedSelectChain {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;
  const speCount = raw.readUInt8(off);
  off += 1;
  const forced = raw.readUInt8(off) !== 0;
  off += 1;
  off += 4; // hint_timing (joueur courant) — non exploité ici
  off += 4; // hint_timing (adversaire) — non exploité ici
  const count = raw.readUInt32LE(off);
  off += 4;
  const options: SelectChainOption[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const position = raw.readUInt32LE(off);
    off += 4;
    const description = raw.readBigUInt64LE(off);
    off += 8;
    off += 1; // client_mode, pas exploité ici
    options.push({ code, controller, location, sequence, position, description });
  }
  return { playerid, speCount, forced, options };
}

/** Réponse à MSG_SELECT_CHAIN : int32 LE, -1 = passer, sinon l'index du lien choisi. */
export function encodeSelectChainResponse(index: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(index, 0);
  return buf;
}

export interface ParsedYesNo {
  playerid: number;
  description: bigint;
}

/** MSG_SELECT_YESNO : playerid(u8) description(u64) — format lu dans field::process(SelectYesNo), playerop.cpp. */
export function parseYesNo(raw: Buffer): ParsedYesNo {
  return { playerid: raw.readUInt8(1), description: raw.readBigUInt64LE(2) };
}

export interface ParsedEffectYesNo {
  playerid: number;
  code: number;
  controller: number;
  location: number;
  sequence: number;
  position: number;
  description: bigint;
}

/** MSG_SELECT_EFFECTYN : playerid(u8) code(u32) loc_info(controller,location,sequence,position) description(u64) — field::process(SelectEffectYesNo). */
export function parseEffectYesNo(raw: Buffer): ParsedEffectYesNo {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;
  const code = raw.readUInt32LE(off);
  off += 4;
  const controller = raw.readUInt8(off);
  off += 1;
  const location = raw.readUInt8(off);
  off += 1;
  const sequence = raw.readUInt32LE(off);
  off += 4;
  const position = raw.readUInt32LE(off);
  off += 4;
  const description = raw.readBigUInt64LE(off);
  return { playerid, code, controller, location, sequence, position, description };
}

/** Réponse à MSG_SELECT_YESNO / MSG_SELECT_EFFECTYN : int32 LE, 0 = non, 1 = oui. */
export function encodeYesNoResponse(yes: boolean): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(yes ? 1 : 0, 0);
  return buf;
}

export interface BattleCmdChainOption extends IdleCmdCardOption {
  description: bigint;
}

export interface BattleCmdAttackOption {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  /** true si une attaque directe est légale pour cette carte en l'état actuel du terrain adverse. */
  directAttackable: boolean;
}

export interface ParsedBattleCmd {
  playerid: number;
  activatable: BattleCmdChainOption[];
  attackable: BattleCmdAttackOption[];
  canMain2: boolean;
  canEndPhase: boolean;
}

/** Catégories de réponse pour MSG_SELECT_BATTLECMD : (index << 16) | catégorie. */
export const BattleCmdCategory = {
  ACTIVATE: 0,
  ATTACK: 1,
  TO_MAIN2: 2,
  TO_END: 3,
} as const;

export function parseBattleCmd(raw: Buffer): ParsedBattleCmd {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;

  const chainCount = raw.readUInt32LE(off);
  off += 4;
  const activatable: BattleCmdChainOption[] = [];
  for (let i = 0; i < chainCount; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const description = raw.readBigUInt64LE(off);
    off += 8;
    off += 1; // client_mode
    activatable.push({ code, controller, location, sequence, description });
  }

  const attackCount = raw.readUInt32LE(off);
  off += 4;
  const attackable: BattleCmdAttackOption[] = [];
  for (let i = 0; i < attackCount; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt8(off);
    off += 1;
    const directAttackable = raw.readUInt8(off) === 1;
    off += 1;
    attackable.push({ code, controller, location, sequence, directAttackable });
  }

  const canMain2 = raw.readUInt8(off) === 1;
  off += 1;
  const canEndPhase = raw.readUInt8(off) === 1;

  return { playerid, activatable, attackable, canMain2, canEndPhase };
}

/** Réponse à MSG_SELECT_BATTLECMD : int32 LE = (index << 16) | catégorie. */
export function encodeBattleCmdResponse(category: number, index: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(((index & 0xffff) << 16) | (category & 0xffff), 0);
  return buf;
}

export interface SelectableCard {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  position: number;
}

export interface ParsedSelectCard {
  playerid: number;
  cancelable: boolean;
  min: number;
  max: number;
  cards: SelectableCard[];
}

/** MSG_SELECT_CARD : sélection de cible(s) (attaque, effets ciblés...). */
export function parseSelectCard(raw: Buffer): ParsedSelectCard {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;
  const cancelable = raw.readUInt8(off) === 1;
  off += 1;
  const min = raw.readUInt32LE(off);
  off += 4;
  const max = raw.readUInt32LE(off);
  off += 4;
  const count = raw.readUInt32LE(off);
  off += 4;
  const cards: SelectableCard[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const position = raw.readUInt32LE(off);
    off += 4;
    cards.push({ code, controller, location, sequence, position });
  }
  return { playerid, cancelable, min, max, cards };
}

/**
 * Réponse à MSG_SELECT_CARD : indices (dans l'ordre de la liste proposée)
 * des cartes choisies, encodés en uint8 (format `type=2` du moteur — le
 * plus compact, suffisant tant que la liste proposée tient sur 256 entrées,
 * toujours le cas en pratique). `int32 type=2` + `uint32 taille` + `n
 * octets d'index`.
 */
export function encodeSelectCardResponse(indices: number[]): Buffer {
  const buf = Buffer.alloc(4 + 4 + indices.length);
  buf.writeInt32LE(2, 0);
  buf.writeUInt32LE(indices.length, 4);
  indices.forEach((idx, i) => buf.writeUInt8(idx, 8 + i));
  return buf;
}

/** Réponse "annuler" à MSG_SELECT_CARD (uniquement si `cancelable` ou `min === 0`). */
export function encodeSelectCardCancel(): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(-1, 0);
  return buf;
}

export interface TributeCard {
  code: number;
  controller: number;
  location: number;
  sequence: number;
  /** Nombre de "points" de tribut que compte cette carte (quasi toujours 1, mais certains effets en comptent plus). */
  releaseParam: number;
}

export interface ParsedSelectTribute {
  playerid: number;
  cancelable: boolean;
  min: number;
  max: number;
  cards: TributeCard[];
}

/**
 * MSG_SELECT_TRIBUTE : choix des tributs pour une Invocation Normale de
 * Niveau ≥5 (ou tout coût de type "release"). Format quasi identique à
 * MSG_SELECT_CARD (field::process(SelectTributeP), playerop.cpp), mais
 * chaque carte porte `release_param` (poids en tributs) à la place de
 * `position`. La réponse réutilise EXACTEMENT le même encodage que
 * MSG_SELECT_CARD (`encodeSelectCardResponse`/`encodeSelectCardCancel` —
 * les deux passent par `parse_response_cards` côté moteur, confirmé dans
 * playerop.cpp), pas besoin d'un encodeur dédié.
 */
export function parseSelectTribute(raw: Buffer): ParsedSelectTribute {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;
  const cancelable = raw.readUInt8(off) === 1;
  off += 1;
  const min = raw.readUInt32LE(off);
  off += 4;
  const max = raw.readUInt32LE(off);
  off += 4;
  const count = raw.readUInt32LE(off);
  off += 4;
  const cards: TributeCard[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = raw.readUInt32LE(off);
    off += 4;
    const controller = raw.readUInt8(off);
    off += 1;
    const location = raw.readUInt8(off);
    off += 1;
    const sequence = raw.readUInt32LE(off);
    off += 4;
    const releaseParam = raw.readUInt8(off);
    off += 1;
    cards.push({ code, controller, location, sequence, releaseParam });
  }
  return { playerid, cancelable, min, max, cards };
}

export interface ParsedSelectPosition {
  playerid: number;
  code: number;
  /** Bitmask des positions légales (voir `Position` — FACEUP_ATTACK/FACEDOWN_ATTACK/FACEUP_DEFENSE/FACEDOWN_DEFENSE), plusieurs bits possibles. */
  positions: number;
}

/**
 * MSG_SELECT_POSITION : choix explicite Attaque/Défense (et face visible/
 * cachée) quand plus d'une position est légale — field::process(SelectPosition).
 * N'apparaît PAS pour une Invocation Normale/Set standard (une seule position
 * possible, le moteur résout seul sans prompt, confirmé en pilotant le
 * protocole brut) : typiquement des Invocations Spéciales qui laissent le
 * choix.
 */
export function parseSelectPosition(raw: Buffer): ParsedSelectPosition {
  const playerid = raw.readUInt8(1);
  const code = raw.readUInt32LE(2);
  const positions = raw.readUInt8(6);
  return { playerid, code, positions };
}

/** Réponse à MSG_SELECT_POSITION : int32 LE = UN SEUL bit de `Position` (doit être un sous-ensemble du bitmask proposé). */
export function encodeSelectPositionResponse(position: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(position, 0);
  return buf;
}

export interface ParsedSelectOption {
  playerid: number;
  /** Un identifiant d'effet par option (pas de texte : aucune donnée structurée d'effet n'existe pour le décoder, voir CLAUDE.md §7). */
  options: bigint[];
}

/** MSG_SELECT_OPTION : choix entre plusieurs variantes d'un même effet — field::process(SelectOption). */
export function parseSelectOption(raw: Buffer): ParsedSelectOption {
  let off = 1;
  const playerid = raw.readUInt8(off);
  off += 1;
  const count = raw.readUInt8(off);
  off += 1;
  const options: bigint[] = [];
  for (let i = 0; i < count; i += 1) {
    options.push(raw.readBigUInt64LE(off));
    off += 8;
  }
  return { playerid, options };
}

/** Réponse à MSG_SELECT_OPTION : int32 LE = index choisi (0..count-1, pas de -1 — cette invite ne peut jamais être passée). */
export function encodeSelectOptionResponse(index: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(index, 0);
  return buf;
}

// --- Parseur de OCG_DuelQueryLocation (réponse LOCATION) — format retrouvé
// en lisant ocgapi.cpp (OCG_DuelQueryLocation) et card.cpp (card::get_infos) :
// un préfixe uint32 = taille totale, puis pour chaque emplacement de la zone
// interrogée soit un int16 LE = 0 (emplacement vide — mzone/szone seulement,
// les autres zones n'ont jamais de "trou"), soit une suite d'entrées TLV
// [uint16 taille][uint32 flag QUERY_*][valeur] qui se termine par une entrée
// QUERY_END (taille=4, pas de valeur) marquant la fin de CETTE carte. Le
// nombre de cartes n'est jamais transmis explicitement : on avance dans le
// buffer jusqu'à avoir consommé les `taille totale` octets annoncés — ce qui
// fonctionne aussi bien pour une zone à trous (terrain) qu'une liste sans
// trou (main/cimetière/etc.), voir CHECK_AND_INSERT_T dans card.cpp. ---

export interface QueriedCard {
  code: number | null;
  position: number | null;
  attack: number | null;
  defense: number | null;
  overlayCodes: number[];
  counters: number[];
}

/**
 * Décode les entrées TLV d'UNE carte à partir de `start` (pointant sur le
 * premier `[uint16 taille]`), jusqu'à et y compris l'entrée QUERY_END qui la
 * termine. Renvoie aussi `end` (offset juste après QUERY_END = début de la
 * carte/zone suivante) : chaque entrée occupe `2 + entryLen` octets sur le
 * fil (2 pour le champ taille lui-même, `entryLen` = flag(4) + valeur).
 */
function parseCardInfoEntries(raw: Buffer, start: number): { card: QueriedCard; end: number } {
  const card: QueriedCard = { code: null, position: null, attack: null, defense: null, overlayCodes: [], counters: [] };
  let off = start;
  for (;;) {
    const entryLen = raw.readUInt16LE(off);
    const flag = raw.readUInt32LE(off + 2);
    const valueStart = off + 6;
    off += 2 + entryLen;
    if (flag === QUERY_END) break;
    switch (flag) {
      case QUERY_CODE:
        card.code = raw.readUInt32LE(valueStart);
        break;
      case QUERY_POSITION:
        card.position = raw.readUInt32LE(valueStart);
        break;
      case QUERY_ATTACK:
        card.attack = raw.readInt32LE(valueStart);
        break;
      case QUERY_DEFENSE:
        card.defense = raw.readInt32LE(valueStart);
        break;
      case QUERY_OVERLAY_CARD: {
        const materialCount = raw.readUInt32LE(valueStart);
        for (let i = 0; i < materialCount; i += 1) card.overlayCodes.push(raw.readUInt32LE(valueStart + 4 + i * 4));
        break;
      }
      case QUERY_COUNTERS: {
        const counterCount = raw.readUInt32LE(valueStart);
        for (let i = 0; i < counterCount; i += 1) card.counters.push(raw.readUInt32LE(valueStart + 4 + i * 4));
        break;
      }
      default:
        break; // flag non demandé/non exploité (ex. QUERY_IS_PUBLIC, toujours inséré par le moteur)
    }
  }
  return { card, end: off };
}

/** Décode une réponse LOCATION (OCG_DuelQueryLocation) en une liste d'emplacements (null = zone vide). */
export function parseQueryLocation(raw: Buffer): Array<QueriedCard | null> {
  if (raw.length === 0) return [];
  const totalLength = raw.readUInt32LE(0);
  const end = 4 + totalLength;
  const slots: Array<QueriedCard | null> = [];
  let off = 4;
  while (off < end) {
    const firstLen = raw.readUInt16LE(off);
    if (firstLen === 0) {
      slots.push(null);
      off += 2;
      continue;
    }
    const { card, end: cardEnd } = parseCardInfoEntries(raw, off);
    slots.push(card);
    off = cardEnd;
  }
  return slots;
}

// --- Client bas niveau : un process ocgcore_server par duel. ---

export class OcgcoreDuel {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pendingLines: string[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;
  // Le protocole stdin/stdout n'a AUCUN identifiant de requête : une réponse
  // est juste "la prochaine ligne qui matche". Deux commandes envoyées avant
  // que la première n'ait reçu sa réponse (ex. deux zones interrogées via
  // Promise.all côté appelant) désynchronisent complètement les réponses —
  // constaté en pratique (timeout) en pilotant /field avec des requêtes
  // concurrentes. Cette file garantit qu'une seule paire send()+waitFor()
  // est jamais "en vol" à la fois, quel que soit le nombre d'appelants
  // concurrents côté Node — c'est cette classe qui sérialise, pas à charge
  // de chaque appelant de s'en souvenir.
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.child = spawn(OCGCORE_BINARY, [], { cwd: OCGCORE_CWD, stdio: ['pipe', 'pipe', 'pipe'] });
    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      this.pendingLines.push(line);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    });
    this.child.on('exit', () => {
      this.closed = true;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    });
  }

  private send(line: string): void {
    if (this.closed) throw new Error('ocgcore_server: process déjà terminé');
    this.child.stdin.write(line + '\n');
  }

  private waitFor(match: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const check = (): void => {
        const idx = this.pendingLines.findIndex(match);
        if (idx !== -1) {
          resolve(this.pendingLines.splice(0, idx + 1));
        } else if (this.closed) {
          reject(new Error('ocgcore_server: process terminé avant la réponse attendue'));
        } else {
          this.waiter = check;
        }
      };
      check();
    });
  }

  /** Chaîne `fn` derrière tout appel déjà en cours — voir le commentaire sur `queue`. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // Toujours enchaîner (même en cas d'échec de `run`), sinon un appel en
    // échec bloquerait la file pour tous les suivants.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private parseMessages(lines: string[]): EngineMessage[] {
    const messages: EngineMessage[] = [];
    for (const line of lines) {
      if (!line.startsWith('MSG ')) continue;
      const [, typeStr, hex] = line.split(' ');
      messages.push({ type: Number(typeStr), raw: Buffer.from(hex ?? '', 'hex') });
    }
    return messages;
  }

  /** Crée le duel. `flags` typiquement `DUEL_MODE_MR5`. */
  async create(options: {
    flags: number;
    lp1: number;
    hand1: number;
    draw1: number;
    lp2: number;
    hand2: number;
    draw2: number;
  }): Promise<number> {
    return this.enqueue(async () => {
      this.send(
        `CREATE ${options.flags.toString(16)} ${options.lp1} ${options.hand1} ${options.draw1} ${options.lp2} ${options.hand2} ${options.draw2}`,
      );
      const lines = await this.waitFor((l) => l.startsWith('CREATED'));
      return Number(lines[lines.length - 1]!.split(' ')[1]);
    });
  }

  /** Enregistre les stats d'une carte custom sous son code synthétique (voir engineCardCode.ts). */
  async addCustomCard(code: number, stats: CustomCardStats): Promise<void> {
    return this.enqueue(async () => {
      this.send(
        `CUSTOMCARD ${code} ${stats.type.toString(16)} ${stats.level} ${stats.attribute.toString(16)} ${stats.race.toString(16)} ${stats.atk} ${stats.def}`,
      );
      await this.waitFor((l) => l === 'CUSTOMCARDED');
    });
  }

  /** Envoie le script Lua fourni par le MJ pour une carte custom (obligatoire, voir CLAUDE.md §3.4). */
  async addCustomScript(code: number, luaSource: string): Promise<void> {
    return this.enqueue(async () => {
      this.send(`CUSTOMSCRIPT ${code} ${Buffer.from(luaSource, 'utf8').toString('hex')}`);
      await this.waitFor((l) => l === 'CUSTOMSCRIPTED');
    });
  }

  async addCard(info: NewCardInput): Promise<void> {
    return this.enqueue(async () => {
      this.send(`CARD ${info.team} ${info.code} ${info.con} ${info.loc.toString(16)} ${info.seq} ${info.pos.toString(16)} ${info.duelist ?? 0}`);
      await this.waitFor((l) => l === 'CARDED');
    });
  }

  async start(): Promise<ProcessResult> {
    return this.enqueue(async () => {
      this.send('START');
      const lines = await this.waitFor((l) => l.startsWith('DONE'));
      return { status: Number(lines[lines.length - 1]!.split(' ')[1]), messages: this.parseMessages(lines) };
    });
  }

  /** Fait avancer la state machine (à rappeler après chaque `respond`). */
  async process(): Promise<ProcessResult> {
    return this.enqueue(async () => {
      this.send('PROCESS');
      const lines = await this.waitFor((l) => l.startsWith('DONE'));
      return { status: Number(lines[lines.length - 1]!.split(' ')[1]), messages: this.parseMessages(lines) };
    });
  }

  async respond(bytes: Buffer): Promise<void> {
    return this.enqueue(async () => {
      this.send(`RESPOND ${bytes.toString('hex')}`);
      await this.waitFor((l) => l === 'RESPONDED');
    });
  }

  async queryField(): Promise<Buffer> {
    return this.enqueue(async () => {
      this.send('QUERY_FIELD');
      const lines = await this.waitFor((l) => l.startsWith('FIELD'));
      return Buffer.from(lines[lines.length - 1]!.split(' ')[1] ?? '', 'hex');
    });
  }

  /** Interroge toutes les cartes d'UNE zone (con + loc) en un seul appel — voir parseQueryLocation. */
  async queryLocation(con: 0 | 1, loc: number, flags: number): Promise<Buffer> {
    return this.enqueue(async () => {
      this.send(`QUERY_LOCATION ${con} ${loc.toString(16)} ${flags.toString(16)}`);
      const lines = await this.waitFor((l) => l.startsWith('LOCATION'));
      return Buffer.from(lines[lines.length - 1]!.split(' ')[1] ?? '', 'hex');
    });
  }

  /** Termine le process proprement. Toujours appeler en fin de duel / à l'arrêt du backend. */
  quit(): void {
    if (this.closed) return;
    try {
      this.send('QUIT');
    } catch {
      // déjà fermé, rien à faire
    }
    this.child.stdin.end();
  }
}
