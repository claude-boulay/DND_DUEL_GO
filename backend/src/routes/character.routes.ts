import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import multer from 'multer';
import { parse as csvParse } from 'csv-parse/sync';
import { Character, type CharacterDocument } from '../models/Character.model';
import { Card } from '../models/Card.model';
import { CardSet } from '../models/CardSet.model';
import { AppError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { isSessionGm, isSessionMember } from '../utils/sessionMembership';
import { validatePointBuy } from '../utils/pointBuy';
import { maxLuckRerolls } from '../utils/luck';
import { loadSessionOrThrow } from '../utils/loaders';
import { drawBoosterPack, isRareReveal, rarityForSet } from '../utils/boosterOpening';
import { importCardsForSet, importCardsByIds } from '../services/cardImport';
import { broadcastSessionResourceChanged } from '../utils/broadcast';
import { toCardDto } from '../utils/cardDto';
import { resolveCardSet } from '../utils/resolveCardSet';
import { EXTRA_DECK_MAX, MAIN_DECK_MAX, MAIN_DECK_MIN, MAX_COPIES_PER_CARD, isExtraDeckFrameType } from '../utils/deckRules';
import { CUSTOM_CODE_BASE } from '../utils/engineCardCode';

export const characterRouter = Router();
characterRouter.use(requireAuth);

const statsSchema = z.object({
  history: z.number(),
  perception: z.number(),
  intelligence: z.number(),
  charisma: z.number(),
  luck: z.number(),
});

function toCharacterDto(character: CharacterDocument, isGm: boolean) {
  return {
    id: character._id.toString(),
    user_id: character.user_id.toString(),
    game_session_id: character.game_session_id.toString(),
    name: character.name,
    is_npc: character.is_npc,
    level: character.level,
    experience: character.experience,
    money: character.money,
    backstory: character.backstory,
    personality: character.personality,
    visual_description: character.visual_description,
    notes: character.notes,
    // Jamais exposé au propriétaire du personnage, même le sien — voir
    // Character.model.ts. `undefined` est retiré par JSON.stringify, donc
    // absent du fil pour un joueur, quel que soit ce personnage.
    gm_notes: isGm ? character.gm_notes : undefined,
    stats: character.stats,
    remaining_luck_rerolls: character.remaining_luck_rerolls,
    inventory: character.inventory,
    collection: character.collection,
    sealed_boosters: character.sealed_boosters,
    decks: character.decks.map((deck) => ({
      id: deck._id.toString(),
      name: deck.name,
      cards: deck.cards,
    })),
  };
}

async function loadCharacterOrThrow(characterId: string) {
  if (!Types.ObjectId.isValid(characterId)) throw new AppError(404, 'Personnage introuvable', 'not_found');
  const character = await Character.findById(characterId);
  if (!character) throw new AppError(404, 'Personnage introuvable', 'not_found');
  return character;
}

function assertCanManageCharacter(
  character: CharacterDocument,
  session: Awaited<ReturnType<typeof loadSessionOrThrow>>,
  userId: string,
): void {
  const isOwner = character.user_id.toString() === userId;
  const isGm = isSessionGm(session, userId);
  if (!isOwner && !isGm) {
    throw new AppError(403, 'Vous ne pouvez pas modifier ce personnage', 'forbidden');
  }
}

const createCharacterSchema = z.object({
  game_session_id: z.string(),
  name: z.string().trim().min(1).max(64),
  is_npc: z.boolean().default(false),
  stats: statsSchema,
  backstory: z.string().max(5000).default(''),
  personality: z.string().max(2000).default(''),
  visual_description: z.string().max(2000).default(''),
});

characterRouter.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const body = createCharacterSchema.parse(req.body);
    const userId = req.user!.sub;

    if (!Types.ObjectId.isValid(body.game_session_id)) {
      throw new AppError(400, 'game_session_id invalide', 'invalid_input');
    }
    const session = await loadSessionOrThrow(body.game_session_id);
    if (!isSessionMember(session, userId)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    if (body.is_npc && !isSessionGm(session, userId)) {
      throw new AppError(403, 'Seul le MJ peut créer un NPC', 'forbidden');
    }
    // Un seul personnage JOUEUR par utilisateur et par salon (demande
    // utilisateur explicite, en vue du calcul automatique du modificateur de
    // stat lors des lancers de dés — plusieurs personnages joueurs pour un
    // même compte rendrait "le" modificateur ambigu). Le MJ, lui, ne peut
    // JAMAIS créer de personnage joueur, uniquement des NPC — il n'a donc
    // jamais besoin d'être exempté de cette règle.
    if (!body.is_npc) {
      if (isSessionGm(session, userId)) {
        throw new AppError(403, 'Le MJ ne peut créer que des PNJ, pas de personnage joueur', 'forbidden');
      }
      const existingPlayerCharacter = await Character.findOne({ game_session_id: session._id, user_id: userId, is_npc: false });
      if (existingPlayerCharacter) {
        throw new AppError(409, 'Vous avez déjà un personnage joueur dans ce salon', 'already_has_character');
      }
    }

    validatePointBuy(body.stats);

    const character = await Character.create({
      user_id: new Types.ObjectId(userId),
      game_session_id: session._id,
      name: body.name,
      is_npc: body.is_npc,
      level: 1,
      experience: 0,
      money: 0,
      backstory: body.backstory,
      personality: body.personality,
      visual_description: body.visual_description,
      stats: body.stats,
      remaining_luck_rerolls: maxLuckRerolls(body.stats.luck, 1),
      inventory: [],
      collection: [],
      decks: [],
    });

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.status(201).json({ character: toCharacterDto(character, isSessionGm(session, userId)) });
  }),
);

characterRouter.get(
  '/session/:sessionId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = req.params.sessionId!;
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new AppError(400, 'Identifiant de salon invalide', 'invalid_input');
    }
    const session = await loadSessionOrThrow(sessionId);
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const isGm = isSessionGm(session, req.user!.sub);
    const characters = await Character.find({ game_session_id: session._id }).sort({ createdAt: 1 });
    res.json({ characters: characters.map((c) => toCharacterDto(c, isGm)) });
  }),
);

/**
 * "Long repos" (demande utilisateur) : le MJ recharge d'un coup les rerolls
 * de Chance de TOUS les personnages du salon (joueurs et PNJ) à leur
 * maximum — même formule/calcul que le rechargement individuel déjà fait à
 * la création ou à un changement de stats/niveau (`maxLuckRerolls`, voir la
 * route PATCH /:id ci-dessus), juste appliqué à tout le salon en une seule
 * action plutôt qu'individuellement. Réservé au MJ (une ressource partagée
 * du salon, pas celle d'un personnage précis — pas de notion de
 * "propriétaire" pertinente ici, contrairement à PATCH/DELETE /:id).
 */
characterRouter.post(
  '/session/:sessionId/long-rest',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const sessionId = req.params.sessionId!;
    if (!Types.ObjectId.isValid(sessionId)) {
      throw new AppError(400, 'Identifiant de salon invalide', 'invalid_input');
    }
    const session = await loadSessionOrThrow(sessionId);
    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut déclencher un long repos', 'forbidden');
    }

    const characters = await Character.find({ game_session_id: session._id }).sort({ createdAt: 1 });
    await Promise.all(
      characters.map((character) => {
        character.remaining_luck_rerolls = maxLuckRerolls(character.stats.luck, character.level);
        return character.save();
      }),
    );

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    // GM-only route (voir le garde ci-dessus) : toujours vrai ici.
    res.json({ characters: characters.map((c) => toCharacterDto(c, true)) });
  }),
);

characterRouter.get(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    res.json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

characterRouter.get(
  '/:id/collection',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }

    const counts = new Map<string, number>();
    // Position de la première occurrence : la collection n'a pas de vrai
    // timestamp par carte, mais les cartes y sont toujours empilées dans
    // l'ordre d'acquisition (achat, ouverture de booster, don du MJ) — cet
    // index sert donc de proxy fidèle pour un tri "ordre d'acquisition".
    const firstIndex = new Map<string, number>();
    character.collection.forEach((cardId, index) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
      if (!firstIndex.has(cardId)) firstIndex.set(cardId, index);
    });

    const cards = await Card.find({ _id: { $in: [...counts.keys()] } }).sort({ name: 1 });

    // Date de sortie : une carte apparaît dans plusieurs sets (card_sets),
    // chacun avec sa propre date (CardSet.tcg_date) ; on retient la plus
    // ancienne comme date de première parution de la carte.
    const setNames = [...new Set(cards.flatMap((card) => card.card_sets.map((s) => s.set_name)))];
    const referencedSets = setNames.length ? await CardSet.find({ set_name: { $in: setNames } }) : [];
    const tcgDateBySetName = new Map(referencedSets.map((s) => [s.set_name, s.tcg_date]));

    const entries = cards.map((card) => {
      const knownDates = card.card_sets
        .map((s) => tcgDateBySetName.get(s.set_name))
        .filter((d): d is string => !!d)
        .sort();
      return {
        card: toCardDto(card),
        quantity: counts.get(card._id.toString()) ?? 0,
        release_date: knownDates[0] ?? null,
        acquired_order: firstIndex.get(card._id.toString()) ?? 0,
      };
    });

    res.json({ collection: entries });
  }),
);

const openBoosterSchema = z.object({
  // Préféré (voir CLAUDE.md — set_code seul n'identifie pas un set de façon
  // fiable) : référence sans ambiguïté LE CardSet précis dont ce booster
  // scellé provient. Optionnel uniquement pour une entrée sealed_boosters
  // créée avant ce correctif (card_set_id encore null côté personnage) —
  // set_code reste alors le seul repère possible, ambigu comme avant dans
  // ce seul cas résiduel.
  card_set_id: z.string().trim().optional(),
  set_code: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(20).default(1),
});

characterRouter.post(
  '/:id/open-booster',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    const userId = req.user!.sub;

    const isOwner = character.user_id.toString() === userId;
    const isGm = isSessionGm(session, userId);
    if (!isOwner && !isGm) {
      throw new AppError(403, 'Vous ne pouvez pas ouvrir les boosters de ce personnage', 'forbidden');
    }

    const { card_set_id, set_code, quantity } = openBoosterSchema.parse(req.body);

    const sealedEntry = character.sealed_boosters.find((b) =>
      card_set_id ? b.card_set_id?.toString() === card_set_id : b.set_code === set_code,
    );
    if (!sealedEntry || sealedEntry.quantity < quantity) {
      throw new AppError(400, 'Pas assez de boosters scellés de ce set', 'insufficient_boosters');
    }

    // Repli précis par (set_code, set_name) quand card_set_id manque (voir
    // resolveCardSet) : sealedEntry.set_name est déjà connu même pour une
    // entrée créée avant l'introduction de card_set_id, donc reste fiable
    // sans nécessiter de migration des données existantes.
    const cardSet = await resolveCardSet({ cardSetId: card_set_id, setCode: set_code, setName: sealedEntry.set_name });
    if (!cardSet) throw new AppError(404, 'Set introuvable', 'not_found');

    // Un set custom (créé depuis le créateur de cartes) est toujours "prêt".
    // Un set officiel jamais importé est importé à la volée ici : on ne peut
    // PAS se fier à "le pool de cartes est non vide" pour savoir s'il est
    // prêt — le champ card_sets d'une carte YGOPRODeck liste TOUS les
    // produits où elle a été réimprimée, pas seulement celui par lequel elle
    // a été importée chez nous. Un set jamais importé peut donc avoir un pool
    // non vide s'il partage une carte réimprimée avec un autre set déjà
    // importé ; sans vérifier explicitement imported_at, le booster
    // s'ouvrirait sur ce pool contaminé (quelques cartes en boucle) au lieu
    // des vraies cartes du set. L'import réel (fetchCardsBySet) résout ça :
    // il rapatrie l'intégralité des cartes propres à CE set.
    if (!cardSet.is_custom && !cardSet.imported_at) {
      try {
        await importCardsForSet(cardSet._id.toString());
      } catch (error) {
        throw new AppError(
          400,
          `Import automatique des cartes de ce set impossible : ${error instanceof Error ? error.message : String(error)}`,
          'import_failed',
        );
      }

      // importCardsForSet ne marque imported_at que s'il a réellement trouvé
      // des cartes pour CE set. S'il n'a rien trouvé, il faut refuser ici —
      // sinon on retomberait sur le pool ci-dessous qui, lui, peut être non
      // vide UNIQUEMENT à cause d'une carte réimprimée d'un set différent
      // déjà importé (la contamination que ce garde-fou entier vise à éviter).
      const refreshed = await CardSet.findById(cardSet._id);
      if (!refreshed?.imported_at) {
        throw new AppError(400, "Aucune carte trouvée sur YGOPRODeck pour ce set", 'set_not_imported');
      }
    }

    const pool = await Card.find({ 'card_sets.set_name': cardSet.set_name });
    if (pool.length === 0) {
      throw new AppError(400, 'Ce set ne contient aucune carte importable', 'set_not_imported');
    }

    const openedCards = Array.from({ length: quantity }).flatMap(() => drawBoosterPack(pool, cardSet.set_name));

    sealedEntry.quantity -= quantity;
    if (sealedEntry.quantity === 0) {
      character.sealed_boosters = character.sealed_boosters.filter((b) =>
        card_set_id ? b.card_set_id?.toString() !== card_set_id : b.set_code !== set_code,
      );
    }
    character.collection.push(...openedCards.map((c) => c._id.toString()));
    await character.save();

    res.json({
      character: toCharacterDto(character, isGm),
      opened_cards: openedCards.map((card) => {
        const rarity = rarityForSet(card, cardSet.set_name);
        return {
          id: card._id.toString(),
          name: card.name,
          type: card.type,
          card_images: card.card_images,
          rarity,
          // Grande révélation (agrandissement + brillance) côté front pour
          // les tirages Super Rare et plus rares.
          is_rare_reveal: isRareReveal(rarity),
        };
      }),
    });
  }),
);

const addCardSchema = z.object({
  card_id: z.string(),
  quantity: z.number().int().min(1).max(999).default(1),
});

/**
 * Le MJ ajoute N exemplaires d'une carte précise (choisie via recherche côté
 * front) à la collection d'un personnage — CLAUDE.md §3.5 "Option pour le MJ
 * d'ajouter une ou plusieurs cartes à un joueur". Volontairement GM-only
 * (pas `assertCanManageCharacter`, qui autorise aussi le propriétaire) : un
 * joueur ne doit jamais pouvoir se créditer lui-même des cartes, exactement
 * la même logique déjà appliquée à `PATCH /:id` pour l'argent.
 */
characterRouter.post(
  '/:id/collection/add-card',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut ajouter des cartes à la collection d’un personnage', 'forbidden');
    }

    const { card_id: cardId, quantity } = addCardSchema.parse(req.body);
    if (!Types.ObjectId.isValid(cardId)) throw new AppError(400, 'Identifiant de carte invalide', 'invalid_input');
    const card = await Card.findById(cardId);
    if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');

    character.collection.push(...Array(quantity).fill(cardId));
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    // GM-only route (voir le garde ci-dessus) : toujours vrai ici.
    res.json({ character: toCharacterDto(character, true), added: { card: toCardDto(card), quantity } });
  }),
);

const csvImportUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

interface CsvImportRowResult {
  cardname: string;
  cardid: string;
  quantity: number;
}
interface CsvImportSkipped {
  row: number;
  cardname: string;
  reason: string;
}

/**
 * Migration d'une collection déjà existante (autre outil/partie précédente)
 * via un CSV — colonnes confirmées en direct : c'est exactement le format
 * d'export "My Collection" de YGOPRODeck (cardname,cardq,cardrarity,
 * card_edition,cardset,cardcode,cardid,print_id). On matche par `cardid`
 * (= ygoprodeck_id, le passcode officiel — bien plus fiable qu'un
 * rapprochement par nom/set) ; toute carte absente de notre base est
 * importée à la volée (voir importCardsByIds) plutôt que de bloquer toute la
 * migration sur des sets jamais importés manuellement ici.
 */
characterRouter.post(
  '/:id/collection/import-csv',
  (req, res, next) => {
    csvImportUpload.single('csv')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          next(new AppError(400, 'Fichier CSV trop lourd (2 Mo maximum)', 'invalid_input'));
          return;
        }
        next(err instanceof AppError ? err : new AppError(400, 'Envoi du fichier CSV impossible', 'invalid_input'));
        return;
      }
      next();
    });
  },
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut importer une collection pour un personnage', 'forbidden');
    }
    if (!req.file) throw new AppError(400, 'Aucun fichier CSV reçu', 'invalid_input');

    let records: Record<string, string>[];
    try {
      // bom: true retire le BOM UTF-8 en tête de fichier (présent dans
      // l'export YGOPRODeck réel, confirmé sur un exemple fourni).
      records = csvParse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw new AppError(400, `CSV invalide : ${err instanceof Error ? err.message : String(err)}`, 'invalid_input');
    }

    const parsed: CsvImportRowResult[] = [];
    const skipped: CsvImportSkipped[] = [];
    records.forEach((row, index) => {
      const cardname = row.cardname?.trim() || '(sans nom)';
      const cardidRaw = row.cardid?.trim();
      const cardid = cardidRaw ? Number(cardidRaw) : NaN;
      const quantityRaw = row.cardq?.trim();
      const quantity = quantityRaw ? Number(quantityRaw) : 1;
      if (!cardidRaw || !Number.isInteger(cardid) || cardid <= 0) {
        skipped.push({ row: index + 2, cardname, reason: 'colonne cardid manquante ou invalide' });
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        skipped.push({ row: index + 2, cardname, reason: 'colonne cardq manquante ou invalide' });
        return;
      }
      parsed.push({ cardname, cardid: String(cardid), quantity });
    });

    const uniqueIds = [...new Set(parsed.map((r) => Number(r.cardid)))];
    const { foundIds } = await importCardsByIds(uniqueIds);

    const notFound = parsed.filter((r) => !foundIds.has(Number(r.cardid)));
    const toAdd = parsed.filter((r) => foundIds.has(Number(r.cardid)));

    const cards = toAdd.length > 0 ? await Card.find({ ygoprodeck_id: { $in: toAdd.map((r) => Number(r.cardid)) } }) : [];
    const cardByYgoId = new Map(cards.map((c) => [c.ygoprodeck_id, c]));

    let totalCopiesAdded = 0;
    const added: Array<{ card_name: string; quantity: number }> = [];
    for (const row of toAdd) {
      const card = cardByYgoId.get(Number(row.cardid));
      if (!card) continue; // ne devrait jamais arriver (foundIds vient de la même requête), garde défensive
      character.collection.push(...Array(row.quantity).fill(card._id.toString()));
      totalCopiesAdded += row.quantity;
      added.push({ card_name: card.name, quantity: row.quantity });
    }
    if (totalCopiesAdded > 0) await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    // GM-only route (voir le garde ci-dessus) : toujours vrai ici.
    res.json({
      character: toCharacterDto(character, true),
      summary: {
        total_copies_added: totalCopiesAdded,
        added,
        not_found: notFound.map((r) => ({ cardname: r.cardname, cardid: r.cardid })),
        skipped,
      },
    });
  }),
);

const createDeckSchema = z.object({ name: z.string().trim().min(1).max(64) });

characterRouter.post(
  '/:id/decks',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    assertCanManageCharacter(character, session, req.user!.sub);

    const { name } = createDeckSchema.parse(req.body);
    character.decks.push({ _id: new Types.ObjectId(), name, cards: [] });
    await character.save();

    // Rend le nouveau deck immédiatement visible au MJ (et tout autre
    // spectateur de la partie) sans attendre une action qui redéclenche un
    // fetch — même convention que les autres mutations de personnage.
    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.status(201).json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

function findDeckOrThrow(character: CharacterDocument, deckId: string) {
  const deck = character.decks.find((d) => d._id.toString() === deckId);
  if (!deck) throw new AppError(404, 'Deck introuvable', 'not_found');
  return deck;
}

characterRouter.get(
  '/:id/decks/:deckId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionMember(session, req.user!.sub)) {
      throw new AppError(403, "Vous n'êtes pas membre de ce salon", 'forbidden');
    }
    const deck = findDeckOrThrow(character, req.params.deckId!);

    const counts = new Map<string, number>();
    for (const cardId of deck.cards) counts.set(cardId, (counts.get(cardId) ?? 0) + 1);

    const cards = await Card.find({ _id: { $in: [...counts.keys()] } });
    const cardsById = new Map(cards.map((c) => [c._id.toString(), c]));

    const main: Array<{ card: ReturnType<typeof toCardDto>; quantity: number }> = [];
    const extra: Array<{ card: ReturnType<typeof toCardDto>; quantity: number }> = [];

    for (const [cardId, quantity] of counts) {
      const card = cardsById.get(cardId);
      if (!card) continue; // carte disparue du cache entre-temps : ignorée à l'affichage
      const entry = { card: toCardDto(card), quantity };
      (isExtraDeckFrameType(card.frame_type) ? extra : main).push(entry);
    }

    const mainCount = main.reduce((sum, e) => sum + e.quantity, 0);
    const extraCount = extra.reduce((sum, e) => sum + e.quantity, 0);

    res.json({
      deck: {
        id: deck._id.toString(),
        name: deck.name,
        main,
        extra,
        main_count: mainCount,
        extra_count: extraCount,
        main_min: MAIN_DECK_MIN,
        main_max: MAIN_DECK_MAX,
        extra_max: EXTRA_DECK_MAX,
        is_valid: mainCount >= MAIN_DECK_MIN && mainCount <= MAIN_DECK_MAX && extraCount <= EXTRA_DECK_MAX,
      },
    });
  }),
);

const updateDeckSchema = z.object({ name: z.string().trim().min(1).max(64) });

characterRouter.patch(
  '/:id/decks/:deckId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    assertCanManageCharacter(character, session, req.user!.sub);
    const deck = findDeckOrThrow(character, req.params.deckId!);

    const { name } = updateDeckSchema.parse(req.body);
    deck.name = name;
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

characterRouter.delete(
  '/:id/decks/:deckId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    assertCanManageCharacter(character, session, req.user!.sub);

    const index = character.decks.findIndex((d) => d._id.toString() === req.params.deckId);
    if (index === -1) throw new AppError(404, 'Deck introuvable', 'not_found');

    character.decks.splice(index, 1);
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

const addDeckCardSchema = z.object({
  card_id: z.string(),
  quantity: z.number().int().min(1).max(MAX_COPIES_PER_CARD).default(1),
});

characterRouter.post(
  '/:id/decks/:deckId/cards',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    assertCanManageCharacter(character, session, req.user!.sub);
    const deck = findDeckOrThrow(character, req.params.deckId!);

    const { card_id, quantity } = addDeckCardSchema.parse(req.body);
    if (!Types.ObjectId.isValid(card_id)) throw new AppError(400, 'card_id invalide', 'invalid_input');

    const card = await Card.findById(card_id);
    if (!card) throw new AppError(404, 'Carte introuvable', 'not_found');

    const currentInDeck = deck.cards.filter((id) => id === card_id).length;

    // Les decks de PNJ construits par le MJ ne sont pas adossés à une
    // collection : le MJ compose librement l'adversaire.
    if (!character.is_npc) {
      const ownedCopies = character.collection.filter((id) => id === card_id).length;
      if (currentInDeck + quantity > ownedCopies) {
        throw new AppError(
          400,
          `Vous ne possédez que ${ownedCopies} exemplaire(s) de « ${card.name} » dans votre collection`,
          'not_owned',
          { owned: ownedCopies, name: card.name },
        );
      }
    }

    if (currentInDeck + quantity > MAX_COPIES_PER_CARD) {
      throw new AppError(400, `Maximum ${MAX_COPIES_PER_CARD} exemplaires de « ${card.name} » par deck`, 'copy_limit', {
        max: MAX_COPIES_PER_CARD,
        name: card.name,
      });
    }

    const existingCardIds = [...new Set(deck.cards)];
    const existingCards = existingCardIds.length ? await Card.find({ _id: { $in: existingCardIds } }) : [];
    const frameById = new Map(existingCards.map((c) => [c._id.toString(), c.frame_type]));
    frameById.set(card_id, card.frame_type);

    const isExtra = isExtraDeckFrameType(card.frame_type);
    const zoneCount = deck.cards.filter((id) => isExtraDeckFrameType(frameById.get(id) ?? '') === isExtra).length;

    if (isExtra && zoneCount + quantity > EXTRA_DECK_MAX) {
      throw new AppError(400, `L'Extra Deck est limité à ${EXTRA_DECK_MAX} cartes`, 'extra_deck_full', { max: EXTRA_DECK_MAX });
    }
    if (!isExtra && zoneCount + quantity > MAIN_DECK_MAX) {
      throw new AppError(400, `Le Main Deck est limité à ${MAIN_DECK_MAX} cartes`, 'main_deck_full', { max: MAIN_DECK_MAX });
    }

    for (let i = 0; i < quantity; i += 1) deck.cards.push(card_id);
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.status(201).json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

const removeDeckCardSchema = z.object({ quantity: z.coerce.number().int().min(1).max(MAX_COPIES_PER_CARD).default(1) });

characterRouter.delete(
  '/:id/decks/:deckId/cards/:cardId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    assertCanManageCharacter(character, session, req.user!.sub);
    const deck = findDeckOrThrow(character, req.params.deckId!);

    const { quantity } = removeDeckCardSchema.parse(req.query);
    const cardId = req.params.cardId!;

    let removed = 0;
    for (let i = deck.cards.length - 1; i >= 0 && removed < quantity; i -= 1) {
      if (deck.cards[i] === cardId) {
        deck.cards.splice(i, 1);
        removed += 1;
      }
    }
    if (removed === 0) throw new AppError(404, 'Cette carte ne figure pas dans le deck', 'not_found');

    await character.save();
    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.json({ character: toCharacterDto(character, isSessionGm(session, req.user!.sub)) });
  }),
);

const importYdkSchema = z.object({
  name: z.string().trim().min(1).max(64),
  // Contenu brut du fichier .ydk — que ce soit un vrai upload (lu en texte
  // côté front, voir DeckManager.tsx) ou un copier-coller direct (demande
  // utilisateur explicite : les deux doivent marcher).
  content: z.string().trim().min(1).max(200_000),
});

interface ParsedYdk {
  main: number[];
  extra: number[];
}

/**
 * Format standard EDOPro/YGOPro (voir lib/ydk.ts côté front, qui produit
 * exactement ça à l'export) : un passcode par ligne sous `#main`/`#extra`,
 * copies multiples répétées. `!side` marque la section side deck — ignorée
 * en entier, cette app n'a pas cette notion (CLAUDE.md). Toute ligne
 * commençant par `#` en dehors de `#main`/`#extra` est un commentaire
 * (ex. `#created by ...`), ignorée ; toute ligne non numérique inattendue
 * aussi, plutôt que de faire échouer tout l'import pour une seule ligne mal
 * formée.
 */
function parseYdk(content: string): ParsedYdk {
  const main: number[] = [];
  const extra: number[] = [];
  let section: 'main' | 'extra' | 'side' | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === '#main') {
      section = 'main';
      continue;
    }
    if (line === '#extra') {
      section = 'extra';
      continue;
    }
    if (line === '!side') {
      section = 'side';
      continue;
    }
    if (line.startsWith('#') || line.startsWith('!')) continue;
    if (section === 'side' || section === null) continue;
    if (!/^\d+$/.test(line)) continue;
    const code = Number(line);
    (section === 'main' ? main : extra).push(code);
  }
  return { main, extra };
}

/**
 * Import d'un deck PNJ complet depuis un fichier .ydk (ou son contenu
 * collé) — demande utilisateur : composer un deck adversaire à la main,
 * carte par carte, était trop long pour un deck déjà prêt ailleurs
 * (EDOPro/YGOPro, ou un export .ydk fait par ce même outil, voir
 * lib/ydk.ts). Réservé au MJ ET à un PNJ (comme le contournement de la
 * collection déjà en place pour l'ajout carte-par-carte, CLAUDE.md §3.6) —
 * un deck JOUEUR reste construit depuis SA collection, jamais depuis un
 * fichier arbitraire.
 */
characterRouter.post(
  '/:id/decks/import-ydk',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    if (!isSessionGm(session, req.user!.sub)) {
      throw new AppError(403, 'Seul le MJ peut importer un deck .ydk', 'forbidden');
    }
    if (!character.is_npc) {
      throw new AppError(
        400,
        "L'import .ydk n'est disponible que pour un PNJ — un deck joueur reste construit depuis sa collection",
        'invalid_input',
      );
    }

    const { name, content } = importYdkSchema.parse(req.body);
    const { main, extra } = parseYdk(content);
    if (main.length === 0 && extra.length === 0) {
      throw new AppError(
        400,
        'Aucune carte trouvée dans ce fichier .ydk (sections #main/#extra vides ou absentes)',
        'invalid_input',
      );
    }

    const allCodes = [...new Set([...main, ...extra])];
    const known = await Card.find({ engine_code: { $in: allCodes } });
    const cardByCode = new Map(known.map((c) => [c.engine_code!, c]));

    // Second appel uniquement pour les codes qui POURRAIENT être une vraie
    // carte officielle pas encore importée (< CUSTOM_CODE_BASE) — un code
    // custom d'un autre MJ n'a de toute façon aucune existence côté
    // YGOPRODeck, inutile de le tenter.
    const maybeOfficial = allCodes.filter((code) => !cardByCode.has(code) && code < CUSTOM_CODE_BASE);
    if (maybeOfficial.length > 0) {
      const { foundIds } = await importCardsByIds(maybeOfficial);
      if (foundIds.size > 0) {
        const fetched = await Card.find({ ygoprodeck_id: { $in: [...foundIds] } });
        for (const card of fetched) cardByCode.set(card.engine_code ?? card.ygoprodeck_id!, card);
      }
    }

    const notFound = allCodes.filter((code) => !cardByCode.has(code));
    const resolveSection = (codes: number[]) => codes.filter((code) => cardByCode.has(code)).map((code) => cardByCode.get(code)!._id.toString());
    const resolvedMain = resolveSection(main);
    const resolvedExtra = resolveSection(extra);

    // Mêmes règles que l'ajout carte-par-carte (voir POST .../cards
    // ci-dessus), appliquées ici au deck entier plutôt qu'incrémentalement —
    // pas de vérification du minimum (MAIN_DECK_MIN) : un import partiel
    // (cartes non trouvées) reste utile à créer, le MJ complète ensuite.
    const copyCounts = new Map<string, number>();
    for (const id of [...resolvedMain, ...resolvedExtra]) copyCounts.set(id, (copyCounts.get(id) ?? 0) + 1);
    if ([...copyCounts.values()].some((count) => count > MAX_COPIES_PER_CARD)) {
      throw new AppError(400, `Ce fichier contient plus de ${MAX_COPIES_PER_CARD} exemplaires d'une même carte`, 'copy_limit', {
        max: MAX_COPIES_PER_CARD,
      });
    }
    if (resolvedMain.length > MAIN_DECK_MAX) {
      throw new AppError(400, `Le Main Deck est limité à ${MAIN_DECK_MAX} cartes`, 'main_deck_full', { max: MAIN_DECK_MAX });
    }
    if (resolvedExtra.length > EXTRA_DECK_MAX) {
      throw new AppError(400, `L'Extra Deck est limité à ${EXTRA_DECK_MAX} cartes`, 'extra_deck_full', { max: EXTRA_DECK_MAX });
    }

    character.decks.push({ _id: new Types.ObjectId(), name, cards: [...resolvedMain, ...resolvedExtra] });
    await character.save();

    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    // GM-only route (voir le garde ci-dessus) : toujours vrai ici.
    res.status(201).json({
      character: toCharacterDto(character, true),
      summary: {
        main_count: resolvedMain.length,
        extra_count: resolvedExtra.length,
        not_found: notFound,
      },
    });
  }),
);

const updateCharacterSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  backstory: z.string().max(5000).optional(),
  personality: z.string().max(2000).optional(),
  visual_description: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
  gm_notes: z.string().max(5000).optional(),
  stats: statsSchema.optional(),
  level: z.number().int().min(1).optional(),
  experience: z.number().int().min(0).optional(),
  money: z.number().int().min(0).optional(),
  inventory: z.array(z.string()).optional(),
});

characterRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    const userId = req.user!.sub;

    const isOwner = character.user_id.toString() === userId;
    const isGm = isSessionGm(session, userId);
    if (!isOwner && !isGm) {
      throw new AppError(403, 'Vous ne pouvez pas modifier ce personnage', 'forbidden');
    }

    const updates = updateCharacterSchema.parse(req.body);

    // Le niveau, l'XP et l'argent restent sous le contrôle du MJ, comme à la
    // table : un joueur peut faire baisser son propre solde (achat, via la
    // route marchand — un chemin distinct, non concerné ici) mais ne peut
    // pas s'en créditer lui-même (CLAUDE.md §4 : jamais faire confiance à
    // l'état client pour la monnaie).
    if ((updates.level !== undefined || updates.experience !== undefined || updates.money !== undefined) && !isGm) {
      throw new AppError(403, "Seul le MJ peut modifier le niveau, l'expérience ou l'argent", 'forbidden');
    }
    // Même logique que ci-dessus : un joueur ne doit jamais pouvoir écrire
    // (ni donc a fortiori lire, voir toCharacterDto) le bloc réservé au MJ,
    // même sur SON PROPRE personnage.
    if (updates.gm_notes !== undefined && !isGm) {
      throw new AppError(403, 'Seul le MJ peut modifier les notes MJ', 'forbidden');
    }

    if (updates.stats) validatePointBuy(updates.stats);

    if (updates.name !== undefined) character.name = updates.name;
    if (updates.backstory !== undefined) character.backstory = updates.backstory;
    if (updates.personality !== undefined) character.personality = updates.personality;
    if (updates.visual_description !== undefined) character.visual_description = updates.visual_description;
    if (updates.notes !== undefined) character.notes = updates.notes;
    if (updates.gm_notes !== undefined) character.gm_notes = updates.gm_notes;
    if (updates.money !== undefined) character.money = updates.money;
    if (updates.inventory !== undefined) character.inventory = updates.inventory;
    if (updates.stats) character.stats = updates.stats;
    if (updates.level !== undefined) character.level = updates.level;
    if (updates.experience !== undefined) character.experience = updates.experience;

    if (updates.stats || updates.level !== undefined) {
      character.remaining_luck_rerolls = maxLuckRerolls(character.stats.luck, character.level);
    }

    await character.save();
    // Manquait ici : sans lui, un changement fait par le MJ (argent, XP,
    // niveau, stats...) ne se répercutait pas en temps réel chez le joueur
    // concerné — il ne le voyait qu'après une action qui refetch le
    // personnage par ailleurs (achat, négociation marchand...) ou un
    // rechargement de page. Même convention que la création/suppression.
    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.json({ character: toCharacterDto(character, isGm) });
  }),
);

characterRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const character = await loadCharacterOrThrow(req.params.id!);
    const session = await loadSessionOrThrow(character.game_session_id.toString());
    const userId = req.user!.sub;

    const isOwner = character.user_id.toString() === userId;
    const isGm = isSessionGm(session, userId);
    if (!isOwner && !isGm) {
      throw new AppError(403, 'Vous ne pouvez pas supprimer ce personnage', 'forbidden');
    }

    await character.deleteOne();
    broadcastSessionResourceChanged(req, session._id.toString(), 'characters');
    res.status(204).send();
  }),
);
