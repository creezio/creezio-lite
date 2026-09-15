# syntax=docker/dockerfile:1
# Image générique serveur marque Creezio (headless) — sans Electron/AppImage.
#
# Image modulaire par variant (SERVER_VARIANT) :
#   base    (défaut) — kernel + API + CRM Next + Meili
#   browser          — + chromium/xvfb/fonts : sidecar navigateur IA
#                      (CREEZIO_BROWSER_SIDECAR=1, profils /data/browser).
#                      L'image base n'est jamais alourdie.
#
# Layout marque (SERVER_DIR) :
#   server (défaut) — monorepo : workspace npm racine + livrable server/
#   .               — layout plat legacy (tout à la racine marque)
#
# Deps @creezio/* = packages npm publiés sur GitHub Packages (plus de
# vendoring). Le token passe par secret BuildKit — jamais en ARG/ENV, donc
# rien dans l'historique d'image ni dans `docker history` :
#   docker build --secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN …
# Le .npmrc racine de la marque (commité, SANS secret) référence
# ${CREEZIO_NPM_TOKEN} — expansé par npm au moment du npm ci.
#
# Build context = racine marque (ex. tempoflow3) :
#   docker build -f $CREEZIO_KIT_ROOT/docker/server/Dockerfile \
#     --build-arg SERVER_DIR=server \
#     --secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN \
#     -t creezio-server-<brandId>:local /path/to/brand
#
# Build 100% in-image (stage brand-build) : tsc (build/electron) + materialize
#   os-ui + next build (ui/.next/standalone). L'hôte ne fournit QUE les sources
#   git — node/npm de l'hôte ne produisent AUCUN artefact consommé par l'image
#   (brand.dockerignore v5 exclut **/node_modules, **/.next, build/ du contexte).
#   Même image, même comportement, sur tous les serveurs : une seule commande
#   (`creezio server-docker build`), zéro divergence possible.
# Runtime : startBrandKernelHarness via scripts/brand-kernel-harness.mjs
#   → boot-status HTTP dès le démarrage (GET /api/v1/os/boot-status)
#   → reverse-proxy UI Next standalone (CRM navigateur sur /)
# Bind HTTP Docker : CREEZIO_HTTP_HOST=0.0.0.0 (publier sur 127.0.0.1 côté hôte)

ARG SERVER_VARIANT=base
ARG SERVER_DIR=server
# Version applicative embarquée (publish : creezio server-docker publish --tag X).
ARG SERVER_VERSION=0.0.0-local

FROM node:22-bookworm-slim AS deps
ARG SERVER_DIR
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Deps du livrable serveur = workspace npm racine (lockfile racine SoT).
# .npmrc commité sans secret : @creezio → registry.npmjs.org (public, sans token).
# Le secret CREEZIO_NPM_TOKEN reste accepté (marques pas encore migrées).
# (server/ui reste un projet npm indépendant avec son propre lockfile :
# l'UI Next est servie en standalone self-contained, ses deps ne vont pas
# dans l'image.)
COPY package.json package-lock.json .npmrc ./
COPY ${SERVER_DIR}/package.json ./${SERVER_DIR}/package.json
# P1.c : resources/vendor+scripts+bin vivent dans @creezio/host-runtime.
# On PURGE le wrapper npm `electron` + `electron-updater` (binaire fat).
# `@creezio/electron-shell` RESTE : app-runtime (compose/boot-progress/
# start-brand-desktop barrel) importe encore splash-ui / createLocalSplashSteps
# (JS pur, zéro binaire Electron). ELECTRON_SKIP_BINARY_DOWNLOAD reste
# posé (lock marque historique peut lister electron en dev=false).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# Resilience registre : reset TLS transitoire sous charge (2 npm ci
# concurrents — vecu idem). Retries npm via env, identique partout.
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=15000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
# Monorepo : -w ${SERVER_DIR} = seules les deps du livrable serveur
# (install workspace → node_modules RACINE, walk-up standard depuis
# /app/${SERVER_DIR}). Layout plat : npm ci à la racine (la racine EST le
# livrable). npm ci strict : le lock commité est garanti frais par les
# gates (test-clone-autonomy + CI marque) — pas de fallback silencieux.
RUN --mount=type=secret,id=CREEZIO_NPM_TOKEN \
    export CREEZIO_NPM_TOKEN="$(cat /run/secrets/CREEZIO_NPM_TOKEN 2>/dev/null || true)" \
  && if [ "${SERVER_DIR}" = "." ]; then \
       npm ci --omit=dev --no-audit --no-fund; \
     else \
       npm ci --omit=dev --workspace="${SERVER_DIR}" --no-audit --no-fund; \
     fi \
  && rm -rf node_modules/electron \
            node_modules/electron-updater \
  && npm rebuild better-sqlite3

# Meilisearch Linux embarqué — recherche réelle (plus de sql-fallback).
# Version alignée sur ensure-kit-binaries.ts (@creezio/host-runtime).
FROM node:22-bookworm-slim AS meili
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/meilisearch \
    https://github.com/meilisearch/meilisearch/releases/download/v1.11.3/meilisearch-linux-amd64 \
  && chmod 755 /usr/local/bin/meilisearch \
  && /usr/local/bin/meilisearch --version

# cloudflared Linux embarqué — tunnel d'accès distant, exécuté IN-PROCESS
# par le kernel (fin du sidecar). Version PINÉE (reproductibilité : plus de
# releases/latest) — alignée sur ensure-kit-binaries.ts.
# CREEZIO_SKIP_KIT_BINARIES=1 au run : le binaire vient de l'image, jamais
# téléchargé au boot.
FROM node:22-bookworm-slim AS cloudflared
ARG CLOUDFLARED_VERSION=2026.7.3
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/cloudflared \
    https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64 \
  && chmod 755 /usr/local/bin/cloudflared \
  && /usr/local/bin/cloudflared --version

# ---------------------------------------------------------------------------
# Stage brand-build — build runtime (tsc) + UI Next 100% dans l'image.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS brand-build
ARG SERVER_DIR
# Outils de build natif (better-sqlite3 et cie) — stage jetable, jamais
# copié dans le runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Manifests d'abord (cache BuildKit) : racine + livrable serveur.
COPY package.json package-lock.json .npmrc ./
COPY ${SERVER_DIR}/package.json ./${SERVER_DIR}/package.json
# Deps COMPLÈTES du livrable serveur (dev inclus : typescript pour tsc…).
# ELECTRON_SKIP_BINARY_DOWNLOAD : le binaire electron est inutile pour tsc —
# le télécharger alourdirait le stage sans rien apporter à l'image serveur.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=15000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
RUN --mount=type=secret,id=CREEZIO_NPM_TOKEN \
    export CREEZIO_NPM_TOKEN="$(cat /run/secrets/CREEZIO_NPM_TOKEN 2>/dev/null || true)" \
  && if [ "${SERVER_DIR}" = "." ]; then \
       npm ci --no-audit --no-fund; \
     else \
       npm ci --workspace="${SERVER_DIR}" --no-audit --no-fund; \
     fi
# Sources marque (filtrées par brand.dockerignore v5 : aucun artefact hôte).
COPY . .
# Overlay kit local optionnel (démo VPS sans bump pin) :
#   <brand>/.creezio-kit-overlay/<pkg> → node_modules/@creezio/<pkg>
# avant tsc / next build. Dossier gitignoré côté marque.
RUN if [ -d .creezio-kit-overlay ]; then \
      mkdir -p node_modules/@creezio; \
      for d in .creezio-kit-overlay/*; do \
        [ -d "$d" ] || continue; \
        name="$(basename "$d")"; \
        rm -rf "node_modules/@creezio/$name"; \
        cp -a "$d" "node_modules/@creezio/$name"; \
        echo "kit overlay (build): @creezio/$name"; \
      done; \
    fi
# UI Next : projet npm indépendant (lockfile propre) — install + builds.
#   build:runtime = tsc → <SERVER_DIR>/build/electron (requis par le harness :
#   app-manifest, migrations, API métier). build:ui = materialize os-ui (lit
#   @creezio/os-ui hoisté racine) + next build → ui/.next/standalone.
#   App sans ui/ : stage vide garanti par mkdir, runtime = API seule.
RUN --mount=type=secret,id=CREEZIO_NPM_TOKEN \
    export CREEZIO_NPM_TOKEN="$(cat /run/secrets/CREEZIO_NPM_TOKEN 2>/dev/null || true)" \
  && P="./${SERVER_DIR}" \
  && if [ -f "$P/ui/package.json" ]; then \
       npm ci --prefix "$P/ui" --no-audit --no-fund; \
     fi \
  && npm run build:runtime --prefix "$P" \
  && if [ -f "$P/ui/package.json" ]; then \
       npm run build:ui --prefix "$P"; \
     fi \
  && mkdir -p "$P/ui/.next/standalone" "$P/ui/.next/static" "$P/ui/public"

FROM node:22-bookworm-slim AS runtime-base
ARG SERVER_DIR
ARG SERVER_VERSION
ARG IMAGE_SOURCE
# xz-utils : l'install Hermes (warm natif) extrait un node runtime .tar.xz.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Version image = version applicative (GET /api/v1/core/version — SoT flotte).
# IMAGE_SOURCE = remote git marque (publish → GHCR rattache le package au repo).
ENV CREEZIO_APP_VERSION=${SERVER_VERSION}
LABEL org.opencontainers.image.version=${SERVER_VERSION}
LABEL org.opencontainers.image.source=${IMAGE_SOURCE}

COPY --from=meili /usr/local/bin/meilisearch /opt/creezio/bin/meilisearch
COPY --from=cloudflared /usr/local/bin/cloudflared /opt/creezio/bin/cloudflared

# Sources marque (brand.dockerignore v5 : sources server/ et server/ui
# incluses ; artefacts hôte exclus — tout artefact de build vient du stage
# brand-build ci-dessous, jamais de l'hôte).
COPY . .

# Deps rebuildées (COPY . ne ramène pas node_modules grâce au dockerignore).
# node_modules à la RACINE : résolution standard par walk-up depuis
# /app/${SERVER_DIR} (packages npm réels — plus de vendor ni de symlink).
COPY --from=deps /app/node_modules ./node_modules
RUN if [ -d .creezio-kit-overlay ]; then \
      mkdir -p node_modules/@creezio; \
      for d in .creezio-kit-overlay/*; do \
        [ -d "$d" ] || continue; \
        name="$(basename "$d")"; \
        rm -rf "node_modules/@creezio/$name"; \
        cp -a "$d" "node_modules/@creezio/$name"; \
        echo "kit overlay (runtime): @creezio/$name"; \
      done; \
    fi

# Artefacts de build produits IN-IMAGE (stage brand-build) :
#   build/electron  — harness : app-manifest, migrations, API métier
#   ui/.next/standalone + static + public — CRM navigateur servi par le kernel
COPY --from=brand-build /app/${SERVER_DIR}/build ./${SERVER_DIR}/build
COPY --from=brand-build /app/${SERVER_DIR}/ui/.next/standalone ./${SERVER_DIR}/ui/.next/standalone
COPY --from=brand-build /app/${SERVER_DIR}/ui/.next/static ./${SERVER_DIR}/ui/.next/static
COPY --from=brand-build /app/${SERVER_DIR}/ui/public ./${SERVER_DIR}/ui/public

# Workdir = livrable serveur (monorepo : /app/server ; plat : /app).
WORKDIR /app/${SERVER_DIR}

ENV NODE_ENV=production \
    CREEZIO_HTTP_HOST=0.0.0.0 \
    CREEZIO_NATIVE_WARM=0 \
    CREEZIO_TUNNEL_LOCAL=1 \
    CREEZIO_SKIP_KIT_BINARIES=1 \
    MEILI_BINARY=/opt/creezio/bin/meilisearch \
    CREEZIO_CLOUDFLARED_BINARY=/opt/creezio/bin/cloudflared \
    METIER_DATA_DIR=/data \
    PORT=18791 \
    METIER_PORT=18791

VOLUME ["/data"]
EXPOSE 18791

HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=8 \
  CMD curl -fsS "http://127.0.0.1:${METIER_PORT:-18791}/api/v1/core/health" || exit 1

# Le CMD n'est pas supposé être le seul process du container : un variant
# peut lancer des sidecars (browser, …) via un entrypoint superviseur.
CMD ["node", "scripts/brand-kernel-harness.mjs"]

# ---------------------------------------------------------------------------
# Variant browser — sidecar navigateur IA (CREEZIO_BROWSER_SIDECAR=1) :
#   chromium + xvfb + fonts (liberation/noto) + libs rendu.
# Profils persistants /data/browser/<aiUserId> (même volume /data).
# Recommandé au run : --shm-size=1g (Chromium /dev/shm) — appliqué par le
# CLI `creezio server-docker create --browser`.
# Activation : docker build --build-arg SERVER_VARIANT=browser …
# ---------------------------------------------------------------------------
FROM runtime-base AS runtime-browser
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium xvfb \
    fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 libxss1 \
  && rm -rf /var/lib/apt/lists/* \
  && chromium --version
ENV CREEZIO_BROWSER_SIDECAR=1 \
    CREEZIO_CHROMIUM_BIN=/usr/bin/chromium \
    CREEZIO_BROWSER_DATA_DIR=/data/browser

# Stage final : sélectionné par SERVER_VARIANT (base par défaut).
FROM runtime-${SERVER_VARIANT} AS runtime