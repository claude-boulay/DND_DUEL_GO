# Yu-Gi-Oh! D&D — Plateforme de jeu de rôle

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
├── docker-compose.prod.yml   # Override production (images buildées + Nginx)
├── .env.example              # Variables d'environnement à copier en .env
├── backend/                  # Express + Socket.io + Mongoose (TypeScript)
│   ├── Dockerfile            # Cibles : deps → dev / build → prod
│   └── src/
│       ├── config/env.ts     # Validation Zod des variables d'env
│       ├── db/mongo.ts       # Connexion Mongo avec retry
│       ├── middleware/       # Gestion d'erreurs centralisée
│       ├── routes/           # Routes REST
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

### Production

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Le frontend est alors servi par Nginx sur le port `8080`, Mongo n'est plus
exposé sur l'hôte, et le backend tourne en `NODE_ENV=production` sous
l'utilisateur non-root `node`.

---

## À faire avant toute mise en ligne

- [ ] Remplacer `JWT_SECRET` par une valeur aléatoire forte.
- [ ] Activer l'authentification MongoDB (le dev tourne sans identifiants).
- [ ] Passer `CORS_ORIGIN` sur le domaine réel.
- [ ] Mettre en place les sauvegardes du volume `mongo_data`.

---

## Feuille de route

- [x] Dockerisation complète (frontend, backend, base de données)
- [x] Authentification JWT & salons de partie par code (`YGO-8941`)
- [x] Proxy/cache YGOPRODeck (import par set/booster) — cron hebdomadaire non fait
- [x] Fiche de personnage (validateur point-buy 27 points)
- [x] Marchands : stock mutable (cartes/boosters), prix par article défini par le MJ — cartes custom et banlist non faites. Ajout d'article en plein écran (`MerchantItemPickerOverlay`) : grille de cartes avec recherche/filtre/tri (même système que le deckbuilder), tuiles booster visuelles avec recherche, tri par date de sortie et filtre par plage de dates (depuis/jusqu'à). Le filtre de cartes (catégorie, type de monstre, Pendule, attribut, race) interroge `GET /api/cards` côté serveur (`buildCardCatalogQuery`) sur le catalogue complet, pas seulement la page déjà chargée — idem pour la recherche PNJ du deckbuilder.
- [x] Moteur de dés Socket.io & rerolls de Chance
- [x] Collection joueur, achat, marchandage au Charisme, simulateur d'ouverture de boosters — interface plein écran dédiée (`BoosterOpeningOverlay`) avec cartes révélées une à une (tours de plus en plus rapides) et grande révélation animée (agrandissement + halo doré) pour les tirages Super Rare et plus rares
- [x] Argent des personnages : comme le niveau/l'XP, seul le MJ peut créditer/fixer le solde d'un joueur (`PATCH /characters/:id`) — un joueur peut le faire baisser en achetant chez un marchand (route distincte, server-authoritative) mais plus se créditer lui-même. Interface dédiée "Argent (MJ)" (créditer un montant, ou fixer le total exact) visible uniquement du MJ ; les joueurs voient leur solde en lecture seule.
- [x] Retrouver ses parties (MJ et joueur), suppression d'une partie par le MJ (cascade)
- [x] Deckbuilding : Main/Extra Deck automatique, limité à la collection (sauf decks PNJ du MJ) — banlist custom non faite. Éditeur plein écran (`DeckEditorOverlay`) : aperçu grand format à gauche, Main/Extra au centre, collection à droite ; clic simple = aperçu, double-clic = ajouter/retirer, glisser-déposer depuis la collection vers le deck. Modale de filtre complète (catégorie, type de monstre/magie/piège, Pendule, attribut, race) + bouton reset, et tri (type, date de sortie, ordre d'acquisition — pas de vrai timestamp par carte) avec inversion du sens.
- [x] Tableau de bord de duel MJ : équipes 1v1 à 5v5, PV/tours/mains, PNJ, règles spéciales (fusion de contact, deck-out...) — plateau plein écran (`DuelBoardOverlay`) avec vrai terrain par participant (5 zones Monstre, 5 zones Magie/Piège, Terrain, main/deck/Extra Deck/cimetière/bannis en vraies listes de cartes, peuplé depuis le deck réel du personnage), invocation avec coût réel (tribut par Niveau, matériau ≥1 pour l'Extra Deck), combat automatisé (ATK/DEF, attaque directe bloquée si l'adversaire contrôle un monstre), cycle de phases (draw/standby/main1/battle/main2/end, `skip_first_battle_phase` désormais réellement appliqué) et main cachée par spectateur (le MJ et le contrôleur voient les cartes, les autres n'ont qu'un compte). Une pile de **chaîne** (ordre, priorité par équipe, légalité de spell speed, résolution LIFO) affiche le texte d'effet de chaque carte à sa place dans la pile mais ne l'exécute pas — aucune donnée d'effet structurée n'existe pour l'automatiser honnêtement (voir `duel.routes.ts`), la résolution reste manuelle via les mêmes outils génériques (déplacement de carte, PV, main).
- [x] Créateur de cartes custom : monstres (Normal/Effet/Rituel/Fusion/Synchro/Xyz/Lien, Pendule), magies, pièges, image uploadée, liaison à un booster (existant ou nouveau), réutilisable dans toute partie du même MJ — banlist custom toujours pas faite
