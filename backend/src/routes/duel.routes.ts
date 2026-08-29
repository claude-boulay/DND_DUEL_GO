import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { Duel, type DuelDocument, type DuelParticipantAttrs } from '../models/Duel.model';
import { Character, type CharacterDocument } from '../models/Character.model';
import { Card } from '../models/Card.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { loadSessionOrThrow } from '../utils/loaders';
import { isExtraDeckFrameType } from '../utils/deckRules';
import { shuffle } from '../utils/duelBoard';
import { engineStatsForCustomCard } from '../utils/engineCardMapping';
import { toCardDto } from '../utils/cardDto';
import { broadcastSessionResourceChanged, notifyDuelInvite } from '../utils/broadcast';
import {
  applyMessages,
  createInitialState,
  dropEngineDuel,
  getEngineDuel,
  pumpUntilSettled,
  registerEngineDuel,
  summarizeMessage,
  type DuelistSeed,
  type EngineDuelState,
} from '../services/duelEngine';
import {
  BOARD_QUERY_FLAGS,
  DUEL_MODE_MR5,
  Location,
  MessageType,
  OcgcoreDuel,
  Position,
  encodeBattleCmdResponse,
  encodeIdleCmdResponse,
  encodeSelectCardCancel,
  encodeSelectCardResponse,
  encodeSelectChainResponse,
  encodeSelectOptionResponse,
  encodeSelectPlaceResponse,
  encodeSelectPositionResponse,
  encodeYesNoResponse,
  parseBattleCmd,
  parseEffectYesNo,
  parseIdleCmd,
  parseQueryLocation,
  parseSelectCard,
  parseSelectChain,
  parseSelectOption,
  parseSelectPlace,
  parseSelectPosition,
  parseSelectTribute,
  parseYesNo,
  type ProcessResult,
  type QueriedCard,
} from '../services/ocgcoreClient';
import type { GameSessionDocument } from '../models/GameSession.model';

type CardSummary = ReturnType<typeof toCardDto>;

/** Résolution en lot code moteur -> DTO carte complet (nom, image, stats...), pour enrichir les prompts et le terrain. */
async function resolveCardSummaries(codes: number[]): Promise<Map<number, CardSummary>> {
  const unique = [...new Set(codes)].filter((c) => c > 0);
  if (unique.length === 0) return new Map();
  const cards = await Card.find({ engine_code: { $in: unique } });
  return new Map(cards.filter((c) => c.engine_code !== null).map((c) => [c.engine_code as number, toCardDto(c)]));
}

export const duelRouter = Router();
duelRouter.use(requireAuth);

// DUEL_ATTACK_FIRST_TURN (0x02) : sans ce flag, le premier joueur ne peut
// pas entrer en Battle Phase à son tour 1 — règle native du moteur,
// équivalent (et plus fiable) de l'ancien `skip_first_battle_phase` calculé
// à la main. `skip_first_battle_phase: false` dans les règles l'ajoute.
const DUEL_ATTACK_FIRST_TURN = 0x02;

async function loadDuelOrThrow(duelId: string): Promise<DuelDocument> {
  if (!Types.ObjectId.isValid(duelId)) throw new AppError(404, 'Duel introuvable', 'not_found');
  const duel = await Duel.findById(duelId);
  if (!duel) throw new AppError(404, 'Duel introuvable', 'not_found');
  return duel;
}

/** Marque en base un duel dont le process moteur a été perdu (redémarrage backend) — jamais reprenable. */
async function syncLostStatus(duel: DuelDocument): Promise<void> {
  if (duel.status === 'active' && !getEngineDuel(duel._id.toString())) {
    duel.status = 'lost';
    duel.events.push({ message: 'Le process du moteur a été perdu (redémarrage du serveur) — duel non reprenable.', created_at: new Date() });
    await duel.save();
  }
}

/**
 * Pour la VISIBILITÉ (savoir ce qu'un spectateur a le droit de voir) : le
 * "contrôleur" d'un personnage est simplement son créateur (`user_id`) — pour
 * un PNJ, c'est déjà le MJ (seul habilité à en créer, voir
 * character.routes.ts), donc cette fonction reconnaît naturellement le MJ
 * comme contrôleur de SES PROPRES PNJ sans avoir besoin d'un cas spécial. Pas
 * de privilège "MJ voit tout" ici — voir `computeCanSeeTeam` pour la nuance
 * MJ-superviseur vs MJ-qui-joue-un-PNJ.
 */
async function isControllerOfCharacter(characterId: Types.ObjectId, userId: string): Promise<boolean> {
  const character = await Character.findById(characterId).select('user_id');
  return !!character && character.user_id.toString() === userId;
}

/**
 * Pour AGIR à la place d'un participant (répondre à un prompt) : le MJ ne
 * contrôle QUE les PNJ, jamais un participant joué par un vrai joueur — même
 * s'il est administrateur du salon. Volontairement plus strict que
 * `isControllerOfCharacter` (visibilité) : voir/superviser la partie est un
 * rôle de MJ légitime, jouer À LA PLACE d'un joueur n'en est pas un.
 */
async function canActForParticipant(participant: DuelParticipantAttrs, userId: string, session: GameSessionDocument): Promise<boolean> {
  if (participant.is_npc) return isSessionGm(session, userId);
  const character = await Character.findById(participant.character_id).select('user_id');
  return !!character && character.user_id.toString() === userId;
}

/**
 * Camps dont CE spectateur peut voir les secrets (main/Extra Deck, cartes
 * face cachée) : le sien, via N'IMPORTE LEQUEL de ses participants — y
 * compris pour le MJ, dont les PNJ lui appartiennent naturellement
 * (`isControllerOfCharacter`). Le MJ ne garde une vision complète des DEUX
 * camps QUE s'il ne contrôle AUCUN participant de CE duel précis (pure
 * supervision d'un duel joueur-contre-joueur, aucun PNJ en jeu) : dès qu'il
 * pilote un PNJ dans ce duel, il est traité exactement comme n'importe quel
 * joueur pour CE duel — voir les cartes face cachée de l'ADVERSAIRE de son
 * propre PNJ romprait le fair-play/l'immersion RP (retour utilisateur
 * explicite : « je ne devrais pas pouvoir voir ces cartes, ça ruine le RP »).
 */
async function computeCanSeeTeam(duel: DuelDocument, userId: string, session: GameSessionDocument): Promise<[boolean, boolean]> {
  const controls = await Promise.all(duel.participants.map((p) => isControllerOfCharacter(p.character_id, userId)));
  const canSee: [boolean, boolean] = [false, false];
  duel.participants.forEach((p, i) => {
    if (controls[i]) canSee[p.team] = true;
  });
  if (isSessionGm(session, userId) && !canSee[0] && !canSee[1]) {
    return [true, true];
  }
  return canSee;
}

/** Codes moteur portés par chaque type de prompt — collectés pour une résolution carte en un seul aller-retour Mongo. */
function collectPromptCodes(prompt: { type: number; raw: Buffer }): number[] {
  switch (prompt.type) {
    case MessageType.SELECT_IDLECMD: {
      const p = parseIdleCmd(prompt.raw);
      return [...p.summonable, ...p.spSummonable, ...p.repositionable, ...p.msetable, ...p.ssetable, ...p.activatable].map((o) => o.code);
    }
    case MessageType.SELECT_BATTLECMD: {
      const p = parseBattleCmd(prompt.raw);
      return [...p.activatable, ...p.attackable].map((o) => o.code);
    }
    case MessageType.SELECT_CARD:
      return parseSelectCard(prompt.raw).cards.map((o) => o.code);
    case MessageType.SELECT_CHAIN:
      return parseSelectChain(prompt.raw).options.map((o) => o.code);
    case MessageType.SELECT_TRIBUTE:
      return parseSelectTribute(prompt.raw).cards.map((o) => o.code);
    default:
      return [];
  }
}

/** Attache le DTO carte résolu (nom, image, stats) à chaque option d'une liste porteuse d'un `code`. */
function withCard<T extends { code: number }>(options: T[], cards: Map<number, CardSummary>): Array<T & { card: CardSummary | null }> {
  return options.map((o) => ({ ...o, card: cards.get(o.code) ?? null }));
}

/**
 * Masque l'identité d'une carte face cachée qui appartient à un camp que CE
 * SPECTATEUR ne peut pas voir (`canSeeTeam`, voir `computeCanSeeTeam`) —
 * même le MJ n'y échappe plus depuis qu'il pilote un PNJ dans ce duel :
 * savoir "quel monstre précis est posé face cachée en face" avant de choisir
 * sa cible reviendrait à tricher pour son propre PNJ (règle réelle : on ne le
 * sait qu'une fois la carte retournée). `canSeeTeam[actingTeam]` est
 * TOUJOURS vrai pour qui décide réellement (sinon `describePendingPrompt`
 * aurait déjà renvoyé `redacted: true` plus haut) — donc ses propres cartes
 * posées face cachée restent normalement visibles pour lui. Ne s'applique
 * qu'aux listes qui portent `position` (select_card/select_tribute/chain) —
 * les autres (idle/battle) ne listent que les propres ressources de l'acteur.
 */
function redactFaceDown<T extends { controller: number; position: number; card: CardSummary | null }>(
  options: T[],
  canSeeTeam: [boolean, boolean],
): T[] {
  return options.map((o) => {
    const isFaceDown = (o.position & (Position.FACEDOWN_ATTACK | Position.FACEDOWN_DEFENSE)) !== 0;
    if (isFaceDown && !canSeeTeam[o.controller as 0 | 1]) return { ...o, card: null };
    return o;
  });
}

/** Étiquette générique renvoyée à un spectateur non autorisé à voir le détail de ce prompt (voir describePendingPrompt). */
const PROMPT_TYPE_LABELS: Partial<Record<number, string>> = {
  [MessageType.SELECT_IDLECMD]: 'idle',
  [MessageType.SELECT_BATTLECMD]: 'battle',
  [MessageType.SELECT_CARD]: 'select_card',
  [MessageType.SELECT_PLACE]: 'select_place',
  [MessageType.SELECT_CHAIN]: 'chain',
  [MessageType.SELECT_TRIBUTE]: 'select_tribute',
  [MessageType.SELECT_POSITION]: 'select_position',
  [MessageType.SELECT_OPTION]: 'select_option',
  [MessageType.SELECT_YESNO]: 'yesno',
  [MessageType.SELECT_EFFECTYN]: 'effectyn',
};

/**
 * Traduit le prompt AWAITING courant en une forme exploitable côté client
 * (pas de parsing binaire côté frontend). `canSeeTeam[team]` = CE spectateur
 * a le droit de voir le détail des décisions de `team` (son propre camp, ou
 * MJ superviseur pur — voir `computeCanSeeTeam`) — sinon il reçoit une
 * version minimale (`redacted: true`, aucune carte listée) : sans ça,
 * n'importe quel membre du salon verrait exactement ce que l'adversaire a en
 * main/peut activer au moment même où il décide.
 */
async function describePendingPrompt(state: EngineDuelState, canSeeTeam: [boolean, boolean]): Promise<Record<string, unknown> | null> {
  const prompt = state.pendingPrompt;
  if (!prompt) return null;

  const promptTeam = promptPlayerId(prompt.raw);
  if (!canSeeTeam[promptTeam === 1 ? 1 : 0]) {
    return { type: PROMPT_TYPE_LABELS[prompt.type] ?? 'unhandled', playerid: promptTeam, redacted: true };
  }

  const cards = await resolveCardSummaries(collectPromptCodes(prompt));

  switch (prompt.type) {
    case MessageType.SELECT_IDLECMD: {
      const p = parseIdleCmd(prompt.raw);
      return {
        type: 'idle',
        playerid: p.playerid,
        summonable: withCard(p.summonable, cards),
        sp_summonable: withCard(p.spSummonable, cards),
        repositionable: withCard(p.repositionable, cards),
        msetable: withCard(p.msetable, cards),
        ssetable: withCard(p.ssetable, cards),
        activatable: withCard(p.activatable, cards).map((o) => ({ ...o, description: o.description.toString() })),
        can_battle_phase: p.canBattlePhase,
        can_end_phase: p.canEndPhase,
        can_shuffle_hand: p.canShuffleHand,
      };
    }
    case MessageType.SELECT_BATTLECMD: {
      const p = parseBattleCmd(prompt.raw);
      return {
        type: 'battle',
        playerid: p.playerid,
        activatable: withCard(p.activatable, cards).map((o) => ({ ...o, description: o.description.toString() })),
        attackable: withCard(p.attackable, cards),
        can_main2: p.canMain2,
        can_end_phase: p.canEndPhase,
      };
    }
    case MessageType.SELECT_CARD: {
      const p = parseSelectCard(prompt.raw);
      return {
        type: 'select_card',
        playerid: p.playerid,
        cancelable: p.cancelable,
        min: p.min,
        max: p.max,
        cards: redactFaceDown(withCard(p.cards, cards), canSeeTeam),
      };
    }
    case MessageType.SELECT_PLACE: {
      const p = parseSelectPlace(prompt.raw);
      return { type: 'select_place', playerid: p.playerid, count: p.count, flag: p.flag };
    }
    case MessageType.SELECT_CHAIN: {
      const p = parseSelectChain(prompt.raw);
      return {
        type: 'chain',
        playerid: p.playerid,
        forced: p.forced,
        options: redactFaceDown(withCard(p.options, cards), canSeeTeam).map((o) => ({ ...o, description: o.description.toString() })),
      };
    }
    case MessageType.SELECT_TRIBUTE: {
      const p = parseSelectTribute(prompt.raw);
      // Un tribut ne cible que ses PROPRES monstres (règle réelle) : jamais besoin de redactFaceDown ici.
      return { type: 'select_tribute', playerid: p.playerid, cancelable: p.cancelable, min: p.min, max: p.max, cards: withCard(p.cards, cards) };
    }
    case MessageType.SELECT_POSITION: {
      const p = parseSelectPosition(prompt.raw);
      const positionCards = await resolveCardSummaries([p.code]);
      return { type: 'select_position', playerid: p.playerid, code: p.code, card: positionCards.get(p.code) ?? null, positions: p.positions };
    }
    case MessageType.SELECT_OPTION: {
      const p = parseSelectOption(prompt.raw);
      return { type: 'select_option', playerid: p.playerid, options: p.options.map((o) => o.toString()) };
    }
    case MessageType.SELECT_YESNO: {
      const p = parseYesNo(prompt.raw);
      return { type: 'yesno', playerid: p.playerid };
    }
    case MessageType.SELECT_EFFECTYN: {
      const p = parseEffectYesNo(prompt.raw);
      const effectCards = await resolveCardSummaries([p.code]);
      return { type: 'effectyn', playerid: p.playerid, code: p.code, card: effectCards.get(p.code) ?? null };
    }
    default:
      return { type: 'unhandled', raw_type: prompt.type };
  }
}

async function toDuelDto(duel: DuelDocument, userId: string, session: GameSessionDocument) {
  const state = getEngineDuel(duel._id.toString());
  const canSeeTeam = await computeCanSeeTeam(duel, userId, session);
  return {
    id: duel._id.toString(),
    game_session_id: duel.game_session_id.toString(),
    name: duel.name,
    status: duel.status,
    starting_lp: duel.starting_lp,
    hand_size: duel.hand_size,
    draw_count_per_turn: duel.draw_count_per_turn,
    teams: duel.teams.map((t, i) => ({ name: t.name, life_points: state ? state.teams[i as 0 | 1].lp : null })),
    participants: duel.participants.map((p) => {
      const duelistState = state?.participants[p.team][p.duelist_index];
      return {
        id: p._id.toString(),
        character_id: p.character_id.toString(),
        character_name: p.character_name,
        is_npc: p.is_npc,
        team: p.team,
        duelist_index: p.duelist_index,
        deck_id: p.deck_id.toString(),
        hand_count: duelistState ? duelistState.handCount : null,
        deck_remaining: duelistState ? duelistState.deckCount : null,
        // Duel Tag (voir Duel.model.ts) : seul le duelist actif de son camp a
        // une main/un deck "vivants" en ce moment — c'est lui qui répond aux
        // prompts de son camp (voir requirePendingPrompt). Les autres
        // participants de la même équipe gardent leurs derniers comptes
        // connus, gelés jusqu'à leur prochaine rotation.
        is_active: state ? state.activeDuelistIndex[p.team] === p.duelist_index : false,
      };
    }),
    phase: state?.phase ?? null,
    turn_number: state?.turnNumber ?? null,
    current_team: state?.currentTeam ?? null,
    pending_prompt: state ? await describePendingPrompt(state, canSeeTeam) : null,
    winner_team: duel.winner_team,
    events: duel.events,
  };
}

function findParticipantOrThrow(duel: DuelDocument, participantId: string) {
  const p = duel.participants.find((x) => x._id.toString() === participantId);
  if (!p) throw new AppError(404, 'Participant introuvable', 'not_found');
  return p;
}

function requireEngineState(duel: DuelDocument): EngineDuelState {
  const state = getEngineDuel(duel._id.toString());
  if (!state) throw new AppError(400, 'Ce duel n’a pas (ou plus) de process moteur actif', 'no_engine');
  return state;
}

/**
 * Chaque type de prompt qu'on gère porte son `playerid` au même endroit
 * (octet 1 du payload, juste après le type — vérifié pour les 10 prompts
 * gérés : SELECT_IDLECMD, SELECT_BATTLECMD, SELECT_CARD, SELECT_PLACE,
 * SELECT_CHAIN, SELECT_TRIBUTE, SELECT_POSITION, SELECT_OPTION,
 * SELECT_YESNO, SELECT_EFFECTYN, tous confirmés en lisant playerop.cpp).
 * `playerid` identifie le CAMP (0/1), pas le participant précis : en Duel
 * Tag (Duel.model.ts), un camp peut avoir 1 à 5 participants qui partagent
 * ce même `playerid` — seul celui actuellement actif (`duelist_index ===
 * activeDuelistIndex[team]`, voir duelEngine.ts) a réellement la main/le
 * deck en jeu et doit pouvoir répondre ; un coéquipier inactif ne contrôle
 * ni la main ni le deck concernés par le prompt, même s'il est bien "de ce
 * camp".
 */
function promptPlayerId(raw: Buffer): number {
  return raw.readUInt8(1);
}

function requireActiveParticipant(state: EngineDuelState, participant: DuelParticipantAttrs, expectedTeam: number) {
  if (participant.team !== expectedTeam || participant.duelist_index !== state.activeDuelistIndex[participant.team]) {
    throw new AppError(403, 'Ce n’est pas à ce participant de répondre à cette invite en ce moment', 'wrong_participant');
  }
}

function requirePendingPrompt(state: EngineDuelState, expectedType: number, label: string, participant: DuelParticipantAttrs) {
  if (!state.pendingPrompt || state.pendingPrompt.type !== expectedType) {
    throw new AppError(400, `Aucune invite ${label} en attente pour ce duel actuellement`, 'wrong_prompt');
  }
  requireActiveParticipant(state, participant, promptPlayerId(state.pendingPrompt.raw));
}

/** Traite la réponse envoyée, avance la state machine, journalise, sauvegarde. */
async function respondAndAdvance(duel: DuelDocument, state: EngineDuelState, responseBytes: Buffer): Promise<void> {
  await state.ocgDuel.respond(responseBytes);
  const result: ProcessResult = await pumpUntilSettled(state.ocgDuel, await state.ocgDuel.process());
  const log = applyMessages(state, result);
  for (const msg of result.messages) {
    const summary = summarizeMessage(msg);
    if (summary) log.push(summary);
  }
  for (const line of log) duel.events.push({ message: line, created_at: new Date() });

  if (state.finished) {
    duel.status = 'finished';
    duel.winner_team = state.winnerTeam;
    dropEngineDuel(duel._id.toString());
  }
  await duel.save();
}

const rulesSchema = z
  .object({
    starting_lp: z.number().int().min(100).max(999_999).default(8000),
    hand_size: z.number().int().min(0).max(20).default(5),
    draw_count_per_turn: z.number().int().min(0).max(10).default(1),
    skip_first_battle_phase: z.boolean().default(true),
  })
  .default({});

const teamMemberSchema = z.object({ character_id: z.string(), deck_id: z.string() });

// 2 camps (limite dure du moteur, voir Duel.model.ts), 1 à 5 participants
// chacun (Duel Tag : PV/terrain partagés par camp, decks qui tournent —
// généralisation de l'ancien MIN_TEAMS=2/MAX_TEAMS=2/MAX_TEAM_SIZE=5).
const teamInputSchema = z.object({ name: z.string().trim().min(1).max(64), participants: z.array(teamMemberSchema).min(1).max(5) });

const createDuelSchema = z.object({
  game_session_id: z.string(),
  name: z.string().trim().min(1).max(64),
  rules: rulesSchema,
  teams: z.tuple([teamInputSchema, teamInputSchema]),
});

interface DeckCardPlan {
  characterId: Types.ObjectId;
  characterName: string;
  isNpc: boolean;
  // Propriétaire du personnage — sert uniquement à cibler la notification
  // duel_invite ci-dessous (jamais envoyé au moteur ni stocké sur le duel).
  userId: string;
  deckId: Types.ObjectId;
  mainCodes: number[];
  extraCodes: number[];
}

async function loadDeckPlan(characterId: string, deckId: string, session: GameSessionDocument): Promise<DeckCardPlan> {
  if (!Types.ObjectId.isValid(characterId)) throw new AppError(400, 'Identifiant de personnage invalide', 'invalid_input');
  const character = await Character.findById(characterId);
  if (!character || character.game_session_id.toString() !== session._id.toString()) {
    throw new AppError(404, 'Personnage introuvable dans ce salon', 'not_found');
  }
  const deck = character.decks.find((d) => d._id.toString() === deckId);
  if (!deck) throw new AppError(404, `Deck introuvable pour ${character.name}`, 'not_found');
  if (deck.cards.length === 0) throw new AppError(400, `Le deck de ${character.name} est vide`, 'invalid_input');

  const uniqueCardIds = [...new Set(deck.cards)];
  const cards = await Card.find({ _id: { $in: uniqueCardIds } });
  const cardById = new Map(cards.map((c) => [c._id.toString(), c]));

  const mainCodes: number[] = [];
  const extraCodes: number[] = [];
  for (const cardId of deck.cards) {
    const card = cardById.get(cardId);
    if (!card) throw new AppError(404, `Carte introuvable (${cardId}) dans le deck de ${character.name}`, 'not_found');
    if (card.engine_code === null || card.engine_code === undefined) {
      // Auto-guérison pour une carte OFFICIELLE : engine_code n'est jamais
      // qu'un miroir de ygoprodeck_id (voir cardImport.ts, aucune allocation
      // distincte), donc si ce dernier est déjà connu, il n'y a rien à
      // deviner — pas besoin de forcer une ré-importation manuelle du set.
      // Concerne les cartes importées avant l'ajout de ce champ (imports
      // antérieurs à l'intégration ocgcore) et jamais re-synchronisées
      // depuis. Une carte CUSTOM sans engine_code, elle, reste une vraie
      // erreur : aucune valeur sûre à déduire (le code synthétique est
      // alloué une seule fois à la création, voir engineCardCode.ts).
      if (!card.is_custom && card.ygoprodeck_id !== null && card.ygoprodeck_id !== undefined) {
        card.engine_code = card.ygoprodeck_id;
        await card.save();
      } else {
        throw new AppError(400, `« ${card.name} » n'a pas de code moteur — réenregistrez cette carte`, 'missing_engine_code');
      }
    }
    if (card.is_custom && !card.lua_script) {
      throw new AppError(400, `« ${card.name} » est une carte custom sans script Lua — un vrai script est obligatoire (CLAUDE.md §3.4)`, 'missing_lua_script');
    }
    (isExtraDeckFrameType(card.frame_type) ? extraCodes : mainCodes).push(card.engine_code);
  }

  return {
    characterId: character._id,
    characterName: character.name,
    isNpc: character.is_npc,
    userId: character.user_id.toString(),
    deckId: deck._id,
    mainCodes: shuffle(mainCodes),
    extraCodes,
  };
}

/** Enregistre (une fois) les cartes custom utilisées par ce plan de deck auprès du process moteur. */
async function registerCustomCards(ocgDuel: OcgcoreDuel, plans: DeckCardPlan[], registered: Set<number>): Promise<void> {
  const allCodes = [...new Set(plans.flatMap((p) => [...p.mainCodes, ...p.extraCodes]))];
  const customCards = await Card.find({ engine_code: { $in: allCodes }, is_custom: true });
  for (const card of customCards) {
    if (!card.engine_code || registered.has(card.engine_code)) continue;
    await ocgDuel.addCustomCard(card.engine_code, engineStatsForCustomCard(card));
    await ocgDuel.addCustomScript(card.engine_code, card.lua_script!);
    registered.add(card.engine_code);
  }
}

duelRouter.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = createDuelSchema.parse(req.body);
    const userId = req.user!.sub;

    if (!Types.ObjectId.isValid(body.game_session_id)) throw new AppError(400, 'game_session_id invalide', 'invalid_input');
    const session = await loadSessionOrThrow(body.game_session_id);
    if (!isSessionGm(session, userId)) throw new AppError(403, 'Seul le MJ peut organiser un duel', 'forbidden');

    const allCharacterIds = body.teams.flatMap((t) => t.participants.map((p) => p.character_id));
    if (new Set(allCharacterIds).size !== allCharacterIds.length) {
      throw new AppError(400, 'Un même personnage ne peut pas participer deux fois (même camp ou camps différents)', 'invalid_input');
    }

    // plans[team][duelistIndex] — l'index dans le tableau EST le duelist_index (voir Duel.model.ts).
    const plans: [DeckCardPlan[], DeckCardPlan[]] = [[], []];
    for (const team of [0, 1] as const) {
      for (const member of body.teams[team].participants) {
        plans[team].push(await loadDeckPlan(member.character_id, member.deck_id, session));
      }
    }

    const ocgDuel = new OcgcoreDuel();
    try {
      const registeredCustomCodes = new Set<number>();
      await registerCustomCards(ocgDuel, [...plans[0], ...plans[1]], registeredCustomCodes);

      const flags = DUEL_MODE_MR5 | (body.rules.skip_first_battle_phase ? 0 : DUEL_ATTACK_FIRST_TURN);
      const createdStatus = await ocgDuel.create({
        flags,
        lp1: body.rules.starting_lp,
        hand1: body.rules.hand_size,
        draw1: body.rules.draw_count_per_turn,
        lp2: body.rules.starting_lp,
        hand2: body.rules.hand_size,
        draw2: body.rules.draw_count_per_turn,
      });
      if (createdStatus !== 0) {
        throw new AppError(500, 'Le moteur de duel a refusé la création (voir logs backend)', 'engine_error');
      }

      for (const team of [0, 1] as const) {
        for (const [duelistIndex, plan] of plans[team].entries()) {
          for (const code of plan.mainCodes) {
            await ocgDuel.addCard({ team, code, con: team, loc: Location.DECK, seq: 0, pos: Position.FACEDOWN_DEFENSE, duelist: duelistIndex });
          }
          for (const code of plan.extraCodes) {
            await ocgDuel.addCard({ team, code, con: team, loc: Location.EXTRA, seq: 0, pos: Position.FACEDOWN_DEFENSE, duelist: duelistIndex });
          }
        }
      }

      const duel = await Duel.create({
        game_session_id: session._id,
        name: body.name,
        status: 'active',
        starting_lp: body.rules.starting_lp,
        hand_size: body.rules.hand_size,
        draw_count_per_turn: body.rules.draw_count_per_turn,
        teams: [{ name: body.teams[0].name }, { name: body.teams[1].name }],
        participants: ([0, 1] as const).flatMap((team) =>
          plans[team].map((plan, duelistIndex) => ({
            character_id: plan.characterId,
            character_name: plan.characterName,
            is_npc: plan.isNpc,
            team,
            duelist_index: duelistIndex,
            deck_id: plan.deckId,
          })),
        ),
        winner_team: null,
        events: [{ message: `Duel « ${body.name} » commencé`, created_at: new Date() }],
      });

      const duelistSeeds: [DuelistSeed[], DuelistSeed[]] = [
        plans[0].map((p) => ({ mainDeckSize: p.mainCodes.length })),
        plans[1].map((p) => ({ mainDeckSize: p.mainCodes.length })),
      ];
      const state = createInitialState(ocgDuel, body.rules.starting_lp, body.rules.hand_size, duelistSeeds);
      registerEngineDuel(duel._id.toString(), state);

      const startResult = await pumpUntilSettled(ocgDuel, await ocgDuel.start());
      const log = applyMessages(state, startResult);
      for (const line of log) duel.events.push({ message: line, created_at: new Date() });
      await duel.save();

      broadcastSessionResourceChanged(req, session._id.toString(), 'duels');

      // Convoque explicitement chaque joueur concerné (pas les PNJ — aucun
      // utilisateur humain n'attend derrière — ni le MJ créateur lui-même,
      // déjà au courant puisqu'il vient de le créer). Dédupliqué par
      // user_id : un même joueur pilotant 2 participants dans ce duel (rare,
      // mais permis) ne reçoit qu'UNE convocation.
      const inviteTargets = new Map<string, { user_id: string; character_id: string; character_name: string; team: 0 | 1 }>();
      for (const team of [0, 1] as const) {
        for (const plan of plans[team]) {
          if (plan.isNpc || plan.userId === userId || inviteTargets.has(plan.userId)) continue;
          inviteTargets.set(plan.userId, { user_id: plan.userId, character_id: plan.characterId.toString(), character_name: plan.characterName, team });
        }
      }
      if (inviteTargets.size > 0) {
        notifyDuelInvite(req, session._id.toString(), {
          duel_id: duel._id.toString(),
          duel_name: duel.name,
          participants: [...inviteTargets.values()],
        });
      }

      res.status(201).json({ duel: await toDuelDto(duel, userId, session) });
    } catch (err) {
      ocgDuel.quit();
      throw err;
    }
  }),
);

duelRouter.get(
  '/session/:sessionId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = req.params.sessionId!;
    if (!Types.ObjectId.isValid(sessionId)) throw new AppError(400, 'Identifiant de salon invalide', 'invalid_input');
    const session = await loadSessionOrThrow(sessionId);
    if (!isSessionMember(session, req.user!.sub)) throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');

    const duels = await Duel.find({ game_session_id: session._id }).sort({ createdAt: -1 });
    for (const duel of duels) await syncLostStatus(duel);
    res.json({ duels: await Promise.all(duels.map((d) => toDuelDto(d, req.user!.sub, session))) });
  }),
);

duelRouter.get(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const duel = await loadDuelOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(duel.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    await syncLostStatus(duel);
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

async function loadActionContext(req: AuthenticatedRequest, participantId: string) {
  const duel = await loadDuelOrThrow(req.params.id!);
  const session = await loadSessionOrThrow(duel.game_session_id.toString());
  if (duel.status !== 'active') throw new AppError(400, 'Ce duel n’est plus actif', 'duel_finished');
  const participant = findParticipantOrThrow(duel, participantId);
  // Le MJ ne joue jamais À LA PLACE d'un participant contrôlé par un vrai
  // joueur — seulement les PNJ (voir canActForParticipant).
  if (!(await canActForParticipant(participant, req.user!.sub, session))) {
    throw new AppError(403, 'Vous ne contrôlez pas ce participant', 'forbidden');
  }
  const state = requireEngineState(duel);
  return { duel, participant, state, session };
}

duelRouter.post(
  '/:id/idle-action',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), category: z.number().int().min(0).max(8), index: z.number().int().min(0).default(0) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_IDLECMD, 'd’action (Main Phase)', participant);
    await respondAndAdvance(duel, state, encodeIdleCmdResponse(body.category, body.index));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/battle-action',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), category: z.number().int().min(0).max(3), index: z.number().int().min(0).default(0) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_BATTLECMD, 'de combat (Battle Phase)', participant);
    await respondAndAdvance(duel, state, encodeBattleCmdResponse(body.category, body.index));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/select-place',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z
      .object({ participant_id: z.string(), selections: z.array(z.object({ player: z.union([z.literal(0), z.literal(1)]), location: z.number(), sequence: z.number() })).min(1) })
      .parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_PLACE, 'de zone', participant);
    await respondAndAdvance(duel, state, encodeSelectPlaceResponse(body.selections));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/select-card',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), indices: z.array(z.number().int().min(0)).optional(), cancel: z.boolean().default(false) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_CARD, 'de sélection de carte', participant);
    const response = body.cancel ? encodeSelectCardCancel() : encodeSelectCardResponse(body.indices ?? []);
    await respondAndAdvance(duel, state, response);
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/select-tribute',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), indices: z.array(z.number().int().min(0)).optional(), cancel: z.boolean().default(false) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_TRIBUTE, 'de tribut', participant);
    // Même encodage que MSG_SELECT_CARD : les deux passent par parse_response_cards côté moteur (playerop.cpp).
    const response = body.cancel ? encodeSelectCardCancel() : encodeSelectCardResponse(body.indices ?? []);
    await respondAndAdvance(duel, state, response);
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/select-position',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), position: z.union([z.literal(0x1), z.literal(0x2), z.literal(0x4), z.literal(0x8)]) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_POSITION, 'de position', participant);
    await respondAndAdvance(duel, state, encodeSelectPositionResponse(body.position));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/select-option',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), index: z.number().int().min(0) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_OPTION, 'de choix d’option', participant);
    await respondAndAdvance(duel, state, encodeSelectOptionResponse(body.index));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/chain-action',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), index: z.number().int().min(-1).default(-1) }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    requirePendingPrompt(state, MessageType.SELECT_CHAIN, 'de chaîne', participant);
    await respondAndAdvance(duel, state, encodeSelectChainResponse(body.index));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/yesno',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ participant_id: z.string(), yes: z.boolean() }).parse(req.body);
    const { duel, participant, state, session } = await loadActionContext(req, body.participant_id);
    if (!state.pendingPrompt || (state.pendingPrompt.type !== MessageType.SELECT_YESNO && state.pendingPrompt.type !== MessageType.SELECT_EFFECTYN)) {
      throw new AppError(400, 'Aucune invite oui/non en attente pour ce duel actuellement', 'wrong_prompt');
    }
    requireActiveParticipant(state, participant, promptPlayerId(state.pendingPrompt.raw));
    await respondAndAdvance(duel, state, encodeYesNoResponse(body.yes));
    broadcastSessionResourceChanged(req, duel.game_session_id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.post(
  '/:id/end',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const duel = await loadDuelOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(duel.game_session_id.toString());
    if (!isSessionGm(session, req.user!.sub)) throw new AppError(403, 'Seul le MJ peut terminer le duel', 'forbidden');
    if (duel.status !== 'active') throw new AppError(400, 'Ce duel est déjà terminé', 'duel_finished');

    const { winner_team } = z.object({ winner_team: z.number().int().min(0).max(1).nullable().optional() }).parse(req.body ?? {});
    dropEngineDuel(duel._id.toString());
    duel.status = 'finished';
    duel.winner_team = winner_team ?? null;
    duel.events.push({ message: 'Duel arrêté par le MJ', created_at: new Date() });
    await duel.save();
    broadcastSessionResourceChanged(req, session._id.toString(), 'duels');
    res.json({ duel: await toDuelDto(duel, req.user!.sub, session) });
  }),
);

duelRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const duel = await loadDuelOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(duel.game_session_id.toString());
    if (!isSessionGm(session, req.user!.sub)) throw new AppError(403, 'Seul le MJ peut supprimer ce duel', 'forbidden');
    dropEngineDuel(duel._id.toString());
    await duel.deleteOne();
    broadcastSessionResourceChanged(req, session._id.toString(), 'duels');
    res.status(204).send();
  }),
);

// --- Terrain (zone par zone) : consommé à la demande par le plateau frontend,
// pas embarqué dans toDuelDto (round-trip supplémentaire vers le process
// moteur par zone interrogée). Main/Extra Deck : contenu réservé au
// contrôleur du participant concerné et au MJ (voir CLAUDE.md §7) — sinon
// simplement omis (le compte, lui, est déjà dans le DTO duel principal).

interface BoardCard {
  code: number;
  position: number;
  face_down: boolean;
  attack: number | null;
  defense: number | null;
  overlay_count: number;
  counters: number[];
  card: CardSummary | null;
}

/**
 * `reveal=false` masque l'identité (nom/image/ATK/DEF) d'une carte FACE
 * CACHÉE — utilisé pour le terrain de l'ADVERSAIRE (jamais le sien : on
 * connaît toujours ses propres cartes posées face cachée). Le nombre de
 * matériaux Xyz/compteurs reste visible (info publique même face cachée).
 */
function toBoardCard(q: QueriedCard, cards: Map<number, CardSummary>, reveal = true): BoardCard {
  const position = q.position ?? 0;
  const faceDown = (position & (Position.FACEDOWN_ATTACK | Position.FACEDOWN_DEFENSE)) !== 0;
  const shouldReveal = reveal || !faceDown;
  return {
    code: q.code ?? 0,
    position,
    face_down: faceDown,
    attack: shouldReveal ? q.attack : null,
    defense: shouldReveal ? q.defense : null,
    overlay_count: q.overlayCodes.length,
    counters: q.counters,
    card: shouldReveal && q.code !== null ? (cards.get(q.code) ?? null) : null,
  };
}

async function queryZone(
  ocgDuel: OcgcoreDuel,
  con: 0 | 1,
  loc: number,
): Promise<{ slots: Array<QueriedCard | null>; codes: number[] }> {
  const buf = await ocgDuel.queryLocation(con, loc, BOARD_QUERY_FLAGS);
  const slots = parseQueryLocation(buf);
  return { slots, codes: slots.filter((s): s is QueriedCard => s !== null && s.code !== null).map((s) => s.code as number) };
}

duelRouter.get(
  '/:id/field',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const duel = await loadDuelOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(duel.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    const state = requireEngineState(duel);

    // Secret d'équipe (main/Extra Deck ET identité des cartes face cachée
    // sur le terrain) : visible si le spectateur contrôle N'IMPORTE LEQUEL
    // des participants de ce camp (pas juste le duelist actuellement actif)
    // — un coéquipier voit la main de son équipe même hors de son propre
    // tour, exactement comme sur un vrai plateau de tag. Le MJ n'a cette
    // vision étendue aux DEUX camps que s'il ne pilote aucun PNJ dans CE duel
    // (pure supervision) — voir `computeCanSeeTeam`.
    const canSeeSecrets = await computeCanSeeTeam(duel, req.user!.sub, session);

    const zonesByTeam = await Promise.all(
      ([0, 1] as const).map(async (team) => {
        const [mzone, szone, grave, removed] = await Promise.all([
          queryZone(state.ocgDuel, team, Location.MZONE),
          queryZone(state.ocgDuel, team, Location.SZONE),
          queryZone(state.ocgDuel, team, Location.GRAVE),
          queryZone(state.ocgDuel, team, Location.REMOVED),
        ]);
        const secret = canSeeSecrets[team]
          ? await Promise.all([queryZone(state.ocgDuel, team, Location.HAND), queryZone(state.ocgDuel, team, Location.EXTRA)])
          : null;
        return { mzone, szone, grave, removed, hand: secret?.[0] ?? null, extra: secret?.[1] ?? null };
      }),
    );

    const allCodes = zonesByTeam.flatMap((z) => [...z.mzone.codes, ...z.szone.codes, ...z.grave.codes, ...z.removed.codes, ...(z.hand?.codes ?? []), ...(z.extra?.codes ?? [])]);
    const cards = await resolveCardSummaries(allCodes);

    const toBoard = (slots: Array<QueriedCard | null>, reveal = true) => slots.map((s) => (s ? toBoardCard(s, cards, reveal) : null));

    res.json({
      field: {
        teams: zonesByTeam.map((z, team) => ({
          // Terrain public en position face visible ; face cachée, seule
          // l'équipe propriétaire (ou le MJ) voit l'identité (voir toBoardCard).
          monster_zones: toBoard(z.mzone.slots, canSeeSecrets[team as 0 | 1]),
          spell_trap_zones: toBoard(z.szone.slots, canSeeSecrets[team as 0 | 1]),
          graveyard: toBoard(z.grave.slots).filter((c): c is BoardCard => c !== null),
          banished: toBoard(z.removed.slots).filter((c): c is BoardCard => c !== null),
          hand: z.hand ? toBoard(z.hand.slots).filter((c): c is BoardCard => c !== null) : null,
          extra_deck: z.extra ? toBoard(z.extra.slots).filter((c): c is BoardCard => c !== null) : null,
        })),
      },
    });
  }),
);
