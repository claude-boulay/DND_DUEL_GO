import { afterEach, describe, expect, it } from 'vitest';
import {
  DUEL_MODE_MR5,
  DuelStatus,
  encodeIdleCmdResponse,
  encodeSelectChainResponse,
  encodeSelectPlaceResponse,
  firstAvailablePlace,
  IdleCmdCategory,
  Location,
  MessageType,
  OcgcoreDuel,
  parseIdleCmd,
  parseSelectPlace,
  Position,
  type ProcessResult,
} from '../ocgcoreClient';

/**
 * E2E réel : fait tourner le VRAI binaire ocgcore_server (compilé dans
 * l'image backend, voir backend/Dockerfile stage ocgcore-build) — pas de
 * mock. Reproduit le scénario validé manuellement en Phase 0/1/2 (voir le
 * plan d'intégration) : Raigeki (carte officielle, données réelles
 * BabelCDB + vrai script Project Ignis) détruit une carte custom (stats +
 * script fournis via CUSTOMCARD/CUSTOMSCRIPT, chemin emprunté par le MJ à
 * la création d'une carte custom).
 */

const RAIGEKI_CODE = 12580477;
const CUSTOM_TARGET_CODE = 750000001;

const CUSTOM_MONSTER_SCRIPT = `local s,id=GetID()
function s.initial_effect(c)
end
`;

let activeDuel: OcgcoreDuel | null = null;

afterEach(() => {
  activeDuel?.quit();
  activeDuel = null;
});

/** Répond automatiquement à un prompt AWAITING pour faire avancer le duel jusqu'à la résolution. */
async function respondAndContinue(duel: OcgcoreDuel, result: ProcessResult, activateCode: number): Promise<ProcessResult> {
  const idle = result.messages.find((m) => m.type === MessageType.SELECT_IDLECMD);
  if (idle) {
    const parsed = parseIdleCmd(idle.raw);
    const idx = parsed.activatable.findIndex((e) => e.code === activateCode);
    if (idx !== -1) {
      await duel.respond(encodeIdleCmdResponse(IdleCmdCategory.ACTIVATE, idx));
    } else {
      await duel.respond(encodeIdleCmdResponse(IdleCmdCategory.TO_END, 0));
    }
    return duel.process();
  }
  const place = result.messages.find((m) => m.type === MessageType.SELECT_PLACE);
  if (place) {
    const parsed = parseSelectPlace(place.raw);
    const target = firstAvailablePlace(parsed.flag);
    if (!target) throw new Error('Aucune zone libre pour SELECT_PLACE');
    await duel.respond(encodeSelectPlaceResponse([{ player: 0, location: target.location, sequence: target.sequence }]));
    return duel.process();
  }
  if (result.messages.some((m) => m.type === MessageType.SELECT_CHAIN)) {
    await duel.respond(encodeSelectChainResponse(-1));
    return duel.process();
  }
  if (result.messages.some((m) => m.type === MessageType.SELECT_YESNO || m.type === MessageType.SELECT_EFFECTYN)) {
    const buf = Buffer.alloc(4); // 0 = non, réponse par défaut sûre pour ce scénario
    await duel.respond(buf);
    return duel.process();
  }
  throw new Error('Message AWAITING non géré par le test : ' + JSON.stringify(result.messages.map((m) => m.type)));
}

describe('OcgcoreDuel (E2E réel, process ocgcore_server)', () => {
  it(
    'Raigeki (carte officielle, vrai script Project Ignis) détruit une carte custom (script fourni par le MJ)',
    async () => {
      const duel = new OcgcoreDuel();
      activeDuel = duel;

      const createdStatus = await duel.create({ flags: DUEL_MODE_MR5, lp1: 8000, hand1: 5, draw1: 1, lp2: 8000, hand2: 5, draw2: 1 });
      expect(createdStatus).toBe(0);

      await duel.addCustomCard(CUSTOM_TARGET_CODE, { type: 0x1 | 0x10, level: 4, attribute: 0x01, race: 1n, atk: 1000, def: 1000 });
      await duel.addCustomScript(CUSTOM_TARGET_CODE, CUSTOM_MONSTER_SCRIPT);

      await duel.addCard({ team: 0, code: RAIGEKI_CODE, con: 0, loc: Location.HAND, seq: 0, pos: Position.FACEUP_ATTACK });
      for (let i = 0; i < 19; i += 1) {
        await duel.addCard({ team: 0, code: 800000 + i, con: 0, loc: Location.DECK, seq: 0, pos: Position.FACEDOWN_DEFENSE });
      }
      await duel.addCard({ team: 1, code: CUSTOM_TARGET_CODE, con: 1, loc: Location.MZONE, seq: 0, pos: Position.FACEUP_ATTACK });
      for (let i = 0; i < 20; i += 1) {
        await duel.addCard({ team: 1, code: 800100 + i, con: 1, loc: Location.DECK, seq: 0, pos: Position.FACEDOWN_DEFENSE });
      }

      let result = await duel.start();
      let iterations = 0;
      let targetDestroyed = false;

      while (result.status !== DuelStatus.END && iterations < 40 && !targetDestroyed) {
        iterations += 1;
        if (result.status === DuelStatus.AWAITING) {
          result = await respondAndContinue(duel, result, RAIGEKI_CODE);
        } else {
          result = await duel.process();
        }
        for (const msg of result.messages) {
          if (msg.type === MessageType.MOVE && msg.raw.readUInt32LE(1) === CUSTOM_TARGET_CODE) {
            targetDestroyed = true;
          }
        }
      }

      expect(targetDestroyed).toBe(true);
    },
    30_000,
  );
});
