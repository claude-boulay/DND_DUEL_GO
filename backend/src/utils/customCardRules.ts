import { z } from 'zod';

/**
 * Vocabulaire des cartes custom. Repris au plus près des conventions
 * YGOPRODeck (mêmes noms de frame_type que les cartes officielles, pour que
 * isExtraDeckFrameType et le reste du pipeline deck/booster fonctionnent sans
 * distinction custom/officiel) mais c'est une reconstruction simplifiée, pas
 * une fidélité garantie au jeu réel (pas de Synchro Tuner, pas de Ritual
 * Effect distinct, etc.).
 */
export const MONSTER_KINDS = ['normal', 'effect', 'ritual', 'fusion', 'synchro', 'xyz', 'link'] as const;
export type MonsterKind = (typeof MONSTER_KINDS)[number];

export const ATTRIBUTES = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'] as const;
export type CardAttribute = (typeof ATTRIBUTES)[number];

export const SPELL_TYPES = ['normal', 'continuous', 'quick-play', 'equip', 'field', 'ritual'] as const;
export type SpellType = (typeof SPELL_TYPES)[number];

export const TRAP_TYPES = ['normal', 'continuous', 'counter'] as const;
export type TrapType = (typeof TRAP_TYPES)[number];

export const LINK_ARROWS = ['top', 'top-left', 'top-right', 'left', 'right', 'bottom-left', 'bottom-right', 'bottom'] as const;
export type LinkArrow = (typeof LINK_ARROWS)[number];

export const CUSTOM_RARITIES = [
  'Common',
  'Rare',
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Ultimate Rare',
  'Ghost Rare',
  'Starlight Rare',
] as const;

const MONSTER_KIND_LABELS: Record<MonsterKind, string> = {
  normal: 'Normal',
  effect: 'Effect',
  ritual: 'Ritual',
  fusion: 'Fusion',
  synchro: 'Synchro',
  xyz: 'Xyz',
  link: 'Link',
};

const SPELL_TYPE_LABELS: Record<SpellType, string> = {
  normal: 'Normal',
  continuous: 'Continuous',
  'quick-play': 'Quick-Play',
  equip: 'Equip',
  field: 'Field',
  ritual: 'Ritual',
};

const TRAP_TYPE_LABELS: Record<TrapType, string> = {
  normal: 'Normal',
  continuous: 'Continuous',
  counter: 'Counter',
};

const commonFieldsSchema = {
  name: z.string().trim().min(1).max(64),
  effect_text: z.string().trim().min(1).max(4000),
  image_url: z.string().trim().max(500).optional(),
  archetype: z.string().trim().max(64).optional(),
  // Second langue, optionnelle, saisie par le MJ (aucune traduction
  // automatique possible pour du contenu inventé — voir CLAUDE.md, plan
  // d'internationalisation §5). Absent = pas encore traduite, l'affichage
  // retombe alors sur name/effect_text.
  name_fr: z.string().trim().min(1).max(64).optional(),
  effect_text_fr: z.string().trim().min(1).max(4000).optional(),
};

const monsterSchema = z.object({
  category: z.literal('monster'),
  monster_kind: z.enum(MONSTER_KINDS),
  is_pendulum: z.boolean().default(false),
  attribute: z.enum(ATTRIBUTES),
  race: z.string().trim().min(1).max(40),
  atk: z.number().int().min(0).max(99999),
  def: z.number().int().min(0).max(99999).optional(),
  level_rank: z.number().int().min(0).max(13).optional(),
  link_rating: z.number().int().min(1).max(8).optional(),
  link_arrows: z.array(z.enum(LINK_ARROWS)).max(8).optional(),
  pendulum_scale: z.number().int().min(0).max(13).optional(),
  ...commonFieldsSchema,
});

const spellSchema = z.object({
  category: z.literal('spell'),
  spell_type: z.enum(SPELL_TYPES),
  ...commonFieldsSchema,
});

const trapSchema = z.object({
  category: z.literal('trap'),
  trap_type: z.enum(TRAP_TYPES),
  ...commonFieldsSchema,
});

export const customCardInputSchema = z
  .discriminatedUnion('category', [monsterSchema, spellSchema, trapSchema])
  .superRefine((val, ctx) => {
    if (val.category !== 'monster') return;

    const isLink = val.monster_kind === 'link';

    if (val.is_pendulum && isLink) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['is_pendulum'], message: 'Un monstre Link ne peut pas être Pendule' });
    }

    if (isLink) {
      if (val.link_rating === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['link_rating'], message: 'Link Rating requis pour un monstre Link' });
      }
      if (!val.link_arrows || val.link_arrows.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['link_arrows'], message: 'Au moins une flèche Link requise' });
      } else if (new Set(val.link_arrows).size !== val.link_arrows.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['link_arrows'], message: 'Flèches Link en double' });
      }
    } else {
      if (val.level_rank === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['level_rank'], message: 'Niveau/Rang requis' });
      }
      if (val.def === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['def'], message: 'DEF requise (sauf pour un monstre Link)' });
      }
    }

    if (val.is_pendulum && val.pendulum_scale === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pendulum_scale'], message: 'Échelle Pendule requise' });
    }
  });

export type CustomCardInput = z.infer<typeof customCardInputSchema>;

export interface DerivedCardFields {
  type: string;
  frame_type: string;
  race: string | null;
  attribute: string | null;
  level_rank: number | null;
  atk: number | null;
  def: number | null;
  pendulum_scale: number | null;
  link_arrows: string[];
}

/**
 * Traduit le formulaire structuré (catégorie + sous-type) vers les champs
 * plats du modèle Card partagé, en réutilisant exactement le vocabulaire
 * frame_type des cartes officielles (deckRules.isExtraDeckFrameType
 * fonctionne donc sans modification pour une carte custom).
 */
export function deriveCardFields(input: CustomCardInput): DerivedCardFields {
  if (input.category === 'monster') {
    const isLink = input.monster_kind === 'link';
    const kindLabel = MONSTER_KIND_LABELS[input.monster_kind];
    const type = `${input.is_pendulum ? 'Pendulum ' : ''}${kindLabel} Monster`;
    const frameType = `${input.monster_kind}${input.is_pendulum ? '_pendulum' : ''}`;

    return {
      type,
      frame_type: frameType,
      race: input.race,
      attribute: input.attribute,
      level_rank: isLink ? input.link_rating! : input.level_rank!,
      atk: input.atk,
      def: isLink ? null : input.def!,
      pendulum_scale: input.is_pendulum ? input.pendulum_scale! : null,
      link_arrows: isLink ? [...(input.link_arrows ?? [])] : [],
    };
  }

  const isSpell = input.category === 'spell';
  return {
    type: isSpell ? 'Spell Card' : 'Trap Card',
    frame_type: isSpell ? 'spell' : 'trap',
    race: isSpell ? SPELL_TYPE_LABELS[input.spell_type] : TRAP_TYPE_LABELS[input.trap_type],
    attribute: null,
    level_rank: null,
    atk: null,
    def: null,
    pendulum_scale: null,
    link_arrows: [],
  };
}
