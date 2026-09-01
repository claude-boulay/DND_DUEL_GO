import {
  DuelStatus,
  MessageType,
  OcgcoreDuel,
  parseDamageOrRecover,
  parseDraw,
  parseMove,
  parseNewPhase,
  parseNewTurn,
  parseTagSwap,
  type EngineMessage,
  type ProcessResult,
} from './ocgcoreClient';
import { Location } from './ocgcoreClient';

/**
 * État "vivant" d'un duel, tenu UNIQUEMENT en mémoire par ce process backend
 * (voir Duel.model.ts pour la justification — pas de sérialisation possible
 * côté ocgcore). Registre en mémoire, clé = _id du document Duel Mongo.
 */

const PHASE_LABELS: Record<number, string> = {
  0x01: 'draw',
  0x02: 'standby',
  0x04: 'main1',
  0x08: 'battle_start',
  0x10: 'battle_step',
  0x20: 'damage',
  0x40: 'damage_cal',
  0x80: 'battle',
  0x100: 'main2',
  0x200: 'end',
};

export interface EngineTeamState {
  lp: number;
}

export interface EngineParticipantState {
  handCount: number;
  deckCount: number;
}

export interface PendingPrompt {
  type: number;
  raw: Buffer;
}

/** Taille du deck principal enregistré pour un duelist, pour amorcer son compteur au bon nombre (voir createInitialState). */
export interface DuelistSeed {
  mainDeckSize: number;
}

export interface EngineDuelState {
  ocgDuel: OcgcoreDuel;
  phase: string;
  turnNumber: number;
  /** Équipe dont c'est le tour (0 ou 1). */
  currentTeam: 0 | 1;
  teams: [EngineTeamState, EngineTeamState];
  /**
   * Un tableau de duelists PAR camp (1 à 5, voir Duel.model.ts) — indexé par
   * `duelist_index` (voir DuelParticipantAttrs). Seul le duelist
   * `activeDuelistIndex[team]` est "en jeu" à un instant donné (main/deck
   * réels) ; les autres gardent leurs derniers comptes connus (gelés depuis
   * leur dernier tour actif), exactement comme le moteur les gèle vraiment
   * (voir field::tag_swap, field.cpp).
   */
  participants: [EngineParticipantState[], EngineParticipantState[]];
  /**
   * Duelist actuellement actif par camp — avancé UNIQUEMENT en réaction à un
   * vrai MSG_TAG_SWAP observé (jamais prédit à partir du numéro de tour : le
   * camp qui perd le tirage au sort de départ voit sa rotation démarrer dès
   * SON PROPRE premier tour, sautant l'index 0 — comportement réel du
   * moteur confirmé en le pilotant en direct, voir le plan d'intégration).
   * Coïncide avec `duelist_index` des participants Mongo.
   */
  activeDuelistIndex: [number, number];
  pendingPrompt: PendingPrompt | null;
  finished: boolean;
  winnerTeam: number | null;
}

const registry = new Map<string, EngineDuelState>();

export function registerEngineDuel(duelId: string, state: EngineDuelState): void {
  registry.set(duelId, state);
}

export function getEngineDuel(duelId: string): EngineDuelState | undefined {
  return registry.get(duelId);
}

export function dropEngineDuel(duelId: string): void {
  const state = registry.get(duelId);
  if (state) {
    state.ocgDuel.quit();
    registry.delete(duelId);
  }
}

/**
 * `duelistSeeds[team][i]` = infos du duelist d'index `i` de ce camp (dans
 * l'ordre d'enregistrement, voir Duel.model.ts). Seul le duelist d'index 0
 * de chaque camp reçoit la main de départ (`handSize`, tirée automatiquement
 * de son deck par le moteur au démarrage — les autres commencent avec 0 en
 * main, leur deck intact, jusqu'à leur première rotation active).
 */
export function createInitialState(
  ocgDuel: OcgcoreDuel,
  startingLp: number,
  handSize: number,
  duelistSeeds: [DuelistSeed[], DuelistSeed[]],
): EngineDuelState {
  const participants = duelistSeeds.map((seeds) =>
    seeds.map((seed, i) => ({
      handCount: i === 0 ? handSize : 0,
      deckCount: i === 0 ? Math.max(0, seed.mainDeckSize - handSize) : seed.mainDeckSize,
    })),
  ) as [EngineParticipantState[], EngineParticipantState[]];

  return {
    ocgDuel,
    phase: 'main1',
    turnNumber: 1,
    currentTeam: 0,
    teams: [{ lp: startingLp }, { lp: startingLp }],
    participants,
    activeDuelistIndex: [0, 0],
    pendingPrompt: null,
    finished: false,
    winnerTeam: null,
  };
}

/**
 * `OCG_DuelProcess` (une commande PROCESS) s'arrête dès qu'IL A GÉNÉRÉ AU
 * MOINS UN message, même si son statut de retour reste CONTINUE — ce n'est
 * PAS la même chose que "prêt à recevoir une réponse" (AWAITING). Vérifié
 * empiriquement en pilotant le protocole brut : un simple Invocation Normale
 * niveau 4 (aucun tribut) produit successivement un HINT (CONTINUE), un MOVE
 * (CONTINUE) puis un SUMMONED (CONTINUE) sur TROIS appels PROCESS séparés,
 * avant d'atteindre le prochain vrai prompt (AWAITING). Un seul appel
 * `.process()` par action laisserait donc le duel bloqué en interne (plus
 * aucun prompt visible côté client, mais le moteur attend toujours d'être
 * rappelé) — ce nettoyage boucle jusqu'à AWAITING/END, comme l'API le prévoit.
 */
export async function pumpUntilSettled(ocgDuel: OcgcoreDuel, initial: ProcessResult): Promise<ProcessResult> {
  let result = initial;
  const messages: EngineMessage[] = [...result.messages];
  let iterations = 0;
  while (result.status === DuelStatus.CONTINUE) {
    iterations += 1;
    if (iterations > 1000) {
      throw new Error('ocgcore: boucle PROCESS sans atteindre AWAITING/END (dépassement de sécurité)');
    }
    result = await ocgDuel.process();
    messages.push(...result.messages);
  }
  return { status: result.status, messages };
}

/**
 * Une ligne de journal, structurée (voir Duel.model.ts `DuelEventAttrs`) :
 * `message` reste TOUJOURS le texte français (repli), `code`/`params`
 * permettent au frontend de la traduire via `duelEvents.<code>` quand
 * catalogués (voir locales/{fr,en}.json, plan d'internationalisation §6).
 */
export interface DuelLogEntry {
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * Applique un lot de messages moteur à l'état en mémoire, renvoie les
 * lignes de journal humain correspondantes (à ajouter au document Duel).
 * Ne cherche PAS à reconstruire le contenu exact des zones (main/terrain en
 * détail) — juste PV/phase/tour/compteurs, suffisant pour une DTO utile ;
 * le détail zone par zone est laissé au travail frontend à venir (voir le
 * plan d'intégration).
 */
export function applyMessages(state: EngineDuelState, result: ProcessResult): DuelLogEntry[] {
  const log: DuelLogEntry[] = [];

  for (const msg of result.messages) {
    switch (msg.type) {
      case MessageType.DAMAGE: {
        const { team, amount } = parseDamageOrRecover(msg.raw);
        state.teams[team]!.lp = Math.max(0, state.teams[team]!.lp - amount);
        log.push({
          message: `Équipe ${team + 1} : -${amount} PV (${state.teams[team]!.lp})`,
          code: 'lp_damage',
          params: { team: team + 1, amount, total: state.teams[team]!.lp },
        });
        break;
      }
      case MessageType.RECOVER: {
        const { team, amount } = parseDamageOrRecover(msg.raw);
        state.teams[team]!.lp += amount;
        log.push({
          message: `Équipe ${team + 1} : +${amount} PV (${state.teams[team]!.lp})`,
          code: 'lp_recover',
          params: { team: team + 1, amount, total: state.teams[team]!.lp },
        });
        break;
      }
      case MessageType.NEW_TURN: {
        const team = parseNewTurn(msg.raw);
        state.currentTeam = team === 1 ? 1 : 0;
        state.turnNumber += 1;
        log.push({
          message: `Tour ${state.turnNumber} — équipe ${state.currentTeam + 1}`,
          code: 'new_turn',
          params: { turn: state.turnNumber, team: state.currentTeam + 1 },
        });
        break;
      }
      case MessageType.NEW_PHASE: {
        const phaseFlag = parseNewPhase(msg.raw);
        state.phase = PHASE_LABELS[phaseFlag] ?? String(phaseFlag);
        log.push({ message: `Phase : ${state.phase}`, code: 'new_phase', params: { phase: state.phase } });
        break;
      }
      case MessageType.DRAW: {
        const { team, codes } = parseDraw(msg.raw);
        const con = team === 1 ? 1 : 0;
        const p = state.participants[con][state.activeDuelistIndex[con]];
        if (p) {
          p.handCount += codes.length;
          p.deckCount = Math.max(0, p.deckCount - codes.length);
        }
        break;
      }
      case MessageType.MOVE: {
        const move = parseMove(msg.raw);
        // Ajustement grossier des compteurs main/deck quand une carte les
        // quitte ou les rejoint (ex. une carte piochée à la création, sans
        // passer par MSG_DRAW ; ou remise en main par un effet). Toujours le
        // duelist ACTUELLEMENT actif de ce camp : main/deck inactifs sont
        // gelés (le moteur ne les touche jamais tant qu'ils ne sont pas
        // rappelés via un MSG_TAG_SWAP, voir field::tag_swap).
        const adjust = (loc: number, con: number, delta: number) => {
          const teamIdx = con === 1 ? 1 : 0;
          const p = state.participants[teamIdx][state.activeDuelistIndex[teamIdx]];
          if (!p) return;
          if (loc === Location.HAND) p.handCount = Math.max(0, p.handCount + delta);
          else if (loc === Location.DECK) p.deckCount = Math.max(0, p.deckCount + delta);
        };
        adjust(move.previous.location, move.previous.controller, -1);
        adjust(move.current.location, move.current.controller, 1);
        break;
      }
      case MessageType.TAG_SWAP: {
        // Duel Tag (voir Duel.model.ts) : le camp `team` vient de faire
        // tourner son duelist actif. On avance NOTRE index en réaction à ce
        // vrai événement moteur (jamais en le prédisant depuis le numéro de
        // tour — le camp qui perd le tirage au sort de départ saute l'index
        // 0 dès son propre premier tour, confirmé en direct), et on
        // resynchronise main/deck du duelist qui vient de devenir actif sur
        // ce que le moteur rapporte réellement (vérité terrain, pas une
        // simple estimation incrémentale).
        const swap = parseTagSwap(msg.raw);
        const team = (swap.team === 1 ? 1 : 0) as 0 | 1;
        const roster = state.participants[team];
        if (roster.length > 1) {
          state.activeDuelistIndex[team] = (state.activeDuelistIndex[team] + 1) % roster.length;
        }
        const active = roster[state.activeDuelistIndex[team]];
        if (active) {
          active.handCount = swap.hand.length;
          active.deckCount = swap.mainCount;
        }
        log.push({
          message: `Équipe ${team + 1} : le duelist actif change (duelist n°${state.activeDuelistIndex[team] + 1})`,
          code: 'duelist_swap',
          params: { team: team + 1, duelist: state.activeDuelistIndex[team] + 1 },
        });
        break;
      }
      case MessageType.WIN: {
        state.finished = true;
        // Le camp gagnant est le premier octet du payload (0 ou 1) — con.
        state.winnerTeam = msg.raw.length > 1 ? msg.raw.readUInt8(1) : null;
        log.push({ message: 'Le duel est terminé.', code: 'duel_won' });
        break;
      }
      default:
        break;
    }
  }

  if (result.status === 1 /* AWAITING */) {
    const last = result.messages[result.messages.length - 1];
    // MSG_RETRY (une réponse invalide vient d'être rejetée) n'est PAS un
    // nouveau prompt : le moteur repose exactement la même question qu'avant
    // (il ne réémet pas les données du prompt, juste ce marqueur — confirmé
    // en pilotant le protocole brut). Écraser pendingPrompt avec {type:
    // RETRY} ici casserait la réponse suivante : plus aucune route ne
    // reconnaîtrait ce type, la session serait bloquée en 'wrong_prompt' en
    // permanence. On garde donc le prompt précédent tel quel dans ce cas.
    if (last && last.type !== MessageType.RETRY) {
      state.pendingPrompt = { type: last.type, raw: last.raw };
    }
  } else {
    state.pendingPrompt = null;
  }
  if (result.status === 0 /* END */) {
    state.finished = true;
  }

  return log;
}

export function summarizeMessage(msg: EngineMessage): DuelLogEntry | null {
  switch (msg.type) {
    case MessageType.SUMMONED:
      return { message: 'Invocation résolue.', code: 'summoned' };
    case MessageType.CHAINING:
      return { message: 'Activation en chaîne.', code: 'chaining' };
    case MessageType.CHAIN_SOLVED:
      return { message: 'Un lien de la chaîne se résout.', code: 'chain_solved' };
    case MessageType.ATTACK:
      return { message: 'Déclaration d’attaque.', code: 'attack_declared' };
    case MessageType.BATTLE:
      return { message: 'Résolution de combat.', code: 'battle_resolved' };
    default:
      return null;
  }
}
