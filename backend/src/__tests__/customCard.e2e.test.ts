import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { env } from '../config/env';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { Character } from '../models/Character.model';
import { Card } from '../models/Card.model';
import { firstAvailablePlace, IdleCmdCategory } from '../services/ocgcoreClient';

/**
 * E2E : créateur de cartes custom (monstres/magies/pièges de tous types,
 * CLAUDE.md §3.4). Couvre la validation par catégorie, la restriction MJ,
 * la réutilisation inter-parties (même MJ, parties différentes) avec sa
 * frontière de confidentialité (un autre MJ n'y a pas accès), et le lien
 * carte custom <-> booster jusqu'à l'ouverture réelle du booster.
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

async function createSession(token: string, currencyName = 'Gold') {
  const res = await request(app).post('/api/sessions').set('Authorization', `Bearer ${token}`).send({ currency_name: currencyName }).expect(201);
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

const normalMonster = {
  category: 'monster',
  monster_kind: 'normal',
  attribute: 'DARK',
  race: 'Dragon',
  atk: 2500,
  def: 2000,
  level_rank: 7,
  effect_text: 'Un dragon custom sans effet.',
  name: 'Dragon de Test',
};

// Script minimal valide (respecte juste la convention Project Ignis vérifiée
// côté route : présence d'initial_effect) — le contenu réel de l'effet n'est
// pas ce que ce fichier teste ici. Voir le describe "activation réelle d'un
// effet scripté" plus bas pour un vrai script d'effet exécuté par le moteur.
const DUMMY_LUA_SCRIPT = 'local s,id=GetID()\nfunction s.initial_effect(c)\nend\n';

/**
 * Script réel (pas un script factice) — Carte Magie Normale à ciblage unique
 * qui détruit 1 monstre. Validé en direct contre le vrai moteur AVANT
 * d'écrire le test HTTP ci-dessous (protocole texte brut, voir le plan
 * d'intégration) : un premier jet utilisait `CATEGORY_TOTARGET`, qui
 * n'existe PAS comme constante globale dans cette build du moteur
 * (`LOG ERROR ... attempt to perform arithmetic on a nil value`) — corrigé
 * en le retirant (seul `CATEGORY_DESTROY` est nécessaire, comme dans le vrai
 * script officiel de Raigeki déjà utilisé ailleurs cette session). Structure
 * standard Project Ignis (SetTarget/SetOperation + Duel.SelectTarget), pas
 * une simple copie de Raigeki : cible UNE carte choisie par le joueur, pas
 * un ciblage de masse.
 */
const TARGETED_DESTROY_LUA_SCRIPT = `--Purge de Test (carte custom)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_DESTROY)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(s.activate)
	c:RegisterEffect(e1)
end
function s.filter(c)
	return c:IsFaceup() and c:IsDestructable()
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc) end
	if chk==0 then return Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil) end
	Duel.Hint(HINT_CARD,0,id)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local c=Duel.GetFirstTarget()
	if c and c:IsRelateToEffect(e) then
		Duel.Destroy(Group.FromCards(c),REASON_EFFECT)
	end
end
`;

describe('Créateur de cartes custom : validation, MJ, réutilisation inter-parties, boosters (E2E)', () => {
  let gm1: AuthedUser;
  let player: AuthedUser;
  let gm2: AuthedUser;

  let sessionA: { id: string; code: string };
  let sessionA2: { id: string; code: string };
  let sessionB: { id: string; code: string };

  beforeAll(async () => {
    if (!env.MONGO_URI.endsWith('_test')) {
      throw new Error('Les tests doivent tourner sur une base dédiée se terminant par "_test". Utilisez "npm test".');
    }
    await connectMongo();

    gm1 = await registerUser('cc_gm1');
    player = await registerUser('cc_player');
    gm2 = await registerUser('cc_gm2');

    sessionA = await createSession(gm1.token);
    sessionA2 = await createSession(gm1.token); // même MJ, AUTRE partie
    sessionB = await createSession(gm2.token); // MJ différent

    await request(app).post(`/api/sessions/${sessionA.code}/join`).set('Authorization', `Bearer ${player.token}`).expect(200);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await disconnectMongo();
  });

  it('un joueur (pas MJ) ne peut pas créer de carte custom', async () => {
    await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ game_session_id: sessionA.id, card: normalMonster, lua_script: DUMMY_LUA_SCRIPT })
      .expect(403);
  });

  it('refuse un monstre non-Link sans niveau/rang (validation par catégorie)', async () => {
    const { level_rank: _omit, ...incomplete } = normalMonster;
    await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({ game_session_id: sessionA.id, card: incomplete, lua_script: DUMMY_LUA_SCRIPT })
      .expect(400);
  });

  it('le MJ crée un monstre Normal custom', async () => {
    const res = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({ game_session_id: sessionA.id, card: normalMonster, lua_script: DUMMY_LUA_SCRIPT })
      .expect(201);

    expect(res.body.card.type).toBe('Normal Monster');
    expect(res.body.card.frame_type).toBe('normal');
    expect(res.body.card.is_custom).toBe(true);
    expect(res.body.card.owner_id).toBe(gm1.id);
    expect(res.body.card.created_in_session_id).toBe(sessionA.id);
  });

  it('le MJ crée un monstre Link avec Link Rating et flèches', async () => {
    const res = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({
        game_session_id: sessionA.id,
        card: {
          category: 'monster',
          monster_kind: 'link',
          attribute: 'LIGHT',
          race: 'Cyberse',
          atk: 2100,
          link_rating: 3,
          link_arrows: ['top', 'left', 'right'],
          effect_text: 'Un monstre Link custom.',
          name: 'Cyberse de Test',
        },
        lua_script: DUMMY_LUA_SCRIPT,
      })
      .expect(201);

    expect(res.body.card.type).toBe('Link Monster');
    expect(res.body.card.frame_type).toBe('link');
    expect(res.body.card.def).toBeNull();
    expect(res.body.card.level_rank).toBe(3);
    expect(res.body.card.link_arrows).toEqual(['top', 'left', 'right']);
  });

  it('le MJ crée une carte Magie Quick-Play et une carte Piège Contre', async () => {
    const spell = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({
        game_session_id: sessionA.id,
        card: { category: 'spell', spell_type: 'quick-play', effect_text: 'Effet de sort.', name: 'Sort Rapide de Test' },
        lua_script: DUMMY_LUA_SCRIPT,
      })
      .expect(201);
    expect(spell.body.card.type).toBe('Spell Card');
    expect(spell.body.card.race).toBe('Quick-Play');

    const trap = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({
        game_session_id: sessionA.id,
        card: { category: 'trap', trap_type: 'counter', effect_text: 'Effet de piège.', name: 'Contre-Piège de Test' },
        lua_script: DUMMY_LUA_SCRIPT,
      })
      .expect(201);
    expect(trap.body.card.type).toBe('Trap Card');
    expect(trap.body.card.race).toBe('Counter');
  });

  it('un membre du salon (joueur) voit les cartes custom créées par le MJ', async () => {
    const res = await request(app)
      .get(`/api/custom-cards/session/${sessionA.id}`)
      .set('Authorization', `Bearer ${player.token}`)
      .expect(200);
    expect(res.body.cards.length).toBeGreaterThanOrEqual(4);
    expect(res.body.cards.some((c: { name: string }) => c.name === 'Dragon de Test')).toBe(true);
  });

  it('réutilisation inter-parties : le même MJ retrouve ses cartes custom dans une AUTRE de ses parties', async () => {
    const res = await request(app)
      .get(`/api/custom-cards/session/${sessionA2.id}`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .expect(200);
    const dragon = res.body.cards.find((c: { name: string }) => c.name === 'Dragon de Test');
    expect(dragon).toBeDefined();
    // Créée dans sessionA, pas dans sessionA2 : le flag le reflète.
    expect(dragon.created_in_session_id).toBe(sessionA.id);
    expect(dragon.created_in_this_session).toBe(false);
  });

  it("frontière de confidentialité : un AUTRE MJ (session différente, propriétaire différent) ne voit pas ces cartes", async () => {
    const res = await request(app)
      .get(`/api/custom-cards/session/${sessionB.id}`)
      .set('Authorization', `Bearer ${gm2.token}`)
      .expect(200);
    expect(res.body.cards.some((c: { name: string }) => c.name === 'Dragon de Test')).toBe(false);
  });

  it("ni le joueur ni un autre MJ ne peuvent modifier ou supprimer la carte d'un MJ tiers", async () => {
    const list = await request(app)
      .get(`/api/custom-cards/session/${sessionA.id}`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .expect(200);
    const dragonId = list.body.cards.find((c: { name: string }) => c.name === 'Dragon de Test').id;

    await request(app)
      .patch(`/api/custom-cards/${dragonId}`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ card: { ...normalMonster, atk: 3000 }, lua_script: DUMMY_LUA_SCRIPT })
      .expect(403);

    await request(app)
      .patch(`/api/custom-cards/${dragonId}`)
      .set('Authorization', `Bearer ${gm2.token}`)
      .send({ card: { ...normalMonster, atk: 3000 }, lua_script: DUMMY_LUA_SCRIPT })
      .expect(403);

    await request(app).delete(`/api/custom-cards/${dragonId}`).set('Authorization', `Bearer ${player.token}`).expect(403);
  });

  it('le propriétaire peut modifier sa carte custom', async () => {
    const list = await request(app)
      .get(`/api/custom-cards/session/${sessionA.id}`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .expect(200);
    const dragonId = list.body.cards.find((c: { name: string }) => c.name === 'Dragon de Test').id;

    const res = await request(app)
      .patch(`/api/custom-cards/${dragonId}`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({ card: { ...normalMonster, atk: 3000 }, lua_script: DUMMY_LUA_SCRIPT })
      .expect(200);
    expect(res.body.card.atk).toBe(3000);
  });

  describe('lien carte custom <-> booster, jusqu’à l’ouverture réelle', () => {
    let dragonId: string;
    let boosterSetCode: string;
    let merchantId: string;
    let buyerCharId: string;

    it('le MJ crée un nouveau booster custom et y lie le monstre Normal', async () => {
      const list = await request(app)
        .get(`/api/custom-cards/session/${sessionA.id}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(200);
      dragonId = list.body.cards.find((c: { name: string }) => c.name === 'Dragon de Test').id;

      const res = await request(app)
        .post(`/api/custom-cards/${dragonId}/booster-link`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ new_set_name: 'Booster Custom de Test', rarity: 'Ultra Rare' })
        .expect(201);

      boosterSetCode = res.body.card_set.set_code;
      expect(boosterSetCode).toMatch(/^CUSTOM-/);
      expect(res.body.card.card_sets).toHaveLength(1);
      expect(res.body.card.card_sets[0].set_code).toBe(boosterSetCode);
      expect(res.body.card.card_sets[0].set_rarity).toBe('Ultra Rare');
    });

    it('relier deux fois la même carte au même booster est refusé', async () => {
      await request(app)
        .post(`/api/custom-cards/${dragonId}/booster-link`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ set_code: boosterSetCode })
        .expect(400);
    });

    it('le booster custom n’apparaît PAS dans la liste des sets officiels (pas de faux bouton "Importer")', async () => {
      const res = await request(app).get('/api/cards/sets').set('Authorization', `Bearer ${gm1.token}`).expect(200);
      expect(res.body.sets.some((s: { set_code: string }) => s.set_code === boosterSetCode)).toBe(false);
    });

    it('le MJ vend ce booster custom via un marchand, le joueur l’achète et l’ouvre : la carte custom sort du pack', async () => {
      const merchant = await request(app)
        .post('/api/merchants')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Boutique Custom' })
        .expect(201);
      merchantId = merchant.body.merchant.id;

      const item = await request(app)
        .post(`/api/merchants/${merchantId}/items`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ item_type: 'booster', set_code: boosterSetCode, price: 50 })
        .expect(201);
      const itemId = item.body.merchant.items[0].id;

      const buyer = await createCharacter(player.token, sessionA.id, 'Acheteur de Test');
      buyerCharId = buyer.id;
      await request(app)
        .patch(`/api/characters/${buyerCharId}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ money: 500 })
        .expect(200);

      const purchase = await request(app)
        .post(`/api/merchants/${merchantId}/items/${itemId}/purchase`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ character_id: buyerCharId })
        .expect(200);
      expect(purchase.body.character.sealed_boosters).toEqual([
        expect.objectContaining({ set_code: boosterSetCode, quantity: 1 }),
      ]);

      const opened = await request(app)
        .post(`/api/characters/${buyerCharId}/open-booster`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ set_code: boosterSetCode })
        .expect(200);

      // Seule carte du pool -> ressort forcément à chaque tirage du booster.
      expect(opened.body.opened_cards.length).toBeGreaterThan(0);
      expect(opened.body.opened_cards.every((c: { id: string }) => c.id === dragonId)).toBe(true);
      expect(opened.body.character.collection.filter((id: string) => id === dragonId).length).toBe(
        opened.body.opened_cards.length,
      );
    });

    it('la carte custom obtenue est utilisable dans un deck, classée par frame_type comme une carte officielle', async () => {
      const deck = await request(app)
        .post(`/api/characters/${buyerCharId}/decks`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ name: 'Deck de Test' })
        .expect(201);
      const deckId = deck.body.character.decks[0].id;

      await request(app)
        .post(`/api/characters/${buyerCharId}/decks/${deckId}/cards`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ card_id: dragonId, quantity: 1 })
        .expect(201);

      const view = await request(app)
        .get(`/api/characters/${buyerCharId}/decks/${deckId}`)
        .set('Authorization', `Bearer ${player.token}`)
        .expect(200);
      expect(view.body.deck.main.some((e: { card: { id: string } }) => e.card.id === dragonId)).toBe(true);
      expect(view.body.deck.extra).toHaveLength(0);
    });

    it('délier la carte du booster retire l’entrée card_sets', async () => {
      const res = await request(app)
        .delete(`/api/custom-cards/${dragonId}/booster-link/${boosterSetCode}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(200);
      expect(res.body.card.card_sets).toHaveLength(0);
    });
  });

  describe('POST /custom-cards/boosters : créer un booster custom VIDE (sans devoir déjà posséder une carte)', () => {
    let emptyBoosterSetCode: string;

    it('le MJ crée un booster custom vide', async () => {
      const res = await request(app)
        .post('/api/custom-cards/boosters')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Booster Vide de Test' })
        .expect(201);
      emptyBoosterSetCode = res.body.card_set.set_code;
      expect(emptyBoosterSetCode).toMatch(/^CUSTOM-/);
      expect(res.body.card_set.set_name).toBe('Booster Vide de Test');
    });

    it("un joueur (pas MJ) ne peut pas créer de booster custom", async () => {
      await request(app)
        .post('/api/custom-cards/boosters')
        .set('Authorization', `Bearer ${player.token}`)
        .send({ game_session_id: sessionA.id, name: 'Booster Pirate' })
        .expect(403);
    });

    it("une carte custom peut ensuite être liée à CE booster déjà créé (set_code, pas new_set_name)", async () => {
      const created = await request(app)
        .post('/api/custom-cards')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          card: { category: 'trap', trap_type: 'normal', effect_text: 'Piège de test.', name: 'Piège du Booster Vide' },
          lua_script: DUMMY_LUA_SCRIPT,
        })
        .expect(201);

      const linked = await request(app)
        .post(`/api/custom-cards/${created.body.card.id}/booster-link`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ set_code: emptyBoosterSetCode, rarity: 'Rare' })
        .expect(201);
      expect(linked.body.card.card_sets).toEqual([expect.objectContaining({ set_code: emptyBoosterSetCode, set_rarity: 'Rare' })]);
    });

    it("GET /cards/sets exclut toujours ce booster custom par défaut, mais le montre avec include_custom=true — jamais à un AUTRE MJ", async () => {
      const withoutFlag = await request(app).get('/api/cards/sets').set('Authorization', `Bearer ${gm1.token}`).expect(200);
      expect(withoutFlag.body.sets.some((s: { set_code: string }) => s.set_code === emptyBoosterSetCode)).toBe(false);

      const withFlag = await request(app).get('/api/cards/sets?include_custom=true').set('Authorization', `Bearer ${gm1.token}`).expect(200);
      const found = withFlag.body.sets.find((s: { set_code: string }) => s.set_code === emptyBoosterSetCode);
      expect(found).toBeDefined();
      expect(found.is_custom).toBe(true);

      // gm2 (un AUTRE MJ) ne voit jamais le booster custom de gm1, même avec include_custom=true.
      const asOtherGm = await request(app).get('/api/cards/sets?include_custom=true').set('Authorization', `Bearer ${gm2.token}`).expect(200);
      expect(asOtherGm.body.sets.some((s: { set_code: string }) => s.set_code === emptyBoosterSetCode)).toBe(false);
    });
  });

  describe('DELETE /custom-cards/boosters/:setCode : supprimer un booster custom', () => {
    it('le propriétaire supprime un booster custom et les cartes qui y étaient liées sont déliées (pas supprimées)', async () => {
      const created = await request(app)
        .post('/api/custom-cards/boosters')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Booster à Supprimer' })
        .expect(201);
      const setCode = created.body.card_set.set_code;

      const card = await request(app)
        .post('/api/custom-cards')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          card: { category: 'trap', trap_type: 'normal', effect_text: 'Sera délié.', name: 'Piège Bientôt Délié' },
          lua_script: DUMMY_LUA_SCRIPT,
        })
        .expect(201);
      await request(app)
        .post(`/api/custom-cards/${card.body.card.id}/booster-link`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ set_code: setCode, rarity: 'Rare' })
        .expect(201);

      await request(app)
        .delete(`/api/custom-cards/boosters/${encodeURIComponent(setCode)}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(204);

      // Le booster a disparu de la liste...
      const sets = await request(app).get('/api/cards/sets?include_custom=true').set('Authorization', `Bearer ${gm1.token}`).expect(200);
      expect(sets.body.sets.some((s: { set_code: string }) => s.set_code === setCode)).toBe(false);

      // ...mais la carte elle-même existe toujours, juste déliée de ce booster.
      const cards = await request(app).get(`/api/custom-cards/session/${sessionA.id}`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
      const stillThere = cards.body.cards.find((c: { id: string }) => c.id === card.body.card.id);
      expect(stillThere).toBeDefined();
      expect(stillThere.card_sets).toEqual([]);
    });

    it("un autre MJ ne peut pas supprimer le booster custom d'un MJ tiers (403), et un set_code inconnu 404", async () => {
      const created = await request(app)
        .post('/api/custom-cards/boosters')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Booster Protégé' })
        .expect(201);

      await request(app)
        .delete(`/api/custom-cards/boosters/${encodeURIComponent(created.body.card_set.set_code)}`)
        .set('Authorization', `Bearer ${gm2.token}`)
        .expect(403);

      await request(app)
        .delete('/api/custom-cards/boosters/CUSTOM-NEXISTEPAS-0000')
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(404);
    });

    it("refuse (409) tant qu'un marchand vend encore le booster, ou qu'un personnage en possède des exemplaires scellés non ouverts", async () => {
      const created = await request(app)
        .post('/api/custom-cards/boosters')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Booster En Vente' })
        .expect(201);
      const setCode = created.body.card_set.set_code;

      const merchant = await request(app)
        .post('/api/merchants')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ game_session_id: sessionA.id, name: 'Boutique de Test Suppression', description: '', haggle_dc: 10 })
        .expect(201);
      const itemRes = await request(app)
        .post(`/api/merchants/${merchant.body.merchant.id}/items`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ item_type: 'booster', set_code: setCode, price: 10, stock: 5 })
        .expect(201);
      const itemId = itemRes.body.merchant.items.find((i: { item_type: string }) => i.item_type === 'booster').id;

      const blockedByMerchant = await request(app)
        .delete(`/api/custom-cards/boosters/${encodeURIComponent(setCode)}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(409);
      expect(blockedByMerchant.body.error.code).toBe('booster_in_use');

      // Une fois retiré du marchand, mais tant qu'un personnage possède
      // encore des exemplaires scellés non ouverts, toujours refusé.
      await request(app)
        .delete(`/api/merchants/${merchant.body.merchant.id}/items/${itemId}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(200);

      const character = await createCharacter(gm1.token, sessionA.id, 'Porteur de Booster Scellé', true);
      await Character.updateOne(
        { _id: character.id },
        { $push: { sealed_boosters: { set_code: setCode, set_name: 'Booster En Vente', quantity: 1 } } },
      );

      const blockedByCharacter = await request(app)
        .delete(`/api/custom-cards/boosters/${encodeURIComponent(setCode)}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(409);
      expect(blockedByCharacter.body.error.code).toBe('booster_in_use');

      // Une fois l'exemplaire scellé retiré, la suppression réussit enfin.
      await Character.updateOne({ _id: character.id }, { $set: { sealed_boosters: [] } });
      await request(app)
        .delete(`/api/custom-cards/boosters/${encodeURIComponent(setCode)}`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .expect(204);
    });
  });

  describe('une carte custom (script obligatoire) rejoint un deck et un vrai duel', () => {
    // Le déroulé complet d'un duel (invocation, combat, chaîne, script
    // effectivement exécuté par le moteur) est couvert par duel.e2e.test.ts —
    // ce bloc-ci vérifie seulement le point de jonction : une carte custom
    // avec son script obligatoire (CLAUDE.md §3.4) traverse tout le pipeline
    // collection -> deck -> création de duel réel sans accroc.
    it('une carte custom avec script rejoint la collection, le deck, puis un duel réel démarre avec', async () => {
      const monster = await request(app)
        .post('/api/custom-cards')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          card: {
            category: 'monster',
            monster_kind: 'normal',
            attribute: 'EARTH',
            race: 'Rock',
            atk: 1800,
            def: 2000,
            level_rank: 4,
            effect_text: 'Un golem custom sans effet.',
            name: 'Golem de Jonction',
          },
          lua_script: DUMMY_LUA_SCRIPT,
        })
        .expect(201);
      const monsterId = monster.body.card.id;
      // .trim() côté validation (luaScriptSchema) : le script stocké perd les espaces/retours en trop.
      expect(monster.body.card.lua_script).toBe(DUMMY_LUA_SCRIPT.trim());

      const duellist = await createCharacter(player.token, sessionA.id, 'Duelliste de Jonction');
      await Character.updateOne({ _id: duellist.id }, { $set: { collection: Array(40).fill(monsterId) } });
      const deckRes = await request(app)
        .post(`/api/characters/${duellist.id}/decks`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ name: 'Deck de Jonction' })
        .expect(201);
      const deckId = deckRes.body.character.decks[0].id;
      await request(app)
        .post(`/api/characters/${duellist.id}/decks/${deckId}/cards`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ card_id: monsterId, quantity: 3 })
        .expect(201);

      const opponent = await createCharacter(gm1.token, sessionA.id, 'Adversaire de Jonction', true);
      const opponentDeckRes = await request(app)
        .post(`/api/characters/${opponent.id}/decks`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ name: 'Deck Adverse' })
        .expect(201);
      const opponentDeckId = opponentDeckRes.body.character.decks[0].id;
      await request(app)
        .post(`/api/characters/${opponent.id}/decks/${opponentDeckId}/cards`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ card_id: monsterId, quantity: 3 })
        .expect(201);

      const duelRes = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          name: 'Duel de Jonction',
          teams: [
            { name: 'Camp Joueur', participants: [{ character_id: duellist.id, deck_id: deckId }] },
            { name: 'Camp PNJ', participants: [{ character_id: opponent.id, deck_id: opponentDeckId }] },
          ],
        })
        .expect(201);
      expect(duelRes.body.duel.status).toBe('active');
      expect(duelRes.body.duel.teams[0].life_points).toBe(8000);

      await request(app).post(`/api/duels/${duelRes.body.duel.id}/end`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
    });

    it('refuse de créer un duel avec une carte custom sans script (carte créée avant cette exigence, simulée en base)', async () => {
      const scriptless = await Card.create({
        name: 'Carte Sans Script (legacy)',
        type: 'Normal Monster',
        frame_type: 'normal',
        description: '',
        atk: 1000,
        def: 1000,
        level_rank: 4,
        race: 'Warrior',
        attribute: 'EARTH',
        archetype: null,
        card_sets: [],
        card_images: [],
        is_custom: true,
        owner_id: new mongoose.Types.ObjectId(gm1.id),
        created_in_session_id: new mongoose.Types.ObjectId(sessionA.id),
        engine_code: 999999001,
        lua_script: null,
      });

      const duellist = await createCharacter(player.token, sessionA.id, 'Duelliste Sans Script');
      await Character.updateOne({ _id: duellist.id }, { $set: { collection: Array(40).fill(scriptless._id.toString()) } });
      const deckRes = await request(app)
        .post(`/api/characters/${duellist.id}/decks`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ name: 'Deck Sans Script' })
        .expect(201);
      const deckId = deckRes.body.character.decks[0].id;
      await request(app)
        .post(`/api/characters/${duellist.id}/decks/${deckId}/cards`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ card_id: scriptless._id.toString(), quantity: 3 })
        .expect(201);

      const opponent = await createCharacter(gm1.token, sessionA.id, 'Adversaire Sans Script', true);
      const opponentDeckRes = await request(app)
        .post(`/api/characters/${opponent.id}/decks`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ name: 'Deck Adverse 2' })
        .expect(201);
      const opponentDeckId = opponentDeckRes.body.character.decks[0].id;
      await request(app)
        .post(`/api/characters/${opponent.id}/decks/${opponentDeckId}/cards`)
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({ card_id: scriptless._id.toString(), quantity: 3 })
        .expect(201);

      await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          name: 'Duel Refusé',
          teams: [
            { name: 'Camp Joueur', participants: [{ character_id: duellist.id, deck_id: deckId }] },
            { name: 'Camp PNJ', participants: [{ character_id: opponent.id, deck_id: opponentDeckId }] },
          ],
        })
        .expect(400)
        .then((r) => expect(r.body.error.code).toBe('missing_lua_script'));
    });
  });

  describe("activation réelle d'un effet scripté (création -> deck -> duel -> activation -> résolution)", () => {
    // Le point que les tests précédents NE couvrent PAS : jusqu'ici, une
    // carte custom traverse le pipeline collection -> deck -> duel, mais
    // aucun test ne l'active réellement pour vérifier que le moteur exécute
    // VRAIMENT son script (par opposition à juste le charger sans erreur).
    // Scénario validé en direct contre le vrai binaire avant d'écrire ce
    // test HTTP (voir TARGETED_DESTROY_LUA_SCRIPT ci-dessus) : le joueur
    // active la carte custom, le moteur ouvre une vraie chaîne, demande une
    // vraie cible (MSG_SELECT_CARD, pas simulé), puis détruit RÉELLEMENT la
    // cible choisie via le script — vérifié via /field (cimetière).
    it('la carte custom active réellement son script : chaîne, choix de cible, destruction effective', async () => {
      const spell = await request(app)
        .post('/api/custom-cards')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          card: { category: 'spell', spell_type: 'normal', effect_text: 'Détruit 1 monstre ciblé.', name: 'Purge de Test' },
          lua_script: TARGETED_DESTROY_LUA_SCRIPT,
        })
        .expect(201);
      const spellId = spell.body.card.id as string;

      // Cible réelle : Celtic Guardian (91152256, Niveau 4 vanille — passcode
      // confirmé en interrogeant cards.cdb ailleurs cette session), seedée
      // directement en base comme carte officielle (le moteur lit ses
      // vraies stats/son absence de script dans BabelCDB, pas ce document).
      const celtic = await Card.create({
        ygoprodeck_id: 91152256,
        engine_code: 91152256,
        name: 'Celtic Guardian',
        type: 'Normal Monster',
        frame_type: 'normal',
        description: 'Carte vanille de test.',
        atk: 1400,
        def: 1200,
        level_rank: 4,
        race: 'Warrior',
        attribute: 'EARTH',
        archetype: null,
        card_sets: [],
        card_images: [
          { image_id: 91152256, image_url: 'https://images.ygoprodeck.com/images/cards/91152256.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/91152256.jpg', image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/91152256.jpg' },
        ],
        is_custom: false,
      });

      const caster = await createCharacter(player.token, sessionA.id, 'Lanceuse de Purge');
      const target = await createCharacter(gm1.token, sessionA.id, 'Porteur de Cible', true);

      await Character.updateOne({ _id: caster.id }, { $set: { collection: Array(3).fill(spellId) } });
      const casterDeck = await request(app).post(`/api/characters/${caster.id}/decks`).set('Authorization', `Bearer ${player.token}`).send({ name: 'Deck Purge' }).expect(201);
      const casterDeckId = casterDeck.body.character.decks[0].id as string;
      await request(app).post(`/api/characters/${caster.id}/decks/${casterDeckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: spellId, quantity: 3 }).expect(201);

      const targetDeck = await request(app).post(`/api/characters/${target.id}/decks`).set('Authorization', `Bearer ${gm1.token}`).send({ name: 'Deck Cible' }).expect(201);
      const targetDeckId = targetDeck.body.character.decks[0].id as string;
      await request(app).post(`/api/characters/${target.id}/decks/${targetDeckId}/cards`).set('Authorization', `Bearer ${gm1.token}`).send({ card_id: celtic._id.toString(), quantity: 3 }).expect(201);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          name: 'Duel Purge',
          rules: { starting_lp: 8000, hand_size: 1, draw_count_per_turn: 1 },
          teams: [
            { name: 'Camp Lanceuse', participants: [{ character_id: caster.id, deck_id: casterDeckId }] },
            { name: 'Camp Cible', participants: [{ character_id: target.id, deck_id: targetDeckId }] },
          ],
        })
        .expect(201);
      const duelId = created.body.duel.id as string;

      const tokenFor = (characterId: string) => (characterId === target.id ? gm1.token : player.token);
      const participantByTeam = (duel: { participants: Array<{ team: number; is_active: boolean; character_id: string; id: string }> }, team: number) =>
        duel.participants.find((p) => p.team === team && p.is_active)!;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function passOptionalChains(duel: any): Promise<any> {
        while (duel.pending_prompt?.type === 'chain' && !duel.pending_prompt.forced) {
          const acting = participantByTeam(duel, duel.pending_prompt.playerid);
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
        const acting = participantByTeam(duel, duel.current_team);
        const res = await request(app)
          .post(`/api/duels/${duelId}/idle-action`)
          .set('Authorization', `Bearer ${tokenFor(acting.character_id)}`)
          .send({ participant_id: acting.id, category: IdleCmdCategory.TO_END, index: 0 })
          .expect(200);
        return passOptionalChains(res.body.duel);
      }

      // Fait passer les tours jusqu'à ce que Celtic Guardian soit invocable
      // (main de la cible), l'invoque, puis passe encore jusqu'à ce que la
      // carte Purge soit activable côté lanceuse.
      let duel = created.body.duel;
      let targetSummoned = false;
      let spellReady = false;
      for (let i = 0; i < 20 && !spellReady; i += 1) {
        const acting = participantByTeam(duel, duel.current_team);
        if (acting.character_id === target.id && !targetSummoned) {
          const idleRes = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
          const summonOpt = idleRes.body.duel.pending_prompt?.summonable?.find((o: { card: { name: string } | null }) => o.card?.name === 'Celtic Guardian');
          if (summonOpt) {
            const summonRes = await request(app)
              .post(`/api/duels/${duelId}/idle-action`)
              .set('Authorization', `Bearer ${gm1.token}`)
              .send({ participant_id: acting.id, category: IdleCmdCategory.SUMMON, index: idleRes.body.duel.pending_prompt.summonable.indexOf(summonOpt) })
              .expect(200);
            const place = firstAvailablePlace(summonRes.body.duel.pending_prompt.flag);
            const placeRes = await request(app)
              .post(`/api/duels/${duelId}/select-place`)
              .set('Authorization', `Bearer ${gm1.token}`)
              .send({ participant_id: acting.id, selections: [{ player: acting.team, location: place!.location, sequence: place!.sequence }] })
              .expect(200);
            duel = await passOptionalChains(placeRes.body.duel);
            targetSummoned = true;
            continue;
          }
        }
        if (acting.character_id === caster.id && targetSummoned) {
          const current = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
          const activateOpt = current.body.duel.pending_prompt?.activatable?.find((o: { card: { name: string } | null }) => o.card?.name === 'Purge de Test');
          if (activateOpt) {
            duel = current.body.duel;
            spellReady = true;
            continue;
          }
        }
        duel = await endTurn(duel);
      }
      expect(spellReady).toBe(true);

      const casterParticipant = participantByTeam(duel, duel.current_team);
      const activateOpt = duel.pending_prompt.activatable.find((o: { card: { name: string } | null }) => o.card?.name === 'Purge de Test');

      const activateRes = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: casterParticipant.id, category: IdleCmdCategory.ACTIVATE, index: duel.pending_prompt.activatable.indexOf(activateOpt) })
        .expect(200);

      // Après activation : soit un placement de zone (Magie/Piège) reste à
      // faire pour la carte elle-même, soit on est déjà à l'invite de cible.
      let afterActivate = activateRes.body.duel;
      if (afterActivate.pending_prompt?.type === 'select_place') {
        const place = firstAvailablePlace(afterActivate.pending_prompt.flag);
        const placeRes = await request(app)
          .post(`/api/duels/${duelId}/select-place`)
          .set('Authorization', `Bearer ${player.token}`)
          .send({ participant_id: casterParticipant.id, selections: [{ player: casterParticipant.team, location: place!.location, sequence: place!.sequence }] })
          .expect(200);
        afterActivate = placeRes.body.duel;
      }

      // Le VRAI script demande alors la cible (MSG_SELECT_CARD réel, pas simulé).
      expect(afterActivate.pending_prompt.type).toBe('select_card');
      expect(afterActivate.pending_prompt.cards).toHaveLength(1);
      expect(afterActivate.pending_prompt.cards[0].card.name).toBe('Celtic Guardian');

      const targetRes = await request(app)
        .post(`/api/duels/${duelId}/select-card`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: casterParticipant.id, indices: [0] })
        .expect(200);
      // Résolu : la chaîne se termine, un nouveau prompt (jamais null) suit.
      expect(targetRes.body.duel.pending_prompt).not.toBeNull();
      // La cible étant choisie, le moteur ouvre encore une fenêtre de
      // chaîne (les deux camps peuvent répondre) AVANT que le lien ne se
      // résolve pour de bon — il faut la traverser pour que la destruction
      // soit vraiment effective au moment où on interroge /field.
      await passOptionalChains(targetRes.body.duel);

      // Vérification finale : Celtic Guardian a RÉELLEMENT été détruit par
      // le script custom — il n'est plus sur le terrain, il est au cimetière.
      const field = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
      const teams = field.body.field.teams as Array<{
        monster_zones: Array<{ card: { name: string } | null } | null>;
        graveyard: Array<{ card: { name: string } | null }>;
      }>;
      const stillOnField = teams.some((t) => t.monster_zones.some((z) => z?.card?.name === 'Celtic Guardian'));
      const inGraveyard = teams.some((t) => t.graveyard.some((c) => c.card?.name === 'Celtic Guardian'));
      expect(stillOnField).toBe(false);
      expect(inGraveyard).toBe(true);

      await request(app).post(`/api/duels/${duelId}/end`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
    });
  });

  describe('une cible face cachée reste anonyme au moment du choix, même pour celui qui décide', () => {
    // Script identique au précédent, MAIS dont le filtre de cible n'exige
    // plus `IsFaceup()` (ex. certains effets réels ciblent aussi le face
    // caché) — pour vérifier qu'un vrai MSG_SELECT_CARD portant sur une
    // carte face cachée adverse masque bien son identité (`card: null`)
    // dans la réponse HTTP, MÊME pour le joueur qui choisit la cible :
    // en vrai jeu, on ne sait pas ce qu'est une carte posée face cachée
    // avant qu'elle ne soit retournée. Le MJ, lui, pilote ici le PNJ CIBLÉ
    // dans ce duel précis : il n'est plus "superviseur pur" (voir
    // computeCanSeeTeam) et ne voit donc PAS non plus le détail de la
    // décision de l'ADVERSAIRE de son PNJ — retour utilisateur explicite,
    // voir la cible ruinerait le RP en jouant le PNJ.
    const BLIND_TARGET_LUA_SCRIPT = `--Purge Aveugle (cible même face cachée)
local s,id=GetID()
function s.initial_effect(c)
	local e1=Effect.CreateEffect(c)
	e1:SetCategory(CATEGORY_DESTROY)
	e1:SetType(EFFECT_TYPE_ACTIVATE)
	e1:SetCode(EVENT_FREE_CHAIN)
	e1:SetTarget(s.target)
	e1:SetOperation(s.activate)
	c:RegisterEffect(e1)
end
function s.filter(c)
	return c:IsDestructable()
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc) end
	if chk==0 then return Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil) end
	Duel.Hint(HINT_CARD,0,id)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local c=Duel.GetFirstTarget()
	if c and c:IsRelateToEffect(e) then
		Duel.Destroy(Group.FromCards(c),REASON_EFFECT)
	end
end
`;

    it("le monstre posé face cachée par l'adversaire apparaît comme cible anonyme (card: null) pour le joueur qui choisit ; le MJ qui pilote la cible dans ce duel ne voit plus le détail de cette décision adverse non plus", async () => {
      const spell = await request(app)
        .post('/api/custom-cards')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          card: { category: 'spell', spell_type: 'normal', effect_text: 'Détruit 1 monstre ciblé, même face cachée.', name: 'Purge Aveugle' },
          lua_script: BLIND_TARGET_LUA_SCRIPT,
        })
        .expect(201);
      const spellId = spell.body.card.id as string;

      const celtic = await Card.create({
        ygoprodeck_id: 91152257,
        engine_code: 91152257,
        name: 'Celtic Guardian (face cachée)',
        type: 'Normal Monster',
        frame_type: 'normal',
        description: 'Carte vanille de test.',
        atk: 1400,
        def: 1200,
        level_rank: 4,
        race: 'Warrior',
        attribute: 'EARTH',
        archetype: null,
        card_sets: [],
        card_images: [
          { image_id: 91152257, image_url: 'https://images.ygoprodeck.com/images/cards/91152257.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/91152257.jpg', image_url_cropped: 'https://images.ygoprodeck.com/images/cards_cropped/91152257.jpg' },
        ],
        is_custom: false,
      });

      const caster = await createCharacter(player.token, sessionA.id, 'Lanceuse Aveugle');
      const target = await createCharacter(gm1.token, sessionA.id, 'Porteur Aveugle', true);

      await Character.updateOne({ _id: caster.id }, { $set: { collection: Array(3).fill(spellId) } });
      const casterDeck = await request(app).post(`/api/characters/${caster.id}/decks`).set('Authorization', `Bearer ${player.token}`).send({ name: 'Deck Aveugle' }).expect(201);
      const casterDeckId = casterDeck.body.character.decks[0].id as string;
      await request(app).post(`/api/characters/${caster.id}/decks/${casterDeckId}/cards`).set('Authorization', `Bearer ${player.token}`).send({ card_id: spellId, quantity: 3 }).expect(201);

      const targetDeck = await request(app).post(`/api/characters/${target.id}/decks`).set('Authorization', `Bearer ${gm1.token}`).send({ name: 'Deck Cible Aveugle' }).expect(201);
      const targetDeckId = targetDeck.body.character.decks[0].id as string;
      await request(app).post(`/api/characters/${target.id}/decks/${targetDeckId}/cards`).set('Authorization', `Bearer ${gm1.token}`).send({ card_id: celtic._id.toString(), quantity: 3 }).expect(201);

      const created = await request(app)
        .post('/api/duels')
        .set('Authorization', `Bearer ${gm1.token}`)
        .send({
          game_session_id: sessionA.id,
          name: 'Duel Purge Aveugle',
          rules: { starting_lp: 8000, hand_size: 1, draw_count_per_turn: 1 },
          teams: [
            { name: 'Camp Lanceuse', participants: [{ character_id: caster.id, deck_id: casterDeckId }] },
            { name: 'Camp Cible', participants: [{ character_id: target.id, deck_id: targetDeckId }] },
          ],
        })
        .expect(201);
      const duelId = created.body.duel.id as string;

      const tokenFor = (characterId: string) => (characterId === target.id ? gm1.token : player.token);
      const participantByTeam = (duel: { participants: Array<{ team: number; is_active: boolean; character_id: string; id: string }> }, team: number) =>
        duel.participants.find((p) => p.team === team && p.is_active)!;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function passOptionalChains(duel: any): Promise<any> {
        while (duel.pending_prompt?.type === 'chain' && !duel.pending_prompt.forced) {
          const acting = participantByTeam(duel, duel.pending_prompt.playerid);
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
        const acting = participantByTeam(duel, duel.current_team);
        const res = await request(app)
          .post(`/api/duels/${duelId}/idle-action`)
          .set('Authorization', `Bearer ${tokenFor(acting.character_id)}`)
          .send({ participant_id: acting.id, category: IdleCmdCategory.TO_END, index: 0 })
          .expect(200);
        return passOptionalChains(res.body.duel);
      }

      // Fait passer les tours jusqu'à ce que Celtic Guardian soit "posable"
      // (MSET, face cachée défense) côté cible, la pose, puis jusqu'à ce que
      // Purge Aveugle soit activable côté lanceuse.
      let duel = await passOptionalChains(created.body.duel);
      let targetSet = false;
      let spellReady = false;
      for (let i = 0; i < 20 && !spellReady; i += 1) {
        const acting = participantByTeam(duel, duel.current_team);
        if (acting.character_id === target.id && !targetSet) {
          const idleRes = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
          const msetOpt = idleRes.body.duel.pending_prompt?.msetable?.find((o: { card: { name: string } | null }) => o.card?.name === 'Celtic Guardian (face cachée)');
          if (msetOpt) {
            const msetRes = await request(app)
              .post(`/api/duels/${duelId}/idle-action`)
              .set('Authorization', `Bearer ${gm1.token}`)
              .send({ participant_id: acting.id, category: IdleCmdCategory.MSET, index: idleRes.body.duel.pending_prompt.msetable.indexOf(msetOpt) })
              .expect(200);
            const place = firstAvailablePlace(msetRes.body.duel.pending_prompt.flag);
            const placeRes = await request(app)
              .post(`/api/duels/${duelId}/select-place`)
              .set('Authorization', `Bearer ${gm1.token}`)
              .send({ participant_id: acting.id, selections: [{ player: acting.team, location: place!.location, sequence: place!.sequence }] })
              .expect(200);
            duel = await passOptionalChains(placeRes.body.duel);
            targetSet = true;
            continue;
          }
        }
        if (acting.character_id === caster.id && targetSet) {
          const current = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${player.token}`).expect(200);
          const activateOpt = current.body.duel.pending_prompt?.activatable?.find((o: { card: { name: string } | null }) => o.card?.name === 'Purge Aveugle');
          if (activateOpt) {
            duel = current.body.duel;
            spellReady = true;
            continue;
          }
        }
        duel = await endTurn(duel);
      }
      expect(spellReady).toBe(true);

      const casterParticipant = participantByTeam(duel, duel.current_team);
      const activateOpt = duel.pending_prompt.activatable.find((o: { card: { name: string } | null }) => o.card?.name === 'Purge Aveugle');

      const activateRes = await request(app)
        .post(`/api/duels/${duelId}/idle-action`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: casterParticipant.id, category: IdleCmdCategory.ACTIVATE, index: duel.pending_prompt.activatable.indexOf(activateOpt) })
        .expect(200);

      let afterActivate = activateRes.body.duel;
      if (afterActivate.pending_prompt?.type === 'select_place') {
        const place = firstAvailablePlace(afterActivate.pending_prompt.flag);
        const placeRes = await request(app)
          .post(`/api/duels/${duelId}/select-place`)
          .set('Authorization', `Bearer ${player.token}`)
          .send({ participant_id: casterParticipant.id, selections: [{ player: casterParticipant.team, location: place!.location, sequence: place!.sequence }] })
          .expect(200);
        afterActivate = placeRes.body.duel;
      }

      expect(afterActivate.pending_prompt.type).toBe('select_card');
      expect(afterActivate.pending_prompt.cards).toHaveLength(1);
      // Cœur du test : la cible EST proposée (le moteur, lui, connaît sa
      // vraie identité en interne), mais son nom/image ne sont PAS révélés
      // au joueur qui doit pourtant choisir — exactement comme sur un vrai
      // plateau, où on désigne "ce monstre face cachée là", pas son nom.
      expect(afterActivate.pending_prompt.cards[0].card).toBeNull();
      expect(afterActivate.pending_prompt.cards[0].position & 0x8).toBeTruthy(); // FACEDOWN_DEFENSE

      // Le MJ pilote ici le PNJ CIBLÉ (le camp `target`) dans ce duel précis :
      // il n'a donc PAS de vision privilégiée sur la décision de l'ADVERSAIRE
      // de son PNJ (le camp `caster`, qui choisit la cible) — cette invite
      // lui revient réduite (`redacted: true`), exactement comme pour un
      // vrai adversaire, pas de fuite via le siège MJ.
      const asGm = await request(app).get(`/api/duels/${duelId}`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
      expect(asGm.body.duel.pending_prompt.redacted).toBe(true);

      const targetRes = await request(app)
        .post(`/api/duels/${duelId}/select-card`)
        .set('Authorization', `Bearer ${player.token}`)
        .send({ participant_id: casterParticipant.id, indices: [0] })
        .expect(200);
      await passOptionalChains(targetRes.body.duel);

      // Malgré l'anonymat côté réponse HTTP, l'effet s'est bien résolu sur
      // la BONNE carte en interne : elle est réellement détruite.
      const field = await request(app).get(`/api/duels/${duelId}/field`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
      const teams = field.body.field.teams as Array<{
        monster_zones: Array<{ card: { name: string } | null } | null>;
        graveyard: Array<{ card: { name: string } | null }>;
      }>;
      const stillOnField = teams.some((t) => t.monster_zones.some((z) => z?.card?.name === 'Celtic Guardian (face cachée)'));
      const inGraveyard = teams.some((t) => t.graveyard.some((c) => c.card?.name === 'Celtic Guardian (face cachée)'));
      expect(stillOnField).toBe(false);
      expect(inGraveyard).toBe(true);

      await request(app).post(`/api/duels/${duelId}/end`).set('Authorization', `Bearer ${gm1.token}`).expect(200);
    });
  });

  it("le propriétaire change l'image d'une carte custom (PATCH .../image, sans redonner tout le reste de la carte)", async () => {
    const created = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({
        game_session_id: sessionA.id,
        card: { category: 'trap', trap_type: 'normal', effect_text: 'Image de test.', name: 'Piège Image de Test', image_url: 'https://example.com/old.png' },
        lua_script: DUMMY_LUA_SCRIPT,
      })
      .expect(201);
    expect(created.body.card.card_images[0].image_url).toBe('https://example.com/old.png');

    const updated = await request(app)
      .patch(`/api/custom-cards/${created.body.card.id}/image`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({ image_url: 'https://example.com/new.png' })
      .expect(200);
    expect(updated.body.card.card_images[0].image_url).toBe('https://example.com/new.png');
    // Le reste de la carte est inchangé — pas besoin de tout renvoyer.
    expect(updated.body.card.name).toBe('Piège Image de Test');
    expect(updated.body.card.description).toBe('Image de test.');

    // Un tiers (même MJ d'une autre partie) ne peut pas modifier une carte qu'il ne possède pas.
    await request(app)
      .patch(`/api/custom-cards/${created.body.card.id}/image`)
      .set('Authorization', `Bearer ${gm2.token}`)
      .send({ image_url: 'https://example.com/hack.png' })
      .expect(403);
  });

  it('le propriétaire supprime une carte custom', async () => {
    const created = await request(app)
      .post('/api/custom-cards')
      .set('Authorization', `Bearer ${gm1.token}`)
      .send({
        game_session_id: sessionA.id,
        card: { category: 'trap', trap_type: 'normal', effect_text: 'Jetable.', name: 'Piège Jetable de Test' },
        lua_script: DUMMY_LUA_SCRIPT,
      })
      .expect(201);

    await request(app).delete(`/api/custom-cards/${created.body.card.id}`).set('Authorization', `Bearer ${gm1.token}`).expect(204);

    const list = await request(app)
      .get(`/api/custom-cards/session/${sessionA.id}`)
      .set('Authorization', `Bearer ${gm1.token}`)
      .expect(200);
    expect(list.body.cards.some((c: { id: string }) => c.id === created.body.card.id)).toBe(false);
  });
});
