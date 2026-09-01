import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ApiCharacter } from '../lib/api';
import { translateApiError } from '../lib/translateApiError';
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
  isGm: boolean;
  // Un joueur ne peut avoir qu'UN SEUL personnage joueur par salon (demande
  // utilisateur, pour que "le" modificateur de stat d'un lancer de dé reste
  // sans ambiguïté) — le formulaire se masque une fois ce personnage créé.
  hasPlayerCharacter: boolean;
  onCreated: (character: ApiCharacter) => void;
}

const BASE_STATS: CharacterStats = {
  history: STAT_MIN,
  perception: STAT_MIN,
  intelligence: STAT_MIN,
  charisma: STAT_MIN,
  luck: STAT_MIN,
};

/**
 * Le MJ ne crée plus JAMAIS que des PNJ (plus de case à cocher — imposé),
 * un joueur ne crée plus jamais qu'un personnage joueur, et un seul par
 * salon (voir hasPlayerCharacter). Le choix is_npc n'existe donc plus côté
 * formulaire : il est entièrement dérivé de qui le soumet.
 */
export function CharacterSheetForm({ token, sessionId, isGm, hasPlayerCharacter, onCreated }: CharacterSheetFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
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
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { character } = await api.createCharacter(token, {
        game_session_id: sessionId,
        name,
        is_npc: isGm,
        stats,
        backstory,
        personality,
        visual_description: visualDescription,
      });
      onCreated(character);
      resetForm();
    } catch (err) {
      setError(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isGm && hasPlayerCharacter) {
    return (
      <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('characterForm.title_player')}</h2>
        <p className="text-xs text-neutral-500">{t('characterForm.already_has_character')}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-200">
        {isGm ? t('characterForm.title_npc') : t('characterForm.title_player')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder={isGm ? t('characterForm.placeholder_name_npc') : t('characterForm.placeholder_name_player')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />

        <div className="rounded-md border border-arena-700 p-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-400">
            <span>{t('characterForm.point_buy')}</span>
            <span className={remaining === 0 ? 'text-emerald-400' : 'text-accent-400'}>
              {t('characterForm.points_used', { spent, budget: POINT_BUY_BUDGET })}
            </span>
          </div>
          <div className="space-y-1.5">
            {STAT_NAMES.map((stat) => (
              <div key={stat} className="flex items-center gap-2 text-sm text-neutral-200">
                <span className="w-24 shrink-0">{t(STAT_LABELS[stat])}</span>
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
                <span className="ml-auto font-mono text-xs text-neutral-500">{t('characterForm.cost', { cost: stats[stat] - STAT_MIN })}</span>
              </div>
            ))}
          </div>
        </div>

        <textarea
          placeholder={t('characterForm.placeholder_backstory')}
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <textarea
          placeholder={t('characterForm.placeholder_personality')}
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-arena-600 bg-arena-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent-500"
        />
        <textarea
          placeholder={t('characterForm.placeholder_visual_description')}
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
          {submitting ? t('characterForm.creating') : t('characterForm.submit')}
        </button>
      </form>
    </section>
  );
}
