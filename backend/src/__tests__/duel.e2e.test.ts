import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Card } from '../models/Card.model';
import { Character } from '../models/Character.model';
import { firstAvailablePlace, IdleCmdCategory, Location } from '../services/ocgcoreClient';

/**
 * E2E : duel piloté par le vrai moteur ocgcore, via l'API HTTP complète
 * (routes/duel.routes.ts). Complète ocgcoreClient.e2e.test.ts (qui pilote le
 * process bas niveau directement) en couvrant la couche HTTP : création,
 * résolution de carte sur les prompts (nom/image attachés aux options, pas
 * juste des codes bruts), un vrai cycle Invocation Normale -> zone -> terrain,
 * le point de terminaison /field et sa confidentialité par spectateur (main
 * visible seulement par le contrôleur/le MJ), et les vérifications de droits.
 *
 * Cartes officielles réelles utilisées (passcodes BabelCDB confirmés en
 * interrogeant cards.cdb directement, pas de supposition) : Celtic Guardian
 * (91152256, Niveau 4, aucun script — monstre "vanille") et Feral Imp
 * (41392891, Niveau 4, vanille aussi) — Niveau <= 4 : 0 tribut, invocable
 * directement sur un terrain vide, ce qui garde le scénario simple. Chaque
 * deck ne contient qu'UN SEUL exemplaire de carte distincte (répété), pour
 * que la main de départ soit déterministe malgré le mélange aléatoire côté
 * app (shuffle() dans duelBoard.ts) — sans ça, quelle carte précise arrive en
 * main ne serait pas prévisible d'un run à l'autre.
 *
 * Séquence Invocation Normale -> SELECT_PLACE confirmée en pilotant le
 * protocole texte brut directement contre le vrai binaire avant d'écrire ce
 * test (voir le plan d'intégration) : un carte de Niveau 4 sans tribut suit
 * exactement ce chemin, pas de MSG_SELECT_POSITION intermédiaire.
 */

const app = createApp();
const rand = Math.floor(Math.random() * 1e6);

interface AuthedUser {
  token: string;
  id: string;
}

async function registerUser(username: string): Promise<AuthedUser> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: `${username}_${rand}`, email: `${username}_${rand}@example.com`, password: 'supersecret123' })
    .expect(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function createSession(token: string) {
  const res = await request(app).post('/api/sessions').set('Authorization', `Bearer ${token}`).send({ currency_name: 'Gold' }).expect(201);
  return res.body.session as { id: string; code: string };
}

const stats = { history: 13, perception: 13, intelligence: 13, charisma: 20, luck: 8 };

async function createCharacter(token: string, sessionId: string, name: string, isNpc = false) {
  const res = await request(app)
    .post('/api/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({ game_session_id: sessionId, name, is_npc: isNpc, stats })
    .expect(201);
  return res.body.character as { id: string };
}

/** Carte officielle réelle seedée directement en base (comme deckbuilding.e2e.test.ts) : le moteur, lui, lit cards.cdb — ces champs ne servent qu'à l'affichage/la résolution nom+image côté API. */
async function seedOfficialCard(code: number, name: string, atk: number, def: number, race: string, attribute: string) {
  const card = await Card.create({
    ygoprodeck_id: code,
    engine_code: code,
    name,
    type: 'Normal Monster',
    frame_type: 'normal',
    description: 'Carte vanille de test.',
    atk,
    def,
    level_rank: 4,
    race,
    attribute,
    archetype: null,
    card_sets: [],
    card_images: [
      { image_id: code, image_url: `https://images.ygoprodeck.com/images/cards/${code}.jpg`, image_url_small: `https://images.ygoprodeck.com/images/cards_small/${code}.jpg`, image_url_cropped: `https://images.ygoprodeck.com/images/cards_cropped/${code}.jpg` },
    ],
    is_custom: false,
  });
  return card._id.toString();
}

async function buildDeck(token: string, characterId: string, deckName: string, cardId: string, copies: number) {
  const deckRes = await request(app).post(`/api/characters/${characterId}/decks`).set('Authorization', `Bearer ${token}`).send({ name: deckName }).expect(201);
  const deckId = deckRes.body.character.decks[0].id as string;
  await request(app)
    .post(`/api/characters/${characterId}/decks/${deckId}/cards`)
    .set('Authorization', `Bearer ${token}`)
    .send({ card_id: cardId, quantity: copies })
    .expect(201);
  return deckId as string;
}

describe('Duel piloté par le moteur ocgcore réel, via l’API HTTP (E2E)', () => {
  let gm: AuthedUser;
  let player: AuthedUser;
  let outsider: AuthedUser;
  let session: { id: string; code: string };
  let playerChar: { id: string };
  let npcChar: { id: string };
  let playerDeckId: string;
  let npcDeckId: string;
  let celticGuardianId: string;

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm = await registerUser('duel_gm');
    player = await registerUser('duel_player');
    outsider = await registerUser('duel_outsider'); // jamais membre du salon

    session = await createSession(gm.token);
    await request(app).post(`/api/sessions/${session.code}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);

    playerChar = await createCharacter(player.token, session.id, 'Duelliste');
    npcChar = await createCharacter(gm.token, session.id, 'Adversaire PNJ', true);

    celticGuardianId = await seedOfficialCard(91152256, 'Celtic Guardian', 1400, 1200, 'Warrior', 'EARTH');
    const feralImpId = await seedOfficialCard(41392891, 'Feral Imp', 1300, 1400, 'Fiend', 'DARK');

    // Deck de personnage joueur : les cartes ajoutables doivent être dans sa
    // collection (règle deckbuilding, voir CLAUDE.md §3.6) — pas les decks PNJ.
    await Character.updateOne({ _id: playerChar.id }, { $set: { collection: Array(3).fill(celticGuardianId) } });

    // Un seul exemplaire distinct par deck : la main de départ est donc
    // déterministe malgré le mélange, quel que soit l'ordre tiré.
    playerDeckId = await buildDeck(player.token, playerChar.id, 'Deck Joueur', celticGuardianId, 3);
    npcDeckId = await buildDeck(gm.token, npcChar.id, 'Deck PNJ', feralImpId, 3);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('un tiers non membre du salon ne peut pas créer de duel', async () => {
    await request(app)
      .post('/api/duels')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({
        game_session_id: session.id,
        name: 'Duel Interdit',
        rules: { hand_size: 1 },
        teams: [
          { name: 'Camp Joueur', participants: [{ character_id: playerChar.id, deck_id: playerDeckId }] },
          { name: 'Camp PNJ', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
        ],
      })
      .expect(403);
  });

  it("un joueur (pas MJ) ne peut pas créer de duel — seul le MJ valide le lancement d'un duel", async () => {
    await request(app)
      .post('/api/duels')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        game_session_id: session.id,
        name: 'Duel Refusé',
        rules: { hand_size: 1 },
        teams: [
          { name: 'Camp Joueur', participants: [{ character_id: playerChar.id, deck_id: playerDeckId }] },
          { name: 'Camp PNJ', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
        ],
      })
      .expect(403);
  });

  describe('un vrai duel : création, invocation, terrain, confidentialité, fin', () => {
    let duelId: string;

    it('le MJ crée le duel — le premier prompt (idle) est déjà atteint et résolu (pumpUntilSettled), avec les cartes nommées/imagées', async () => {
      const res = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          game_session_id: session.id,
          name: 'Duel Réel',
          rules: { starting_lp: 8000, hand_size: 1, draw_count_per_turn: 1 },
          teams: [
            { name: 'Camp Joueur', participants: [{ character_id: playerChar.id, deck_id: playerDeckId }] },
            { name: 'Camp PNJ', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
          ],
        })
        .expect(201);

      duelId = res.body.duel.id;
      expect(res.body.duel.status).toBe('active');
      expect(res.body.duel.teams).toEqual([
        { name: 'Camp Joueur', life_points: 8000 },
        { name: 'Camp PNJ', life_points: 8000 },
      ]);
      // Reste bloqué en interne (CONTINUE) sans la boucle pumpUntilSettled —
      // c'est exactement le bug que ce test couvre : sans elle, ce champ
      // serait `null` malgré un duel bien vivant.
      expect(res.body.duel.pending_prompt).not.toBeNull();
      expect(res.body.duel.pending_prompt.type).toBe('idle');
    });

    it('la carte en main (résolue depuis le prompt) est bien Celtic Guardian ou Feral Imp — un vrai nom/une vraie image, pas juste un code', async () => {
      // Depuis que le MJ n'a plus une vision totale des DEUX camps dès qu'il
      // pilote un PNJ dans CE duel (voir computeCanSeeTeam), il faut lire le
      // prompt détaillé avec le token du camp RÉELLEMENT concerné, pas
      // toujours celui du MJ — sinon le prompt reviendrait `redacted: true`
      // si c'est le tour du joueur.
      const overview = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const actingTeam = overview.body.duel.current_team as 0 | 1;
      const actingParticipant = overview.body.duel.participants.find((p: { team: number }) => p.team === actingTeam);
      const actorToken = actingParticipant.character_id === playerChar.id ? player.token : gm.token;
      const res = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${actorToken}`).expect(200);
      const prompt = res.body.duel.pending_prompt;
      expect(prompt.type).toBe('idle');
      expect(prompt.summonable).toHaveLength(1);
      expect(['Celtic Guardian', 'Feral Imp']).toContain(prompt.summonable[0].card.name);
      expect(prompt.summonable[0].card.card_images[0].image_url).toMatch(/^https:\/\//);
    });

    it("invoque la carte (Invocation Normale) puis place sur le terrain — deux actions, deux vrais tours de l'API", async () => {
      const overview = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const actingTeam = overview.body.duel.current_team as 0 | 1;
      const actingParticipant = overview.body.duel.participants.find((p: { team: number }) => p.team === actingTeam);
      const actorToken = actingParticipant.character_id === playerChar.id ? player.token : gm.token;
      const before = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${actorToken}`).expect(200);
      const prompt = before.body.duel.pending_prompt;
      const expectedCardName = actingTeam === 0 ? 'Celtic Guardian' : 'Feral Imp';
      expect(prompt.summonable[0].card.name).toBe(expectedCardName);

      const summonRes = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ participant_id: actingParticipant.id, category: IdleCmdCategory.SUMMON, index: 0 })
        .expect(200);
      expect(summonRes.body.duel.pending_prompt.type).toBe('select_place');

      const place = firstAvailablePlace(summonRes.body.duel.pending_prompt.flag);
      expect(place).not.toBeNull();

      const placeRes = await request(app)
        .post(`/api/duels/${duelId}/select-place`)
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ participant_id: actingParticipant.id, selections: [{ player: actingTeam, location: place!.location, sequence: place!.sequence }] })
        .expect(200);
      // Résolu (Invocation terminée) : soit un nouveau prompt (Battle/Main2),
      // soit AWAITING sur autre chose — jamais null, sinon le duel est bloqué.
      expect(placeRes.body.duel.pending_prompt).not.toBeNull();
    });

    it('/field reflète le vrai terrain moteur : le monstre invoqué apparaît avec son vrai nom/ATK/DEF live', async () => {
      const res = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      interface FieldCard { card: { name: string } | null; face_down: boolean; attack: number | null }
      const [teamA, teamB] = res.body.field.teams as [{ monster_zones: Array<FieldCard | null> }, { monster_zones: Array<FieldCard | null> }];
      const occupied = [...teamA.monster_zones, ...teamB.monster_zones].filter((z): z is FieldCard => z !== null);
      expect(occupied).toHaveLength(1);
      expect(['Celtic Guardian', 'Feral Imp']).toContain(occupied[0]!.card?.name);
      expect(occupied[0]!.face_down).toBe(false);
      expect(occupied[0]!.attack).toBeGreaterThan(0);
    });

    it("confidentialité : le joueur voit sa propre main mais pas celle du PNJ ; le MJ qui pilote ce PNJ dans CE duel ne voit PAS la main du joueur non plus (il est traité comme l'adversaire, pas comme un superviseur omniscient)", async () => {
      const asPlayer = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${player.token}`).expect(200);
      const [teamAAsPlayer, teamBAsPlayer] = asPlayer.body.field.teams;
      expect(teamAAsPlayer.hand).not.toBeNull(); // équipe du joueur : visible pour lui-même
      expect(teamBAsPlayer.hand).toBeNull(); // équipe du PNJ (contrôlé par le MJ) : caché pour le joueur

      // Le MJ pilote npcChar (Camp PNJ) dans CE duel précis : il n'est plus
      // "superviseur pur" ici (voir computeCanSeeTeam) — il voit la main de
      // SON PROPRE PNJ (normal, il doit pouvoir jouer) mais PAS celle du
      // joueur, exactement comme le joueur ne voit pas celle du PNJ. Retour
      // utilisateur explicite : voir la main adverse en jouant le PNJ « ruine
      // le RP ».
      const asGm = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const [teamAAsGm, teamBAsGm] = asGm.body.field.teams;
      expect(teamAAsGm.hand).toBeNull(); // main du joueur : cachée au MJ tant qu'il joue le PNJ adverse
      expect(teamBAsGm.hand).not.toBeNull(); // main de son propre PNJ : toujours visible
    });

    it('un tiers non membre du salon ne peut pas consulter le terrain', async () => {
      await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${outsider.token}`).expect(403);
    });

    it('un joueur ne peut pas agir pour un participant qu’il ne contrôle pas', async () => {
      const current = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const npcParticipant = current.body.duel.participants.find((p: { character_id: string }) => p.character_id === npcChar.id);
      await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: npcParticipant.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(403);
    });

    it('le MJ termine le duel — le process moteur est libéré, /field échoue ensuite (plus de moteur actif)', async () => {
      const res = await request(app).post(`/api/duels/${duelId}/end`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      expect(res.body.duel.status).toBe('finished');

      await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm.token}`).expect(400);
    });

    it('le MJ peut supprimer le duel terminé', async () => {
      await request(app).delete(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(204);
      await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(404);
    });
  });

  describe('Invocation Normale avec tribut (MSG_SELECT_TRIBUTE)', () => {
    // Summoned Skull (70781052, Niveau 6, vanille — passcode confirmé en
    // interrogeant cards.cdb) exige 1 tribut (Niveau 5-6). Deck de 3 cartes
    // (2x Celtic Guardian + 1x Summoned Skull) avec hand_size=2 : quel que
    // soit le tirage, au tour 2 les 3 cartes ont été vues (2 en main de
    // départ + 1 piochée), donc un Celtic Guardian est déjà sur le terrain
    // (invoqué tour 1, aucun tribut requis) et Summoned Skull est en main —
    // jamais besoin de connaître l'ordre du mélange à l'avance. Après CHAQUE
    // action, le moteur ouvre une fenêtre de chaîne (MSG_SELECT_CHAIN, même
    // vide) : `advance()` la traverse automatiquement (passer) comme le
    // ferait le mode "Off" du panneau de chaîne (DuelBoardOverlay.tsx) tant
    // qu'elle n'est pas `forced`, avant de rendre la main au test.
    let duelId: string;

    const tokenFor = (duel: any, characterId: string) => (characterId === playerChar.id ? player.token : gm.token);
    const participantByTeam = (duel: any, team: 0 | 1) => duel.participants.find((p: { team: number }) => p.team === team);
    const participantByCharacter = (duel: any, characterId: string) => duel.participants.find((p: { character_id: string }) => p.character_id === characterId);

    /**
     * Relit l'état du duel avec le token de qui doit RÉELLEMENT agir
     * maintenant. Nécessaire depuis que le MJ n'a plus une vision totale des
     * deux camps dès qu'il pilote un PNJ dans CE duel (voir
     * computeCanSeeTeam côté serveur) : un objet `duel` obtenu via un autre
     * token peut porter un `pending_prompt` réduit (`redacted: true`, sans
     * `summonable`/`cards`) si ce camp n'est pas le sien.
     */
    async function actorView(duel: any): Promise<any> {
      const acting = participantByTeam(duel, duel.current_team);
      const token = tokenFor(duel, acting.character_id);
      return (await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${token}`).expect(200)).body.duel;
    }

    /** Absorbe toute fenêtre de chaîne non forcée (passe) tant que le prompt courant en est une. */
    async function skipOptionalChains(duel: any): Promise<any> {
      while (duel.pending_prompt?.type === 'chain' && !duel.pending_prompt.forced) {
        const acting = participantByTeam(duel, duel.pending_prompt.playerid);
        const res = await request(app)
          .post(`/api/duels/${duelId}/chain-action`)
          .set('Authorization', `Bearer ${tokenFor(duel, acting.character_id)}`)
          .send({ participant_id: acting.id, index: -1 })
          .expect(200);
        duel = res.body.duel;
      }
      return duel;
    }

    async function idleAction(duel: any, participantId: string, token: string, category: number, index = 0): Promise<any> {
      const res = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${token}`)
        .send({ participant_id: participantId, category, index })
        .expect(200);
      return skipOptionalChains(res.body.duel);
    }

    async function endTurn(duel: any): Promise<any> {
      const acting = participantByTeam(duel, duel.current_team);
      return idleAction(duel, acting.id, tokenFor(duel, acting.character_id), IdleCmdCategory.TO_END);
    }

    /** Invoque `cardName` depuis la main du camp actif (doit déjà être proposée dans `summonable`), place-la si besoin. Ne gère PAS le tribut : le test appelant s'en charge s'il en attend un. */
    async function summon(duel: any, cardName: string): Promise<any> {
      duel = await actorView(duel);
      const acting = participantByTeam(duel, duel.current_team);
      const token = tokenFor(duel, acting.character_id);
      const option = duel.pending_prompt.summonable.find((o: { card: { name: string } | null }) => o.card?.name === cardName);
      expect(option).toBeDefined();
      const res = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${token}`)
        .send({ participant_id: acting.id, category: IdleCmdCategory.SUMMON, index: duel.pending_prompt.summonable.indexOf(option) })
        .expect(200);
      let next = await skipOptionalChains(res.body.duel);
      if (next.pending_prompt?.type === 'select_place') {
        const place = firstAvailablePlace(next.pending_prompt.flag);
        const placeRes = await request(app)
          .post(`/api/duels/${duelId}/select-place`)
          .set('Authorization', `Bearer ${token}`)
          .send({ participant_id: acting.id, selections: [{ player: acting.team, location: place!.location, sequence: place!.sequence }] })
          .expect(200);
        next = await skipOptionalChains(placeRes.body.duel);
      }
      return next;
    }

    it('prépare un terrain avec un Celtic Guardian déjà en jeu (tour 1 de chaque camp), sans tribut nécessaire', async () => {
      const summonedSkullId = await seedOfficialCard(70781052, 'Summoned Skull', 2500, 1200, 'Fiend', 'DARK');
      await Character.updateOne({ _id: playerChar.id }, { $set: { collection: [...Array(3).fill(celticGuardianId), ...Array(3).fill(summonedSkullId)] } });

      // playerChar a déjà un deck (créé dans le describe précédent) : .push()
      // append, `decks[0]` ne serait donc PAS le nouveau deck — on le
      // retrouve par son nom plutôt que de supposer sa position.
      const deckRes = await request(app).post(`/api/characters/${playerChar.id}/decks`).set('Authorization', `Bearer ${player.token}`).send({ name: 'Deck Tribut' }).expect(201);
      const deckId = deckRes.body.character.decks.find((d: { name: string }) => d.name === 'Deck Tribut').id as string;
      await request(app).post(`/api/characters/${playerChar.id}/decks/${deckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: celticGuardianId, quantity: 2 }).expect(201);
      await request(app).post(`/api/characters/${playerChar.id}/decks/${deckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: summonedSkullId, quantity: 1 }).expect(201);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          game_session_id: session.id,
          name: 'Duel Tribut',
          rules: { starting_lp: 8000, hand_size: 2, draw_count_per_turn: 1 },
          teams: [
            { name: 'Camp Joueur', participants: [{ character_id: playerChar.id, deck_id: deckId }] },
            { name: 'Camp PNJ', participants: [{ character_id: npcChar.id, deck_id: npcDeckId }] },
          ],
        })
        .expect(201);
      duelId = created.body.duel.id;

      // Tour 1 (quel que soit le camp qui commence, on suit `current_team`) :
      // le joueur invoque Celtic Guardian dès que c'est son tour, l'autre
      // camp passe sans rien faire — au bout de 2 tours (1 par camp), le
      // joueur a forcément eu son tour 1.
      let duel = await skipOptionalChains(created.body.duel);
      for (let i = 0; i < 2; i += 1) {
        const acting = participantByTeam(duel, duel.current_team);
        if (acting.character_id === playerChar.id) {
          duel = await summon(duel, 'Celtic Guardian');
        }
        duel = await endTurn(duel);
      }

      const field = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      interface FieldCard { card: { name: string } | null }
      const onField: FieldCard[] = [...field.body.field.teams[0].monster_zones, ...field.body.field.teams[1].monster_zones].filter(
        (z: FieldCard | null): z is FieldCard => z !== null,
      );
      expect(onField.some((z) => z.card?.name === 'Celtic Guardian')).toBe(true);
    });

    it("invoque Summoned Skull (Niveau 6) : le prompt de tribut propose exactement Celtic Guardian, la résolution l'envoie au cimetière", async () => {
      let duel = await actorView((await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200)).body.duel);
      // Fait passer les tours jusqu'à ce que ce soit au joueur d'agir avec
      // Summoned Skull réellement proposée à l'invocation (main de départ
      // entièrement piochée par tour 2, voir le commentaire du describe).
      while (participantByTeam(duel, duel.current_team).character_id !== playerChar.id || !duel.pending_prompt.summonable?.some((o: { card: { name: string } | null }) => o.card?.name === 'Summoned Skull')) {
        duel = await actorView(await endTurn(duel));
      }
      const playerParticipant = participantByCharacter(duel, playerChar.id);
      const skull = duel.pending_prompt.summonable.find((o: { card: { name: string } | null }) => o.card?.name === 'Summoned Skull');

      const summonRes = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: playerParticipant.id, category: IdleCmdCategory.SUMMON, index: duel.pending_prompt.summonable.indexOf(skull) })
        .expect(200);

      const tributePrompt = summonRes.body.duel.pending_prompt;
      expect(tributePrompt.type).toBe('select_tribute');
      expect(tributePrompt.min).toBe(1);
      expect(tributePrompt.max).toBe(1);
      expect(tributePrompt.cards).toHaveLength(1);
      expect(tributePrompt.cards[0].card.name).toBe('Celtic Guardian');

      // Réponse invalide (0 carte sélectionnée sans annuler, alors que
      // min=1) : le VRAI moteur rejette (MSG_RETRY), et ça ne doit PAS
      // détruire le prompt en attente côté app (couvre le fix de
      // duelEngine.ts — sans lui, la route suivante répondrait
      // 'wrong_prompt' pour toujours, plus aucune réponse possible).
      const rejected = await request(app)
        .post(`/api/duels/${duelId}/select-tribute`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: playerParticipant.id, indices: [] })
        .expect(200);
      expect(rejected.body.duel.pending_prompt.type).toBe('select_tribute');
      expect(rejected.body.duel.pending_prompt.cards).toHaveLength(1);

      const tributeRes = await request(app)
        .post(`/api/duels/${duelId}/select-tribute`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: playerParticipant.id, indices: [0] })
        .expect(200);
      // Résolu : soit un nouveau prompt (placement de Summoned Skull), jamais null.
      expect(tributeRes.body.duel.pending_prompt).not.toBeNull();

      const field = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const teams = field.body.field.teams as Array<{ graveyard: Array<{ card: { name: string } | null }> }>;
      expect(teams.some((t) => t.graveyard.some((c) => c.card?.name === 'Celtic Guardian'))).toBe(true);
    });
  });

  describe('Duel Tag : plusieurs participants partagent un même camp (PV/terrain communs, decks qui tournent)', () => {
    // Décision utilisateur explicite : 2 camps, 1 à 5 participants chacun,
    // PV PARTAGÉS PAR CAMP (généralisation tag duel — un vrai "chacun pour
    // soi" à PV individuels est structurellement impossible avec ocgcore,
    // voir Duel.model.ts). `team` = position dans `body.teams` (0/1),
    // déterministe — PAS lié au tirage au sort de qui joue en premier.
    // `duelist_index` = ordre d'ajout au sein du camp ; le duelist ACTIF
    // tourne automatiquement via MSG_TAG_SWAP (moteur), et — piège réel
    // trouvé en pilotant le moteur en direct avant d'écrire ce test — le
    // camp qui perd le tirage au sort de départ saute DÉJÀ à duelist_index 1
    // dès son propre premier tour (jamais duelist_index 0 en premier). Ce
    // test suit donc `is_active` tel que rapporté par l'API, jamais une
    // supposition sur le numéro de tour.
    let duelId: string;
    let p1: { id: string };
    let p2: { id: string };
    let opp: { id: string };

    const tokenFor = (characterId: string) => (characterId === opp.id ? gm.token : player.token);

    /** Absorbe toute fenêtre de chaîne non forcée (passe) — voir le describe précédent, même piège (MSG_SELECT_CHAIN après chaque action). */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function passOptionalChains(duel: any): Promise<any> {
      while (duel.pending_prompt?.type === 'chain' && !duel.pending_prompt.forced) {
        const acting = duel.participants.find((x: { team: number; is_active: boolean }) => x.team === duel.pending_prompt.playerid && x.is_active);
        const res = await request(app)
          .post(`/api/duels/${duelId}/chain-action`)
          .set('Authorization', `Bearer ${tokenFor(acting.character_id)}`)
          .send({ participant_id: acting.id, index: -1 })
          .expect(200);
        duel = res.body.duel;
      }
      return duel;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function endTurn(duel: any): Promise<any> {
      duel = await passOptionalChains(duel);
      const acting = duel.participants.find((x: { team: number; is_active: boolean }) => x.team === duel.current_team && x.is_active);
      const res = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${tokenFor(acting.character_id)}`)
        .send({ participant_id: acting.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(200);
      return passOptionalChains(res.body.duel);
    }

    it('crée un duel 2v1 : team A = 2 duelists (PV/terrain partagés), team B = 1 — duelist_index 0 est actif au départ', async () => {
      // 2 cartes distinctes x3 exemplaires (limite MAX_COPIES_PER_CARD) par
      // deck = 6 cartes chacun, assez pour survivre à plusieurs tours de
      // pioche sans deck-out (hand_size=1, draw=1) le temps du test.
      const kuriboh = await seedOfficialCard(40640057, 'Kuriboh', 300, 200, 'Fiend', 'DARK');
      const mysticElf = await seedOfficialCard(15025844, 'Mystical Elf', 800, 2000, 'Spellcaster', 'LIGHT');
      const battleOx = await seedOfficialCard(5053103, 'Battle Ox', 1700, 1000, 'Beast-Warrior', 'EARTH');
      const babyDragon = await seedOfficialCard(88819587, 'Baby Dragon', 1200, 700, 'Dragon', 'WIND');

      p1 = await createCharacter(player.token, session.id, 'Duelliste Tag 1');
      p2 = await createCharacter(player.token, session.id, 'Duelliste Tag 2');
      opp = await createCharacter(gm.token, session.id, 'Adversaire Tag', true);

      await Character.updateOne({ _id: p1.id }, { $set: { collection: [...Array(3).fill(celticGuardianId), ...Array(3).fill(battleOx)] } });
      await Character.updateOne({ _id: p2.id }, { $set: { collection: [...Array(3).fill(mysticElf), ...Array(3).fill(babyDragon)] } });

      const p1DeckId = await buildDeck(player.token, p1.id, 'Deck Tag P1', celticGuardianId, 3);
      await request(app).post(`/api/characters/${p1.id}/decks/${p1DeckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: battleOx, quantity: 3 }).expect(201);
      const p2DeckId = await buildDeck(player.token, p2.id, 'Deck Tag P2', mysticElf, 3);
      await request(app).post(`/api/characters/${p2.id}/decks/${p2DeckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: babyDragon, quantity: 3 }).expect(201);
      const oppDeckId = await buildDeck(gm.token, opp.id, 'Deck Tag Adversaire', kuriboh, 3);
      await request(app).post(`/api/characters/${opp.id}/decks/${oppDeckId}/cards`).set('Authorization', `Bearer ${gm.token}`).send({ card_id: mysticElf, quantity: 3 }).expect(201);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          game_session_id: session.id,
          name: 'Duel Tag',
          rules: { starting_lp: 8000, hand_size: 1, draw_count_per_turn: 1 },
          teams: [
            {
              name: 'Équipe Joueurs',
              participants: [
                { character_id: p1.id, deck_id: p1DeckId },
                { character_id: p2.id, deck_id: p2DeckId },
              ],
            },
            { name: 'Camp Adverse', participants: [{ character_id: opp.id, deck_id: oppDeckId }] },
          ],
        })
        .expect(201);
      duelId = created.body.duel.id;

      expect(created.body.duel.participants).toHaveLength(3);
      expect(created.body.duel.teams[0].life_points).toBe(8000); // PV partagés : un seul total pour toute l'équipe, pas 2.

      const teamAParticipants = created.body.duel.participants.filter((x: { team: number }) => x.team === 0);
      expect(teamAParticipants).toHaveLength(2);
      const p1Participant = teamAParticipants.find((x: { character_id: string }) => x.character_id === p1.id);
      const p2Participant = teamAParticipants.find((x: { character_id: string }) => x.character_id === p2.id);
      expect(p1Participant.duelist_index).toBe(0);
      expect(p2Participant.duelist_index).toBe(1);
      expect(p1Participant.is_active).toBe(true);
      expect(p2Participant.is_active).toBe(false);
    });

    it("le duelist inactif (P2) ne peut pas agir tant que ce n'est pas son tour — même en le contrôlant légitimement", async () => {
      const current = (await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200)).body.duel;
      const p2Participant = current.participants.find((x: { character_id: string }) => x.character_id === p2.id);
      expect(p2Participant.is_active).toBe(false);
      await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: p2Participant.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(403);
    });

    it("après la rotation (2e tour de l'équipe), le duelist actif bascule réellement vers P2 (MSG_TAG_SWAP observé, pas supposé)", async () => {
      let duel = (await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200)).body.duel;
      let sawSwapToP2 = false;
      for (let i = 0; i < 12 && !sawSwapToP2; i += 1) {
        duel = await endTurn(duel);
        const p2Now = duel.participants.find((x: { character_id: string }) => x.character_id === p2.id);
        if (p2Now.is_active) sawSwapToP2 = true;
      }
      expect(sawSwapToP2).toBe(true);
      // La rotation ne peut arriver QUE pendant le tour de l'équipe 0 elle-même.
      expect(duel.current_team).toBe(0);

      const p1Participant = duel.participants.find((x: { character_id: string }) => x.character_id === p1.id);
      const p2Participant = duel.participants.find((x: { character_id: string }) => x.character_id === p2.id);
      expect(p1Participant.is_active).toBe(false);
      expect(p2Participant.is_active).toBe(true);
      // P2 vient de devenir actif : sa propre main (distincte de celle de P1), pas gelée à 0.
      expect(p2Participant.hand_count).toBeGreaterThan(0);

      // P1 (maintenant inactif) ne peut plus agir, même si c'est toujours le tour de son équipe.
      await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: p1Participant.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(403);

      // P2, lui, peut désormais agir pour son équipe.
      await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: p2Participant.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(200);
    });

    it('le MJ termine le duel Tag', async () => {
      await request(app).post(`/api/duels/${duelId}/end`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    });
  });

  describe('carte officielle importée avant l’ajout de engine_code (auto-guérison plutôt que blocage)', () => {
    // Reproduit un vrai problème rencontré en usage réel : une carte
    // officielle enregistrée avant l'intégration ocgcore (ou jamais
    // re-synchronisée depuis) a `ygoprodeck_id` mais pas `engine_code` —
    // demander de "réenregistrer la carte" est une impasse pour
    // l'utilisateur (aucun bouton pour ça). Comme engine_code n'est jamais
    // qu'un miroir de ygoprodeck_id pour une carte officielle (cardImport.ts,
    // aucune allocation distincte), loadDeckPlan doit s'auto-guérir plutôt
    // que bloquer — voir duel.routes.ts.
    it("une carte officielle avec engine_code manquant se répare toute seule à la création du duel, plus besoin de la retoucher ensuite", async () => {
      const legacyCard = await Card.create({
        ygoprodeck_id: 90357090,
        // engine_code délibérément absent (jamais défini) — simule un import antérieur à ce champ.
        name: 'Silver Fang (import ancien)',
        type: 'Normal Monster',
        frame_type: 'normal',
        description: 'Carte importée avant engine_code.',
        atk: 1200,
        def: 800,
        level_rank: 3,
        race: 'Beast',
        attribute: 'EARTH',
        archetype: null,
        card_sets: [],
        card_images: [
          { image_id: 90357090, image_url: 'https://images.ygoprodeck.com/images/cards/90357090.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/90357090.jpg', image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/90357090.jpg' },
        ],
        is_custom: false,
      });
      // Pas de `default: null` dans le schéma (index sparse, voir Card.model.ts) : un champ jamais défini vaut `undefined`, pas `null`.
      expect(legacyCard.engine_code).toBeUndefined();

      const duellist = await createCharacter(player.token, session.id, 'Duelliste Carte Ancienne');
      await Character.updateOne({ _id: duellist.id }, { $set: { collection: Array(3).fill(legacyCard._id.toString()) } });
      const deckId = await buildDeck(player.token, duellist.id, 'Deck Carte Ancienne', legacyCard._id.toString(), 3);

      const opponent = await createCharacter(gm.token, session.id, 'Adversaire Carte Ancienne', true);
      const opponentDeckId = await buildDeck(gm.token, opponent.id, 'Deck Adverse Ancien', celticGuardianId, 3);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          game_session_id: session.id,
          name: 'Duel Carte Ancienne',
          rules: { hand_size: 1 },
          teams: [
            { name: 'Camp Joueur', participants: [{ character_id: duellist.id, deck_id: deckId }] },
            { name: 'Camp PNJ', participants: [{ character_id: opponent.id, deck_id: opponentDeckId }] },
          ],
        })
        .expect(201);
      expect(created.body.duel.status).toBe('active');

      const healed = await Card.findById(legacyCard._id);
      expect(healed?.engine_code).toBe(90357090);

      await request(app).post(`/api/duels/${created.body.duel.id}/end`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    });
  });

  describe('le MJ ne joue jamais à la place d’un joueur ; les autres ne voient pas le détail du prompt en cours', () => {
    // Deux vrais joueurs (jamais un PNJ des deux côtés cette fois), pour
    // vérifier : (1) le MJ ne peut PAS répondre à la place de l'un ou
    // l'autre (uniquement les PNJ) ; (2) celui qui n'a pas la main voit un
    // prompt "redacted" (aucune carte listée), le MJ voit toujours tout.
    let duelId: string;
    let playerA: AuthedUser;
    let playerB: AuthedUser;
    let charA: { id: string };
    let charB: { id: string };

    it('prépare un duel joueur contre joueur', async () => {
      playerA = await registerUser('duel_visib_a');
      playerB = await registerUser('duel_visib_b');
      await request(app).post(`/api/sessions/${session.code}/join`).set('Authorization', `Bearer ${playerA.token}`).expect(200);
      await request(app).post(`/api/sessions/${session.code}/join`).set('Authorization', `Bearer ${playerB.token}`).expect(200);

      charA = await createCharacter(playerA.token, session.id, 'Joueur A Visibilité');
      charB = await createCharacter(playerB.token, session.id, 'Joueur B Visibilité');
      await Character.updateOne({ _id: charA.id }, { $set: { collection: Array(3).fill(celticGuardianId) } });
      await Character.updateOne({ _id: charB.id }, { $set: { collection: Array(3).fill(celticGuardianId) } });
      const deckA = await buildDeck(playerA.token, charA.id, 'Deck Visib A', celticGuardianId, 3);
      const deckB = await buildDeck(playerB.token, charB.id, 'Deck Visib B', celticGuardianId, 3);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm.token}`)
        .send({
          game_session_id: session.id,
          name: 'Duel Visibilité',
          rules: { hand_size: 1 },
          teams: [
            { name: 'Camp A', participants: [{ character_id: charA.id, deck_id: deckA }] },
            { name: 'Camp B', participants: [{ character_id: charB.id, deck_id: deckB }] },
          ],
        })
        .expect(201);
      duelId = created.body.duel.id;
      expect(created.body.duel.pending_prompt.type).toBe('idle');
    });

    it("le MJ ne peut pas répondre à la place du joueur actif — même si l'action serait par ailleurs légale", async () => {
      const asGm = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      const activeParticipant = asGm.body.duel.participants.find((p: { is_active: boolean }) => p.is_active);
      await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${gm.token}`)
        .send({ participant_id: activeParticipant.id, category: IdleCmdCategory.TO_END, index: 0 })
        .expect(403);
    });

    it("celui qui n'a pas la main voit un prompt réduit (aucune carte listée) ; le MJ voit toujours le détail complet", async () => {
      const asGm = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm.token}`).expect(200);
      expect(asGm.body.duel.pending_prompt.redacted).toBeUndefined();
      expect(asGm.body.duel.pending_prompt.summonable).toBeDefined();

      const activeParticipant = asGm.body.duel.participants.find((p: { is_active: boolean }) => p.is_active);
      const activeIsA = activeParticipant.character_id === charA.id;
      const waitingPlayer = activeIsA ? playerB : playerA;

      const asWaiting = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${waitingPlayer.token}`).expect(200);
      expect(asWaiting.body.duel.pending_prompt.redacted).toBe(true);
      expect(asWaiting.body.duel.pending_prompt.summonable).toBeUndefined();
      expect(asWaiting.body.duel.pending_prompt.type).toBe('idle');

      // Le joueur actif, lui, voit bien le détail complet de SA propre décision.
      const activePlayer = activeIsA ? playerA : playerB;
      const asActive = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${activePlayer.token}`).expect(200);
      expect(asActive.body.duel.pending_prompt.redacted).toBeUndefined();
      expect(asActive.body.duel.pending_prompt.summonable).toBeDefined();

      await request(app).post(`/api/duels/${duelId}/end`).set('Authorization', `Bearer ${gm.token}`).expect(200);
    });
  });
});
