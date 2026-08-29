import type { CustomCardStats } from '../services/ocgcoreClient';

/**
 * Traduit les champs plats du modèle Card (mêmes qu'utilisés partout
 * ailleurs dans l'app — frame_type/attribute/race en chaînes, convention
 * YGOPRODeck, voir customCardRules.ts) vers les bitflags attendus par
 * ocgcore (constantes TYPE_, ATTRIBUTE_ et RACE_, voir ocgapi_constants.h).
 * Ne sert que pour les cartes CUSTOM : les cartes officielles utilisent
 * directement les bitflags déjà corrects de BabelCDB (voir
 * engine/ocgcore/poc/server.cpp, CardReader) — aucune traduction nécessaire
 * pour elles.
 */

const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;
const TYPE_NORMAL = 0x10;
const TYPE_EFFECT = 0x20;
const TYPE_FUSION = 0x40;
const TYPE_RITUAL = 0x80;
const TYPE_SYNCHRO = 0x2000;
const TYPE_QUICKPLAY = 0x10000;
const TYPE_CONTINUOUS = 0x20000;
const TYPE_EQUIP = 0x40000;
const TYPE_FIELD = 0x80000;
const TYPE_COUNTER = 0x100000;
const TYPE_XYZ = 0x800000;
const TYPE_PENDULUM = 0x1000000;
const TYPE_LINK = 0x4000000;

const FRAME_TYPE_MONSTER_FLAGS: Record<string, number> = {
  normal: TYPE_NORMAL,
  effect: TYPE_EFFECT,
  ritual: TYPE_EFFECT | TYPE_RITUAL,
  fusion: TYPE_EFFECT | TYPE_FUSION,
  synchro: TYPE_EFFECT | TYPE_SYNCHRO,
  xyz: TYPE_EFFECT | TYPE_XYZ,
  link: TYPE_EFFECT | TYPE_LINK,
};

const SPELL_RACE_FLAGS: Record<string, number> = {
  Normal: 0,
  Continuous: TYPE_CONTINUOUS,
  'Quick-Play': TYPE_QUICKPLAY,
  Equip: TYPE_EQUIP,
  Field: TYPE_FIELD,
  Ritual: TYPE_RITUAL,
};

const TRAP_RACE_FLAGS: Record<string, number> = {
  Normal: 0,
  Continuous: TYPE_CONTINUOUS,
  Counter: TYPE_COUNTER,
};

const ATTRIBUTE_FLAGS: Record<string, number> = {
  EARTH: 0x01,
  WATER: 0x02,
  FIRE: 0x04,
  WIND: 0x08,
  LIGHT: 0x10,
  DARK: 0x20,
  DIVINE: 0x40,
};

/**
 * `race` est un champ libre côté carte custom (voir customCardRules.ts) —
 * cette table ne couvre que les noms de race standard (vocabulaire
 * YGOPRODeck). Une race custom non reconnue tombe sur RACE_WARRIOR par
 * défaut : les effets qui vérifient un type de race précis ("si ce monstre
 * est de Type Dragon") ne se déclencheront simplement pas correctement pour
 * une carte avec une race inventée — limite assumée, pas un bug caché.
 */
const RACE_FLAGS: Record<string, bigint> = {
  warrior: 0x1n,
  spellcaster: 0x2n,
  fairy: 0x4n,
  fiend: 0x8n,
  zombie: 0x10n,
  machine: 0x20n,
  aqua: 0x40n,
  pyro: 0x80n,
  rock: 0x100n,
  'winged beast': 0x200n,
  plant: 0x400n,
  insect: 0x800n,
  thunder: 0x1000n,
  dragon: 0x2000n,
  beast: 0x4000n,
  'beast-warrior': 0x8000n,
  dinosaur: 0x10000n,
  fish: 0x20000n,
  'sea serpent': 0x40000n,
  reptile: 0x80000n,
  psychic: 0x100000n,
  'divine-beast': 0x200000n,
  'creator god': 0x400000n,
  wyrm: 0x800000n,
  cyberse: 0x1000000n,
  illusion: 0x2000000n,
};
const DEFAULT_RACE_FLAG = RACE_FLAGS.warrior!;

function raceFlag(race: string): bigint {
  return RACE_FLAGS[race.trim().toLowerCase()] ?? DEFAULT_RACE_FLAG;
}

export interface EngineMappableCard {
  frame_type: string;
  attribute: string | null;
  race: string | null;
  level_rank: number | null;
  pendulum_scale: number | null;
  atk: number | null;
  def: number | null;
}

/** Construit les stats moteur (CUSTOMCARD) à partir des champs plats d'une carte custom. */
export function engineStatsForCustomCard(card: EngineMappableCard): CustomCardStats {
  const baseFrame = card.frame_type.replace('_pendulum', '');
  const isPendulum = card.frame_type.endsWith('_pendulum');

  if (baseFrame === 'spell' || baseFrame === 'trap') {
    const isSpell = baseFrame === 'spell';
    const subtypeFlags = (isSpell ? SPELL_RACE_FLAGS : TRAP_RACE_FLAGS)[card.race ?? 'Normal'] ?? 0;
    return {
      type: (isSpell ? TYPE_SPELL : TYPE_TRAP) | subtypeFlags,
      level: 0,
      attribute: 0,
      race: 0n,
      atk: 0,
      def: 0,
    };
  }

  const monsterFlags = FRAME_TYPE_MONSTER_FLAGS[baseFrame] ?? TYPE_EFFECT;
  return {
    type: TYPE_MONSTER | monsterFlags | (isPendulum ? TYPE_PENDULUM : 0),
    level: card.level_rank ?? 0,
    attribute: ATTRIBUTE_FLAGS[card.attribute ?? ''] ?? 0,
    race: raceFlag(card.race ?? 'Warrior'),
    atk: card.atk ?? 0,
    def: card.def ?? 0,
  };
}
