#!/usr/bin/env bash
# Stage les binaires Windows (Meili + cloudflared) pour le packaging serveur.
#
# Le kit ne sync PAS les bins fat dans vendor/electron-shell/resources/bin
# (sinon asar + extraResources gonflent le client). Le serveur les embarque
# via win.extraResources depuis ce stage (filtre WIN_SERVER_BIN_FILTER).
#
# Convention TF2 : uniquement meilisearch-win.exe + cloudflared.exe
# (pas d'alias meili.exe dupliqué dans le stage / le paquet).
#
# Usage :
#   bash …/stage-win-bins.sh [APP_ROOT]
#   CREEZIO_WIN_BIN_STAGE=/path/stage bash …/stage-win-bins.sh
#   CREEZIO_WIN_BIN_SRC=/path/with/exes bash …/stage-win-bins.sh
#
# Sources (premier hit) :
#   1. CREEZIO_WIN_BIN_SRC
#   2. $APP_ROOT/resources/bin (marque)
#   3. /opt/docker/tempoflow2/crm/resources/bin (dev VPS, si présent)
#
set -euo pipefail

APP_ROOT="$(cd "${1:-.}" && pwd)"
STAGE="${CREEZIO_WIN_BIN_STAGE:-${APP_ROOT}/.creezio/win-bin-stage}"
mkdir -p "${STAGE}"

copy_one() {
  local src="$1" dest="$2"
  if [[ -f "${src}" && -s "${src}" ]]; then
    cp -a "${src}" "${dest}"
    echo "▸ ${dest} ← ${src}"
    return 0
  fi
  return 1
}

SRC_DIRS=()
if [[ -n "${CREEZIO_WIN_BIN_SRC:-}" ]]; then
  SRC_DIRS+=("${CREEZIO_WIN_BIN_SRC}")
fi
SRC_DIRS+=("${APP_ROOT}/resources/bin")
if [[ -d /opt/docker/tempoflow2/crm/resources/bin ]]; then
  SRC_DIRS+=("/opt/docker/tempoflow2/crm/resources/bin")
fi

found_cf=0
found_meili=0
for dir in "${SRC_DIRS[@]}"; do
  [[ -d "${dir}" ]] || continue
  if [[ "${found_cf}" -eq 0 ]]; then
    if copy_one "${dir}/cloudflared.exe" "${STAGE}/cloudflared.exe"; then
      found_cf=1
    fi
  fi
  if [[ "${found_meili}" -eq 0 ]]; then
    if copy_one "${dir}/meilisearch-win.exe" "${STAGE}/meilisearch-win.exe"; then
      found_meili=1
    elif copy_one "${dir}/meili.exe" "${STAGE}/meilisearch-win.exe"; then
      # Source legacy meili.exe → nom canonique TF2 uniquement.
      found_meili=1
      echo "▸ ${STAGE}/meilisearch-win.exe ← renommé depuis meili.exe"
    fi
  fi
  if [[ "${found_cf}" -eq 1 && "${found_meili}" -eq 1 ]]; then
    break
  fi
done

# Purge alias historique pour éviter un doublon ~121 Mo dans le paquet.
rm -f "${STAGE}/meili.exe"

if [[ "${found_cf}" -eq 0 || "${found_meili}" -eq 0 ]]; then
  echo "ERROR: bins Windows incomplets dans ${STAGE}" >&2
  echo "  cloudflared.exe: ${found_cf}" >&2
  echo "  meilisearch-win.exe: ${found_meili}" >&2
  echo "  Définir CREEZIO_WIN_BIN_SRC=… ou déposer les .exe dans resources/bin" >&2
  exit 1
fi

du -sh "${STAGE}"/* | sed 's/^/  /'
echo "OK win-bin-stage → ${STAGE}"
