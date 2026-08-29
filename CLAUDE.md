# CLAUDE.md - Yu-Gi-Oh! D&D Platform Guidelines

## 1. Project Overview
This project is a full-stack web application designed for running **Yu-Gi-Oh! Tabletop RPG (D&D)** sessions. It integrates official Yu-Gi-Oh! card data (via YGOPRODeck API), custom cards, character sheets with D&D-style stats, real-time dice rolls with luck-based rerolls, shop/booster management, and multi-NPC duel management for the Game Master (GM).

---

## 2. Tech Stack & Docker Architecture

### Stack Specification
- **Frontend:** React (Vite, TypeScript, Tailwind CSS)
- **Backend:** Node.js (Express, TypeScript, Socket.io)
- **Database:** MongoDB (via Mongoose) or PostgreSQL (via Prisma)
- **External API:** [YGOPRODeck API v7](https://db.ygoprodeck.com/api/v7/cardinfo.php)
- **Containerization:** **Docker & Docker Compose (Mandatory)**

### Dockerization Rules
- **Full Containerization:** Every service (Frontend, Backend, Database) MUST be containerized and runnable via `docker-compose up`.
- **Containers Environment:**
  - `frontend`: Node/Nginx alpine container running Vite build / dev server.
  - `backend`: Node alpine container running Express + Socket.io.
  - `database`: Official MongoDB or PostgreSQL image with persistent volume mounts.
- Environment variables must be handled via `.env` files mounted inside Docker containers.

---

## 3. Exhaustive Feature List

### 3.1 Authentication & Room Management
- Account creation and authentication (JWT-based).
- Game Session creation by GM with customizable session settings. Sessions are linked to their creator's account, and to every player who has joined, so both can find and resume them later without re-entering the room code.
- Player join mechanism via unique Room Code (e.g., `YGO-8941`).
- Characters (inventory, collection, decks included) persist with their session and are recovered automatically when a returning player resumes it.
- GM can delete a finished session ; this cascades to its characters and merchants to avoid unbounded data growth. Cards/CardSets are never deleted this way (shared reference data across sessions).

### 3.2 Character Sheet Management (Player & NPC)
- Point-Buy System: 27 base points to allocate across 5 stats (History, Perception, Intelligence, Charisma, Luck).
- Automatic Stat Scaling: +0.5 bonus added to all stats per character level.
- Custom RP Attributes: Character name, backstory, personality, and visual description.
- GM NPC Management: Creation and control of NPC sheets and dedicated NPC decks.
- Player and Npc Inventory : List where you can write what Player or NPC have on them

### 3.3 Real-Time Game Engine & Luck Mechanics
- Server-authoritative D20 (and generic sides) dice roller via WebSockets.
- **Luck Mechanics:** 1 free reroll granted per 2 points above 10 in Effective Luck in duel or in the parties:
  $$\text{Luck Rerolls} = \max\left(0, \left\lfloor \frac{\text{Effective Luck} - 10}{2} \right\rfloor\right)$$
- Anti-cheat validation: Server verifies and decrements Luck pool before broadcasting rerolls.
- Real-time action log broadcasting roll results, rerolls, and player actions.

### 3.4 Cards, Custom Content & Banlist
- Integration with YGOPRODeck API for official cards & booster set mapping.
- **Custom Card Creator:** GM tool to create custom cards, all types (Normal/Effect/Ritual/Fusion/Synchro/Xyz/Link monsters, incl. Pendulum; Spell — Normal/Continuous/Quick-Play/Equip/Field/Ritual; Trap — Normal/Continuous/Counter), with effect text and an uploaded image. A real, GM-authored **Lua effect script is mandatory** at creation (`lua_script`, validated) — this is what lets a custom card run through the real duel engine (see §3.6) exactly like an official card, with no "vanilla"/unscripted fallback. Custom cards are stored in the same `Card` collection as official ones (`is_custom: true`, same `frame_type` vocabulary), so they flow unmodified through deckbuilding, merchants and booster opening. Ownership is per-creator (the GM): a custom card is reusable in **any other session run by that same GM**, not just the session it was created in — not shared across different GMs. A GM can link a custom card to an existing booster/set or spin up a brand-new custom booster on the fly; that booster then behaves exactly like an official one (sellable by a merchant, rarity-weighted opening) except it never shows up in the official YGOPRODeck set browser/import list.
- Custom Banlist System: GM can define session-specific banlists (Banned, Limited to 1, Semi-Limited to 2).

### 3.5 Economy, Shops & Booster Packs
- Custom Currency: GM configures currency name (e.g., Gold, DP). Pricing is per-item, not global : the GM sets the price of each card/booster individually when adding it to a merchant's stock.
- Merchant Creation: GM sets up shops with single cards, booster packs, and custom stock.
- Charisma Haggling: Automated Charisma skill check against Merchant DC to calculate price discounts.
- Booster Pack Opening Simulator: Animated card opening with weighted rarity selection. Add Card open to the collection of the player who open it
- Option for the GM to add one or multiple card to a player (for the start or after a RP event)


### 3.6 Deckbuilding & Duels
- Player Inventory & Collection Manager.
- Deck Builder supporting custom banlist validation. Cards addable to a deck must be in the character's collection, and are automatically split into Main/Extra Deck by card type (max 3 copies/card, 40-60 Main, 0-15 Extra) — except NPC decks built by the GM, which are exempt from the collection requirement.
- Ability to organize duel player against NPC or player versus player (validation of the start of a duel by the GM)
- **Real duel engine:** duels run on the actual EDOPro engine (`ocgcore`, vendored/compiled into the backend, see `engine/ocgcore/`), not a hand-calculated ruleset — see §7 roadmap for what this automates for real (battle math, phase cycle, summon legality, and genuine chain/effect resolution for both official and scripted custom cards).
- **Team duels (Duel Tag), 2 camps × 1-5 participants each, shared LP/field per camp:** explicit user decision — ocgcore hard-codes exactly 2 LP pools (`std::array<player_info,2>`, confirmed by reading `field.h`), so a true individual-LP battle royale (3+ independent camps) is structurally impossible with one ocgcore duel, not just unbuilt; a genuine "1v1v1" was considered and ruled out for that reason. What IS native and now wired up: ocgcore's own Tag Duel mechanism — several "duelists" sharing one camp's LP and field (monster/spell-trap zones are always camp-level, never personal to a participant), with each duelist's own deck/hand/Extra Deck automatically rotating in at the start of that camp's own turns (`OCG_NewCardInfo.duelist`, `field::tag_swap`). See §7 roadmap for the real engine quirk this surfaced and how the app tracks it correctly.

---

## 4. Coding Conventions & Best Practices

### Backend Guidelines (Node.js / Socket.io)
- **Never trust client state:** Validate Luck points, currency, deck validity, and card counts strictly on the server.
- **Socket Events Naming:** Use snake_case event names (`join_game`, `roll_dice`, `reroll_dice`, `open_pack`, `buy_item`).
- **REST APIs:** Use standard REST for authentication, character creation, custom card management, and deck building.
- **External API Caching:** Cache YGOPRODeck API responses locally/in-memory to avoid hitting rate limits (max 20 req/sec). Maybe first download the cards in database and apply a cron to check for new card or update once a week
- Integrations de tests unitaires , d'intégration et end-to-end
### Frontend Guidelines (React / TypeScript)
- Use typed Socket.io client instances.
- Keep state sync lean: broad game state via socket, granular UI state in React components.
- Separate official card components from custom cards using visual tags (`is_custom: true`).

---

## 5. Key Database Models & Schemas

### User & Game Session
```typescript
interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
}

interface GameSession {
  id: string;
  code: string;
  gm_id: string;
  currency_name: string;
  custom_banlist: string[];
}
```

### Merchant
Stock is mutable after creation : items are added/priced/restocked/removed independently, not fixed at merchant creation time.
```typescript
interface MerchantItem {
  id: string;
  item_type: 'card' | 'booster';
  card_id: string | null;   // set when item_type === 'card'
  set_code: string | null;  // set when item_type === 'booster'
  name: string;              // snapshot for display
  image_url: string | null;
  price: number;             // GM-set, per item
  stock: number | null;      // null = unlimited
}

interface Merchant {
  id: string;
  game_session_id: string;
  name: string;
  description: string;
  items: MerchantItem[];
}
```

### Character Sheet
```typescript
interface CharacterStats {
  history: number;
  perception: number;
  intelligence: number;
  charisma: number;
  luck: number;
}

interface Character {
  id: string;
  user_id: string;
  game_session_id: string;
  name: string;
  is_npc: boolean;
  level: number;
  experience: number;
  money: number;
  backstory: string;
  personality: string;
  visual_description: string;
  stats: CharacterStats;
  remaining_luck_rerolls: number;
  collection: string[];
  decks: { name: string; cards: string[] }[];
}
```

### Custom Card
```typescript
// Réalité de l'implémentation : pas d'interface CustomCard séparée. Une
// carte custom est un document `Card` (voir §5 Card officielle plus haut)
// avec `is_custom: true`, `owner_id` (le MJ créateur — détermine la
// réutilisation inter-parties, pas `created_in_session_id` qui n'est que de
// la traçabilité d'affichage), `ygoprodeck_id` absent (index sparse), et
// `description` qui porte le texte d'effet. `type`/`frame_type`/`race`
// sont dérivés côté serveur à partir d'un formulaire structuré
// (catégorie monstre/magie/piège + sous-type) pour rester dans le même
// vocabulaire que les cartes officielles YGOPRODeck (isExtraDeckFrameType
// fonctionne donc sans distinction custom/officiel). `pendulum_scale` et
// `link_arrows` sont des champs custom-only (null/[] pour les cartes
// officielles). Depuis l'intégration du moteur ocgcore réel (voir §3.6/§7) :
// `engine_code` (number | null, sparse unique) = passcode moteur —
// identique à `ygoprodeck_id` pour une carte officielle, alloué de façon
// synthétique (>= 500 000 000, `Counter.model.ts`) pour une carte custom ;
// `lua_script` (string | null) = script d'effet réel, OBLIGATOIRE et
// validé à la création/mise à jour d'une carte custom (jamais null pour
// `is_custom: true`), c'est ce qui permet à une carte custom de tourner
// dans un vrai duel exactement comme une carte officielle.

---

## 6. Docker Compose Preview (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - MONGO_URI=mongodb://mongo:27017/yugioh_dnd
    depends_on:
      - mongo

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    depends_on:
      - backend

  mongo:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

volumes:
  mongo_data:
```

---

## 7. Roadmap & Tasks
- [ ] Create `Dockerfile` for frontend, backend, and write root `docker-compose.yml`.
- [ ] Setup Auth & Session join by room code.
- [ ] Implement YGOPRODeck proxy/cache module on backend.
- [ ] Build Character Sheet creation page (27-point buy validator).
- [ ] Build GM Dashboard (Custom card builder, Shop manager, Banlist config).
- [ ] Build Socket.io Dice & Luck Reroll engine.
- [ ] Implement Booster Pack opening simulator.
- [x] Custom card creator: all monster/spell/trap subtypes, uploaded image, linkable to a new or existing booster, reusable across every session the same GM runs, with a mandatory GM-authored Lua effect script (see §3.4/§5) required at creation.
- [x] **Real duel engine (replaces the earlier hand-calculated duel board entirely — superseded, not layered on top):** duels are driven by the actual EDOPro engine, `ocgcore` (`edo9300/ygopro-core`, C++, AGPLv3+), vendored and statically compiled straight into the backend image (`engine/ocgcore/`, `backend/Dockerfile` `ocgcore-build` stage) and spoken to over a small stdio protocol by `backend/src/services/ocgcoreClient.ts`. Official cards resolve their **real** Project Ignis Lua effect script (bundled `CardScripts`) against **real** stats from Project Ignis' `BabelCDB` (SQLite `cards.cdb`: ATK/DEF/type/attribute/race/level/rank, Pendulum scale, setcodes), keyed by `ygoprodeck_id` doubling as the engine passcode (`engine_code` on `Card`). Custom cards run through the *exact same* engine mechanism via their mandatory `lua_script` (no "vanilla"/unscripted fallback) with a synthetic `engine_code`. What's genuinely automated now (not just tracked): Normal/Special Summon legality and tribute cost, battle calculation, the full phase cycle, and **actual chain/effect resolution** (real LIFO execution of each card's script, not just a structure/legality tracker surfacing effect text for a human to apply) — e.g. Raigeki really destroys its target via its own official script, no hand-written game logic for that card. Per-viewer visibility (superseded/tightened, see the dedicated roadmap entry below — face-down field cards are no longer public): only the GM and a participant's own controller see hand/Extra Deck contents and a face-down field card's real identity; graveyard/banished piles and face-up field cards stay public. `Duel.model.ts` stores only config + a human-readable event log in Mongo — the live game state exists solely in an in-memory per-process child-process registry (`duelEngine.ts`) tied to the running backend process: a backend restart kills any active duel's engine state (`status: 'lost'`, non-resumable — no engine-state serialization API exists, documented limitation, not a bug). Team duels (2 camps × 1-5 participants, shared LP/field per camp) are now reimplemented on this engine — see the dedicated roadmap entry below for how.
- [x] **Duel frontend rebuilt for the ocgcore engine** (`DuelPanel.tsx`, `DuelBoardOverlay.tsx`, `frontend/src/lib/api.ts` — old manual-system shapes like `ApiDuelRules`'s house-rule toggles, `ApiChainLink`, `placeDuelCard`/`attackDuel`/etc. all removed, not layered on). `DuelPanel.tsx`: create/list a 1v1 duel (one character + one deck per camp). `DuelBoardOverlay.tsx`: real-time board — LP/phase/turn header, per-team monster/spell-trap zones + hand (own/GM view only, matching backend secrecy) + graveyard/banished piles, all populated from a new on-demand endpoint (`GET /duels/:id/field`, see below) — and a prompt panel that renders whatever the engine is actually asking for (`pending_prompt`, resolved server-side with real card name/image/stats attached to every option, not bare codes): idle actions (summon/set/activate/phase-change), battle actions (activate/attack), zone placement, target selection, chain response (activate-in-response or pass — not just pass), yes/no. Real-time relay reuses the existing `session_resource_changed` Socket.io convention (new `'duels'` resource, emitted after every state-changing duel route) rather than a bespoke event — matches "keep state sync lean" (CLAUDE.md §4) and required no new socket event, just a refetch-on-notify like characters/merchants already do. Chain-response friction is a per-viewer, localStorage-persisted 3-way toggle (`DuelBoardOverlay.tsx`, purely client-side, no server concept of it): **ON** always shows the chain prompt, even when the only legal response is to pass; **Auto** shows it only when the viewer's controlled participant actually has a card it could activate in response (`options.length > 0`), auto-passing otherwise; **Off** auto-passes everything except an engine-`forced` prompt (a mandatory/timed effect, which per the OCG protocol can never be passed) — a forced prompt with several options still shows the buttons, since the order of activation is still a real choice. Auto-pass only ever fires for a prompt the viewer actually controls (GM, or the character's own owner) — never for the opposing camp's decision.
  - New backend pieces this needed, found and built along the way: `GET /duels/:id/field` (per-zone board query via `OCG_DuelQueryLocation`, reverse-engineered from `ocgapi.cpp`/`card.cpp` exactly like the `MSG_*` formats before it — self-describing TLV entries per card, terminated by a `QUERY_END` marker); decoders for `MSG_SELECT_CHAIN` (which cards can actually be chained, not just "pass") and `MSG_SELECT_YESNO`/`MSG_SELECT_EFFECTYN` (both carry a `playerid`, previously undecoded); a `wrong_participant` permission check (a prompt's `playerid` now must match the acting participant — every handled prompt type carries it at the same byte offset, confirmed by reading `playerop.cpp`) so a player can't answer on the wrong camp's behalf.
  - Two real correctness bugs surfaced (and fixed) by actually driving the full flow end-to-end rather than assuming the lower-level pieces composed correctly: (1) `OCG_DuelProcess` only processes until it has generated *a* message batch, not until it reaches a real prompt — a single `process()` call per action (the original design) silently stalled the duel mid-resolution; fixed with `pumpUntilSettled()` (`duelEngine.ts`), which loops until the engine actually reaches AWAITING/END. (2) the stdin/stdout protocol has no request IDs, so concurrent calls into the same duel's `OcgcoreDuel` (e.g. `/field`'s per-zone queries fired via `Promise.all`) desynchronized responses and hung; fixed by serializing every command through an internal queue inside `OcgcoreDuel` itself, so any caller anywhere is safe by construction.
- [x] **Remaining engine prompt types decoded** (`MSG_SELECT_TRIBUTE`, `MSG_SELECT_POSITION`, `MSG_SELECT_OPTION`) — 10 of the engine's prompt types are now handled end to end (up from 7): a tribute-cost Normal Summon (Level ≥5) now surfaces a real tribute picker (`select_tribute`, same card-selection response encoding as `MSG_SELECT_CARD` under the hood — both funnel through the engine's `parse_response_cards`, confirmed in `playerop.cpp`) instead of dead-ending on "unhandled"; an explicit Attack/Defense (and face-up/face-down) choice surfaces as `select_position` with buttons for whichever position bits the engine actually offers; a multi-variant effect choice surfaces as `select_option` (no decodable text — no structured effect-text data exists, see the custom-card rationale above — just a raw per-option identifier to cross-reference against the card's printed text). All three verified against the real engine before shipping: `MSG_SELECT_TRIBUTE`'s wire format (and its resolution: the released monster actually leaves the field for the graveyard) was driven end-to-end through the real HTTP API with two real BabelCDB monsters (Celtic Guardian tributed to Normal Summon Summoned Skull, `duel.e2e.test.ts`); `select_position`/`select_option` were confirmed against direct reads of `playerop.cpp` (`field::process(SelectPosition)`/`field::process(SelectOption)`) and covered with source-derived unit tests, the same rigor used for every other message format in this system, though not (yet) driven through a live custom-script scenario the way tribute was.
  - **Second real correctness bug surfaced along the way** (found while testing the tribute flow's rejection path, not something anticipated going in): an invalid response to *any* prompt makes the engine emit `MSG_RETRY` — still `AWAITING`, but *without* re-sending the original prompt's data. The app was overwriting `state.pendingPrompt` with that bare `MSG_RETRY` message, a type no route recognizes — one bad submission (e.g. wrong tribute count) permanently soft-locked the duel in `wrong_prompt` for every future request. Fixed in `applyMessages` (`duelEngine.ts`): `MSG_RETRY` no longer overwrites the pending prompt, so the engine's "ask the same question again" is honored instead of orphaning it — covers every prompt type, not just the three new ones.
- [x] **Team duels (Duel Tag), 2 camps × 1-5 participants each, shared LP/field per camp** (`Duel.model.ts`, `duelEngine.ts`, `duel.routes.ts`, `DuelPanel.tsx`, `DuelBoardOverlay.tsx`) — generalizes the old system's `MIN_TEAMS=2/MAX_TEAMS=2/MAX_TEAM_SIZE=5` on the real engine, per explicit user decision (a true individual-LP battle royale was considered and ruled out — see §3.6, ocgcore hard-codes exactly 2 LP pools). Each participant is tagged `team` (0/1) + `duelist_index` (0-based, order added — becomes the engine's `OCG_NewCardInfo.duelist`); the engine automatically rotates which duelist's deck/hand/Extra Deck is "live" for a camp via `field::tag_swap` (`MSG_TAG_SWAP`, decoded), the app just reacts and exposes `is_active` per participant — hand/deck counts are resynced straight from the engine's own report on every swap (ground truth, not an incremental guess).
  - **Real engine quirk found and worked around by construction, not by special-casing:** `tag_swap`'s trigger condition checks the GLOBAL turn counter (`infos.turn_id != 1`), not the camp's own turn count — confirmed by directly reading `processor.cpp` AND reproducing it live (added `duelist` to the `CARD` command in `server.cpp`/`ocgcoreClient.ts` for the experiment). Consequence: the camp that loses the opening coin flip has its rotation fire on its own very first turn, skipping straight to `duelist_index` 1 instead of starting on 0 — real EDOPro/ocgcore behavior, not a bug. The fix was to never predict the active duelist from the turn number at all: the app counts real `MSG_TAG_SWAP` events per camp and advances `activeDuelistIndex[camp] = swapCount % campSize` in direct reaction — verified by driving both cases live (camp going first: 0,1,0,1,...; camp going second: 1,0,1,0,...) and proven mathematically equivalent to the engine's own internal round-robin regardless of who moves first, so no knowledge of the coin-flip outcome is ever needed.
  - `DuelPanel.tsx`'s create-duel form now adds/removes up to 5 participants per camp; `DuelBoardOverlay.tsx` shows the full roster per camp (highlighting whoever is `is_active`) and always acts through the camp's currently-active participant, never a frozen teammate — enforced server-side too (`requireActiveParticipant`, not just "controls *a* participant on this camp").
  - Verified end-to-end against the real engine with a genuine 2-duelist-vs-1 duel over the full HTTP API (`duel.e2e.test.ts`): correct `duelist_index`/`is_active` at creation, the inactive teammate rejected from acting even though legitimately controlled, the real rotation observed via polling (not assumed), and the newly-active duelist correctly gaining control after it.
- [x] **Custom card effect proven end-to-end (creation → deck → duel → real activation → real resolution)** (`customCard.e2e.test.ts`) — closes a real coverage gap: until this test, nothing actually *activated* a custom card's Lua script in a duel and checked the effect resolved (only "loads without error" or "usable as a target" were covered). A single-target-destroy Normal Spell was hand-written (Project Ignis structure: `CATEGORY_DESTROY` + `EFFECT_TYPE_ACTIVATE` + `Duel.SelectTarget`/`Duel.GetFirstTarget`/`Duel.Destroy`), validated live against the real engine via a scratch driver *before* being wired into the HTTP test (established discipline this session) — first draft used `CATEGORY_TOTARGET`, which doesn't exist as a global constant in this engine build and fails silently (`LOG ERROR`, never surfaced by `OcgcoreDuel`'s normal `MSG`-only parsing; only visible by reading the raw text protocol directly); fixed by dropping it (`CATEGORY_DESTROY` alone is enough, matching the real Raigeki script's own pattern). The HTTP test then drives a real duel over the full API: opponent Normal-Summons a real BabelCDB monster (Celtic Guardian), the custom spell is activated once legal, the resulting `select_card` prompt resolves the real target's name (not a bare code), the target is selected, and `/field` confirms it actually left the monster zone for the graveyard. One more real bug caught by driving the *full* flow rather than assuming the pieces composed: after `select-card` resolves, the engine opens *another* chain window (both camps can still respond) before the link actually resolves — skipping it made the `/field` check race ahead of the real resolution; fixed by looping `passOptionalChains` again after target selection, same helper as everywhere else.
- [x] **Duel visibility/authorization tightened: GM cannot act as a player, prompt detail is per-team, face-down field cards stay anonymous** (`duel.routes.ts`) — three real usability/security bugs found in manual GM testing, not from a spec: (1) the GM could submit actions for a player-controlled participant, not just NPCs — a genuine leak of player agency to the GM seat; (2) every viewer received full prompt detail (hand contents, activatable options) for whichever participant the engine was currently prompting, not just that participant's own team; (3) a face-down monster's real name/image leaked through target-selection option lists (e.g. picking an attack target), even though nobody should know what a face-down card is before it's revealed — same leak existed in `/field`'s board view.
  - New `canActForParticipant(participant, userId, session)` (acting — strict) is now separate from `isControllerOfCharacter` (viewing — the GM still sees everything): NPC actions require GM, player actions require the player's own `user_id`, and `loadActionContext` enforces this on every one of the 9 action routes instead of the old "GM or controller" check.
  - New `computeCanSeeTeam(duel, userId, session): [boolean, boolean]` (GM ⇒ `[true,true]`; otherwise per-team via `isControllerOfCharacter`) drives two redactions: `describePendingPrompt` returns `{type, playerid, redacted: true}` instead of full detail when the viewer can't see the prompting team, and a new `redactFaceDown(options, actingTeam, isGm)` nulls the `card` field (name/image/stats) on any face-down, opponent-controlled entry inside `select_card`/chain option lists — applied identically in `/field`'s per-zone `toBoardCard` so board view and prompt view can't disagree with each other. Tribute lists are exempt (a tribute can only ever target the tributing player's own monsters, never hidden).
  - Verified against the real engine, not just asserted: `duel.e2e.test.ts` gained a describe block with two real player accounts on opposing teams (GM can't act for either — 403; the non-active player's `GET` shows `redacted: true` while GM and the active player see full detail); `customCard.e2e.test.ts` gained a live scenario where a monster is set face-down (`MSET`) and then legally targeted by a custom effect that doesn't require face-up (deliberately dropping the `IsFaceup()` filter a normal target effect would have) — the resulting `select_card` option has `card: null` for the *acting, authorized* player, while a simultaneous GM `GET` on the same prompt shows the real card name; the effect still resolves correctly on the right card underneath (confirmed destroyed via `/field`) proving redaction doesn't break the actual game logic, only what's exposed over HTTP.
- [x] **Frontend/backend GM-authorization mismatch fixed (real bug, GM-reported: the "vous ne contrôlez pas ce participant" toast flickering in a loop during the opponent's turn)** (`DuelBoardOverlay.tsx`) — root cause: the frontend's `controlsParticipant` helper still used the OLD, more permissive semantics (GM controls every participant, for viewing) for a decision that actually needs the STRICT acting semantics (`canActForParticipant` server-side, GM only for NPCs) tightened in the entry above. The chain-response auto-pass effect used the permissive check, so a GM spectating a *player's* chain prompt (with their local chain-mode set to `auto`/`off`) auto-fired an action the server correctly 403'd — and because the effect depended on `busy` and nothing prevented a retry, the moment `busy` flipped back to `false` the same doomed call fired again, forever, flashing the error toast on and off (and capable of pegging the tab, plausibly the reported black-screen). Fixed two ways, independently: (1) a new `canAct(participant)` in the frontend now mirrors the backend exactly (`is_npc ? session.is_gm : own character`) and gates the auto-pass effect *and* every interactive control in the redesigned board below; (2) a `lastAutoChainKeyRef` records a content signature (team/forced/options) of the last chain prompt already auto-attempted — a failed attempt is never retried for the same logical prompt, so even an unrelated future mismatch can't loop forever. `PromptPanel` also gained a `readOnly` mode (driven by the same `canAct` check) that replaces every interactive control with a passive "not your decision" message for a viewer who is not authorized to submit it, rather than letting them click into a guaranteed 403.
- [x] **Duel board interaction rework: act from the hand/board directly, targeting by clicking zones, a real card back** (`DuelBoardOverlay.tsx`) — GM-requested usability pass, built on top of the authorization fix above (its `canAct`/`resolveInteraction` gate every new interactive surface). `resolveInteraction(location, sequence, controller, boardCard)` is the single point of truth for what a rendered card (hand slot or field zone, own or opponent's) can do right now, driven purely by matching the current prompt's option arrays on `(location, sequence, controller)` — the exact same triple `ApiPromptCardOption` already carried, previously unused for this purpose. Idle/Battle prompts: a hand or field card lights up with a colored ring — amber for activatable, sky-blue for summonable/settable, rose for a legal attacker, emerald for reposition-only — and clicking it opens a small floating popup (the card enlarged, round icon buttons above it for each legal action) instead of the old scrolling option lists; those lists are now gone from the idle/battle panel entirely (replaced by a one-line hint + the phase-transition buttons, which aren't tied to a specific card). `select_place`/`select_card` prompts: the matching board zones (or hand slots) become directly clickable to toggle the same selection state the existing list-based panel already used — both paths write to identical state, so the panel's list stays as a fully-working fallback (needed for non-field targets like graveyard picks) rather than being replaced. Chain/tribute/position/option/yes-no prompts are unchanged (list-based), a deliberate scope cut for this pass. Card backs: the bare "?" is replaced everywhere (mini cards, action popup, pile modal, `BoosterOpeningOverlay.tsx`'s pending/flip slots) by `CardBack`, rendering the real official Yu-Gi-Oh! card back (`frontend/src/assets/card-back.jpg`, supplied by the user) — superseded an earlier original CSS-drawn placeholder shipped first for IP caution; the user confirmed using the genuine art is fine for this private, non-commercial tool, consistent with how the app already displays official card art everywhere via YGOPRODeck.
- [ ] **Duel board interaction, remaining scope cuts from the click-to-act rework above**: chain response, tribute, position, and option prompts are still list-based only (not click-to-act on the board) — a deliberate scope cut, not an oversight. The action popup's position is a fixed pixel offset from the clicked card's bounding rect, not dynamically sized to the popup's actual content — acceptable for now but not pixel-perfect on all card aspect ratios/screen sizes.
- [x] **Two more GM-reported usability fixes on the click-to-act rework** (`DuelBoardOverlay.tsx`): (1) the chain-response default was `'on'` (always shows the "activate in chain, or pass?" panel, even with zero real options) — since a chain priority window opens after nearly every action in real OCG rules (not a bug), this read as "asking to activate when nothing could be activated"; default flipped to `'auto'` (only asks when the viewer's participant genuinely has something to activate, silently passing otherwise — still user-changeable via the existing 3-way toggle). (2) `select_card`/`select_tribute` option rows only ever toggled selection on click — there was no way to preview a *revealed* option (e.g. picking a card to add from your own deck) before deciding; each row is now a dedicated preview button (the card art) beside a separate toggle-selection button, mirroring the pattern the `chain` list already used.
- [x] **Real regression in the (1) fix above: `'auto'`/`'off'` stopped auto-passing after their very first success** — the loop-guard ref (`lastAutoChainKeyRef`, added to stop a *failed* auto-pass retrying forever) keyed on prompt *content* (participant/team/`forced`/options list). An empty-option chain window — by far the most common case, since a priority window opens after nearly every action — produces the SAME signature every single time, so once the first one auto-passed successfully, every later one (a genuinely different, later event) matched that cached key and got silently skipped: GM-reported as "as if 'auto' and 'off' were always treated like 'on'." Fixed by only ever writing the ref on *failure*, and clearing it on *success* — a successful auto-pass no longer blocks the next one, even with an identical signature; only a real, repeated failure for the exact same still-pending prompt stays blocked.
- [x] **GM omniscience walked back for any duel where the GM is actually piloting an NPC — "MJ voit tout" now only holds for pure supervision** (`duel.routes.ts`) — the investigation above turned out to have the right diagnosis (GM seat) but the wrong verdict: the user confirmed they were controlling the NPC and explicitly said they should still NOT see the opponent's hidden info even then — "ça ruine le RP" (breaks immersion) to have metagame knowledge for a side they're actively playing. This reverses the blanket "GM sees all" rule from the entry above, which was correct for a MJ purely *supervising* a player-vs-player duel but wrong for a MJ *playing* one side of it.
  - `computeCanSeeTeam(duel, userId, session)` no longer short-circuits to `[true,true]` for any GM. It computes per-team visibility purely from character ownership (`isControllerOfCharacter`, now GM-agnostic — an NPC's `user_id` is already its creating GM, so a GM controlling an NPC gets recognized as that team's controller with no special case needed) and only falls back to full `[true,true]` visibility when the GM controls **zero** participants in *this specific duel* (i.e. a genuine player-vs-player duel with no NPC in it at all — pure supervision, unchanged from before). The moment a GM pilots an NPC in a duel, they see exactly what that NPC's controller would see — their own team's hand/face-down cards, never the opponent's — identically to a real player.
  - `redactFaceDown` dropped its `isGm` bypass entirely; it now takes the same `canSeeTeam: [boolean, boolean]` tuple and redacts a face-down card whenever `!canSeeTeam[card.controller]`, for anyone, GM included. Since `describePendingPrompt`'s outer redaction gate already guarantees `canSeeTeam[promptTeam]` is true for whoever legitimately reaches this code, this cleanly generalizes without a separate acting-team parameter.
  - Every existing "GM sees everything" assertion across `duel.e2e.test.ts`/`customCard.e2e.test.ts` that exercised a GM-controlled-NPC duel was flipped to assert the new, correct behavior (GM sees only their own NPC's secrets, gets `redacted: true` for the opponent's live decisions) — the *only* untouched "GM sees everything" case is the dedicated player-vs-player describe block, which has no NPC at all and correctly keeps full GM supervision. Several test helpers that fetched `pending_prompt` detail via a blanket `gm.token` (a pre-existing convenience, not a visibility test) had to start re-fetching via whichever participant's token actually owns that decision — this was the real trigger for the cascading test failures this change surfaced, not a flaw in the new logic itself.
  - Full suite verified green (263/263) after every affected assertion was individually re-audited and updated, not just patched to pass.
- [x] **Duel board layout, per-viewer** (`DuelBoardOverlay.tsx`) — GM-reported usability gaps, now fixed. `myTeam` (0/1/null) is derived from which team the viewer actually controls a *character* in (`characters.find(...).user_id === currentUserId`), never from `session.is_gm` — a GM spectating with no personal character in the duel gets `null` and keeps the plain, unmirrored 2-section layout (their own reasonable default, since the GM has no "own" side to feature). When `myTeam` is set: `teamRenderOrder` puts the opponent's section first (top/farthest) and the viewer's own last (bottom/nearest); the opponent's zone rows are reversed (`mirrored`), the viewer's own never are. Confirmed live against the real engine (temporary instrumented test run, reverted after) that `spell_trap_zones` is always 8 slots (0-4 normal S/T, 5 = Field Zone, 6-7 = Pendulum Zones) and `monster_zones` is 7 (0-4 main + 5-6 Extra Monster Zones) under the `DUEL_MODE_MR5` flags this app uses — the Field Zone slot (index 5) is pulled out of the row and pinned to its left edge (right edge once mirrored), matching the request; the rest of the S/T row and the full Monster row render in order (reversed together when mirrored, so corresponding zones roughly face each other like a real dueling mat). The viewer's own hand is pulled out of its `ParticipantBoard` card entirely and rendered by a new `HandBar`, pinned to the bottom of the board's scroll area — visible only when `myTeam` is set (a spectating GM still sees hands inline in each team's card, as before, since there's no single "own" hand to feature for them).
- [x] **Booster opening: single quick spin for Common/Rare, hover-to-zoom on revealed cards, "next pack"/"another set" continuation** (`BoosterOpeningOverlay.tsx`, `CharacterList.tsx`) — three GM-requested usability passes. (1) `is_rare_reveal` (already computed server-side, Super Rare and above) now also drives the reveal ANIMATION, not just the "hero" zoom-in: Common/Rare settle after one quick spin (`QUICK_SPIN_DURATIONS`) instead of the full 5-step decreasing-duration buildup (`SPIN_DURATIONS`, kept for genuinely rare pulls). (2) `SettledSlot` scales up (`hover:scale-[2.5]`, `z-20`) on mouse-over so the card's printed text is actually legible, relying on the grid's pre-existing `[overflow:visible]`. (3) `onNext`/`otherSets`/`onOpenOther` props let the SAME overlay instance chain straight into the next booster of the current set, or into a *different* sealed set entirely, once a reveal finishes — no more forced trip back to the main character view between packs; the reveal-progress state is now explicitly reset when `cards` changes so reusing the instance replays the animation instead of showing the new pack as if already revealed.
- [x] **Luck reroll audit, prompted by a direct user question ("does it still work, including haggling and duel coin/dice rolls?")** — three-part finding, one real gap fixed:
  - **General d20/RP rolls** (`sockets/index.ts` `roll_dice`/`reroll_dice`, `rollStore.ts`): untouched by any engine work this session, confirmed still fully server-authoritative (atomic `remaining_luck_rerolls` decrement).
  - **Merchant haggling** (`merchant.routes.ts`): was a genuine pre-existing gap, unrelated to ocgcore — the haggle roll was computed and resolved in a single atomic `POST .../purchase` call, with no reroll option at all. Fixed by splitting it: new `POST /:id/items/:itemId/haggle` rolls and returns a `PendingHaggle` (new `utils/haggleStore.ts`, same in-memory/TTL pattern as `rollStore.ts`) without buying; new `POST /:id/haggle/:haggleId/reroll` spends a Luck reroll on it (identical atomic-decrement guard to `reroll_dice`) and re-resolves `total`/`success` from the *same* negotiated modifier/DC; `purchaseSchema` gained an optional `haggle_id` that finalizes a previously-rolled (and possibly rerolled) negotiation, consuming it so it can't be replayed — the original one-shot inline `haggle: {modifier, discount_percent}` stays supported unchanged for a no-reroll-desired purchase. `MerchantPanel.tsx`'s `PurchaseWidget` now rolls first ("Lancer le marchandage"), shows the result, offers "Relancer (Chance : N)" while `remaining_luck_rerolls > 0` and the roll failed, then "Acheter" to finalize.
  - **Coin toss / dice roll as a duel card effect** (e.g. `Duel.TossCoin`/`Duel.DiceRoll` in a card's Lua script): confirmed NOT Luck-reroll-able, and confirmed **structurally impossible** without patching ocgcore's own C++ source — not merely unimplemented like the other gaps this session. Initial assumption (wrong, corrected after reading the real engine source rather than guessing from generic OCG protocol knowledge): thought this was an undecoded AWAITING prompt (`MessageType` has no `TOSS_COIN`/`TOSS_DICE` entry) that would soft-lock the duel. Actually verified live against `edo9300/ygopro-core`'s `operations.cpp` (`field::process(Processors::TossCoin&)`/`TossDice&`): the engine resolves the toss with its own internal RNG (`pduel->get_next_integer(0,1)` / `(1,6)`) *before* it ever builds the `MSG_TOSS_COIN`/`MSG_TOSS_DICE` message — the message is a pure post-hoc announcement, never a request the engine pauses on (no `AWAITING`/`RESPOND` step exists for it in the engine's own state machine, unlike every other prompt type this app has integrated). There is no point in the flow where the app could intercept and ask "reroll or keep?" — the randomness is already committed, entirely inside the vendored engine, before the app is even told. Making it Luck-reroll-able would require forking/patching ocgcore's C++ RNG call itself to accept an externally-supplied result instead of generating its own — real surgery on a third-party AGPL C++ dependency (with correctness risk to everything else that shares the same RNG stream, e.g. deck shuffling) that would need to be maintained indefinitely against a freshly re-cloned upstream on every build. User decision after being shown this finding: not worth it — dropped, no further action planned unless a real card in actual play makes it worth revisiting.
