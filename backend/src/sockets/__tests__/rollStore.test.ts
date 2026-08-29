import { describe, expect, it } from 'vitest';
import { getRoll, recordRoll, updateRollResult } from '../rollStore';

// Le store est un singleton en mémoire : chaque test utilise un sessionId
// unique pour rester isolé sans dépendre d'un reset entre les tests.
let counter = 0;
function uniqueSessionId(): string {
  counter += 1;
  return `session-${counter}-${Date.now()}`;
}

describe('rollStore', () => {
  it('enregistre un jet et le restitue via getRoll', () => {
    const sessionId = uniqueSessionId();
    const pending = recordRoll(sessionId, 'char-1', 20, 15);

    expect(pending.rollId).toBeTruthy();
    expect(pending.sessionId).toBe(sessionId);
    expect(pending.characterId).toBe('char-1');
    expect(pending.sides).toBe(20);
    expect(pending.result).toBe(15);

    expect(getRoll(pending.rollId)).toEqual(pending);
  });

  it('accepte un characterId nul (lancer non lié à un personnage)', () => {
    const sessionId = uniqueSessionId();
    const pending = recordRoll(sessionId, null, 6, 3);
    expect(pending.characterId).toBeNull();
  });

  it('renvoie undefined pour un rollId inconnu', () => {
    expect(getRoll('rollId-inexistant')).toBeUndefined();
  });

  it('génère un rollId différent à chaque enregistrement', () => {
    const sessionId = uniqueSessionId();
    const first = recordRoll(sessionId, null, 20, 1);
    const second = recordRoll(sessionId, null, 20, 1);
    expect(first.rollId).not.toBe(second.rollId);
  });

  it('updateRollResult modifie le résultat du jet enregistré', () => {
    const sessionId = uniqueSessionId();
    const pending = recordRoll(sessionId, 'char-2', 20, 8);
    updateRollResult(pending.rollId, 19);
    expect(getRoll(pending.rollId)?.result).toBe(19);
  });

  it("updateRollResult sur un rollId inconnu ne lève pas d'erreur", () => {
    expect(() => updateRollResult('rollId-inexistant', 42)).not.toThrow();
  });
});
