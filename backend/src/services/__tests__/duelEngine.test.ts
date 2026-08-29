import { describe, expect, it } from 'vitest';
import { applyMessages, createInitialState, pumpUntilSettled } from '../duelEngine';
import { DuelStatus, MessageType, type EngineMessage, type OcgcoreDuel, type ProcessResult } from '../ocgcoreClient';

function msg(type: number): EngineMessage {
  return { type, raw: Buffer.from([type]) };
}

/**
 * Fake minimal conforme à la seule méthode utilisée par pumpUntilSettled
 * (`.process()`) — pas de process réel spawné, voir ocgcoreClient.e2e.test.ts
 * pour la validation contre le vrai moteur.
 */
function fakeOcgDuel(results: ProcessResult[]): OcgcoreDuel {
  let i = 0;
  return {
    process: async () => {
      const r = results[i];
      i += 1;
      return r ?? { status: DuelStatus.END, messages: [] };
    },
  } as unknown as OcgcoreDuel;
}

describe('pumpUntilSettled', () => {
  it("ne rappelle pas process() si le résultat initial est déjà AWAITING", async () => {
    const ocg = fakeOcgDuel([{ status: DuelStatus.CONTINUE, messages: [msg(999)] }]); // ne doit jamais être consommé
    const initial: ProcessResult = { status: DuelStatus.AWAITING, messages: [msg(MessageType.SELECT_IDLECMD)] };
    const result = await pumpUntilSettled(ocg, initial);
    expect(result).toEqual(initial);
  });

  it(
    'reproduit le cas réel observé (Invocation Normale niveau 4) : HINT, MOVE, SUMMONED — trois lots CONTINUE ' +
      'séparés avant AWAITING — accumule tous les messages sans en perdre',
    async () => {
      const ocg = fakeOcgDuel([
        { status: DuelStatus.CONTINUE, messages: [msg(50)] }, // MSG_MOVE
        { status: DuelStatus.CONTINUE, messages: [msg(61)] }, // MSG_SUMMONED
        { status: DuelStatus.AWAITING, messages: [msg(MessageType.SELECT_IDLECMD)] },
      ]);
      const initial: ProcessResult = { status: DuelStatus.CONTINUE, messages: [msg(2)] }; // MSG_HINT
      const result = await pumpUntilSettled(ocg, initial);
      expect(result.status).toBe(DuelStatus.AWAITING);
      expect(result.messages.map((m) => m.type)).toEqual([2, 50, 61, MessageType.SELECT_IDLECMD]);
    },
  );

  it('boucle jusqu’à END si le duel se termine sans repasser par AWAITING', async () => {
    const ocg = fakeOcgDuel([{ status: DuelStatus.END, messages: [msg(MessageType.WIN)] }]);
    const initial: ProcessResult = { status: DuelStatus.CONTINUE, messages: [] };
    const result = await pumpUntilSettled(ocg, initial);
    expect(result.status).toBe(DuelStatus.END);
    expect(result.messages.map((m) => m.type)).toEqual([MessageType.WIN]);
  });

  it('lève une erreur explicite plutôt que de boucler indéfiniment si le moteur ne se stabilise jamais', async () => {
    const ocg: OcgcoreDuel = {
      process: async () => ({ status: DuelStatus.CONTINUE, messages: [] }),
    } as unknown as OcgcoreDuel;
    const initial: ProcessResult = { status: DuelStatus.CONTINUE, messages: [] };
    await expect(pumpUntilSettled(ocg, initial)).rejects.toThrow(/PROCESS/);
  });
});

describe('applyMessages — préservation du prompt sur MSG_RETRY', () => {
  /**
   * Une réponse invalide (ex. mauvais nombre de tributs) fait émettre
   * MSG_RETRY par le moteur, statut toujours AWAITING — mais SANS renvoyer
   * les données du prompt d'origine (confirmé en pilotant le protocole
   * brut : `MSG 1 01` seul). Si on remplaçait pendingPrompt par ce message
   * RETRY (type inconnu de toutes les routes), la session resterait bloquée
   * en 'wrong_prompt' pour toujours — c'est exactement le bug que ce test
   * couvre.
   */
  it('ne remplace PAS le prompt en attente : le moteur repose la même question', () => {
    const state = createInitialState({} as OcgcoreDuel, 8000, 5, [[{ mainDeckSize: 40 }], [{ mainDeckSize: 40 }]]);
    const original = { type: MessageType.SELECT_TRIBUTE, raw: Buffer.from([MessageType.SELECT_TRIBUTE, 0]) };
    state.pendingPrompt = original;

    applyMessages(state, { status: DuelStatus.AWAITING, messages: [{ type: MessageType.RETRY, raw: Buffer.from([MessageType.RETRY]) }] });

    expect(state.pendingPrompt).toBe(original);
  });

  it('un vrai nouveau prompt AWAITING remplace bien le précédent', () => {
    const state = createInitialState({} as OcgcoreDuel, 8000, 5, [[{ mainDeckSize: 40 }], [{ mainDeckSize: 40 }]]);
    state.pendingPrompt = { type: MessageType.SELECT_TRIBUTE, raw: Buffer.from([1]) };

    applyMessages(state, { status: DuelStatus.AWAITING, messages: [{ type: MessageType.SELECT_IDLECMD, raw: Buffer.from([MessageType.SELECT_IDLECMD, 0]) }] });

    expect(state.pendingPrompt?.type).toBe(MessageType.SELECT_IDLECMD);
  });

  it('CONTINUE/END effacent le prompt (rien à répondre)', () => {
    const state = createInitialState({} as OcgcoreDuel, 8000, 5, [[{ mainDeckSize: 40 }], [{ mainDeckSize: 40 }]]);
    state.pendingPrompt = { type: MessageType.SELECT_TRIBUTE, raw: Buffer.from([1]) };
    applyMessages(state, { status: DuelStatus.END, messages: [] });
    expect(state.pendingPrompt).toBeNull();
  });
});
