# syntax=docker/dockerfile:1

# ---------- ocgcore : moteur de duel réel (C++, AGPLv3+) ----------
# Voir engine/ocgcore/ (POC + notes de validation) et le plan d'intégration.
# Contexte de build = racine du repo (voir docker-compose.yml) pour pouvoir
# référencer engine/ocgcore/poc/server.cpp comme unique source de vérité.
# Lié statiquement (-static) : compilé sous glibc (Ubuntu), exécuté ensuite
# dans l'image finale Alpine/musl (le reste du backend) — un binaire
# dynamiquement lié ne s'y chargerait pas, un binaire 100% statique n'a lui
# aucune dépendance runtime à la libc de compilation (l'ABI syscall Linux ne
# change pas entre glibc et musl).
FROM ubuntu:24.04 AS ocgcore-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential git ca-certificates libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/edo9300/ygopro-core.git ygopro-core
RUN git clone --depth 1 --branch v5.4.6 https://github.com/lua/lua.git lua-src
RUN git clone --depth 1 https://github.com/ProjectIgnis/BabelCDB.git babel-cdb
RUN git clone --depth 1 https://github.com/ProjectIgnis/CardScripts.git card-scripts
WORKDIR /ocgcore
COPY engine/ocgcore/poc/server.cpp .
RUN mkdir -p data/CardScripts && \
    cp /src/babel-cdb/cards.cdb data/cards.cdb && \
    cp -r /src/card-scripts/. data/CardScripts/
# lua.h n'est pas enveloppé dans extern "C" par ygopro-core : Lua doit être
# compilé EN C++ (symboles mangled), voir engine/ocgcore/Dockerfile pour le
# détail de ce piège déjà rencontré et documenté.
RUN mkdir -p lua-obj && cd lua-obj && \
    for f in /src/lua-src/*.c; do \
      base=$(basename "$f" .c); \
      case "$base" in lua|luac|onelua|ltests) continue;; esac; \
      g++ -std=c++17 -O2 -x c++ -c "$f" -I/src/lua-src -o "$base.o"; \
    done
RUN g++ -std=c++17 -O2 -static -I/src/ygopro-core -I/src/lua-src \
    server.cpp /src/ygopro-core/*.cpp lua-obj/*.o \
    -lsqlite3 -o ocgcore_server

# ---------- base : dépendances complètes (dev incluses) ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install

# ---------- dev : hot-reload via tsx watch ----------
FROM deps AS dev
ENV NODE_ENV=development
COPY backend/. .
COPY --from=ocgcore-build /ocgcore/ocgcore_server /ocgcore/ocgcore_server
COPY --from=ocgcore-build /ocgcore/data /ocgcore/data
RUN chmod +x /ocgcore/ocgcore_server
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---------- build : compilation TypeScript ----------
FROM deps AS build
COPY backend/. .
RUN npm run build

# ---------- prod : image minimale, dépendances runtime seules ----------
FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=ocgcore-build /ocgcore/ocgcore_server /ocgcore/ocgcore_server
COPY --from=ocgcore-build /ocgcore/data /ocgcore/data
RUN chmod +x /ocgcore/ocgcore_server && mkdir -p /app/uploads && chown -R node:node /app /ocgcore
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
