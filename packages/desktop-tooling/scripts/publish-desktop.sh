#!/usr/bin/env bash
# Publie l'installeur (NSIS win / AppImage linux) + latest*.yml vers le feed.
# Générique multi-marque — paramétré par AppManifest (@creezio/brand-config).
#
# Usage (depuis le crm/ d'une app, ou avec --app-root) :
#   CREEZIO_BRAND=tempoflow bash …/publish-desktop.sh
#   bash …/publish-desktop.sh --brand=certivan --kind=server
#   bash …/publish-desktop.sh --brand=fidu --dry-run
#
# Variables :
#   CREEZIO_BRAND / --brand     tempoflow|certivan|fidu|tempoflow3… (requis)
#   CREEZIO_KIND / --kind       client|server (défaut: client)
#   CREEZIO_PLATFORM / --platform  win|linux (défaut: win ; linux = AppImage)
#   CREEZIO_APP_ROOT / --app-root
#   VERSION                     override version package.json
#   {ENV}_DL_DIR                override dossier DL hôte
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLING_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOLVE="${SCRIPT_DIR}/resolve-config.mjs"

BRAND="${CREEZIO_BRAND:-}"
KIND="${CREEZIO_KIND:-client}"
PLATFORM="${CREEZIO_PLATFORM:-win}"
APP_ROOT="${CREEZIO_APP_ROOT:-}"
DRY_RUN=0

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --brand=*) BRAND="${1#*=}" ;;
    --brand) BRAND="$2"; shift ;;
    --kind=*) KIND="${1#*=}" ;;
    --kind) KIND="$2"; shift ;;
    --platform=*) PLATFORM="${1#*=}" ;;
    --platform) PLATFORM="$2"; shift ;;
    --app-root=*) APP_ROOT="${1#*=}" ;;
    --app-root) APP_ROOT="$2"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage ;;
    *) echo "ERROR: arg inconnu: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -n "${BRAND}" ]] || { echo "ERROR: --brand / CREEZIO_BRAND requis" >&2; exit 2; }
case "${PLATFORM}" in
  win|windows|nsis) PLATFORM="win" ;;
  linux|appimage|AppImage) PLATFORM="linux" ;;
  *) echo "ERROR: --platform win|linux (reçu: ${PLATFORM})" >&2; exit 2 ;;
esac

# Si pas d'app-root : cwd seulement si c'est un crm Electron marque,
# sinon laisser resolve-config utiliser manifest.publish.defaultAppRoot.
if [[ -z "${APP_ROOT}" ]]; then
  if [[ -f "./package.json" ]] && {
    [[ -f "./electron-builder.yml" ]] || [[ -d "./scripts/electron" ]] || [[ -d "./electron" ]]
  }; then
    APP_ROOT="$(pwd)"
  fi
fi

RESOLVE_ARGS=(--brand="${BRAND}" --kind="${KIND}" --platform="${PLATFORM}")
[[ -n "${APP_ROOT}" ]] && RESOLVE_ARGS+=(--app-root="${APP_ROOT}")
[[ -n "${VERSION:-}" ]] && RESOLVE_ARGS+=(--version="${VERSION}")

# shellcheck disable=SC1090
eval "$(node "${RESOLVE}" "${RESOLVE_ARGS[@]}" --export-shell)"

die() { echo "ERROR: $*" >&2; exit 1; }

DIST="${CREEZIO_DIST_ABS}"
EXE="${CREEZIO_EXE}"
ALIAS="${CREEZIO_ALIAS}"
LEGACY_ALIAS="${CREEZIO_LEGACY_ALIAS:-}"
FEED_URL="${CREEZIO_FEED_URL}"
DL_ROOT="${CREEZIO_HOST_DL_ROOT}"
DL_DIR="${CREEZIO_HOST_DL_DIR}"
DOCKER_DL_DIR="${CREEZIO_DOCKER_DL_DIR}"
NPM_CT="${CREEZIO_NPM_CONTAINER}"
TITLE="${CREEZIO_TITLE}"
VERSION="${CREEZIO_VERSION}"
KIND="${CREEZIO_KIND}"
BLOCKMAP="${EXE}.blockmap"
LATEST_YML="${CREEZIO_LATEST_YML:-latest.yml}"
TMP_YML="/tmp/creezio-${BRAND}-${KIND}-${PLATFORM}-latest.yml"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "→ DRY-RUN publication ${TITLE} ${VERSION} (brand=${BRAND} kind=${KIND} platform=${PLATFORM})"
  echo "  source : ${DIST}/${EXE}"
  echo "  feed   : ${FEED_URL}/"
  echo "  dl     : ${DL_DIR} (docker ${DOCKER_DL_DIR})"
  echo "  alias  : ${ALIAS}"
  echo "  yml    : ${LATEST_YML}"
  [[ -n "${LEGACY_ALIAS}" ]] && echo "  legacy : ${LEGACY_ALIAS}"
  echo "  artefacts présents : $([[ -f "${DIST}/${EXE}" ]] && echo oui || echo non)"
  exit 0
fi

[[ -f "${DIST}/${EXE}" ]] || die "manquant : ${DIST}/${EXE}"
[[ -f "${DIST}/${LATEST_YML}" ]] || die "manquant : ${DIST}/${LATEST_YML} (rebuild avec publish configuré)"

PUBLISH_VIA_DOCKER=0
PUBLISH_VIA_SSH=0
REMOTE_HOST="${CREEZIO_REMOTE_BUILD_HOST:-}"
# TempoFlow : le feed prod (crm.tempoflow.fr) vit sur l'hôte remote-build.
# Le NPM local Creezio peut avoir un dossier dl-tempoflow STALE — ne pas le
# préférer, sinon publish « réussit » en local et latest.yml public reste vieux.
FEED_HOST="$(printf '%s' "${FEED_URL}" | sed -E 's|^https?://([^/]+)/.*|\1|')"
if [[ -n "${REMOTE_HOST}" ]] \
  && [[ "${FEED_HOST}" != "fidu.creez.io" && "${FEED_HOST}" != "certivan.creez.io" ]] \
  && ssh -o BatchMode=yes -o ConnectTimeout=15 "${REMOTE_HOST}" \
    "docker exec ${NPM_CT} test -d /data/${CREEZIO_DOCKER_DL_NAME}" >/dev/null 2>&1; then
  PUBLISH_VIA_SSH=1
elif [[ -d "${DL_ROOT}" ]]; then
  :
elif docker exec "${NPM_CT}" test -d "/data/${CREEZIO_DOCKER_DL_NAME}" 2>/dev/null; then
  PUBLISH_VIA_DOCKER=1
else
  die "dossier DL introuvable : ${DL_ROOT}"
fi

echo "→ Publication ${TITLE} ${VERSION} (brand=${BRAND} kind=${KIND})"
echo "  source : ${DIST}/${EXE}"
if [[ "${PUBLISH_VIA_SSH}" -eq 1 ]]; then
  echo "  cible  : ${REMOTE_HOST}:/data/${CREEZIO_DOCKER_DL_NAME}/ (ssh + docker cp)"
fi

sha256sum "${DIST}/${EXE}" | awk '{print $1"  '"${EXE}"'"}' > "${DIST}/${EXE}.sha256"

copy_to_dl() {
  local src="$1" name="$2" dest_dir="$3"
  if [[ "${PUBLISH_VIA_SSH}" -eq 1 ]]; then
    local remote_tmp="/tmp/creezio-publish-${BRAND}-${KIND}-$$"
    ssh -o BatchMode=yes "${REMOTE_HOST}" "mkdir -p '${remote_tmp}' && docker exec ${NPM_CT} mkdir -p '${DOCKER_DL_DIR}'"
    rsync -a "${src}" "${REMOTE_HOST}:${remote_tmp}/${name}"
    ssh -o BatchMode=yes "${REMOTE_HOST}" \
      "docker cp '${remote_tmp}/${name}' '${NPM_CT}:${DOCKER_DL_DIR}/${name}' && rm -f '${remote_tmp}/${name}'"
  elif [[ "${PUBLISH_VIA_DOCKER}" -eq 1 ]]; then
    docker exec "${NPM_CT}" mkdir -p "${DOCKER_DL_DIR}"
    docker cp "${src}" "${NPM_CT}:${DOCKER_DL_DIR}/${name}"
  else
    mkdir -p "${dest_dir}"
    cp -f "${src}" "${dest_dir}/${name}"
  fi
}

copy_to_dl "${DIST}/${EXE}" "${EXE}" "${DL_DIR}"
copy_to_dl "${DIST}/${EXE}.sha256" "${EXE}.sha256" "${DL_DIR}"
copy_to_dl "${DIST}/${EXE}" "${ALIAS}" "${DL_DIR}"
if [[ -n "${LEGACY_ALIAS}" ]]; then
  copy_to_dl "${DIST}/${EXE}" "${LEGACY_ALIAS}" "${DL_DIR}"
  echo "  + legacy alias ${LEGACY_ALIAS}"
fi

if [[ -f "${DIST}/${BLOCKMAP}" ]]; then
  copy_to_dl "${DIST}/${BLOCKMAP}" "${BLOCKMAP}" "${DL_DIR}"
  echo "  + ${BLOCKMAP}"
else
  echo "  ! blockmap absent (diff download indisponible — OK)"
fi

INDEX_HTML="${DIST}/feed-index.html"
cat > "${INDEX_HTML}" <<EOF
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${TITLE} — téléchargements</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1.25rem;line-height:1.5;color:#111}
  h1{font-size:1.35rem;margin:0 0 .5rem}
  p{color:#444}
  a{color:#0b5fff}
  .card{border:1px solid #ddd;border-radius:10px;padding:1rem 1.25rem;margin:1.25rem 0}
  .ver{font-weight:600}
  code{font-size:.85em;background:#f4f4f5;padding:.1em .35em;border-radius:4px}
</style>
</head>
<body>
  <h1>${TITLE}</h1>
  <p>Feed auto-update (listing de dossier désactivé — c’est normal).</p>
  <div class="card">
    <div class="ver">Version actuelle : ${VERSION}</div>
    <p>
      <a href="${EXE}">Télécharger ${EXE}</a><br/>
      <a href="latest.yml"><code>latest.yml</code></a>
      · <a href="${EXE}.sha256">SHA256</a>
      · alias <a href="${ALIAS}">${ALIAS}</a>
    </p>
  </div>
  <p>URL feed updater :<br/><code>${FEED_URL}/</code></p>
</body>
</html>
EOF
copy_to_dl "${INDEX_HTML}" "index.html" "${DL_DIR}"
echo "  + index.html"

copy_to_dl "${DIST}/${LATEST_YML}" "${LATEST_YML}" "${DL_DIR}"
echo "  + ${LATEST_YML} (copié en dernier)"

echo "  vérif HTTP…"
# L’index directory peut être 403 (autoindex nginx off) — ce n’est pas un échec
# de publication. On exige les artefacts (yml + exe/AppImage).
HTTP_DIR="$(curl -sS -o /dev/null -w '%{http_code}' "${FEED_URL}/")"
case "${HTTP_DIR}" in
  200|403) echo "  index feed HTTP ${HTTP_DIR} (listing optionnel)" ;;
  *) die "index feed HTTP ${HTTP_DIR} (attendu 200 ou 403)" ;;
esac

HTTP_YML="$(curl -sS -o "${TMP_YML}" -w '%{http_code}' "${FEED_URL}/${LATEST_YML}")"
[[ "${HTTP_YML}" == "200" ]] || die "latest.yml HTTP ${HTTP_YML}"

PATH_IN_YML="$(grep -E '^[[:space:]]*path:' "${TMP_YML}" | head -1 | awk '{print $2}' | tr -d '"')"
VER_IN_YML="$(grep -E '^version:' "${TMP_YML}" | head -1 | awk '{print $2}' | tr -d '"')"
[[ "${PATH_IN_YML}" == "${EXE}" ]] || die "latest.yml path='${PATH_IN_YML}' attendu '${EXE}'"
[[ "${VER_IN_YML}" == "${VERSION}" ]] || die "latest.yml version='${VER_IN_YML}' attendu '${VERSION}'"

HTTP_EXE="$(curl -sS -o /dev/null -w '%{http_code}' -I "${FEED_URL}/${EXE}")"
[[ "${HTTP_EXE}" == "200" ]] || die "exe HTTP ${HTTP_EXE}"

echo "OK — feed ${FEED_URL}/"
echo "  latest.yml → version ${VER_IN_YML}, path ${PATH_IN_YML}"
echo "  ${FEED_URL}/${EXE}"
echo "  SHA256 : $(cut -d' ' -f1 "${DIST}/${EXE}.sha256")"
cat "${TMP_YML}"
