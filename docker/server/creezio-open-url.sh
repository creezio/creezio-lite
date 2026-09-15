#!/usr/bin/env bash
# Ouvre une URL HTTP dans un navigateur — sans dépendre uniquement de xdg-open.
# Utilisé par les raccourcis Docker server-N ({Product}-Server-{N}.desktop).
set -u

URL="${1:-}"
HOME_DIR="${HOME:-/home/deploy}"
LOG_DIR="${XDG_STATE_HOME:-$HOME_DIR/.local/state}/creezio-server"
LOG="$LOG_DIR/open-server.log"
mkdir -p "$LOG_DIR" 2>/dev/null || true

log() {
  local line="[$(date -Iseconds 2>/dev/null || date)] $*"
  echo "$line" >>"$LOG" 2>/dev/null || true
  echo "$line" >&2
}

if [[ -z "$URL" ]]; then
  log "ERROR usage: creezio-open-url <url>"
  exit 2
fi

# Session XFCE / xrdp : hériter d'un DISPLAY si lancé hors bureau.
if [[ -z "${DISPLAY:-}" ]]; then
  for sock in /tmp/.X11-unix/X10 /tmp/.X11-unix/X*; do
    [[ -S "$sock" ]] || continue
    n="${sock##*/X}"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    export DISPLAY=":$n"
    break
  done
fi
export XAUTHORITY="${XAUTHORITY:-$HOME_DIR/.Xauthority}"
# Snap + binaires locaux (Firefox tarball ~/.local/firefox).
export PATH="$HOME_DIR/bin:$HOME_DIR/.local/firefox:$HOME_DIR/.local/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

log "start url=$URL DISPLAY=${DISPLAY:-} PATH=$PATH XAUTHORITY=${XAUTHORITY:-}"

launch() {
  local bin="$1"
  shift
  local resolved=""
  if [[ -x "$bin" ]]; then
    resolved="$bin"
  elif command -v "$bin" >/dev/null 2>&1; then
    resolved="$(command -v "$bin")"
  else
    return 1
  fi
  log "try $resolved $*"
  # MOZ_DISABLE_CONTENT_SANDBOX aide sur VPS/xrdp (user namespaces souvent bloqués).
  nohup env MOZ_DISABLE_CONTENT_SANDBOX=1 "$resolved" "$@" >>"$LOG" 2>&1 &
  local pid=$!
  # Snap peut double-fork : attendre un peu puis chercher le vrai process.
  sleep 0.8
  if kill -0 "$pid" 2>/dev/null || pgrep -f "$resolved" >/dev/null 2>&1 \
    || pgrep -f '[Ff]irefox' >/dev/null 2>&1 \
    || pgrep -f '[Cc]hromium' >/dev/null 2>&1; then
    log "OK opened with $resolved → $URL (pid $pid)"
    echo "opened with $resolved → $URL (pid $pid)"
    return 0
  fi
  log "FAIL process died immediately: $resolved"
  return 1
}

# 1) Firefox Mozilla tarball (hors snap — fiable hors cgroup session).
launch "$HOME_DIR/.local/firefox/firefox" --new-window "$URL" && exit 0
launch "$HOME_DIR/.local/firefox/firefox" "$URL" && exit 0
launch "$HOME_DIR/bin/firefox-local" --new-window "$URL" && exit 0

# 2) Snap / paquets système.
launch /snap/bin/firefox --new-window "$URL" && exit 0
launch /snap/bin/firefox "$URL" && exit 0
launch /usr/bin/firefox-esr --new-window "$URL" && exit 0
launch /usr/bin/firefox --new-window "$URL" && exit 0
launch firefox --new-window "$URL" && exit 0
launch firefox "$URL" && exit 0
launch /usr/bin/chromium-browser --new-window "$URL" && exit 0
launch /usr/bin/chromium --new-window "$URL" && exit 0
launch chromium-browser --new-window "$URL" && exit 0
launch chromium --new-window "$URL" && exit 0
launch google-chrome --new-window "$URL" && exit 0

# 3) Helpers desktop (vérifier le code retour — ne pas mentir).
if command -v gio >/dev/null 2>&1; then
  log "try gio open $URL"
  if gio open "$URL" >>"$LOG" 2>&1; then
    log "OK gio open → $URL"
    echo "opened with gio open → $URL"
    exit 0
  fi
  log "FAIL gio open"
fi

if command -v xdg-open >/dev/null 2>&1; then
  log "try xdg-open $URL"
  if xdg-open "$URL" >>"$LOG" 2>&1; then
    log "OK xdg-open → $URL"
    echo "opened with xdg-open → $URL"
    exit 0
  fi
  log "FAIL xdg-open"
fi

log "ERROR aucun navigateur pour $URL"
echo "creezio-open-url: aucun navigateur trouvé pour $URL" >&2
echo "Installer Firefox tarball dans ~/.local/firefox ou: sudo snap install firefox" >&2
echo "Log: $LOG" >&2
exit 1
