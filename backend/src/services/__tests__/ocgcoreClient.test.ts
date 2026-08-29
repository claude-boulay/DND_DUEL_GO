import { describe, expect, it } from 'vitest';
import {
  BattleCmdCategory,
  encodeBattleCmdResponse,
  encodeIdleCmdResponse,
  encodeSelectCardCancel,
  encodeSelectCardResponse,
  encodeSelectChainResponse,
  encodeSelectPlaceResponse,
  encodeYesNoResponse,
  firstAvailablePlace,
  IdleCmdCategory,
  Location,
  parseBattleCmd,
  parseDamageOrRecover,
  parseDraw,
  parseIdleCmd,
  parseMove,
  parseNewPhase,
  parseNewTurn,
  encodeSelectOptionResponse,
  encodeSelectPositionResponse,
  parseQueryLocation,
  parseSelectCard,
  parseSelectChain,
  parseSelectOption,
  parseSelectPlace,
  parseSelectPosition,
  parseSelectTribute,
  parseTagSwap,
  Position,
  QUERY_ATTACK,
  QUERY_CODE,
  QUERY_DEFENSE,
  QUERY_END,
  QUERY_POSITION,
} from '../ocgcoreClient';

/**
 * Payloads réels capturés lors de la validation Phase 0/1 (voir le plan
 * d'intégration) : Raigeki en main (seule carte activable), 5 cartes de
 * remplissage invocables, réponse RESPOND 05000000 confirmée avoir
 * effectivement activé Raigeki dans le vrai moteur — donc l'interprétation
 * ci-dessous n'est pas juste "ce que produit mon propre parseur", elle a été
 * behavioralement confirmée contre le moteur réel.
 */
const REAL_IDLE_CMD_HEX =
  '0b000500000012350c0000020100000011350c0000020200000010350c000002030000000f350c000002040000000e350c0000020500000000000000000000000500000012350c0000020100000011350c0000020200000010350c000002030000000f350c000002040000000e350c00000205000000010000007df6bf00000200000000010000007df6bf00000200000000000000000000000000000101';
const REAL_SELECT_PLACE_HEX = '120001ffe0ffff';

describe('parseIdleCmd (MSG_SELECT_IDLECMD)', () => {
  it('parse un payload réel : 5 invocables, 1 activable (Raigeki)', () => {
    const parsed = parseIdleCmd(Buffer.from(REAL_IDLE_CMD_HEX, 'hex'));
    expect(parsed.playerid).toBe(0);
    expect(parsed.summonable).toHaveLength(5);
    expect(parsed.summonable[0]).toEqual({ code: 800018, controller: 0, location: Location.HAND, sequence: 1 });
    expect(parsed.spSummonable).toHaveLength(0);
    expect(parsed.repositionable).toHaveLength(0);
    expect(parsed.msetable).toHaveLength(5);
    // Raigeki (Magie Normale) peut aussi être posée face cachée, pas seulement activée.
    expect(parsed.ssetable).toEqual([{ code: 12580477, controller: 0, location: Location.HAND, sequence: 0 }]);
    expect(parsed.activatable).toEqual([{ code: 12580477, controller: 0, location: Location.HAND, sequence: 0, description: 0n }]);
    expect(parsed.canBattlePhase).toBe(false);
    expect(parsed.canEndPhase).toBe(true);
    expect(parsed.canShuffleHand).toBe(true);
  });

  it('repositionable utilise un octet de séquence (pas un uint32, contrairement aux autres catégories)', () => {
    // Construit un payload minimal avec 1 carte en "repositionable" pour
    // vérifier que le décalage d'octet ne dérape pas vers la catégorie suivante.
    const parts: Buffer[] = [
      Buffer.from([11, 0]), // type + playerid
      Buffer.from([0, 0, 0, 0]), // summonable: 0
      Buffer.from([0, 0, 0, 0]), // spsummonable: 0
      Buffer.from([1, 0, 0, 0]), // repositionable: 1 entrée
      (() => {
        const b = Buffer.alloc(4 + 1 + 1 + 1);
        b.writeUInt32LE(123456, 0);
        b.writeUInt8(0, 4); // controller
        b.writeUInt8(Location.MZONE, 5);
        b.writeUInt8(2, 6); // sequence (1 octet)
        return b;
      })(),
      Buffer.from([0, 0, 0, 0]), // msetable: 0
      Buffer.from([0, 0, 0, 0]), // ssetable: 0
      Buffer.from([0, 0, 0, 0]), // activate: 0
      Buffer.from([0, 0, 0]), // to_bp, to_ep, can_shuffle
    ];
    const parsed = parseIdleCmd(Buffer.concat(parts));
    expect(parsed.repositionable).toEqual([{ code: 123456, controller: 0, location: Location.MZONE, sequence: 2 }]);
  });
});

describe('encodeIdleCmdResponse', () => {
  it('encode (index << 16) | catégorie en int32 LE', () => {
    // Activer le lien d'index 0 : la même réponse validée en Phase 1 (RESPOND 05000000).
    expect(encodeIdleCmdResponse(IdleCmdCategory.ACTIVATE, 0).toString('hex')).toBe('05000000');
  });

  it('encode un index non nul', () => {
    const buf = encodeIdleCmdResponse(IdleCmdCategory.SUMMON, 3);
    expect(buf.readInt32LE(0)).toBe((3 << 16) | 0);
  });
});

describe('parseSelectPlace / firstAvailablePlace (MSG_SELECT_PLACE)', () => {
  it('parse un payload réel : 1 sélection requise, zones Magie/Piège propres libres', () => {
    const parsed = parseSelectPlace(Buffer.from(REAL_SELECT_PLACE_HEX, 'hex'));
    expect(parsed).toEqual({ playerid: 0, count: 1, flag: 0xffffe0ff });
  });

  it('déduit la première zone Magie/Piège libre quand seules ces zones sont disponibles', () => {
    const place = firstAvailablePlace(0xffffe0ff);
    expect(place).toEqual({ location: Location.SZONE, sequence: 0 });
  });

  it('préfère une zone Monstre libre à une zone Magie/Piège libre', () => {
    // Tous les bits à 1 (rien de libre) sauf le bit 2 de la zone Monstre (0x04).
    const flag = 0xffffffff & ~0x04;
    expect(firstAvailablePlace(flag)).toEqual({ location: Location.MZONE, sequence: 2 });
  });

  it("renvoie null quand aucune zone propre n'est libre", () => {
    expect(firstAvailablePlace(0xffffffff)).toBeNull();
  });

  // Régression réelle (rapportée : invocation Pendule impossible, plus aucune
  // action possible) — la portion szone du flag couvre 8 bits (0-4 normales,
  // 5 = Terrain, 6-7 = Pendule), confirmé en lisant operations.cpp
  // (`flag = ((flag & 0xff) << 8) | ...`). Un masque à 5 bits seulement
  // (l'ancien bug) aurait renvoyé null ici, alors que la Zone Pendule gauche
  // (séquence 6) est la SEULE zone libre.
  it('détecte une Zone Pendule (séquence 6) libre quand toutes les autres zones sont indisponibles', () => {
    const flag = 0xffffffff & ~(1 << (8 + 6));
    expect(firstAvailablePlace(flag)).toEqual({ location: Location.SZONE, sequence: 6 });
  });
});

describe('encodeSelectPlaceResponse', () => {
  it('encode un triplet (player, location, sequence) par sélection', () => {
    const buf = encodeSelectPlaceResponse([{ player: 0, location: Location.SZONE, sequence: 0 }]);
    expect(buf.toString('hex')).toBe('000800');
  });

  it('encode plusieurs sélections à la suite', () => {
    const buf = encodeSelectPlaceResponse([
      { player: 0, location: Location.MZONE, sequence: 1 },
      { player: 1, location: Location.SZONE, sequence: 2 },
    ]);
    expect(buf.toString('hex')).toBe('000401' + '010802');
  });
});

describe('encodeSelectChainResponse', () => {
  it('encode -1 pour passer', () => {
    expect(encodeSelectChainResponse(-1).toString('hex')).toBe('ffffffff');
  });

  it('encode un index de lien positif', () => {
    expect(encodeSelectChainResponse(2).readInt32LE(0)).toBe(2);
  });
});

describe('encodeYesNoResponse', () => {
  it('encode oui/non en int32 LE', () => {
    expect(encodeYesNoResponse(true).readInt32LE(0)).toBe(1);
    expect(encodeYesNoResponse(false).readInt32LE(0)).toBe(0);
  });
});

/**
 * Payloads réels capturés en pilotant un vrai combat contre le moteur réel
 * (attaquant 1900 ATK vs cible 500 ATK en position Attaque → 1400 dégâts,
 * cible détruite, confirmé octet pour octet côté MSG_DAMAGE/MSG_MOVE avant
 * d'écrire ces tests — voir le plan d'intégration).
 */
const REAL_BATTLECMD_HEX = '0a000000000001000000e517b42c000400000101';
const REAL_SELECT_CARD_HEX = '0f0001010000000100000001000000e617b42c01040000000001000000';

describe('parseBattleCmd (MSG_SELECT_BATTLECMD)', () => {
  it('parse un payload réel : 1 carte attaquante, direct attack refusée (cible adverse présente)', () => {
    const parsed = parseBattleCmd(Buffer.from(REAL_BATTLECMD_HEX, 'hex'));
    expect(parsed.playerid).toBe(0);
    expect(parsed.activatable).toHaveLength(0);
    expect(parsed.attackable).toEqual([
      { code: 750000101, controller: 0, location: Location.MZONE, sequence: 0, directAttackable: false },
    ]);
    expect(parsed.canMain2).toBe(true);
    expect(parsed.canEndPhase).toBe(true);
  });
});

describe('encodeBattleCmdResponse', () => {
  it('encode (index << 16) | catégorie — attaque avec la carte d’index 0', () => {
    expect(encodeBattleCmdResponse(BattleCmdCategory.ATTACK, 0).toString('hex')).toBe('01000000');
  });
});

describe('parseSelectCard (MSG_SELECT_CARD)', () => {
  it('parse un payload réel : 1 cible obligatoire (min=max=1), la carte adverse en position Attaque', () => {
    const parsed = parseSelectCard(Buffer.from(REAL_SELECT_CARD_HEX, 'hex'));
    expect(parsed.playerid).toBe(0);
    expect(parsed.cancelable).toBe(true);
    expect(parsed.min).toBe(1);
    expect(parsed.max).toBe(1);
    expect(parsed.cards).toEqual([{ code: 750000102, controller: 1, location: Location.MZONE, sequence: 0, position: 1 }]);
  });
});

/** Payload réel : combat 1900 ATK vs cible 500 ATK (position Attaque) — voir le plan d'intégration. */
const REAL_DAMAGE_HEX = '5b0178050000';
const REAL_NEW_TURN_HEX = '2800';
const REAL_NEW_PHASE_MAIN1_HEX = '290400';
const REAL_DRAW_HEX =
  '5a000500000012350c000a00000011350c000a00000010350c000a0000000f350c000a0000000e350c000a000000';
const REAL_MOVE_DESTROY_HEX = '32e617b42c010400000000010000000110000000000500000021000000';

describe('parseDamageOrRecover (MSG_DAMAGE / MSG_RECOVER)', () => {
  it('parse un payload réel : 1400 dégâts à l’équipe 1 (1900 ATK vs 500 ATK)', () => {
    expect(parseDamageOrRecover(Buffer.from(REAL_DAMAGE_HEX, 'hex'))).toEqual({ team: 1, amount: 1400 });
  });
});

describe('parseNewTurn / parseNewPhase', () => {
  it('parse MSG_NEW_TURN', () => {
    expect(parseNewTurn(Buffer.from(REAL_NEW_TURN_HEX, 'hex'))).toBe(0);
  });

  it('parse MSG_NEW_PHASE (Main Phase 1)', () => {
    expect(parseNewPhase(Buffer.from(REAL_NEW_PHASE_MAIN1_HEX, 'hex'))).toBe(0x04);
  });
});

describe('parseDraw', () => {
  it('parse un payload réel : 5 cartes piochées par l’équipe 0', () => {
    const parsed = parseDraw(Buffer.from(REAL_DRAW_HEX, 'hex'));
    expect(parsed.team).toBe(0);
    expect(parsed.codes).toEqual([800018, 800017, 800016, 800015, 800014]);
  });
});

describe('parseMove', () => {
  it('parse un payload réel : cible détruite au combat (MZONE -> GRAVE, REASON_DESTROY|REASON_BATTLE)', () => {
    const parsed = parseMove(Buffer.from(REAL_MOVE_DESTROY_HEX, 'hex'));
    expect(parsed.code).toBe(750000102);
    expect(parsed.previous).toEqual({ controller: 1, location: Location.MZONE, sequence: 0, position: 1 });
    expect(parsed.current).toEqual({ controller: 1, location: Location.GRAVE, sequence: 0, position: 5 });
    expect(parsed.reason).toBe(0x21); // REASON_DESTROY (0x1) | REASON_BATTLE (0x20)
  });
});

/**
 * Format confirmé en lisant directement field::process(SelectChain) dans
 * playerop.cpp (edo9300/ygopro-core, master) : DIFFÉRENT de la liste
 * "activatable" de MSG_SELECT_IDLECMD/BATTLECMD (celles-ci omettent
 * `position`, ici `pcard->get_info_location()` l'inclut — 4 champs, pas 3).
 */
describe('parseSelectChain (MSG_SELECT_CHAIN)', () => {
  it('parse un payload avec une option de chaîne proposée (pas seulement "passer")', () => {
    const parts: Buffer[] = [
      Buffer.from([16, 1, 0, 0]), // type, playerid=1, spe_count=0, forced=0
      Buffer.alloc(4), // hint_timing (joueur)
      Buffer.alloc(4), // hint_timing (adversaire)
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(1, 0); // count = 1 option
        return b;
      })(),
      (() => {
        const b = Buffer.alloc(4 + 1 + 1 + 4 + 4 + 8 + 1);
        let off = 0;
        b.writeUInt32LE(12580477, off);
        off += 4;
        b.writeUInt8(1, off); // controller
        off += 1;
        b.writeUInt8(Location.MZONE, off);
        off += 1;
        b.writeUInt32LE(0, off); // sequence
        off += 4;
        b.writeUInt32LE(Position.FACEUP_ATTACK, off); // position (absent de "activatable" ailleurs)
        off += 4;
        b.writeBigUInt64LE(0n, off); // description
        off += 8;
        b.writeUInt8(0, off); // client_mode
        return b;
      })(),
    ];
    const parsed = parseSelectChain(Buffer.concat(parts));
    expect(parsed.playerid).toBe(1);
    expect(parsed.forced).toBe(false);
    expect(parsed.options).toEqual([
      { code: 12580477, controller: 1, location: Location.MZONE, sequence: 0, position: Position.FACEUP_ATTACK, description: 0n },
    ]);
  });

  it('parse un payload sans option (seul "passer" est possible)', () => {
    const buf = Buffer.concat([Buffer.from([16, 0, 0, 1]), Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]);
    const parsed = parseSelectChain(buf);
    expect(parsed.forced).toBe(true);
    expect(parsed.options).toEqual([]);
  });
});

/**
 * Format confirmé en lisant directement OCG_DuelQueryLocation (ocgapi.cpp)
 * et card::get_infos (card.cpp) : un préfixe uint32 = taille totale, puis par
 * emplacement soit un int16=0 (zone vide, mzone/szone seulement), soit une
 * suite d'entrées TLV [uint16 taille][uint32 flag QUERY_*][valeur] terminée
 * par une entrée QUERY_END. Aucun compteur de cartes explicite : on avance
 * jusqu'à épuiser `taille totale`.
 */
describe('parseQueryLocation (réponse à QUERY_LOCATION)', () => {
  function tlvEntry(flag: number, valueBytes: Buffer): Buffer {
    const entryLen = 4 + valueBytes.length;
    const b = Buffer.alloc(2 + entryLen);
    b.writeUInt16LE(entryLen, 0);
    b.writeUInt32LE(flag, 2);
    valueBytes.copy(b, 6);
    return b;
  }
  function queryEnd(): Buffer {
    const b = Buffer.alloc(6);
    b.writeUInt16LE(4, 0);
    b.writeUInt32LE(QUERY_END, 2);
    return b;
  }
  function u32(v: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    return b;
  }
  function i32(v: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    return b;
  }

  it('emplacement vide (mzone/szone) : int16 = 0', () => {
    const body = Buffer.from([0, 0]); // un seul emplacement vide
    const raw = Buffer.concat([u32(body.length), body]);
    expect(parseQueryLocation(raw)).toEqual([null]);
  });

  it('un emplacement occupé entre deux vides — décode code/position/attaque/défense', () => {
    const cardEntries = Buffer.concat([
      tlvEntry(QUERY_CODE, u32(12580477)),
      tlvEntry(QUERY_POSITION, u32(Position.FACEUP_ATTACK)),
      tlvEntry(QUERY_ATTACK, i32(2400)),
      tlvEntry(QUERY_DEFENSE, i32(2000)),
      queryEnd(),
    ]);
    const body = Buffer.concat([Buffer.from([0, 0]), cardEntries, Buffer.from([0, 0])]);
    const raw = Buffer.concat([u32(body.length), body]);
    const slots = parseQueryLocation(raw);
    expect(slots).toEqual([
      null,
      { code: 12580477, position: Position.FACEUP_ATTACK, attack: 2400, defense: 2000, overlayCodes: [], counters: [] },
      null,
    ]);
  });

  it('buffer vide (rien à cette zone) : liste vide', () => {
    expect(parseQueryLocation(Buffer.alloc(0))).toEqual([]);
  });
});

/**
 * Formats confirmés en lisant directement field::process(SelectTributeP),
 * field::process(SelectPosition) et field::process(SelectOption) dans
 * playerop.cpp (edo9300/ygopro-core, master).
 */
describe('parseSelectTribute (MSG_SELECT_TRIBUTE)', () => {
  it('parse un payload avec deux tributs proposés (release_param à la place de position)', () => {
    const parts: Buffer[] = [
      Buffer.from([20, 0, 1]), // type, playerid=0, cancelable=1 (cancelable || min===0)
      (() => {
        const b = Buffer.alloc(4 + 4 + 4);
        b.writeUInt32LE(1, 0); // min
        b.writeUInt32LE(2, 4); // max
        b.writeUInt32LE(2, 8); // count
        return b;
      })(),
      (() => {
        const b = Buffer.alloc((4 + 1 + 1 + 4 + 1) * 2);
        let off = 0;
        b.writeUInt32LE(91152256, off); off += 4; // Celtic Guardian
        b.writeUInt8(0, off); off += 1; // controller
        b.writeUInt8(Location.MZONE, off); off += 1;
        b.writeUInt32LE(0, off); off += 4; // sequence
        b.writeUInt8(1, off); off += 1; // release_param
        b.writeUInt32LE(41392891, off); off += 4; // Feral Imp
        b.writeUInt8(0, off); off += 1;
        b.writeUInt8(Location.MZONE, off); off += 1;
        b.writeUInt32LE(1, off); off += 4;
        b.writeUInt8(1, off);
        return b;
      })(),
    ];
    const parsed = parseSelectTribute(Buffer.concat(parts));
    expect(parsed.playerid).toBe(0);
    expect(parsed.cancelable).toBe(true);
    expect(parsed.min).toBe(1);
    expect(parsed.max).toBe(2);
    expect(parsed.cards).toEqual([
      { code: 91152256, controller: 0, location: Location.MZONE, sequence: 0, releaseParam: 1 },
      { code: 41392891, controller: 0, location: Location.MZONE, sequence: 1, releaseParam: 1 },
    ]);
  });
});

describe('parseSelectPosition (MSG_SELECT_POSITION)', () => {
  it('parse un payload réel : choix entre Attaque et Défense (face visible)', () => {
    const buf = Buffer.from([19, 0, 0xda, 0xbb, 0x0d, 0x00, Position.FACEUP_ATTACK | Position.FACEUP_DEFENSE]);
    const parsed = parseSelectPosition(buf);
    expect(parsed).toEqual({ playerid: 0, code: 0x000dbbda, positions: Position.FACEUP_ATTACK | Position.FACEUP_DEFENSE });
  });
});

describe('encodeSelectPositionResponse', () => {
  it('encode un seul bit de position en int32 LE', () => {
    expect(encodeSelectPositionResponse(Position.FACEUP_DEFENSE).readInt32LE(0)).toBe(Position.FACEUP_DEFENSE);
  });
});

describe('parseSelectOption (MSG_SELECT_OPTION)', () => {
  it('parse un payload à 2 options (pas de carte associée, juste des descriptions)', () => {
    const buf = Buffer.concat([Buffer.from([14, 1, 2]), (() => {
      const b = Buffer.alloc(16);
      b.writeBigUInt64LE(111n, 0);
      b.writeBigUInt64LE(222n, 8);
      return b;
    })()]);
    const parsed = parseSelectOption(buf);
    expect(parsed).toEqual({ playerid: 1, options: [111n, 222n] });
  });
});

describe('encodeSelectOptionResponse', () => {
  it('encode l’index choisi en int32 LE', () => {
    expect(encodeSelectOptionResponse(1).toString('hex')).toBe('01000000');
  });
});

/**
 * Payloads réels capturés en pilotant un vrai Duel Tag (2 duelists sur le
 * même camp, PV/terrain partagés — voir CLAUDE.md §7 pour le contexte et le
 * piège de rotation trouvé) contre le vrai moteur avant d'écrire ces tests.
 */
describe('parseTagSwap (MSG_TAG_SWAP)', () => {
  it('parse un payload réel : rotation vers Feral Imp (main à 1 carte, pas d’Extra Deck)', () => {
    const parsed = parseTagSwap(Buffer.from('a1000900000000000000000000000100000000000000fb9a77020a000000', 'hex'));
    expect(parsed.team).toBe(0);
    expect(parsed.mainCount).toBe(9);
    expect(parsed.extraCount).toBe(0);
    expect(parsed.hand).toEqual([{ code: 41392891, position: 10 }]);
    expect(parsed.extra).toEqual([]);
  });

  it('parse un payload réel : rotation vers Celtic Guardian', () => {
    const parsed = parseTagSwap(Buffer.from('a100090000000000000000000000010000000000000080df6e050a000000', 'hex'));
    expect(parsed.hand).toEqual([{ code: 91152256, position: 10 }]);
  });

  it('parse un payload réel avec 2 cartes en main (tour ultérieur du même duelist)', () => {
    const parsed = parseTagSwap(Buffer.from('a1000800000000000000000000000200000000000000fb9a77020a000000fb9a77020a000000', 'hex'));
    expect(parsed.mainCount).toBe(8);
    expect(parsed.hand).toEqual([
      { code: 41392891, position: 10 },
      { code: 41392891, position: 10 },
    ]);
  });
});

describe('encodeSelectCardResponse / encodeSelectCardCancel', () => {
  it('encode les index choisis (format type=2, indices uint8) — réponse validée contre le moteur réel', () => {
    // C'est exactement la réponse qui a fait détruire la cible dans le scénario de combat validé.
    expect(encodeSelectCardResponse([0]).toString('hex')).toBe('020000000100000000');
  });

  it('encode plusieurs index', () => {
    expect(encodeSelectCardResponse([0, 2]).toString('hex')).toBe('02000000020000000002');
  });

  it('encode une annulation', () => {
    expect(encodeSelectCardCancel().readInt32LE(0)).toBe(-1);
  });
});
