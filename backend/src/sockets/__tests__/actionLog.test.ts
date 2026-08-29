import { describe, expect, it } from 'vitest';
import { appendAction, getRecentActions } from '../actionLog';
import type { ActionLogEntry } from '../../types/socket';

let counter = 0;
function uniqueSessionId(): string {
  counter += 1;
  return `session-${counter}-${Date.now()}`;
}

function makeEntry(overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  return {
    roll_id: 'roll-1',
    user_id: 'user-1',
    username: 'Testeur',
    character_id: null,
    character_name: null,
    sides: 20,
    result: 10,
    is_reroll: false,
    previous_result: null,
    rerolls_remaining: null,
    label: null,
    rolled_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('actionLog', () => {
  it('renvoie un tableau vide pour un salon sans historique', () => {
    expect(getRecentActions(uniqueSessionId())).toEqual([]);
  });

  it('restitue les entrées ajoutées, dans leur ordre chronologique', () => {
    const sessionId = uniqueSessionId();
    const first = makeEntry({ roll_id: 'r1' });
    const second = makeEntry({ roll_id: 'r2' });

    appendAction(sessionId, first);
    appendAction(sessionId, second);

    expect(getRecentActions(sessionId)).toEqual([first, second]);
  });

  it('isole les journaux entre salons différents', () => {
    const sessionA = uniqueSessionId();
    const sessionB = uniqueSessionId();

    appendAction(sessionA, makeEntry({ roll_id: 'a1' }));

    expect(getRecentActions(sessionA)).toHaveLength(1);
    expect(getRecentActions(sessionB)).toEqual([]);
  });

  it('plafonne le journal à 50 entrées en supprimant les plus anciennes', () => {
    const sessionId = uniqueSessionId();
    for (let i = 0; i < 55; i += 1) {
      appendAction(sessionId, makeEntry({ roll_id: `r${i}` }));
    }

    const log = getRecentActions(sessionId);
    expect(log).toHaveLength(50);
    // Les 5 premières entrées (r0..r4) doivent avoir été évincées.
    expect(log[0]!.roll_id).toBe('r5');
    expect(log.at(-1)!.roll_id).toBe('r54');
  });
});
