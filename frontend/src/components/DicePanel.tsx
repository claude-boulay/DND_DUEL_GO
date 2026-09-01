import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { socket } from '../lib/socket';
import type { ActionLogEntry } from '../types/socket';
import type { ApiCharacter, ApiSession } from '../lib/api';
import { STAT_LABELS, STAT_NAMES, abilityModifier, effectiveStat, type StatName } from '../lib/pointBuy';

interface DicePanelProps {
  token: string;
  session: ApiSession;
  characters: ApiCharacter[];
  currentUserId: string;
  onCharacterRerollsChange?: (characterId: string, remaining: number) => void;
}

const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100];

function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}

function formatDieLabel(sides: number, t: TFunction): string {
  return sides === 2 ? t('dice.coin_label') : `d${sides}`;
}

function formatRollResult(sides: number, result: number, t: TFunction): string {
  if (sides === 2) return result === 1 ? t('dice.coin_heads') : t('dice.coin_tails');
  return String(result);
}

export function DicePanel({ token, session, characters, currentUserId, onCharacterRerollsChange }: DicePanelProps) {
  const { t } = useTranslation();
  const [joined, setJoined] = useState(false);
  const [log, setLog] = useState<ActionLogEntry[]>([]);
  const [sides, setSides] = useState(20);
  const [characterId, setCharacterId] = useState('');
  // Stat choisie (demande utilisateur : "dé de charisme, histoire...") —
  // force un d20 et fait calculer le modificateur automatiquement côté
  // serveur (voir sockets/index.ts). '' = jet classique, comme avant.
  const [stat, setStat] = useState<StatName | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const rollableCharacters = characters.filter((c) => session.is_gm || c.user_id === currentUserId);
  const selectedCharacter = characters.find((c) => c.id === characterId) ?? null;
  // Aperçu client uniquement (le serveur recalcule et reste seul faisant foi,
  // voir CLAUDE.md §4 "never trust client state") : montrer au joueur ce à
  // quoi s'attendre avant de cliquer sur "Lancer".
  const previewModifier =
    stat && selectedCharacter ? abilityModifier(effectiveStat(selectedCharacter.stats[stat], selectedCharacter.level)) : null;

  // Ref plutôt que dépendance d'effet : App ne mémoïse pas ce callback, l'inclure
  // dans les deps ferait rejoindre le salon à chaque re-render.
  const onCharacterRerollsChangeRef = useRef(onCharacterRerollsChange);
  useEffect(() => {
    onCharacterRerollsChangeRef.current = onCharacterRerollsChange;
  }, [onCharacterRerollsChange]);

  useEffect(() => {
    setJoined(false);
    setLog([]);
    setError(null);

    const join = () => socket.emit('join_game', { token, code: session.code });
    if (socket.connected) join();

    const onJoined = (payload: { recent_actions: ActionLogEntry[] }) => {
      setJoined(true);
      setLog(payload.recent_actions);
    };
    const onRolled = (entry: ActionLogEntry) => {
      setLog((prev) => [...prev, entry]);
      if (entry.character_id && entry.rerolls_remaining !== null) {
        onCharacterRerollsChangeRef.current?.(entry.character_id, entry.rerolls_remaining);
      }
    };
    const onError = (payload: { code: string; message: string }) => {
      if (['join_failed', 'roll_failed', 'reroll_failed'].includes(payload.code)) {
        setError(payload.message);
      }
    };

    socket.on('connect', join);
    socket.on('game_joined', onJoined);
    socket.on('dice_rolled', onRolled);
    socket.on('dice_rerolled', onRolled);
    socket.on('error_message', onError);

    return () => {
      socket.off('connect', join);
      socket.off('game_joined', onJoined);
      socket.off('dice_rolled', onRolled);
      socket.off('dice_rerolled', onRolled);
      socket.off('error_message', onError);
    };
  }, [token, session.code]);

  const rollDice = () => {
    setError(null);
    socket.emit('roll_dice', { sides, character_id: characterId || undefined, stat: stat || undefined });
  };

  const lastEntry = log[log.length - 1];
  const canRerollLast =
    !!lastEntry &&
    !!lastEntry.character_id &&
    (lastEntry.rerolls_remaining ?? 0) > 0 &&
    (lastEntry.user_id === currentUserId || session.is_gm);

  const rerollLast = () => {
    if (!lastEntry) return;
    setError(null);
    socket.emit('reroll_dice', { roll_id: lastEntry.roll_id });
  };

  return (
    <section className="rounded-xl border border-arena-700 bg-arena-900 p-5 shadow-lg">
      <header className="mb-3 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${joined ? 'bg-emerald-400' : 'bg-amber-400'}`}
          aria-hidden
        />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('dice.title')}</h2>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {/* Une stat choisie force un d20 (test de caractéristique) : le
            sélecteur de faces devient inutile, remplacé par l'indication. */}
        {stat ? (
          <span className="rounded-md border border-arena-700 bg-arena-800 px-2 py-1.5 text-sm text-neutral-400">d20</span>
        ) : (
          <select
            value={sides}
            onChange={(e) => setSides(Number(e.target.value))}
            className="rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
          >
            {DICE_SIDES.map((n) => (
              <option key={n} value={n}>
                {formatDieLabel(n, t)}
              </option>
            ))}
          </select>
        )}

        <select
          value={characterId}
          onChange={(e) => {
            setCharacterId(e.target.value);
            if (!e.target.value) setStat(''); // pas de personnage -> pas de stat possible (voir sockets/index.ts)
          }}
          className="min-w-0 flex-1 rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500"
        >
          <option value="">{t('dice.no_character')}</option>
          {rollableCharacters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({t('dice.rerolls_count', { count: c.remaining_luck_rerolls })})
            </option>
          ))}
        </select>

        <select
          value={stat}
          onChange={(e) => setStat(e.target.value as StatName | '')}
          disabled={!characterId}
          title={!characterId ? t('dice.choose_character_for_stat') : undefined}
          className="rounded-md border border-arena-600 bg-arena-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent-500 disabled:opacity-40"
        >
          <option value="">{t('dice.classic_roll')}</option>
          {STAT_NAMES.map((s) => (
            <option key={s} value={s}>
              {t(STAT_LABELS[s])}
            </option>
          ))}
        </select>
        {previewModifier !== null && (
          <span className="self-center text-xs text-neutral-500">{t('dice.modifier_preview', { modifier: formatModifier(previewModifier) })}</span>
        )}

        <button
          type="button"
          onClick={rollDice}
          disabled={!joined}
          className="rounded-md bg-accent-500 px-4 py-1.5 text-sm font-semibold text-arena-950 transition hover:bg-accent-400 disabled:opacity-50"
        >
          {t('dice.roll')}
        </button>

        {canRerollLast && (
          <button
            type="button"
            onClick={rerollLast}
            className="rounded-md border border-accent-500 px-4 py-1.5 text-sm text-accent-400 transition hover:bg-accent-500 hover:text-arena-950"
          >
            {t('dice.reroll_luck')}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {/* Demande utilisateur : ne montrer que les 5 derniers lancers ici —
          l'historique complet a sa propre vue (voir DiceHistoryOverlay
          ci-dessous), pour ne pas noyer le bloc classique dans un long journal. */}
      <div className="space-y-1 font-mono text-xs text-neutral-300">
        {log.length === 0 && <p className="text-neutral-500">{t('dice.no_rolls_yet')}</p>}
        {[...log].reverse().slice(0, 5).map((entry, index) => (
          <DiceLogRow key={`${entry.roll_id}-${entry.is_reroll ? 'r' : 'o'}-${index}`} entry={entry} />
        ))}
        {log.length > 5 && (
          <button type="button" onClick={() => setShowHistory(true)} className="pt-1 text-accent-400 underline hover:text-accent-300">
            {t('dice.view_full_history', { count: log.length })}
          </button>
        )}
      </div>

      {showHistory && <DiceHistoryOverlay log={log} onClose={() => setShowHistory(false)} />}
    </section>
  );
}

function DiceLogRow({ entry }: { entry: ActionLogEntry }) {
  const { t } = useTranslation();
  const statLabel = entry.stat && entry.stat in STAT_LABELS ? t(STAT_LABELS[entry.stat as StatName]) : entry.stat;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-neutral-500">{new Date(entry.rolled_at).toLocaleTimeString()}</span>
      <span className="text-neutral-200">{entry.username}</span>
      {entry.character_name && <span className="text-accent-400">({entry.character_name})</span>}
      <span>
        {formatDieLabel(entry.sides, t)}
        {entry.modifier !== null && `${formatModifier(entry.modifier)}`} →{' '}
        <span className="font-bold text-neutral-100">
          {formatRollResult(entry.sides, entry.result, t)}
          {entry.total !== null && ` = ${entry.total}`}
        </span>
        {statLabel && <span className="text-neutral-500"> ({statLabel})</span>}
      </span>
      {entry.is_reroll && (
        <span className="text-neutral-500">{t('dice.reroll_was', { previous: formatRollResult(entry.sides, entry.previous_result ?? 0, t) })}</span>
      )}
    </div>
  );
}

function DiceHistoryOverlay({ log, onClose }: { log: ActionLogEntry[]; onClose: () => void }) {
  const { t } = useTranslation();
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-full max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-arena-700 bg-arena-900 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-arena-700 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{t('dice.full_history_title', { count: log.length })}</h2>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-200">
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4 font-mono text-xs text-neutral-300">
          {[...log].reverse().map((entry, index) => (
            <DiceLogRow key={`${entry.roll_id}-${entry.is_reroll ? 'r' : 'o'}-${index}`} entry={entry} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
