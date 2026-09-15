#!/usr/bin/env bash
# Build Windows (NSIS) distant — générique multi-marque (AppManifest).
#
# Workdir distant isolé (ne touche PAS le runtime clients) :
#   {remoteBuildHost}:{remoteBuildRoot}/crm
#
# Publish feed reste LOCAL — flag optionnel --publish.
#
# Usage :
#   CREEZIO_BRAND=tempoflow bash …/remote-build-win.sh
#   bash …/remote-build-win.sh --brand=certivan --dry-run
#   bash …/remote-build-win.sh --brand=fidu --publish
#   bash …/remote-build-win.sh --brand=certivan --skip-sync
#   bash …/remote-build-win.sh --brand=tempoflow --no-build
#   bash …/remote-build-win.sh --brand=certivan --client-only
#
# Statut JSON : /tmp/{brand}-build-status.json (+ dist-electron/build-status.json)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOLVE="${SCRIPT_DIR}/resolve-config.mjs"
PUBLISH_SH="${SCRIPT_DIR}/publish-desktop.sh"

BRAND="${CREEZIO_BRAND:-}"
APP_ROOT="${CREEZIO_APP_ROOT:-}"
DRY_RUN=0
SKIP_SYNC=0
DO_PUBLISH=0
NO_BUILD=0
SKIP_NEXT_BUILD=0
CLIENT_ONLY=0

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --brand=*) BRAND="${1#*=}" ;;
    --brand) BRAND="$2"; shift ;;
    --app-root=*) APP_ROOT="${1#*=}" ;;
    --app-root) APP_ROOT="$2"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    --skip-sync) SKIP_SYNC=1 ;;
    --publish) DO_PUBLISH=1 ;;
    --no-build) NO_BUILD=1 ;;
    --skip-next-build) SKIP_NEXT_BUILD=1 ;;
    --client-only) CLIENT_ONLY=1 ;;
    -h|--help) usage ;;
    *) echo "ERROR: arg inconnu: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -n "${BRAND}" ]] || { echo "ERROR: --brand / CREEZIO_BRAND requis" >&2; exit 2; }

if [[ -z "${APP_ROOT}" ]]; then
  if [[ -f "./package.json" ]] && {
    [[ -f "./electron-builder.yml" ]] || [[ -d "./scripts/electron" ]] || [[ -d "./electron" ]]
  }; then
    APP_ROOT="$(pwd)"
  fi
fi

RESOLVE_ARGS=(--brand="${BRAND}" --kind=client)
[[ -n "${APP_ROOT}" ]] && RESOLVE_ARGS+=(--app-root="${APP_ROOT}")

# shellcheck disable=SC1090
eval "$(node "${RESOLVE}" "${RESOLVE_ARGS[@]}" --export-shell)"

ROOT="${CREEZIO_APP_ROOT}"
REMOTE_HOST="${CREEZIO_REMOTE_BUILD_HOST}"
REMOTE_ROOT="${CREEZIO_REMOTE_BUILD_ROOT}"
REMOTE_CRM="${CREEZIO_REMOTE_CRM}"
REMOTE_BIN_SRC="${CREEZIO_REMOTE_BIN_SRC}"
DIST_LOCAL="${ROOT}/dist-electron"
DIST_LOCAL_SERVER="${ROOT}/dist-electron-server"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20)
STATUS_FILE="${CREEZIO_STATUS_FILE}"
STATUS_DIST="${CREEZIO_STATUS_DIST}"
VERSION="${CREEZIO_VERSION}"
LOG_HINT="${CREEZIO_REMOTE_LOG_HINT}"
EXE_CLIENT="${CREEZIO_EXE}"
BUILD_SERVER="${CREEZIO_BUILD_SERVER}"
SERVER_PLATFORM_ENV="${CREEZIO_SERVER_PLATFORM_ENV}"

if [[ "${CLIENT_ONLY}" -eq 1 ]]; then
  BUILD_SERVER=0
fi

# Résoudre aussi le serveur pour les noms d'artefacts
# shellcheck disable=SC1090
eval "$(node "${RESOLVE}" --brand="${BRAND}" --kind=server --app-root="${ROOT}" --version="${VERSION}" --export-shell | sed 's/^CREEZIO_/CREEZIO_SRV_/')"
EXE_SERVER="${CREEZIO_SRV_EXE}"

log() { echo "▸ $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

ssh_r() { ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"; }

write_status() {
  local state="$1"
  local phase="$2"
  local message="${3:-}"
  node -e '
const fs = require("fs");
const path = require("path");
const [state, phase, message, version, statusFile, statusDist, pid, logHint, brand] = process.argv.slice(1);
const obj = {
  brand,
  version,
  state,
  phase,
  message,
  updatedAt: new Date().toISOString(),
  pid: Number(pid) || null,
  logHint,
};
const tmp = statusFile + ".tmp." + process.pid;
fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
fs.renameSync(tmp, statusFile);
try {
  fs.mkdirSync(path.dirname(statusDist), { recursive: true });
  fs.copyFileSync(statusFile, statusDist);
} catch (_) { /* ignore */ }
' "$state" "$phase" "$message" "$VERSION" "$STATUS_FILE" "$STATUS_DIST" "$$" "$LOG_HINT" "$BRAND"
}

on_fail() {
  local ec=$?
  if [[ "$ec" -ne 0 ]]; then
    write_status "failed" "error" "remote-build exit ${ec}"
  fi
}
trap on_fail EXIT

log "brand=${BRAND} version=${VERSION}"
log "appRoot=${ROOT}"
log "remote=${REMOTE_HOST}:${REMOTE_CRM}"
log "buildServer=${BUILD_SERVER}"
write_status "sync" "start" "démarrage remote-build"

# ── 0. Smoke SSH ──────────────────────────────────────────────────────────
log "SSH BatchMode…"
write_status "sync" "ssh" "smoke SSH BatchMode"
ssh_r "echo ok:\$(hostname):\$(node -v):\$(wine --version 2>/dev/null || echo no-wine)"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude .next
  --exclude dist-electron
  --exclude dist-electron-server
  --exclude build
  --exclude .git
  --exclude '*.log'
  --exclude .env.local
  --exclude userData
  --exclude crash-reports
  --exclude .turbo
  --exclude resources-node/win/
  --exclude resources-win/
  --exclude resources/bin/cloudflared.exe
  --exclude resources/bin/meilisearch-win.exe
  --exclude resources/bin/meilisearch-linux
  --exclude resources/bin/cloudflared
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "dry-run rsync (code)…"
  write_status "idle" "dry-run" "dry-run uniquement"
  rsync -avn --delete "${RSYNC_EXCLUDES[@]}" \
    "${ROOT}/" "${REMOTE_HOST}:${REMOTE_CRM}/" | tail -40
  log "wine32 ?"
  ssh_r 'dpkg -l wine32 2>/dev/null | tail -1; test -d /usr/lib/i386-linux-gnu/wine && echo wine32-libs=ok || echo wine32-libs=MISSING'
  log "dry-run OK — pas de build"
  trap - EXIT
  exit 0
fi

# ── 1. Workdir + binaires Windows ─────────────────────────────────────────
log "Prépare workdir + binaires win…"
write_status "sync" "prepare-remote" "workdir + binaires win"
ssh_r "bash -s" <<EOF
set -euo pipefail
mkdir -p '${REMOTE_CRM}' \\
  '${REMOTE_CRM}/resources-node/win' \\
  '${REMOTE_CRM}/resources-win' \\
  '${REMOTE_CRM}/resources/bin'

copy_if_missing() {
  local src="\$1" dst="\$2"
  if [[ -f "\$dst" ]]; then
    echo "  = présent \$dst"
    return 0
  fi
  if [[ ! -f "\$src" ]]; then
    echo "ERROR: binaire source manquant: \$src" >&2
    exit 1
  fi
  cp -a "\$src" "\$dst"
  echo "  + copié \$dst"
}

SRC='${REMOTE_BIN_SRC}'
copy_if_missing "\$SRC/resources-node/win/node.exe" '${REMOTE_CRM}/resources-node/win/node.exe'
copy_if_missing "\$SRC/resources-win/better_sqlite3.node" '${REMOTE_CRM}/resources-win/better_sqlite3.node'
copy_if_missing "\$SRC/resources/bin/cloudflared.exe" '${REMOTE_CRM}/resources/bin/cloudflared.exe'
copy_if_missing "\$SRC/resources/bin/meilisearch-win.exe" '${REMOTE_CRM}/resources/bin/meilisearch-win.exe'

if ! dpkg -l wine32 2>/dev/null | grep -q '^ii'; then
  echo "ERROR: wine32 non installé sur l'hôte distant (sudo apt install wine32:i386)" >&2
  exit 1
fi
command -v xvfb-run >/dev/null || { echo "ERROR: xvfb-run manquant" >&2; exit 1; }
EOF

# ── 2. rsync code ─────────────────────────────────────────────────────────
if [[ "$SKIP_SYNC" -eq 0 ]]; then
  log "rsync code → remote…"
  write_status "sync" "rsync" "rsync code → remote"
  rsync -az --delete "${RSYNC_EXCLUDES[@]}" \
    "${ROOT}/" "${REMOTE_HOST}:${REMOTE_CRM}/"
else
  log "skip-sync : code distant inchangé"
  write_status "sync" "skip-sync" "code distant inchangé"
fi

if [[ "$NO_BUILD" -eq 1 ]]; then
  log "--no-build : sync terminé"
  write_status "ok" "no-build" "sync terminé (--no-build)"
  trap - EXIT
  exit 0
fi

# ── 3. Build distant ──────────────────────────────────────────────────────
log "Build distant (peut prendre 10–25 min)…"
write_status "building" "remote-build" "next + electron win (distant)"
ssh_r "bash -s" <<EOF
set -euo pipefail
cd '${REMOTE_CRM}'
export ${SERVER_PLATFORM_ENV}=win32
export CSC_IDENTITY_AUTO_DISCOVERY=false

if [[ ! -d node_modules/electron ]]; then
  echo '▸ npm ci…'
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
else
  echo '▸ node_modules présent — npm ci si lock plus récent…'
  if [[ package-lock.json -nt node_modules ]]; then
    npm ci
  fi
fi

NEED_NEXT=1
if [[ '${SKIP_NEXT_BUILD}' == '1' ]] && [[ -d .next/standalone ]]; then
  NEED_NEXT=0
  echo '▸ skip next build (.next/standalone présent)'
fi
if [[ "\$NEED_NEXT" == '1' ]]; then
  echo '▸ next build…'
  npm run build
fi

echo '▸ electron:server (win32)…'
${SERVER_PLATFORM_ENV}=win32 npm run electron:server
echo '▸ electron:compile…'
npm run electron:compile
echo '▸ electron:build:win (client, xvfb + wine)…'
xvfb-run -a npm run electron:build:win

if [[ '${BUILD_SERVER}' == '1' ]]; then
  echo '▸ electron:build:win:server (serveur, xvfb + wine)…'
  xvfb-run -a npm run electron:build:win:server
fi

VER=\$(node -p 'require("./package.json").version')
test -f "dist-electron/${EXE_CLIENT}" \\
  || { echo "ERROR: exe client manquant (attendu ${EXE_CLIENT})"; exit 1; }
if [[ '${BUILD_SERVER}' == '1' ]]; then
  test -f "dist-electron-server/${EXE_SERVER}" \\
    || { echo "ERROR: exe serveur manquant (attendu ${EXE_SERVER})"; exit 1; }
fi
echo '▸ build distant OK'
EOF

# ── 4. Pull artefacts ─────────────────────────────────────────────────────
mkdir -p "${DIST_LOCAL}"
log "rsync artefacts client → ${DIST_LOCAL}/"
write_status "pulling" "pull-artifacts" "rsync artefacts → dist-electron"
rsync -az \
  "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron/${EXE_CLIENT}" \
  "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron/${EXE_CLIENT}.blockmap" \
  "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron/latest.yml" \
  "${DIST_LOCAL}/" \
  || die "échec pull artefacts client (version ${VERSION} ?)"

if command -v sha256sum >/dev/null; then
  sha256sum "${DIST_LOCAL}/${EXE_CLIENT}" | awk '{print $1}' > "${DIST_LOCAL}/${EXE_CLIENT}.sha256"
fi

if [[ "${BUILD_SERVER}" == "1" ]]; then
  mkdir -p "${DIST_LOCAL_SERVER}"
  log "rsync artefacts serveur → ${DIST_LOCAL_SERVER}/"
  rsync -az \
    "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron-server/${EXE_SERVER}" \
    "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron-server/${EXE_SERVER}.blockmap" \
    "${REMOTE_HOST}:${REMOTE_CRM}/dist-electron-server/latest.yml" \
    "${DIST_LOCAL_SERVER}/" \
    || die "échec pull artefacts serveur (version ${VERSION} ?)"
  if command -v sha256sum >/dev/null; then
    sha256sum "${DIST_LOCAL_SERVER}/${EXE_SERVER}" | awk '{print $1}' > "${DIST_LOCAL_SERVER}/${EXE_SERVER}.sha256"
  fi
fi

log "Artefacts prêts — publish NON lancé (sauf --publish)"

# ── 5. Publish optionnel ──────────────────────────────────────────────────
if [[ "$DO_PUBLISH" -eq 1 ]]; then
  log "Publish feed local (client${BUILD_SERVER:+ + serveur})…"
  write_status "publishing" "publish" "publication feed ${CREEZIO_DOCKER_DL_NAME}"
  bash "${PUBLISH_SH}" --brand="${BRAND}" --kind=client --app-root="${ROOT}"
  if [[ "${BUILD_SERVER}" == "1" ]]; then
    bash "${PUBLISH_SH}" --brand="${BRAND}" --kind=server --app-root="${ROOT}"
  fi
  write_status "ok" "done" "build distant + publish ${VERSION}"
else
  log "Pour publier : ${PUBLISH_SH} --brand=${BRAND}  (ou relancer avec --publish)"
  write_status "ok" "done" "build distant ${VERSION} (publish non lancé)"
fi

log "Terminé — build distant ${BRAND} ${VERSION}"
trap - EXIT
