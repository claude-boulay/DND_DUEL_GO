# Yu-Gi-Oh! D&D — Plateforme de jeu de rôle

[![CI](https://github.com/claude-boulay/DND_DUEL_GO/actions/workflows/ci.yml/badge.svg)](https://github.com/claude-boulay/DND_DUEL_GO/actions/workflows/ci.yml)

Application web full-stack pour animer des parties de JDR sur table Yu-Gi-Oh! :
fiches de personnage type D&D, dés serveur-autoritatifs avec rerolls de Chance,
cartes officielles et custom, économie/boutiques, deckbuilding et duels multi-NPC
pilotés par le MJ.

La spécification fonctionnelle complète se trouve dans [CLAUDE.md](CLAUDE.md).

---

## Démarrage rapide

Prérequis : **Docker Desktop** uniquement. Aucun Node.js local n'est nécessaire.

```bash
cp .env.example .env      # PowerShell : Copy-Item .env.example .env
docker compose up --build
```

| Service  | URL                             |
| -------- | ------------------------------- |
| Frontend | http://localhost:5173           |
| API      | http://localhost:3000/api/health |
| MongoDB  | mongodb://localhost:27017       |

La page d'accueil affiche l'état de l'API, de MongoDB et de la connexion
Socket.io : si les trois sont au vert, la stack est fonctionnelle de bout en bout.

---

## Architecture

```
.
├── docker-compose.yml        # Stack de développement (hot-reload)
├── docker-compose.prod.yml   # Override production (images buildées + Caddy en entrée TLS)
├── Caddyfile                 # Reverse proxy TLS de prod (CADDY_DOMAIN) — voir "Production" ci-dessous
├── .env.example              # Variables d'environnement à copier en .env
├── engine/ocgcore/           # Preuve de faisabilité + notes de validation du moteur de duel réel (voir ci-dessous)
├── backend/                  # Express + Socket.io + Mongoose (TypeScript)
│   ├── Dockerfile            # Cibles : ocgcore-build (moteur C++) → deps → dev / build → prod
│   └── src/
│       ├── config/env.ts     # Validation Zod des variables d'env
│       ├── db/mongo.ts       # Connexion Mongo avec retry
│       ├── middleware/       # Gestion d'erreurs centralisée
│       ├── routes/           # Routes REST
│       ├── services/ocgcoreClient.ts  # Client du process moteur de duel (protocole texte stdin/stdout)
│       ├── sockets/          # Serveur Socket.io typé
│       └── types/socket.ts   # Contrat d'événements (snake_case)
└── frontend/                 # React 19 + Vite + Tailwind v4 (TypeScript)
    ├── Dockerfile            # Cibles : deps → dev / build → prod (Nginx)
    ├── nginx.conf            # Sert le bundle + proxy API/WebSocket
    └── src/
        ├── lib/socket.ts     # Client Socket.io typé (instance unique)
        └── types/socket.ts   # Copie du contrat d'événements du backend
```

### Choix structurants

- **Les duels tournent sur le vrai moteur EDOPro (`ocgcore`, C++, AGPLv3+)**,
  pas une logique de combat écrite à la main. `backend/Dockerfile` clone et
  compile `edo9300/ygopro-core` + les scripts d'effet Project Ignis dans un
  stage dédié (`ocgcore-build`) **à chaque build de l'image backend** — ça
  demande un accès réseau sortant pendant `docker build` (GitHub) et allonge
  sensiblement le tout premier build (compilation C++ complète). Le process
  compilé (`ocgcore_server`) est piloté depuis Node via un petit protocole
  texte sur stdin/stdout (`backend/src/services/ocgcoreClient.ts`) — un
  process enfant par duel actif, état en mémoire uniquement (un redémarrage du
  backend termine tout duel en cours, `status: 'lost'`, non repris).
- **Le front n'appelle que des URLs relatives** (`/api`, `/socket.io`, `/uploads`).
  Le proxy Vite en dev et Nginx en prod routent vers le backend. Aucune URL
  d'API n'est donc embarquée dans le bundle navigateur.
- **Le contrat Socket.io est dupliqué** entre `backend/src/types/socket.ts` et
  `frontend/src/types/socket.ts` pour garder deux contextes de build Docker
  indépendants et légers. Les deux fichiers doivent rester synchronisés ; à
  remplacer par un package partagé si le projet passe en monorepo.
- **Les créations/suppressions de personnages et marchands sont diffusées en
  temps réel** (`session_resource_changed`, émis via `req.app.get('io')` —
  voir `backend/src/utils/broadcast.ts`) aux autres membres du salon déjà
  connectés, qui rechargent alors leur liste. Sans ça, un NPC/marchand ajouté
  par le MJ ou un personnage créé par un joueur qui rejoint restait invisible
  pour les autres jusqu'à quitter/revenir dans le salon.
- **`node_modules` vit dans des volumes nommés**, pas dans les bind mounts :
  les binaires natifs compilés pour Alpine ne sont pas écrasés par ceux de l'hôte.
- **Le hot-reload utilise du polling** (`CHOKIDAR_USEPOLLING` pour `tsx watch`,
  `server.watch.usePolling` pour Vite). Les bind mounts Docker sous Windows et
  macOS ne propagent pas les événements inotify : sans ça, aucun rechargement
  ne se déclenche. Léger surcoût CPU, mais c'est le prix du dev sous Windows.
- **Toute la configuration passe par `src/config/env.ts`** (validation Zod). Le
  serveur refuse de démarrer si une variable est manquante ou invalide.

---

## Commandes utiles

```bash
docker compose up --build            # Démarrer (build si nécessaire)
docker compose logs -f backend       # Suivre les logs d'un service
docker compose restart backend       # Redémarrer un service
docker compose down                  # Arrêter
docker compose down -v               # Arrêter + supprimer les données Mongo

# Ouvrir un shell dans un conteneur
docker compose exec backend sh
docker compose exec mongo mongosh yugioh_dnd

# Ajouter une dépendance (puis rebuild pour figer l'image)
docker compose exec backend npm install <paquet>
docker compose build backend

# Tests backend — Vitest + Supertest
# Unitaires (logique pure : point-buy, formules Chance/Charisme, dés,
# pondération des boosters, JWT, journal d'action...) + e2e (contre une vraie
# base Mongo dédiée `yugioh_dnd_test`, jamais la base de dev), un seul run.
docker compose exec backend npm test
docker compose exec backend npm run test:watch
```

### Production / déploiement sur un serveur

Le déploiement se fait avec les mêmes fichiers `docker-compose.yml` +
`docker-compose.prod.yml` qu'en local — pas de config serveur séparée à
maintenir. Sur une machine (VPS, dédié...) avec **Docker + le plugin Compose**
installés :

```bash
git clone https://github.com/claude-boulay/DND_DUEL_GO.git
cd DND_DUEL_GO
cp .env.example .env       # puis éditer .env — voir la checklist ci-dessous
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Caddy termine le TLS automatiquement** et devient le SEUL point d'entrée
public : `mongo`, `backend` et `frontend` ne publient plus aucun port sur
l'hôte en prod (uniquement joignables entre eux, en interne, sur le réseau
Docker `ygodnd`) — seuls les ports `80`/`443` de `caddy` le sont. Renseignez
`CADDY_DOMAIN` dans `.env` (le domaine pointé vers ce serveur, voir DNS
ci-dessous) : Caddy obtient et renouvelle alors tout seul un certificat Let's
Encrypt pour ce nom, et redirige automatiquement le HTTP vers le HTTPS.
Laisser `CADDY_DOMAIN=localhost` (valeur par défaut) fait fonctionner la
stack quand même, avec un certificat auto-signé — pratique pour tester le mode
prod en local, mais pas pour un vrai déploiement.

Le backend tourne en `NODE_ENV=production` sous l'utilisateur non-root
`node`.

Points spécifiques à un vrai serveur (pas juste `docker compose up` local) :

- **Le premier build compile le moteur de duel en C++** (voir "Choix
  structurants" ci-dessus) : le serveur a besoin d'un accès réseau sortant
  vers GitHub pendant `docker build`, et ce premier build est nettement plus
  long qu'un simple `npm install` (compilation complète d'`ygopro-core` + Lua).
  Les builds suivants (sans changer `engine/ocgcore/poc/server.cpp`) réutilisent
  le cache Docker de ce stage.
- **DNS** : pointez un enregistrement `A` (et `AAAA` si IPv6) de votre domaine
  vers l'IP publique du serveur, et ouvrez les ports `80`/`443` — le `80` sert
  à la validation du certificat Let's Encrypt (challenge HTTP-01), le `443` au
  trafic HTTPS réel.
- **Persistance** : les volumes nommés `mongo_data`, `card_images` (images de
  cartes custom uploadées) et `caddy_data`/`caddy_config` (certificat TLS —
  sans eux, un simple redémarrage du conteneur redemanderait un certificat à
  Let's Encrypt à chaque fois, avec un vrai risque de plafond de requêtes
  atteint) doivent survivre à un redéploiement — `docker compose down` (sans
  `-v`) les conserve ; `docker compose pull`/`up --build` après un `git pull`
  ne les touche pas non plus.
- **Redémarrage automatique** : les quatre services sont en
  `restart: unless-stopped`, donc ils repartent seuls après un reboot du
  serveur ou un crash du daemon Docker.

---

## Intégration continue (GitHub Actions)

`.github/workflows/ci.yml` tourne à chaque push et pull request :

| Job              | Fait quoi |
| ---------------- | --------- |
| `backend-test`   | `tsc --noEmit` + `npm test` (Vitest + Supertest) contre une vraie base Mongo éphémère (service `mongo:7` du job). |
| `frontend-build` | `tsc --noEmit` + `vite build`. |
| `security-audit` | `npm audit --audit-level=high` (backend et frontend) — casse la CI sur une vulnérabilité haute/critique, laisse passer le reste (visible dans les logs). |
| `codeql`         | Analyse statique GitHub CodeQL (`security-and-quality`) — sécurité **et** qualité de code, remonté dans l'onglet Security du repo. |
| `build-images`   | Construit les images `backend` (compile aussi `ocgcore`, voir plus haut) et `frontend` en cible `prod`, sur tout push/PR (valide que les deux `Dockerfile` compilent) ; **publiées sur GHCR uniquement sur push vers `main`** (`ghcr.io/<repo>-backend`/`-frontend`, tags `latest` + SHA du commit), avec cache de build inter-runs (`cache-from`/`cache-to: type=gha`). |

Rien à configurer côté secrets : `GITHUB_TOKEN` (fourni automatiquement par
Actions) suffit pour publier sur GHCR.

---

## À faire avant toute mise en ligne

- [ ] Remplacer `JWT_SECRET` par une valeur aléatoire forte.
- [ ] Activer l'authentification MongoDB (le dev tourne sans identifiants).
- [ ] Passer `CORS_ORIGIN` sur le domaine réel.
- [ ] Renseigner `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`
      (mot de passe oublié) — sans ça le code de réinitialisation part seulement
      dans les logs du conteneur backend, jamais par email, ce qui est le repli
      de dev voulu mais inutilisable pour de vrais joueurs.
- [ ] Renseigner `CADDY_DOMAIN` dans `.env` avec votre vrai nom de domaine (DNS
      pointé dessus au préalable) — Caddy s'occupe du reste (TLS Let's Encrypt
      automatique). Voir "Production / déploiement sur un serveur" ci-dessus.
- [ ] Mettre en place les sauvegardes du volume `mongo_data`.

---

## Feuille de route

- [x] Dockerisation complète (frontend, backend, base de données)
- [x] Authentification JWT & salons de partie par code (`YGO-8941`)
- [x] Proxy/cache YGOPRODeck (import par set/booster) — cron hebdomadaire non fait
- [x] Fiche de personnage (validateur point-buy 27 points)
- [x] Marchands : stock mutable (cartes officielles ET custom, boosters officiels ET custom), prix par article défini par le MJ — banlist toujours non faite. Boutique dédiée plein écran (`MerchantShopOverlay`) : grille d'articles + panneau détail, marchandage au Charisme avec DC/réduction **configurés par article** (pas un DC unique par marchand) et jet relançable via la Chance avant achat. Ajout d'article en plein écran (`MerchantItemPickerOverlay`) : grille de cartes avec recherche/filtre/tri (même système que le deckbuilder), tuiles booster visuelles avec recherche, tri par date de sortie et filtre par plage de dates (depuis/jusqu'à). Le filtre de cartes (catégorie, type de monstre, Pendule, attribut, race) interroge `GET /api/cards` côté serveur (`buildCardCatalogQuery`) sur le catalogue complet, pas seulement la page déjà chargée — idem pour la recherche PNJ du deckbuilder.
- [x] Moteur de dés Socket.io & rerolls de Chance
- [x] Collection joueur, achat, marchandage au Charisme, simulateur d'ouverture de boosters — interface plein écran dédiée (`BoosterOpeningOverlay`) avec cartes révélées une à une (tours de plus en plus rapides) et grande révélation animée (agrandissement + halo doré) pour les tirages Super Rare et plus rares
- [x] Argent des personnages : comme le niveau/l'XP, seul le MJ peut créditer/fixer le solde d'un joueur (`PATCH /characters/:id`) — un joueur peut le faire baisser en achetant chez un marchand (route distincte, server-authoritative) mais plus se créditer lui-même. Interface dédiée "Argent (MJ)" (créditer un montant, ou fixer le total exact) visible uniquement du MJ ; les joueurs voient leur solde en lecture seule.
- [x] Retrouver ses parties (MJ et joueur), suppression d'une partie par le MJ (cascade)
- [x] Deckbuilding : Main/Extra Deck automatique, limité à la collection (sauf decks PNJ du MJ) — banlist custom non faite. Éditeur plein écran (`DeckEditorOverlay`) : aperçu grand format à gauche, Main/Extra au centre, collection à droite ; clic simple = aperçu, double-clic = ajouter/retirer, glisser-déposer depuis la collection vers le deck. Modale de filtre complète (catégorie, type de monstre/magie/piège, Pendule, attribut, race) + bouton reset, et tri (type, date de sortie, ordre d'acquisition — pas de vrai timestamp par carte) avec inversion du sens.
- [x] **Duels pilotés par le vrai moteur EDOPro (`ocgcore`)** — remplace entièrement l'ancien plateau à logique manuelle (ci-dessus était vrai à l'époque : la chaîne affichait le texte d'effet sans l'exécuter). Aujourd'hui : invocation/tribut, phases, calcul de combat et **résolution réelle des effets** (chaîne LIFO exécutée par le vrai script Lua de chaque carte, officielle ou custom) tournent tous sur le moteur lui-même, pas sur une réimplémentation. Duel Tag natif (2 camps, 1 à 5 participants chacun, PV/terrain partagés par camp, decks qui tournent au fil des tours) ; confidentialité par spectateur (main/cartes face cachée visibles seulement du contrôleur et, s'il ne pilote aucun participant de CE duel, du MJ en pure supervision) ; plateau `DuelBoardOverlay` avec zones réelles (Monstre, Magie/Piège, Terrain, Zones Pendule), click-to-act, et convocation temps réel (`duel_invite`) des joueurs concernés à la création. Détail complet dans [CLAUDE.md](CLAUDE.md) §3.6/§7.
- [x] Créateur de cartes custom : monstres (Normal/Effet/Rituel/Fusion/Synchro/Xyz/Lien, Pendule), magies, pièges, image uploadée, script Lua d'effet obligatoire (exécuté par le vrai moteur, jamais de repli "vanille"), liaison à un booster (existant ou nouveau) ou création d'un booster custom vide/gestion dédiée, réutilisable dans toute partie du même MJ — banlist custom toujours pas faite
- [x] Mot de passe oublié par email (code à 6 chiffres, voir `SMTP_*` dans `.env.example`)
