import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import cardBackImage from '../assets/card-back.jpg';
import { socket } from '../lib/socket';
import {
  api,
  ApiError,
  type ApiCard,
  type ApiCharacter,
  type ApiDuel,
  type ApiDuelBoardCard,
  type ApiDuelField,
  type ApiDuelFieldTeam,
  type ApiDuelParticipant,
  type ApiDuelPrompt,
  type ApiPromptCardOption,
  type ApiSession,
} from '../lib/api';

interface DuelBoardOverlayProps {
  token: string;
  session: ApiSession;
  duel: ApiDuel;
  characters: ApiCharacter[];
  currentUserId: string;
  onUpdated: (duel: ApiDuel) => void;
  onClose: () => void;
}

/**
 * Fréquence des invites de réponse en chaîne (MSG_SELECT_CHAIN) — réglage
 * purement local au spectateur (pas de notion serveur : chacun choisit son
 * propre niveau d'interruption), persisté en localStorage pour survivre à la
 * fermeture/réouverture du plateau.
 * - 'on'   : toujours demander, même s'il n'y a rien à activer (juste "Passer").
 * - 'auto' : ne demander que si une carte est réellement activable en réponse
 *            (`options.length > 0`) — passe automatiquement sinon.
 * - 'off'  : ne demander que les effets à activation obligatoire
 *            (`forced`, ex. effets à timing) — passe automatiquement le
 *            reste, y compris quand une activation optionnelle est possible.
 *            Un `forced` avec plusieurs options garde quand même le choix de
 *            l'ORDRE d'activation (les boutons restent affichés).
 */
type ChainAutoMode = 'on' | 'auto' | 'off';
const CHAIN_MODE_STORAGE_KEY = 'duel_chain_auto_mode';

function loadChainMode(): ChainAutoMode {
  try {
    const stored = window.localStorage.getItem(CHAIN_MODE_STORAGE_KEY);
    if (stored === 'on' || stored === 'auto' || stored === 'off') return stored;
  } catch {
    // localStorage indisponible (navigation privée...) : repli sur le défaut.
  }
  // 'auto' par défaut (pas 'on') : une fenêtre de priorité de chaîne s'ouvre
  // en vrai après quasi CHAQUE action (règle réelle du jeu, pas un bug), donc
  // 'on' redemandait "activer ou passer ?" même quand il n'y avait
  // objectivement rien à activer — GM-reported comme "des demandes
  // d'activation même quand il n'y a aucune possibilité d'utiliser un
  // effet". 'auto' ne demande que quand une vraie réponse est possible.
  return 'auto';
}

/**
 * Constantes protocole moteur dupliquées côté front (comme types/socket.ts) —
 * le frontend n'importe jamais backend/src/services/ocgcoreClient.ts (deux
 * contextes de build Docker indépendants). Valeurs confirmées dans
 * ocgapi_constants.h, voir CLAUDE.md §7 pour le contexte.
 */
const IdleCmdCategory = { SUMMON: 0, SPSUMMON: 1, REPOSITION: 2, MSET: 3, SSET: 4, ACTIVATE: 5, TO_BATTLE: 6, TO_END: 7, SHUFFLE_HAND: 8 } as const;
const BattleCmdCategory = { ACTIVATE: 0, ATTACK: 1, TO_MAIN2: 2, TO_END: 3 } as const;
const EngineLocation = { HAND: 0x02, MZONE: 0x04, SZONE: 0x08 } as const;
const EnginePosition = { FACEUP_ATTACK: 0x1, FACEDOWN_ATTACK: 0x2, FACEUP_DEFENSE: 0x4, FACEDOWN_DEFENSE: 0x8 } as const;

/**
 * Emplacements libres décodés du flag de MSG_SELECT_PLACE (bit=1 =
 * indisponible) — mzone (7 zones, bits 0-6) puis szone (8 zones, bits 8-15 :
 * 0-4 Magie/Piège normales, 5 = Zone Terrain, 6-7 = Zones Pendule). RÉEL BUG
 * corrigé ici (rapporté : invocation Pendule impossible, plus aucune action
 * possible) — cette liste s'arrêtait à bit 4 (5 zones), reflet d'une lecture
 * trop courte du flag moteur ; confirmé en lisant `operations.cpp`
 * (`flag = ((flag & 0xff) << 8) | ...` — la portion szone du flag occupe TOUT
 * un octet, 8 bits, pas 5). Poser une carte Pendule dans une Zone Pendule
 * n'avait donc JAMAIS d'emplacement éligible proposé, quelle que soit sa
 * disponibilité réelle côté moteur — la joueuse restait bloquée sans aucune
 * zone cliquable pour terminer l'action.
 */
function availablePlaces(flag: number): Array<{ location: number; sequence: number }> {
  const available = ~flag >>> 0;
  const places: Array<{ location: number; sequence: number }> = [];
  for (let bit = 0; bit < 7; bit += 1) if (available & (1 << bit)) places.push({ location: EngineLocation.MZONE, sequence: bit });
  for (let bit = 0; bit < 8; bit += 1) if (available & (1 << (8 + bit))) places.push({ location: EngineLocation.SZONE, sequence: bit });
  return places;
}

/** Étiquette d'une zone Magie/Piège par séquence — 0-4 normales, 5 = Zone Terrain, 6-7 = Zones Pendule (voir availablePlaces). */
function szoneLabel(sequence: number): string {
  if (sequence === 5) return 'Zone Terrain';
  if (sequence === 6 || sequence === 7) return `Zone Pendule ${sequence === 6 ? 'gauche' : 'droite'}`;
  return `Magie/Piège ${sequence + 1}`;
}

function isDefensePosition(position: number): boolean {
  return (position & (EnginePosition.FACEDOWN_DEFENSE | EnginePosition.FACEUP_DEFENSE)) !== 0;
}

/** Trouve, parmi une liste d'options de prompt, celle qui correspond exactement à cet emplacement (carte en main ou sur le terrain). */
function findOptionAt<T extends { location: number; sequence: number; controller: number }>(
  options: T[],
  location: number,
  sequence: number,
  controller: number,
): T | undefined {
  return options.find((o) => o.location === location && o.sequence === sequence && o.controller === controller);
}

type ActionKind = 'summon' | 'activate' | 'reposition' | 'attack';
interface ActionOption {
  key: string;
  kind: ActionKind;
  label: string;
  glyph: string;
  onClick: () => void;
}
const mkAction = (kind: ActionKind, label: string, glyph: string, onClick: () => void): ActionOption => ({ key: `${kind}:${label}`, kind, label, glyph, onClick });

type GlowKind = ActionKind | null;
/** Halo coloré par carte : orange = activable, bleu = invocable/posable, rouge = attaque possible, vert = changement de position seulement. */
const GLOW_CLS: Record<ActionKind, string> = {
  activate: 'border-transparent ring-2 ring-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.5)]',
  summon: 'border-transparent ring-2 ring-sky-400 shadow-[0_0_8px_2px_rgba(56,189,248,0.5)]',
  attack: 'border-transparent ring-2 ring-rose-400 shadow-[0_0_8px_2px_rgba(251,113,133,0.5)]',
  reposition: 'border-transparent ring-2 ring-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]',
};
const ACTION_BUTTON_CLS: Record<ActionKind, string> = {
  activate: 'border-amber-400 bg-amber-500/20 text-amber-300 hover:bg-amber-500/35',
  summon: 'border-sky-400 bg-sky-500/20 text-sky-300 hover:bg-sky-500/35',
  attack: 'border-rose-400 bg-rose-500/20 text-rose-300 hover:bg-rose-500/35',
  reposition: 'border-emerald-400 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/35',
};

interface ZoneInteraction {
  onClick?: (rect: DOMRect) => void;
  glow: GlowKind;
  selected: boolean;
  eligible: boolean;
}

/** Panneau plein écran : duel réel piloté par le moteur ocgcore (EDOPro), voir CLAUDE.md §7. */
export function DuelBoardOverlay({ token, session, duel, characters, currentUserId, onUpdated, onClose }: DuelBoardOverlayProps) {
  const [field, setField] = useState<ApiDuelField | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewCard, setPreviewCard] = useState<ApiCard | null>(null);
  const [showPile, setShowPile] = useState<{ label: string; cards: ApiDuelBoardCard[] } | null>(null);
  const [selectedPlaces, setSelectedPlaces] = useState<Array<{ location: number; sequence: number }>>([]);
  const [selectedCardIndices, setSelectedCardIndices] = useState<number[]>([]);
  const [chainMode, setChainMode] = useState<ChainAutoMode>(loadChainMode);
  const [actionPopup, setActionPopup] = useState<{ card: ApiDuelBoardCard; rect: DOMRect; actions: ActionOption[] } | null>(null);
  // Empêche de retenter automatiquement une action déjà REFUSÉE (voir bug ci-dessous) :
  // mémorise la signature de la dernière invite de chaîne déjà auto-tentée.
  const lastAutoChainKeyRef = useRef<string | null>(null);

  const updateChainMode = (mode: ChainAutoMode) => {
    setChainMode(mode);
    try {
      window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, mode);
    } catch {
      // localStorage indisponible : le réglage reste actif pour cette session, pas persisté.
    }
  };

  /**
   * Qui peut réellement AGIR pour ce participant — reflète exactement
   * `canActForParticipant` côté backend (duel.routes.ts) : le MJ ne joue
   * JAMAIS à la place d'un participant contrôlé par un vrai joueur, seulement
   * les PNJ. Un ancien alias (`controlsParticipant`) accordait à tort le MJ
   * sur TOUT participant (logique de VUE, pas d'action) — le décalage entre
   * les deux causait un vrai bug : l'auto-passe de chaîne du MJ tentait
   * d'agir pour le joueur, se faisait rejeter (403 « Vous ne contrôlez pas
   * ce participant »), et — comme rien n'empêchait de RÉESSAYER — la
   * nouvelle tentative repartait dès que `busy` repassait à `false`,
   * provoquant une boucle serrée d'appels échoués qui faisait clignoter
   * l'alerte en continu (et pouvait geler l'onglet). Voir aussi
   * `lastAutoChainKeyRef` ci-dessous : la seconde moitié du correctif.
   */
  const canAct = (participant: ApiDuelParticipant): boolean =>
    participant.is_npc ? session.is_gm : characters.find((c) => c.id === participant.character_id)?.user_id === currentUserId;

  // Camp du spectateur (pas le MJ, qui n'a pas de "propre" camp — il voit/gère
  // les deux) : le premier camp où il possède réellement un personnage
  // participant. Pilote la mise en page miroir demandée : le terrain de CE
  // camp s'affiche toujours le plus proche (en bas), l'adversaire le plus
  // loin (en haut) et sa ligne de zones reflétée ; sa main sort de son
  // encart de terrain pour s'afficher dans une barre dédiée en bas de
  // l'écran. Un MJ sans personnage dans le duel garde l'ordre naturel
  // (camp 0 puis camp 1, aucune main mise en avant en particulier).
  const myTeam: 0 | 1 | null = (() => {
    const mine = duel.participants.find((p) => characters.find((c) => c.id === p.character_id)?.user_id === currentUserId);
    return mine ? (mine.team as 0 | 1) : null;
  })();
  const teamRenderOrder: Array<0 | 1> = myTeam === null ? [0, 1] : [(1 - myTeam) as 0 | 1, myTeam];
  const myActiveParticipant = myTeam !== null ? (duel.participants.find((p) => p.team === myTeam && p.is_active) ?? duel.participants.find((p) => p.team === myTeam)) : undefined;

  const refreshField = useCallback(() => {
    if (duel.status !== 'active') return;
    api
      .getDuelField(token, duel.id)
      .then(({ field: fetched }) => {
        setField(fetched);
        setFieldError(null);
      })
      .catch((err) => setFieldError(err instanceof ApiError ? err.message : 'Impossible de charger le terrain'));
  }, [token, duel.id, duel.status]);

  useEffect(() => {
    setSelectedPlaces([]);
    setSelectedCardIndices([]);
    setActionPopup(null);
    refreshField();
  }, [refreshField, duel.pending_prompt]);

  useEffect(() => {
    const onChanged = (payload: { resource: string; session_id: string }) => {
      if (payload.resource === 'duels' && payload.session_id === session.id) refreshField();
    };
    socket.on('session_resource_changed', onChanged);
    return () => {
      socket.off('session_resource_changed', onChanged);
    };
  }, [session.id, refreshField]);

  const run = async (action: () => Promise<{ duel: ApiDuel }>) => {
    setBusy(true);
    setActionError(null);
    try {
      const { duel: updated } = await action();
      onUpdated(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setBusy(false);
    }
  };

  const prompt = duel.pending_prompt;
  // Duel Tag (CLAUDE.md §7) : un camp peut avoir plusieurs participants,
  // seul celui actuellement actif (`is_active`) contrôle vraiment la
  // main/le deck concernés par le prompt de son camp.
  const actingParticipant = prompt && 'playerid' in prompt ? duel.participants.find((p) => p.team === prompt.playerid && p.is_active) : undefined;
  const authorized = !!actingParticipant && canAct(actingParticipant);

  // Passe automatiquement une invite de chaîne selon le réglage choisi — voir
  // ChainAutoMode. Ne s'applique qu'aux invites que CE spectateur peut
  // RÉELLEMENT valider côté serveur (sinon le MJ tenterait de décider à la
  // place d'un joueur, rejeté avec 403 — voir canAct) ; `busy` évite un
  // double envoi pendant l'aller-retour réseau.
  //
  // `lastAutoChainKeyRef` ne mémorise que les ÉCHECS (pas chaque tentative,
  // succès compris) : une fenêtre de chaîne vide (rien à activer) revient
  // très souvent avec une signature IDENTIQUE à la précédente (même
  // participant/équipe/`forced`/liste d'options vide) — ce n'est PAS la même
  // invite logique, juste une nouvelle fenêtre de priorité qui se ressemble.
  // Une première version bloquait sur la signature seule (succès compris),
  // ce qui gelait l'auto-passe en 'auto'/'off' après la toute première
  // réussite : chaque fenêtre vide suivante avait la même clé, donc jamais
  // retentée — retour utilisateur réel ("comme si on était toujours en
  // On"). En ne retenant la clé qu'en cas d'ÉCHEC (et en l'effaçant après
  // un succès), une invite qui réussit ne bloque plus jamais les suivantes,
  // même de signature identique — seul un échec RÉEL et RÉPÉTÉ pour
  // exactement la même invite reste bloqué (protection anti-boucle
  // conservée pour ce cas précis).
  useEffect(() => {
    if (duel.status !== 'active' || busy) return;
    if (!prompt || prompt.type !== 'chain' || !actingParticipant) return;
    if (!canAct(actingParticipant)) return;
    if (chainMode === 'on') return;
    if (prompt.forced) return; // obligatoire : jamais auto-passé, quel que soit le mode (y compris 'off').
    if (chainMode === 'auto' && prompt.options.length > 0) return; // une vraie réponse est possible : on demande.
    const key = `${duel.id}:${actingParticipant.id}:${prompt.playerid}:${prompt.forced}:${prompt.options.map((o) => `${o.code}-${o.position}`).join(',')}`;
    if (lastAutoChainKeyRef.current === key) return; // cette invite précise a déjà échoué — pas de nouvelle tentative tant qu'elle ne change pas.
    setBusy(true);
    setActionError(null);
    api
      .duelChainAction(token, duel.id, actingParticipant.id, -1)
      .then(({ duel: updated }) => {
        lastAutoChainKeyRef.current = null; // succès : n'empêche plus la PROCHAINE invite, même de signature identique.
        onUpdated(updated);
      })
      .catch((err) => {
        lastAutoChainKeyRef.current = key;
        setActionError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel.status, prompt, actingParticipant, chainMode, busy]);

  const dispatchIdle = (category: number, index: number) => {
    if (!actingParticipant) return;
    void run(() => api.duelIdleAction(token, duel.id, actingParticipant.id, category, index));
  };
  const dispatchBattle = (category: number, index: number) => {
    if (!actingParticipant) return;
    void run(() => api.duelBattleAction(token, duel.id, actingParticipant.id, category, index));
  };

  /** Actions déclenchables (bouton rond) pour une carte précise (main OU terrain), d'après l'invite idle/battle en cours. */
  const buildActionsFor = (location: number, sequence: number, controller: number): ActionOption[] => {
    if (!prompt) return [];
    const actions: ActionOption[] = [];
    if (prompt.type === 'idle') {
      const summon = findOptionAt(prompt.summonable, location, sequence, controller);
      if (summon) actions.push(mkAction('summon', 'Invocation Normale', '⚔', () => dispatchIdle(IdleCmdCategory.SUMMON, prompt.summonable.indexOf(summon))));
      const sp = findOptionAt(prompt.sp_summonable, location, sequence, controller);
      if (sp) actions.push(mkAction('summon', 'Invocation Spéciale', '✧', () => dispatchIdle(IdleCmdCategory.SPSUMMON, prompt.sp_summonable.indexOf(sp))));
      const repo = findOptionAt(prompt.repositionable, location, sequence, controller);
      if (repo) actions.push(mkAction('reposition', 'Changer de position', '↻', () => dispatchIdle(IdleCmdCategory.REPOSITION, prompt.repositionable.indexOf(repo))));
      const mset = findOptionAt(prompt.msetable, location, sequence, controller);
      if (mset) actions.push(mkAction('summon', 'Poser (face cachée)', '▽', () => dispatchIdle(IdleCmdCategory.MSET, prompt.msetable.indexOf(mset))));
      const sset = findOptionAt(prompt.ssetable, location, sequence, controller);
      if (sset) actions.push(mkAction('summon', 'Poser', '▽', () => dispatchIdle(IdleCmdCategory.SSET, prompt.ssetable.indexOf(sset))));
      const act = findOptionAt(prompt.activatable, location, sequence, controller);
      if (act) actions.push(mkAction('activate', 'Activer', '✦', () => dispatchIdle(IdleCmdCategory.ACTIVATE, prompt.activatable.indexOf(act))));
    } else if (prompt.type === 'battle') {
      const act = findOptionAt(prompt.activatable, location, sequence, controller);
      if (act) actions.push(mkAction('activate', 'Activer', '✦', () => dispatchBattle(BattleCmdCategory.ACTIVATE, prompt.activatable.indexOf(act))));
      const atk = findOptionAt(prompt.attackable, location, sequence, controller);
      if (atk) actions.push(mkAction('attack', atk.directAttackable ? 'Attaque directe' : 'Attaquer', '⚔', () => dispatchBattle(BattleCmdCategory.ATTACK, prompt.attackable.indexOf(atk))));
    }
    return actions;
  };

  /**
   * Point d'entrée unique pour toute carte affichée (main ou zone de
   * terrain) : détermine si elle fait partie de l'invite en cours (bouton
   * rond d'action, sélection de cible/placement) et sinon retombe sur le
   * simple aperçu. Utilisé identiquement par `HandBar` et `ParticipantBoard`
   * — la main et le terrain partagent exactement la même logique
   * d'appariement (location/sequence/contrôleur), voir `findOptionAt`.
   */
  /**
   * Point d'entrée unique pour toute carte affichée (main ou zone de
   * terrain) : détermine si elle fait partie de l'invite en cours (bouton
   * rond d'action, sélection de cible/placement) et calcule le halo/état
   * correspondant. Quelle que soit l'action déclenchée par le clic, TOUTE
   * carte visible (face visible, ou dont l'identité vous est révélée) se
   * met AUSSI à jour dans l'aperçu à gauche — pas seulement en dernier
   * recours quand aucune autre action n'existe : un joueur qui clique sur
   * son propre monstre pour l'activer, ou sur une option de cible révélée,
   * veut aussi pouvoir relire son texte d'effet pour décider quoi faire.
   */
  const resolveInteraction = (location: number, sequence: number, controller: 0 | 1, boardCard: ApiDuelBoardCard | null): ZoneInteraction => {
    const raw = resolveInteractionAction(location, sequence, controller, boardCard);
    if (!boardCard?.card) return raw;
    const card = boardCard.card;
    const innerOnClick = raw.onClick;
    return {
      ...raw,
      onClick: (rect: DOMRect) => {
        setPreviewCard(card);
        innerOnClick?.(rect);
      },
    };
  };

  /** Calcule l'action déclenchée par un clic (sélection/placement/action) — voir `resolveInteraction`, qui y ajoute systématiquement l'aperçu. */
  const resolveInteractionAction = (location: number, sequence: number, controller: 0 | 1, boardCard: ApiDuelBoardCard | null): ZoneInteraction => {
    const previewOnClick = boardCard?.card ? () => setPreviewCard(boardCard.card!) : undefined;
    if (!prompt) return { glow: null, selected: false, eligible: false, onClick: previewOnClick };

    if (authorized && prompt.type === 'select_place' && actingParticipant && controller === actingParticipant.team) {
      const eligible = availablePlaces(prompt.flag).some((p) => p.location === location && p.sequence === sequence);
      if (eligible) {
        const picked = selectedPlaces.some((s) => s.location === location && s.sequence === sequence);
        return {
          glow: null,
          eligible: true,
          selected: picked,
          onClick: () => {
            if (picked) setSelectedPlaces(selectedPlaces.filter((s) => !(s.location === location && s.sequence === sequence)));
            else if (selectedPlaces.length < prompt.count) setSelectedPlaces([...selectedPlaces, { location, sequence }]);
          },
        };
      }
    }

    if (authorized && prompt.type === 'select_card') {
      const idx = prompt.cards.findIndex((o) => o.location === location && o.sequence === sequence && o.controller === controller);
      if (idx !== -1) {
        const picked = selectedCardIndices.includes(idx);
        return {
          glow: null,
          eligible: true,
          selected: picked,
          onClick: () => {
            if (picked) setSelectedCardIndices(selectedCardIndices.filter((x) => x !== idx));
            else if (selectedCardIndices.length < prompt.max) setSelectedCardIndices([...selectedCardIndices, idx]);
          },
        };
      }
    }

    if (authorized && (prompt.type === 'idle' || prompt.type === 'battle') && actingParticipant && controller === actingParticipant.team && boardCard) {
      const actions = buildActionsFor(location, sequence, controller);
      if (actions.length > 0) {
        const glow: ActionKind = actions.some((a) => a.kind === 'activate')
          ? 'activate'
          : actions.some((a) => a.kind === 'attack')
            ? 'attack'
            : actions.some((a) => a.kind === 'summon')
              ? 'summon'
              : 'reposition';
        return {
          glow,
          selected: false,
          eligible: false,
          onClick: (rect: DOMRect) => setActionPopup({ card: boardCard, rect, actions }),
        };
      }
    }

    return { glow: null, selected: false, eligible: false, onClick: previewOnClick };
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-arena-950 text-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-700 px-6 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-accent-500">Duel</p>
          <h2 className="font-display text-xl text-accent-400">{duel.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-neutral-400">
            {duel.status === 'active'
              ? <>Tour {duel.turn_number ?? '?'} · Phase <span className="text-accent-400">{duel.phase ?? '?'}</span></>
              : duel.status === 'lost'
                ? <span className="text-red-400">Process moteur perdu (redémarrage serveur) — non reprenable</span>
                : <span className="text-emerald-400">Duel terminé{duel.winner_team !== null ? ` — ${duel.teams[duel.winner_team]?.name} gagne` : ''}</span>}
          </span>
          {duel.status === 'active' && session.is_gm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api.endDuel(token, duel.id, null))}
              className="rounded border border-red-500 px-2 py-1 text-red-400 transition hover:bg-red-500 hover:text-arena-950"
            >
              Terminer le duel
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-md border border-arena-600 px-3 py-1.5 text-neutral-300 transition hover:border-accent-500 hover:text-accent-400">
            Fermer
          </button>
        </div>
      </header>

      {actionError && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{actionError}</p>}
      {fieldError && duel.status === 'active' && <p className="border-b border-red-900 bg-red-950/40 px-6 py-2 text-sm text-red-400">{fieldError}</p>}

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        <aside className="w-64 shrink-0 space-y-3 overflow-y-auto">
          <div className="rounded-lg border border-arena-700 bg-arena-900 p-3">
            <h4 className="mb-1.5 font-display text-sm text-accent-400">Réponses en chaîne</h4>
            <div className="flex overflow-hidden rounded border border-arena-600">
              {(
                [
                  { mode: 'on' as const, label: 'ON' },
                  { mode: 'auto' as const, label: 'Auto' },
                  { mode: 'off' as const, label: 'Off' },
                ]
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateChainMode(mode)}
                  className={`flex-1 py-1 text-center transition ${chainMode === mode ? 'bg-accent-500 font-semibold text-arena-950' : 'bg-arena-900 text-neutral-400 hover:text-neutral-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">
              {chainMode === 'on' && 'Toujours demander, dès qu’une réponse (même juste « passer ») est possible.'}
              {chainMode === 'auto' && 'Ne demander que si vous avez vraiment une carte à activer en réponse — passe seul sinon.'}
              {chainMode === 'off' && 'Ne demander que les effets obligatoires/à timing — le reste passe seul (l’ordre reste à choisir s’il y en a plusieurs).'}
            </p>
          </div>

          <div className="rounded-lg border border-arena-700 bg-arena-900 p-3">
            {previewCard ? (
              <>
                <img src={previewCard.card_images[0]?.image_url} alt={previewCard.name} className="mb-2 w-full rounded" />
                <h3 className="font-display text-sm text-accent-400">{previewCard.name}</h3>
                {(previewCard.atk !== null || previewCard.def !== null) && (
                  <p className="text-xs text-neutral-400">
                    ATK {previewCard.atk ?? '?'} / DEF {previewCard.def ?? '?'}
                    {previewCard.level_rank !== null && ` · Niv./Rang ${previewCard.level_rank}`}
                  </p>
                )}
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-300">{previewCard.description}</p>
              </>
            ) : (
              <p className="text-xs text-neutral-500">Cliquez une carte pour l'aperçu.</p>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto pb-2">
            {teamRenderOrder.map((teamIndex) => {
              const team = duel.teams[teamIndex];
              const isMine = myTeam !== null && teamIndex === myTeam;
              // Reflet horizontal du terrain adverse seulement : le sien reste
              // toujours dans le sens naturel (Zone Terrain à gauche).
              const mirrored = myTeam !== null && !isMine;
              return (
                <section key={teamIndex} className={`rounded-lg border p-3 ${duel.current_team === teamIndex ? 'border-accent-500' : 'border-arena-700'} bg-arena-900/40`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-display text-lg text-neutral-200">
                      {team.name}
                      {isMine && <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-500">(vous)</span>}
                      {duel.current_team === teamIndex && <span className="ml-2 text-xs text-accent-400">(tour en cours)</span>}
                    </span>
                    <span className="text-xl font-bold text-accent-400">{team.life_points ?? '?'} PV</span>
                  </div>

                  {(() => {
                    const roster = duel.participants.filter((x) => x.team === teamIndex);
                    // Duel Tag : PV/terrain communs à toute l'équipe (barre au-dessus), mais un
                    // seul participant a la main/le deck vivants à la fois — c'est le sien qu'on affiche.
                    const active = roster.find((x) => x.is_active) ?? roster[0];
                    const fieldTeam = field?.teams[teamIndex] ?? null;
                    if (!active) return null;
                    return (
                      <>
                        {roster.length > 1 && (
                          <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
                            {roster.map((p) => (
                              <span
                                key={p.id}
                                className={`rounded-full px-2 py-0.5 ${p.is_active ? 'bg-accent-500 font-semibold text-arena-950' : 'border border-arena-600 text-neutral-400'}`}
                              >
                                {p.character_name}
                                {p.is_npc ? ' (PNJ)' : ''}
                                {p.is_active ? ' — actif' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        <ParticipantBoard
                          characterName={active.character_name}
                          teamIndex={teamIndex}
                          handCount={active.hand_count}
                          deckRemaining={active.deck_remaining}
                          fieldTeam={fieldTeam}
                          mirrored={mirrored}
                          hideHand={isMine}
                          isNpc={active.is_npc}
                          resolveInteraction={resolveInteraction}
                          onShowPile={(label, cards) => setShowPile({ label, cards })}
                        />
                      </>
                    );
                  })()}
                </section>
              );
            })}
          </div>

          {duel.status === 'active' && myTeam !== null && (
            <HandBar
              characterName={myActiveParticipant?.character_name ?? ''}
              team={myTeam}
              hand={field?.teams[myTeam]?.hand ?? null}
              resolveInteraction={resolveInteraction}
            />
          )}
        </main>

        <aside className="w-72 shrink-0 space-y-3 overflow-y-auto">
          {duel.status === 'active' && prompt && actingParticipant && (
            <div className="rounded-lg border border-accent-500 bg-arena-900 p-3 text-xs">
              <p className="mb-2 text-neutral-400">
                Décision pour <span className="font-semibold text-accent-400">{actingParticipant.character_name}</span>
              </p>
              <PromptPanel
                prompt={prompt}
                busy={busy}
                readOnly={!authorized}
                selectedPlaces={selectedPlaces}
                setSelectedPlaces={setSelectedPlaces}
                selectedCardIndices={selectedCardIndices}
                setSelectedCardIndices={setSelectedCardIndices}
                onCardClick={setPreviewCard}
                onSelectPlace={(selections) =>
                  void run(() => api.duelSelectPlace(token, duel.id, actingParticipant.id, selections.map((s) => ({ player: actingParticipant.team, ...s }))))
                }
                onSelectCard={(indices) => void run(() => api.duelSelectCard(token, duel.id, actingParticipant.id, indices))}
                onChainAction={(index) => void run(() => api.duelChainAction(token, duel.id, actingParticipant.id, index))}
                onSelectTribute={(indices) => void run(() => api.duelSelectTribute(token, duel.id, actingParticipant.id, indices))}
                onSelectUnselectCard={(index) => void run(() => api.duelSelectUnselectCard(token, duel.id, actingParticipant.id, index))}
                onSelectPosition={(position) => void run(() => api.duelSelectPosition(token, duel.id, actingParticipant.id, position))}
                onSelectOption={(index) => void run(() => api.duelSelectOption(token, duel.id, actingParticipant.id, index))}
                onYesNo={(yes) => void run(() => api.duelYesNo(token, duel.id, actingParticipant.id, yes))}
                onIdlePhase={(category) => dispatchIdle(category, 0)}
                onBattlePhase={(category) => dispatchBattle(category, 0)}
              />
            </div>
          )}

          <div className="rounded-lg border border-arena-700 bg-arena-900 p-3">
            <h4 className="mb-1 font-display text-sm text-accent-400">Journal</h4>
            <div className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[10px] text-neutral-500">
              {[...duel.events].reverse().map((event, i) => (
                <div key={i}>
                  {new Date(event.created_at).toLocaleTimeString()} — {event.message}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {actionPopup && (
        <>
          {/* Zone invisible plein écran : tout clic en dehors du popup le referme. */}
          <div className="fixed inset-0 z-30" onClick={() => setActionPopup(null)} />
          <div
            className="fixed z-40 flex flex-col items-center gap-2"
            style={{ left: Math.max(8, actionPopup.rect.left - 70), top: Math.max(8, actionPopup.rect.top - 172) }}
          >
            <div className="flex gap-1.5">
              {actionPopup.actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  title={a.label}
                  disabled={busy}
                  onClick={() => {
                    a.onClick();
                    setActionPopup(null);
                  }}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-base font-bold shadow-lg transition hover:scale-110 disabled:opacity-40 ${ACTION_BUTTON_CLS[a.kind]}`}
                >
                  {a.glyph}
                </button>
              ))}
            </div>
            <div className="w-24 overflow-hidden rounded-lg border-2 border-accent-400 shadow-2xl">
              {actionPopup.card.card ? (
                <img src={actionPopup.card.card.card_images[0]?.image_url} alt={actionPopup.card.card.name} className="w-full" />
              ) : (
                <CardBack />
              )}
            </div>
          </div>
        </>
      )}

      {showPile && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6" onClick={() => setShowPile(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-arena-700 bg-arena-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-lg text-accent-400">{showPile.label}</h3>
              <button type="button" onClick={() => setShowPile(null)} className="text-neutral-400 hover:text-neutral-200">
                Fermer
              </button>
            </div>
            {showPile.cards.length === 0 ? (
              <p className="text-sm text-neutral-500">Vide.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {showPile.cards.map((c, i) => (
                  <button key={i} type="button" onClick={() => c.card && setPreviewCard(c.card)} className="overflow-hidden rounded">
                    {c.card ? (
                      <img src={c.card.card_images[0]?.image_url_small} alt={c.card.name} title={c.card.name} className="rounded" />
                    ) : (
                      <div className="aspect-[59/86] w-full">
                        <CardBack />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Dos de carte officiel Yu-Gi-Oh! affiché pour toute carte face cachée ou d'identité inconnue — remplace le simple "?" d'origine. */
function CardBack() {
  return <img src={cardBackImage} alt="Dos de carte" className="h-full w-full object-cover" />;
}

function MiniCard({
  boardCard,
  small,
  onClick,
  glow,
  selected,
  eligible,
}: {
  boardCard: ApiDuelBoardCard | null;
  small?: boolean;
  onClick?: (rect: DOMRect) => void;
  glow?: GlowKind;
  selected?: boolean;
  eligible?: boolean;
}) {
  const dims = small ? 'h-16 w-11' : 'h-24 w-16';
  const clickable = !!onClick && !!boardCard?.card;
  const stateCls = selected
    ? 'border-transparent ring-2 ring-accent-400 bg-accent-500/10'
    : eligible
      ? 'border-transparent ring-2 ring-accent-600/60'
      : glow
        ? GLOW_CLS[glow]
        : 'border-arena-600';
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={(e) => onClick?.(e.currentTarget.getBoundingClientRect())}
      aria-label={boardCard?.face_down || !boardCard?.card ? 'Carte face cachée' : boardCard.card.name}
      className={`relative shrink-0 overflow-hidden rounded border ${dims} bg-arena-800 ${stateCls} ${clickable ? 'cursor-pointer hover:border-accent-500' : 'cursor-default'}`}
    >
      {!boardCard ? null : boardCard.face_down || !boardCard.card ? (
        <CardBack />
      ) : (
        <img src={boardCard.card.card_images[0]?.image_url_small} alt={boardCard.card.name} className="h-full w-full object-cover" />
      )}
      {boardCard?.card && !boardCard.face_down && boardCard.attack !== null && (
        <span className="absolute bottom-0 left-0 right-0 truncate bg-arena-950/85 px-0.5 text-center text-[8px] text-neutral-200">
          {boardCard.attack}{boardCard.defense !== null ? `/${boardCard.defense}` : ''}
        </span>
      )}
      {boardCard && isDefensePosition(boardCard.position) && (
        <span className="absolute right-0 top-0 rounded-bl bg-arena-950/85 px-1 text-[8px] text-neutral-300">DEF</span>
      )}
    </button>
  );
}

function EmptyZone({ onClick, selected, eligible }: { onClick?: (rect: DOMRect) => void; selected?: boolean; eligible?: boolean }) {
  const stateCls = selected
    ? 'border-accent-400 bg-accent-500/15'
    : eligible
      ? 'border-dashed border-accent-600/70 bg-accent-500/5 hover:bg-accent-500/10'
      : 'border-dashed border-arena-700';
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={(e) => onClick?.(e.currentTarget.getBoundingClientRect())}
      className={`h-24 w-16 shrink-0 rounded border ${stateCls} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    />
  );
}

/** Une zone du terrain, avec sa légende optionnelle (ex. "Terrain" pour la distinguer des zones Magie/Piège normales). */
function ZoneSlot({ slot, label, interaction }: { slot: ApiDuelBoardCard | null; label?: string; interaction: ZoneInteraction }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      {slot ? (
        <MiniCard boardCard={slot} onClick={interaction.onClick} glow={interaction.glow} selected={interaction.selected} eligible={interaction.eligible} />
      ) : (
        <EmptyZone onClick={interaction.onClick} selected={interaction.selected} eligible={interaction.eligible} />
      )}
      {label && <span className="text-[8px] uppercase tracking-wide text-neutral-600">{label}</span>}
    </div>
  );
}

function PileButton({ label, cards, onShow }: { label: string; cards: ApiDuelBoardCard[]; onShow: () => void }) {
  return (
    <button
      type="button"
      onClick={onShow}
      disabled={cards.length === 0}
      className="flex h-24 w-16 shrink-0 flex-col items-center justify-center rounded border border-arena-700 bg-arena-800/60 text-[10px] text-neutral-400 hover:border-accent-500 disabled:cursor-default disabled:opacity-50"
    >
      <span className="text-lg font-bold text-neutral-200">{cards.length}</span>
      {label}
    </button>
  );
}

function ParticipantBoard({
  characterName,
  teamIndex,
  isNpc,
  handCount,
  deckRemaining,
  fieldTeam,
  mirrored,
  hideHand,
  resolveInteraction,
  onShowPile,
}: {
  characterName: string;
  teamIndex: 0 | 1;
  isNpc: boolean;
  handCount: number | null;
  deckRemaining: number | null;
  fieldTeam: ApiDuelFieldTeam | null;
  /** Reflète la ligne de zones (terrain adverse) — sa Zone Terrain se retrouve alors à droite au lieu de gauche. */
  mirrored: boolean;
  /** Main déjà affichée ailleurs (barre du bas, camp du spectateur) — ne pas la dupliquer ici. */
  hideHand: boolean;
  resolveInteraction: (location: number, sequence: number, controller: 0 | 1, boardCard: ApiDuelBoardCard | null) => ZoneInteraction;
  onShowPile: (label: string, cards: ApiDuelBoardCard[]) => void;
}) {
  // spell_trap_zones (8 emplacements confirmés en direct contre le vrai
  // moteur, voir CLAUDE.md §7) : 0-4 = Magie/Piège normales, 5 = Zone
  // Terrain, 6-7 = Zones Pendule. La Zone Terrain est isolée à l'extrémité
  // gauche de la ligne (droite si `mirrored`, terrain adverse reflété),
  // les zones Pendule restent à l'autre extrémité.
  const stZones = fieldTeam?.spell_trap_zones ?? [];
  const stRowBase = [
    { slot: stZones[5] ?? null, sequence: 5, label: 'Terrain' as string | undefined },
    ...stZones.slice(0, 5).map((slot, i) => ({ slot, sequence: i, label: undefined as string | undefined })),
    ...stZones.slice(6, 8).map((slot, i) => ({ slot, sequence: 6 + i, label: undefined as string | undefined })),
  ];
  const mzRowBase = (fieldTeam?.monster_zones ?? []).map((slot, i) => ({ slot, sequence: i }));
  const stRow = mirrored ? [...stRowBase].reverse() : stRowBase;
  const mzRow = mirrored ? [...mzRowBase].reverse() : mzRowBase;

  return (
    <div className="rounded border border-arena-700 bg-arena-900/40 p-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-semibold text-neutral-200">
          {characterName}
          {isNpc && <span className="text-neutral-500"> (PNJ)</span>}
        </span>
        <span className="text-neutral-500">
          Main {handCount ?? '—'} · Deck {deckRemaining ?? '—'}
          {fieldTeam?.extra_deck && fieldTeam.extra_deck.length > 0 ? ` · Extra ${fieldTeam.extra_deck.length}` : ''}
        </span>
      </div>

      {!hideHand && fieldTeam?.hand && fieldTeam.hand.length > 0 && (
        <div className="mb-1 flex gap-1 overflow-x-auto border-b border-arena-800 pb-1">
          {fieldTeam.hand.map((c, i) => {
            const interaction = resolveInteraction(EngineLocation.HAND, i, teamIndex, c);
            return <MiniCard key={i} boardCard={c} small onClick={interaction.onClick} glow={interaction.glow} selected={interaction.selected} eligible={interaction.eligible} />;
          })}
        </div>
      )}

      {!fieldTeam ? (
        <p className="text-xs text-neutral-600">Terrain indisponible.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {/* Monstres au-dessus, Magie/Piège en dessous (avec la Zone Terrain à l'extrémité). */}
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex gap-1">
              {mzRow.map(({ slot, sequence }) => (
                <ZoneSlot key={`mz${sequence}`} slot={slot} interaction={resolveInteraction(EngineLocation.MZONE, sequence, teamIndex, slot)} />
              ))}
            </div>
            <div className="flex gap-1">
              {stRow.map(({ slot, sequence, label }) => (
                <ZoneSlot key={`st${sequence}`} slot={slot} label={label} interaction={resolveInteraction(EngineLocation.SZONE, sequence, teamIndex, slot)} />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 border-l border-arena-700 pl-3">
            <PileButton label="Cimetière" cards={fieldTeam.graveyard} onShow={() => onShowPile(`Cimetière — ${characterName}`, fieldTeam.graveyard)} />
            <PileButton label="Bannis" cards={fieldTeam.banished} onShow={() => onShowPile(`Bannis — ${characterName}`, fieldTeam.banished)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Barre fixe en bas de l'écran : la main du spectateur pour son propre camp, mise en avant plutôt que noyée dans son encart de terrain. */
function HandBar({
  characterName,
  team,
  hand,
  resolveInteraction,
}: {
  characterName: string;
  team: 0 | 1;
  hand: ApiDuelBoardCard[] | null;
  resolveInteraction: (location: number, sequence: number, controller: 0 | 1, boardCard: ApiDuelBoardCard | null) => ZoneInteraction;
}) {
  if (!hand) return null; // main non chargée ou non visible (secret d'équipe, voir computeCanSeeTeam côté backend)
  return (
    <div className="mt-2 shrink-0 rounded-lg border border-arena-700 bg-arena-900 p-2">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Votre main{characterName ? ` — ${characterName}` : ''}</p>
      {hand.length === 0 ? (
        <p className="text-xs text-neutral-600">Main vide.</p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {hand.map((c, i) => {
            const interaction = resolveInteraction(EngineLocation.HAND, i, team, c);
            return <MiniCard key={i} boardCard={c} onClick={interaction.onClick} glow={interaction.glow} selected={interaction.selected} eligible={interaction.eligible} />;
          })}
        </div>
      )}
      <p className="mt-1 text-[9px] leading-snug text-neutral-600">
        Bordure orange = activable · bleue = invocable/posable · rouge = attaque possible · verte = changement de position. Cliquez la carte pour choisir l'action.
      </p>
    </div>
  );
}

function OptionButton({ option, onClick }: { option: ApiPromptCardOption; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded border border-arena-600 bg-arena-800 p-1.5 text-left hover:border-accent-500">
      {option.card ? (
        <img src={option.card.card_images[0]?.image_url_small} alt={option.card.name} className="h-10 w-7 shrink-0 overflow-hidden rounded object-cover" />
      ) : (
        <div className="h-10 w-7 shrink-0 overflow-hidden rounded">
          <CardBack />
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-neutral-200">{option.card?.name ?? `Carte #${option.code}`}</span>
    </button>
  );
}

function PromptPanel({
  prompt,
  busy,
  readOnly,
  selectedPlaces,
  setSelectedPlaces,
  selectedCardIndices,
  setSelectedCardIndices,
  onCardClick,
  onSelectPlace,
  onSelectCard,
  onChainAction,
  onSelectTribute,
  onSelectUnselectCard,
  onSelectPosition,
  onSelectOption,
  onYesNo,
  onIdlePhase,
  onBattlePhase,
}: {
  prompt: ApiDuelPrompt;
  busy: boolean;
  /** Le spectateur ne peut pas valider cette invite (pas le sien à jouer, ou MJ face à un participant joué par un vrai joueur) — affichage passif seulement. */
  readOnly: boolean;
  selectedPlaces: Array<{ location: number; sequence: number }>;
  setSelectedPlaces: (v: Array<{ location: number; sequence: number }>) => void;
  selectedCardIndices: number[];
  setSelectedCardIndices: (v: number[]) => void;
  onCardClick: (card: ApiCard) => void;
  onSelectPlace: (selections: Array<{ location: number; sequence: number }>) => void;
  onSelectCard: (indices: number[] | null) => void;
  onChainAction: (index: number) => void;
  onSelectTribute: (indices: number[] | null) => void;
  onSelectUnselectCard: (index: number | null) => void;
  onSelectPosition: (position: 0x1 | 0x2 | 0x4 | 0x8) => void;
  onSelectOption: (index: number) => void;
  onYesNo: (yes: boolean) => void;
  onIdlePhase: (category: number) => void;
  onBattlePhase: (category: number) => void;
}) {
  const btnCls = 'rounded border border-arena-600 px-2 py-1 text-neutral-200 hover:border-accent-500 disabled:opacity-40';
  const primaryCls = 'rounded bg-accent-500 px-2 py-1 font-semibold text-arena-950 hover:bg-accent-400 disabled:opacity-40';

  if (readOnly) {
    return <p className="text-neutral-500">Ce n'est pas à vous de décider ici — en attente de la réponse de l'autre camp.</p>;
  }

  if (prompt.type === 'idle') {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-snug text-neutral-400">
          Invoquez, posez ou activez une carte directement depuis votre main ou le terrain (bordure brillante = action possible, voir la légende sous
          votre main).
        </p>
        <div className="flex flex-wrap gap-1.5 border-t border-arena-800 pt-2">
          {prompt.can_battle_phase && (
            <button type="button" disabled={busy} onClick={() => onIdlePhase(IdleCmdCategory.TO_BATTLE)} className={primaryCls}>
              Battle Phase
            </button>
          )}
          {prompt.can_end_phase && (
            <button type="button" disabled={busy} onClick={() => onIdlePhase(IdleCmdCategory.TO_END)} className={btnCls}>
              End Phase
            </button>
          )}
          {prompt.can_shuffle_hand && (
            <button type="button" disabled={busy} onClick={() => onIdlePhase(IdleCmdCategory.SHUFFLE_HAND)} className={btnCls}>
              Mélanger la main
            </button>
          )}
        </div>
      </div>
    );
  }

  if (prompt.type === 'battle') {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-snug text-neutral-400">
          Activez une carte ou déclarez une attaque directement depuis le terrain (bordure rouge = attaque possible, orange = activable).
        </p>
        <div className="flex flex-wrap gap-1.5 border-t border-arena-800 pt-2">
          {prompt.can_main2 && (
            <button type="button" disabled={busy} onClick={() => onBattlePhase(BattleCmdCategory.TO_MAIN2)} className={primaryCls}>
              Main Phase 2
            </button>
          )}
          {prompt.can_end_phase && (
            <button type="button" disabled={busy} onClick={() => onBattlePhase(BattleCmdCategory.TO_END)} className={btnCls}>
              End Phase
            </button>
          )}
        </div>
      </div>
    );
  }

  if (prompt.type === 'select_place') {
    const places = availablePlaces(prompt.flag);
    const isPicked = (place: { location: number; sequence: number }) =>
      selectedPlaces.some((s) => s.location === place.location && s.sequence === place.sequence);
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">
          Choisissez {prompt.count > 1 ? `${prompt.count} zones` : 'une zone'} sur le terrain ({selectedPlaces.length}/{prompt.count})
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {places.map((place, i) => (
            <button
              key={i}
              type="button"
              disabled={busy || (isPicked(place) ? false : selectedPlaces.length >= prompt.count)}
              onClick={() => {
                if (isPicked(place)) {
                  setSelectedPlaces(selectedPlaces.filter((s) => !(s.location === place.location && s.sequence === place.sequence)));
                } else {
                  setSelectedPlaces([...selectedPlaces, place]);
                }
              }}
              className={`rounded border px-2 py-1 text-left ${isPicked(place) ? 'border-accent-400 bg-accent-500/10 text-accent-300' : 'border-arena-600 text-neutral-200 hover:border-accent-500'}`}
            >
              {place.location === EngineLocation.MZONE ? `Monstre ${place.sequence + 1}` : szoneLabel(place.sequence)}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || selectedPlaces.length !== prompt.count}
          onClick={() => onSelectPlace(selectedPlaces)}
          className={primaryCls + ' w-full'}
        >
          Valider
        </button>
      </div>
    );
  }

  if (prompt.type === 'select_card') {
    const toggle = (i: number) => {
      if (selectedCardIndices.includes(i)) {
        setSelectedCardIndices(selectedCardIndices.filter((x) => x !== i));
      } else if (selectedCardIndices.length < prompt.max) {
        setSelectedCardIndices([...selectedCardIndices, i]);
      }
    };
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">
          Choisissez {prompt.min === prompt.max ? prompt.min : `${prompt.min} à ${prompt.max}`} carte(s) — cliquez sur le terrain ou ci-dessous (
          {selectedCardIndices.length})
        </p>
        <div className="space-y-1">
          {prompt.cards.map((opt, i) => (
            <div
              key={i}
              className={`flex w-full items-center gap-2 rounded border p-1.5 text-left ${selectedCardIndices.includes(i) ? 'border-accent-400 bg-accent-500/10' : 'border-arena-600'}`}
            >
              <button
                type="button"
                onClick={() => opt.card && onCardClick(opt.card)}
                disabled={!opt.card}
                title="Aperçu"
                className="shrink-0 overflow-hidden rounded disabled:cursor-default"
              >
                {opt.card ? (
                  <img src={opt.card.card_images[0]?.image_url_small} alt={opt.card.name} className="h-10 w-7 object-cover" />
                ) : (
                  <div className="h-10 w-7">
                    <CardBack />
                  </div>
                )}
              </button>
              <button type="button" onClick={() => toggle(i)} className="min-w-0 flex-1 truncate text-left text-neutral-200 hover:text-accent-400">
                {opt.card?.name ?? `Carte #${opt.code}`}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy || selectedCardIndices.length < prompt.min || selectedCardIndices.length > prompt.max}
            onClick={() => onSelectCard(selectedCardIndices)}
            className={primaryCls}
          >
            Valider
          </button>
          {(prompt.cancelable || prompt.min === 0) && (
            <button type="button" disabled={busy} onClick={() => onSelectCard(null)} className={btnCls}>
              Annuler
            </button>
          )}
        </div>
      </div>
    );
  }

  if (prompt.type === 'select_tribute') {
    const toggle = (i: number) => {
      if (selectedCardIndices.includes(i)) {
        setSelectedCardIndices(selectedCardIndices.filter((x) => x !== i));
      } else if (selectedCardIndices.length < prompt.max) {
        setSelectedCardIndices([...selectedCardIndices, i]);
      }
    };
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">
          Choisissez {prompt.min === prompt.max ? prompt.min : `${prompt.min} à ${prompt.max}`} tribut(s) ({selectedCardIndices.length})
        </p>
        <div className="space-y-1">
          {prompt.cards.map((opt, i) => (
            <div
              key={i}
              className={`flex w-full items-center gap-2 rounded border p-1.5 text-left ${selectedCardIndices.includes(i) ? 'border-accent-400 bg-accent-500/10' : 'border-arena-600'}`}
            >
              <button
                type="button"
                onClick={() => opt.card && onCardClick(opt.card)}
                disabled={!opt.card}
                title="Aperçu"
                className="shrink-0 overflow-hidden rounded disabled:cursor-default"
              >
                {opt.card ? (
                  <img src={opt.card.card_images[0]?.image_url_small} alt={opt.card.name} className="h-10 w-7 object-cover" />
                ) : (
                  <div className="h-10 w-7">
                    <CardBack />
                  </div>
                )}
              </button>
              <button type="button" onClick={() => toggle(i)} className="min-w-0 flex-1 truncate text-left text-neutral-200 hover:text-accent-400">
                {opt.card?.name ?? `Carte #${opt.code}`}
              </button>
              {opt.releaseParam > 1 && <span className="shrink-0 text-[10px] text-accent-400">compte pour {opt.releaseParam}</span>}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={busy || selectedCardIndices.length < prompt.min || selectedCardIndices.length > prompt.max}
            onClick={() => onSelectTribute(selectedCardIndices)}
            className={primaryCls}
          >
            Valider
          </button>
          {(prompt.cancelable || prompt.min === 0) && (
            <button type="button" disabled={busy} onClick={() => onSelectTribute(null)} className={btnCls}>
              Annuler
            </button>
          )}
        </div>
      </div>
    );
  }

  if (prompt.type === 'select_unselect_card') {
    // Un coût "release" scripté (ex. Crush Card Virus) : contrairement à
    // select_card/select_tribute, chaque clic envoie IMMÉDIATEMENT un seul
    // index (pas de sélection multiple à valider ensuite) — le moteur
    // renvoie un nouveau prompt select_unselect_card à chaque étape tant
    // que le coût n'est pas complet, la carte cliquée passant alors de
    // "disponible" à "déjà choisi" (ou l'inverse pour la désélectionner).
    const renderRow = (opt: (typeof prompt.select_cards)[number], index: number, chosen: boolean) => (
      <div
        key={`${chosen ? 'u' : 's'}${index}`}
        className={`flex w-full items-center gap-2 rounded border p-1.5 text-left ${chosen ? 'border-accent-400 bg-accent-500/10' : 'border-arena-600'}`}
      >
        <button
          type="button"
          onClick={() => opt.card && onCardClick(opt.card)}
          disabled={!opt.card}
          title="Aperçu"
          className="shrink-0 overflow-hidden rounded disabled:cursor-default"
        >
          {opt.card ? (
            <img src={opt.card.card_images[0]?.image_url_small} alt={opt.card.name} className="h-10 w-7 object-cover" />
          ) : (
            <div className="h-10 w-7">
              <CardBack />
            </div>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelectUnselectCard(index)}
          className="min-w-0 flex-1 truncate text-left text-neutral-200 hover:text-accent-400"
        >
          {opt.card?.name ?? `Carte #${opt.code}`}
        </button>
      </div>
    );
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">
          Choisissez {prompt.min === prompt.max ? prompt.min : `${prompt.min} à ${prompt.max}`} coût(s) — cliquez pour ajouter/retirer
        </p>
        {prompt.unselect_cards.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Déjà choisi (cliquer pour retirer)</p>
            <div className="space-y-1">{prompt.unselect_cards.map((opt, i) => renderRow(opt, prompt.select_cards.length + i, true))}</div>
          </div>
        )}
        {prompt.select_cards.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Disponible</p>
            <div className="space-y-1">{prompt.select_cards.map((opt, i) => renderRow(opt, i, false))}</div>
          </div>
        )}
        {(prompt.finishable || prompt.cancelable) && (
          <button type="button" disabled={busy} onClick={() => onSelectUnselectCard(null)} className={btnCls}>
            {prompt.finishable ? 'Terminer' : 'Annuler'}
          </button>
        )}
      </div>
    );
  }

  if (prompt.type === 'select_position') {
    const options: Array<{ bit: 0x1 | 0x2 | 0x4 | 0x8; label: string }> = [
      { bit: EnginePosition.FACEUP_ATTACK, label: 'Attaque (face visible)' },
      { bit: EnginePosition.FACEDOWN_ATTACK, label: 'Attaque (face cachée)' },
      { bit: EnginePosition.FACEUP_DEFENSE, label: 'Défense (face visible)' },
      { bit: EnginePosition.FACEDOWN_DEFENSE, label: 'Défense (face cachée)' },
    ];
    return (
      <div className="space-y-2">
        {prompt.card && (
          <div className="flex items-center gap-2 rounded border border-arena-600 bg-arena-800 p-1.5">
            <img src={prompt.card.card_images[0]?.image_url_small} alt={prompt.card.name} className="h-10 w-7 shrink-0 overflow-hidden rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-neutral-200">{prompt.card.name}</span>
          </div>
        )}
        <p className="text-neutral-400">Choisissez la position</p>
        <div className="grid grid-cols-2 gap-1.5">
          {options
            .filter((o) => (prompt.positions & o.bit) !== 0)
            .map((o) => (
              <button key={o.bit} type="button" disabled={busy} onClick={() => onSelectPosition(o.bit)} className={btnCls}>
                {o.label}
              </button>
            ))}
        </div>
      </div>
    );
  }

  if (prompt.type === 'select_option') {
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">Choisissez une option</p>
        {/* Pas de texte d'effet décodable ici (aucune donnée structurée d'effet — voir CLAUDE.md §7) : juste l'identifiant brut, pour recouper avec le texte imprimé de la carte au besoin. */}
        <div className="space-y-1">
          {prompt.options.map((description, i) => (
            <button key={i} type="button" disabled={busy} onClick={() => onSelectOption(i)} className={`${btnCls} flex w-full items-center justify-between`}>
              <span>Choix {i + 1}</span>
              <span className="text-[10px] text-neutral-500">#{description}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (prompt.type === 'chain') {
    return (
      <div className="space-y-2">
        <p className="text-neutral-400">Activer une carte en chaîne, ou passer ?</p>
        <div className="space-y-1">
          {prompt.options.map((opt, i) => (
            <div key={i} className="rounded border border-arena-600 bg-arena-800">
              <div onClick={() => opt.card && onCardClick(opt.card)}>
                <OptionButton option={opt} onClick={() => onChainAction(i)} />
              </div>
              {opt.card?.description && <p className="border-t border-arena-700 p-1.5 text-[10px] text-neutral-400">{opt.card.description}</p>}
            </div>
          ))}
        </div>
        <button type="button" disabled={busy || prompt.forced} onClick={() => onChainAction(-1)} className={btnCls + ' w-full'}>
          Passer
        </button>
      </div>
    );
  }

  if (prompt.type === 'yesno') {
    return (
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => onYesNo(true)} className={primaryCls}>
          Oui
        </button>
        <button type="button" disabled={busy} onClick={() => onYesNo(false)} className={btnCls}>
          Non
        </button>
      </div>
    );
  }

  if (prompt.type === 'effectyn') {
    return (
      <div className="space-y-2">
        {prompt.card && (
          <div className="rounded border border-arena-600 bg-arena-800 p-1.5">
            <p className="font-semibold text-accent-400">{prompt.card.name}</p>
            <p className="mt-0.5 text-[10px] text-neutral-400">{prompt.card.description}</p>
          </div>
        )}
        <p className="text-neutral-400">Activer cet effet ?</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => onYesNo(true)} className={primaryCls}>
            Oui
          </button>
          <button type="button" disabled={busy} onClick={() => onYesNo(false)} className={btnCls}>
            Non
          </button>
        </div>
      </div>
    );
  }

  return (
    <p className="text-neutral-500">
      Type d'invite non pris en charge côté interface (type brut {prompt.raw_type}) — cas rare (ex. choix de tribut/position détaillé), à gérer
      manuellement pour l'instant.
    </p>
  );
}
