# Moteur de duel réel (remplace le plateau manuel — voir CLAUDE.md et le plan
# d'intégration). Compile ocgcore (moteur d'EDOPro, AGPLv3+, voir
# https://github.com/edo9300/ygopro-core), embarque les vraies données de
# cartes officielles (BabelCDB) et les vrais scripts d'effet (Project Ignis
# CardScripts), et produit ocgcore_server, le binaire persistant (un process
# par duel) que le backend pilotera. Rien à voir avec backend/ ou frontend/
# à ce stade : image autonome, testable indépendamment.
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    ca-certificates \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/edo9300/ygopro-core.git ygopro-core
# Version alignée sur ygopro-core (static_assert LUA_VERSION_NUM 503-505) et
# sur ce que Debian/Ubuntu empaquette (liblua5.4 5.4.6), même si on ne s'en
# sert plus au final (voir note ci-dessous) : ça vient d'être vérifié cohérent.
RUN git clone --depth 1 --branch v5.4.6 https://github.com/lua/lua.git lua-src
# Données de cartes officielles (stats + scripts d'effet réels, Project Ignis).
RUN git clone --depth 1 https://github.com/ProjectIgnis/BabelCDB.git babel-cdb
RUN git clone --depth 1 https://github.com/ProjectIgnis/CardScripts.git card-scripts

WORKDIR /poc
COPY poc/main.cpp poc/main_real_card.cpp poc/server.cpp ./
COPY poc/scripts ./scripts
RUN mkdir -p data/CardScripts && \
    cp /src/babel-cdb/cards.cdb data/cards.cdb && \
    cp -r /src/card-scripts/. data/CardScripts/

# lua.h n'est PAS enveloppé dans `extern "C"` par ygopro-core (vérifié dans
# scriptlib.h) : le projet s'attend donc à ce que Lua soit compilé EN C++
# (symboles mangled), pas lié à la libsystème liblua5.4 (compilée en C pur —
# confirmé par un premier essai : "undefined reference" malgré des flags
# pkg-config corrects). On recompile donc Lua depuis les sources avec g++,
# comme le fait le build "vendored" officiel du projet (voir .gitmodules).
RUN mkdir -p lua-obj && cd lua-obj && \
    for f in /src/lua-src/*.c; do \
      base=$(basename "$f" .c); \
      case "$base" in lua|luac|onelua|ltests) continue;; esac; \
      g++ -std=c++17 -O2 -x c++ -c "$f" -I/src/lua-src -o "$base.o"; \
    done

RUN g++ -std=c++17 -O2 -I/src/ygopro-core -I/src/lua-src \
    main.cpp /src/ygopro-core/*.cpp lua-obj/*.o \
    -o ocgcore_poc
RUN g++ -std=c++17 -O2 -I/src/ygopro-core -I/src/lua-src \
    main_real_card.cpp /src/ygopro-core/*.cpp lua-obj/*.o \
    -o ocgcore_poc_real_card
RUN g++ -std=c++17 -O2 -I/src/ygopro-core -I/src/lua-src \
    server.cpp /src/ygopro-core/*.cpp lua-obj/*.o \
    -lsqlite3 \
    -o ocgcore_server

ENTRYPOINT ["/poc/ocgcore_server"]
