import { useState, type FormEvent } from 'react';
import { api, ApiError, type ApiCharacter } from '../lib/api';
import {
  POINT_BUY_BUDGET,
  STAT_LABELS,
  STAT_MAX,
  STAT_MIN,
  STAT_NAMES,
  totalPointBuyCost,
  type CharacterStats,
} from '../lib/pointBuy';

interface CharacterSheetFormProps {
  token: string;
  sessionId: string;
  canCreateNpc: boolean;
  onCreated: (character: ApiCharacter) => void;
}

const BASE_STATS: CharacterStats = {
  history: STAT_MIN,
  perception: STAT_MIN,
  intelligence: STAT_MIN,
  charisma: STAT_MIN,
  luck: STAT_MIN,
};

export function CharacterSheetForm({ token, sessionId, canCreateNpc, onCreated }: CharacterSheetFormProps) {
  const [name, setName] = useState('');
  const [isNpc, setIsNpc] = useState(false);
  const [backstory, setBackstory] = useState('');
  const [personality, setPersonality] = useState('');
  const [visualDescription, setVisualDescription] = useState('');
  const [stats, setStats] = useState<CharacterStats>(BASE_STATS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const spent = totalPointBuyCost(stats);
  const remaining = POINT_BUY_BUDGET - spent;

  const adjust = (stat: keyof CharacterStats, delta: 1 | -1) => {
    setStats((prev) => {
      const nextValue = prev[stat] + delta;
      if (nextValue < STAT_MIN || nextValue > STAT_MAX) return prev;
      const nextStats = { ...prev, [stat]: nextValue };
      if (delta > 0 && totalPointBuyCost(nextStats) > POINT_BUY_BUDGET) return prev;
      return nextStats;
    });
  };

  const resetForm = () => {
    setName('');
    setBackstory('');
    setPersonality('');
    setVisualDescription('');
    setStats(BASE_STATS);
    setIsNpc(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { character } = await api.createCharacter(token, {
        game_session_id: sessionId,
        name,
        is_npc: isNpc,
        stats,
        backstory,
        personality,
        visual_description: visualDescription,
      });
      onCreated(character);
      resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">Nouveau personnage</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Nom du personnage"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
          />
          {canCreateNpc && (
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-neutral-400">
              <input type="checkbox" checked={isNpc} onChange={(e) => setIsNpc(e.target.checked)} />
              NPC
            </label>
          )}
        </div>

        <div className="rounded-md border border-arena-700 p-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-400">
            <span>Point-buy</span>
            <span className={remaining === 0 ? 'text-emerald-400' : 'text-accent-400'}>
              {spent} / {POINT_BUY_BUDGET} points utilisés
            </span>
          </div>
          <div className="space-y-1.5">
            {STAT_NAMES.map((stat) => (
              <div key={stat} className="flex items-center gap-2 text-sm text-neutral-200">
                <span className="w-24 shrink-0">{STAT_LABELS[stat]}</span>
                <button
                  type="button"
                  onClick={() => adjust(stat, -1)}
                  disabled={stats[stat] <= STAT_MIN}
                  className="h-6 w-6 rounded border border-arena-600 text-xs disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-6 text-center font-mono">{stats[stat]}</span>
                <button
                  type="button"
                  onClick={() => adjust(stat, 1)}
                  disabled={
                    stats[stat] >= STAT_MAX || totalPointBuyCost({ ...stats, [stat]: stats[stat] + 1 }) > POINT_BUY_BUDGET
                  }
                  className="h-6 w-6 rounded border border-arena-600 text-xs disabled:opacity-30"
                >
                  +
                </button>
                <span className="ml-auto font-mono text-xs text-neutral-500">coût {stats[stat] - STAT_MIN}</span>
              </div>
            ))}
          </div>
        </div>

        <textarea
          placeholder="Historique"
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <textarea
          placeholder="Personnalité"
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <textarea
          placeholder="Description visuelle"
          value={visualDescription}
          onChange={(e) => setVisualDescription(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || remaining !== 0 || !name.trim()}
          className="w-full rounded-md bg-accent-500 py-2 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {submitting ? 'Création...' : 'Créer le personnage'}
        </button>
      </form>
    </section>
  );
}
