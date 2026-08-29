import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { socket } from '../lib/socket';
import { api, ApiError, type ApiCharacter, type ApiDuel, type ApiSession } from '../lib/api';
import { DuelBoardOverlay } from './DuelBoardOverlay';

interface DuelPanelProps {
  token: string;
  session: ApiSession;
  characters: ApiCharacter[];
  currentUserId: string;
  // Ouverture pilotée depuis l'extérieur (ex. clic sur "Voir le duel" dans la
  // bannière de convocation, App.tsx) — en plus de l'ouverture normale via un
  // clic direct dans la liste ci-dessous, gérée en interne (openedId). Un
  // simple effet applique la demande puis prévient le parent qu'elle a été
  // traitée, sans faire de cet id la source de vérité en continu.
  requestedOpenDuelId?: string | null;
  onRequestedOpenDuelHandled?: () => void;
}

/**
 * Liste + création de duels réels (moteur ocgcore, voir CLAUDE.md §7). Duel
 * Tag : 2 camps, 1 à 5 participants chacun — PV et terrain partagés PAR
 * CAMP, les decks/mains des participants d'un même camp tournent
 * automatiquement au fil de leurs tours (voir DuelBoardOverlay.tsx). Un vrai
 * "chacun pour soi" à PV individuels (battle royale au sens strict) n'est
 * pas possible : le moteur ocgcore n'a que 2 réservoirs de PV, en dur.
 */
export function DuelPanel({ token, session, characters, currentUserId, requestedOpenDuelId, onRequestedOpenDuelHandled }: DuelPanelProps) {
  const [duels, setDuels] = useState<ApiDuel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedOpenDuelId) return;
    setOpenedId(requestedOpenDuelId);
    onRequestedOpenDuelHandled?.();
  }, [requestedOpenDuelId, onRequestedOpenDuelHandled]);

  const loadDuels = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      return api
        .listDuels(token, session.id)
        .then(({ duels: fetched }) => setDuels(fetched))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Une erreur est survenue'))
        .finally(() => setLoading(false));
    },
    [token, session.id],
  );

  useEffect(() => {
    void loadDuels();
  }, [loadDuels]);

  // Un autre membre du salon peut créer/agir sur un duel (relais temps réel
  // des actions moteur, voir types/socket.ts) : sans ça, la liste et l'état
  // de chaque duel resteraient périmés côté spectateurs.
  useEffect(() => {
    const onChanged = (payload: { resource: string; session_id: string }) => {
      if (payload.resource === 'duels' && payload.session_id === session.id) void loadDuels({ silent: true });
    };
    socket.on('session_resource_changed', onChanged);
    return () => {
      socket.off('session_resource_changed', onChanged);
    };
  }, [session.id, loadDuels]);

  const handleDelete = async (duel: ApiDuel) => {
    if (!window.confirm(`Supprimer le duel « ${duel.name} » ?`)) return;
    try {
      await api.deleteDuel(token, duel.id);
      setDuels((prev) => prev.filter((d) => d.id !== duel.id));
      if (openedId === duel.id) setOpenedId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    }
  };

  const activeDuels = duels.filter((d) => d.status === 'active');
  const otherDuels = duels.filter((d) => d.status !== 'active');
  const openedDuel = duels.find((d) => d.id === openedId) ?? null;

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">Duels</h2>
        {session.is_gm && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="text-xs text-accent-400 underline hover:text-accent-300"
          >
            {showCreate ? 'Fermer' : '+ Organiser un duel'}
          </button>
        )}
      </header>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      {loading && <p className="text-xs text-neutral-500">Chargement...</p>}

      {showCreate && (
        <CreateDuelForm
          token={token}
          session={session}
          characters={characters}
          onCreated={(duel) => {
            setDuels((prev) => [duel, ...prev]);
            setShowCreate(false);
            setOpenedId(duel.id);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {!loading && duels.length === 0 && !showCreate && <p className="text-xs text-neutral-500">Aucun duel pour l'instant.</p>}

      <div className="mt-3 space-y-2">
        {[...activeDuels, ...otherDuels].map((duel) => (
          <div key={duel.id} className="flex items-center gap-2 rounded-lg border border-arena-700 bg-arena-800 p-3 text-xs">
            <button type="button" onClick={() => setOpenedId(duel.id)} className="flex-1 text-left text-neutral-200 hover:text-accent-400">
              <span className="font-semibold text-accent-400">{duel.name}</span>{' '}
              <span className={duel.status === 'active' ? 'text-emerald-400' : duel.status === 'lost' ? 'text-red-400' : 'text-neutral-500'}>
                {duel.status === 'active' ? `tour ${duel.turn_number ?? '?'}` : duel.status === 'lost' ? 'process perdu (non reprenable)' : 'terminé'}
              </span>{' '}
              <span className="text-neutral-500">— {duel.teams.map((t) => `${t.name} ${t.life_points ?? '?'} PV`).join(' vs ')}</span>
            </button>
            {session.is_gm && (
              <button type="button" onClick={() => void handleDelete(duel)} className="shrink-0 text-red-400 hover:text-red-300">
                Supprimer
              </button>
            )}
          </div>
        ))}
      </div>

      {openedDuel && (
        <DuelBoardOverlay
          token={token}
          session={session}
          duel={openedDuel}
          characters={characters}
          currentUserId={currentUserId}
          onUpdated={(updated) => setDuels((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))}
          onClose={() => setOpenedId(null)}
        />
      )}
    </section>
  );
}

const MAX_TEAM_SIZE = 5;

interface TeamMemberDraft {
  characterId: string;
  deckId: string;
}

const emptyMember = (): TeamMemberDraft => ({ characterId: '', deckId: '' });

function CreateDuelForm({
  token,
  session,
  characters,
  onCreated,
  onCancel,
}: {
  token: string;
  session: ApiSession;
  characters: ApiCharacter[];
  onCreated: (duel: ApiDuel) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [teamNames, setTeamNames] = useState<[string, string]>(['Camp 1', 'Camp 2']);
  const [teamMembers, setTeamMembers] = useState<[TeamMemberDraft[], TeamMemberDraft[]]>([[emptyMember()], [emptyMember()]]);
  const [startingLp, setStartingLp] = useState(8000);
  const [handSize, setHandSize] = useState(5);
  const [drawCount, setDrawCount] = useState(1);
  const [skipFirstBattlePhase, setSkipFirstBattlePhase] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const decksFor = (characterId: string) => characters.find((c) => c.id === characterId)?.decks ?? [];

  const updateMember = (team: 0 | 1, index: number, patch: Partial<TeamMemberDraft>) => {
    setTeamMembers((prev) => {
      const next: [TeamMemberDraft[], TeamMemberDraft[]] = [[...prev[0]], [...prev[1]]];
      next[team] = next[team].map((m, i) => (i === index ? { ...m, ...patch } : m));
      return next;
    });
  };

  const addMember = (team: 0 | 1) => {
    setTeamMembers((prev) => {
      if (prev[team].length >= MAX_TEAM_SIZE) return prev;
      const next: [TeamMemberDraft[], TeamMemberDraft[]] = [[...prev[0]], [...prev[1]]];
      next[team] = [...next[team], emptyMember()];
      return next;
    });
  };

  const removeMember = (team: 0 | 1, index: number) => {
    setTeamMembers((prev) => {
      const next: [TeamMemberDraft[], TeamMemberDraft[]] = [[...prev[0]], [...prev[1]]];
      next[team] = next[team].length > 1 ? next[team].filter((_, i) => i !== index) : [emptyMember()];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const allMembers = [...teamMembers[0], ...teamMembers[1]];
    if (allMembers.some((m) => !m.characterId || !m.deckId)) {
      setError('Choisissez un personnage et un deck pour chaque participant.');
      return;
    }
    const allCharacterIds = allMembers.map((m) => m.characterId);
    if (new Set(allCharacterIds).size !== allCharacterIds.length) {
      setError('Un même personnage ne peut pas participer deux fois (même camp ou camps différents).');
      return;
    }

    setSubmitting(true);
    try {
      const { duel } = await api.createDuel(token, {
        game_session_id: session.id,
        name: name.trim() || 'Duel',
        rules: { starting_lp: startingLp, hand_size: handSize, draw_count_per_turn: drawCount, skip_first_battle_phase: skipFirstBattlePhase },
        teams: [
          { name: teamNames[0] || 'Camp 1', participants: teamMembers[0].map((m) => ({ character_id: m.characterId, deck_id: m.deckId })) },
          { name: teamNames[1] || 'Camp 2', participants: teamMembers[1].map((m) => ({ character_id: m.characterId, deck_id: m.deckId })) },
        ],
      });
      onCreated(duel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-3 space-y-3 rounded-lg border border-arena-600 bg-arena-800 p-3 text-xs">
      <input
        type="text"
        placeholder="Nom du duel"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border border-arena-600 bg-arena-900 px-2 py-1.5 text-neutral-100 outline-none focus:border-accent-500"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {([0, 1] as const).map((team) => (
          <div key={team} className="rounded border border-arena-700 p-2">
            <input
              type="text"
              value={teamNames[team]}
              onChange={(e) => setTeamNames((prev) => { const next: [string, string] = [...prev]; next[team] = e.target.value; return next; })}
              className="mb-2 w-full rounded border border-arena-600 bg-arena-900 px-2 py-1 text-neutral-100 outline-none focus:border-accent-500"
            />
            <div className="space-y-2">
              {teamMembers[team].map((member, i) => (
                <div key={i} className="rounded border border-arena-800 bg-arena-900/60 p-1.5">
                  <div className="mb-1 flex items-center gap-1">
                    <span className="shrink-0 text-neutral-500">#{i + 1}</span>
                    <select
                      value={member.characterId}
                      onChange={(e) => updateMember(team, i, { characterId: e.target.value, deckId: '' })}
                      className="min-w-0 flex-1 rounded border border-arena-600 bg-arena-900 px-1.5 py-1 text-neutral-200"
                    >
                      <option value="">Choisir un personnage…</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.is_npc ? ' (PNJ)' : ''}
                        </option>
                      ))}
                    </select>
                    {teamMembers[team].length > 1 && (
                      <button type="button" onClick={() => removeMember(team, i)} className="shrink-0 px-1 text-red-400 hover:text-red-300">
                        ✕
                      </button>
                    )}
                  </div>
                  <select
                    value={member.deckId}
                    disabled={!member.characterId}
                    onChange={(e) => updateMember(team, i, { deckId: e.target.value })}
                    className="w-full rounded border border-arena-600 bg-arena-900 px-1.5 py-1 text-neutral-200 disabled:opacity-40"
                  >
                    <option value="">Choisir un deck…</option>
                    {decksFor(member.characterId).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.cards.length})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {teamMembers[team].length < MAX_TEAM_SIZE && (
              <button type="button" onClick={() => addMember(team)} className="mt-1.5 text-accent-400 underline hover:text-accent-300">
                + Ajouter un participant (Duel Tag)
              </button>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-neutral-400">Règles</div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-neutral-300">
            PV de départ
            <input type="number" min={100} value={startingLp} onChange={(e) => setStartingLp(Number(e.target.value) || 8000)} className="w-20 rounded border border-arena-600 bg-arena-900 px-1.5 py-0.5 text-neutral-100" />
          </label>
          <label className="flex items-center gap-1 text-neutral-300">
            Main de départ
            <input type="number" min={0} value={handSize} onChange={(e) => setHandSize(Number(e.target.value) || 0)} className="w-16 rounded border border-arena-600 bg-arena-900 px-1.5 py-0.5 text-neutral-100" />
          </label>
          <label className="flex items-center gap-1 text-neutral-300">
            Pioche/tour
            <input type="number" min={0} value={drawCount} onChange={(e) => setDrawCount(Number(e.target.value) || 0)} className="w-16 rounded border border-arena-600 bg-arena-900 px-1.5 py-0.5 text-neutral-100" />
          </label>
          <label className="flex items-center gap-1.5 text-neutral-300">
            <input type="checkbox" checked={skipFirstBattlePhase} onChange={(e) => setSkipFirstBattlePhase(e.target.checked)} />
            Pas de Battle Phase au tour 1 (règle standard)
          </label>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-neutral-500">
          PV de départ et main de départ s'appliquent par CAMP (partagés entre ses participants), pas par participant. En Duel Tag, seul le premier
          participant ajouté pioche la main de départ — les suivants prennent le relais au fil des tours de leur camp.
        </p>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50">
          Lancer le duel
        </button>
        <button type="button" onClick={onCancel} className="text-neutral-400 underline hover:text-neutral-200">
          Annuler
        </button>
      </div>
    </form>
  );
}
