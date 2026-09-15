#!/usr/bin/env bash
# Wrapper sudo scopé pour les ops flotte (Q3) — installé root:root 0755 dans
# /usr/local/sbin/creezio-server-docker, autorisé seul en NOPASSWD pour le
# user de deploy (remplace NOPASSWD:ALL).
#
#   deploy ALL=(root) NOPASSWD: /usr/local/sbin/creezio-server-docker
#
# N'autorise QUE `creezio server-docker <update|backup|migrate-stack|ls|start|
# stop|logs>` sur des brand roots en allowlist (/opt/docker/*), avec des
# arguments validés (pas d'injection : allowlist stricte + regex par flag).
# Le binaire node du kit est résolu ici — jamais via PATH de l'appelant.
set -euo pipefail

KIT_ROOT="${CREEZIO_KIT_ROOT:-/opt/docker/creezio}"
CLI="$KIT_ROOT/packages/factory/bin/creezio.js"
NODE="$(command -v node)"

die() { echo "creezio-server-docker(sudo): $*" >&2; exit 2; }

[ -x "$CLI" ] || die "CLI kit introuvable: $CLI"
[ -n "$NODE" ] || die "node introuvable"

SUB="${1:-}"
# I/O privilégié des fichiers stack (cf.env, secrets.env, servers.json…) :
# mêmes chemins que persistDedicatedAgentUrl — cat/tee/chmod/rm/test
# uniquement sous …/docker-data/. Jamais un chmod one-shot hors wrapper.
if [ "$SUB" = "priv-io" ]; then
  shift || true
  OP="${1:-}"; shift || true
  case "$OP" in
    cat)
      FILE="${1:-}"
      [ -n "$FILE" ] || die "priv-io cat : chemin requis"
      case "$FILE" in
        */docker-data/*) ;;
        *) die "priv-io : chemin hors docker-data: $FILE" ;;
      esac
      exec cat -- "$FILE"
      ;;
    tee)
      FILE="${1:-}"
      [ -n "$FILE" ] || die "priv-io tee : chemin requis"
      case "$FILE" in
        */docker-data/*) ;;
        *) die "priv-io : chemin hors docker-data: $FILE" ;;
      esac
      exec tee -- "$FILE"
      ;;
    chmod)
      MODE="${1:-}"; FILE="${2:-}"
      [ "$MODE" = "600" ] || die "priv-io chmod : seul 600 est autorisé"
      [ -n "$FILE" ] || die "priv-io chmod : chemin requis"
      case "$FILE" in
        */docker-data/*) ;;
        *) die "priv-io : chemin hors docker-data: $FILE" ;;
      esac
      exec chmod 600 -- "$FILE"
      ;;
    rm)
      [ "${1:-}" = "-f" ] || die "priv-io rm : seul rm -f <chemin> est autorisé"
      FILE="${2:-}"
      [ -n "$FILE" ] || die "priv-io rm : chemin requis"
      case "$FILE" in
        */docker-data/*) ;;
        *) die "priv-io : chemin hors docker-data: $FILE" ;;
      esac
      exec rm -f -- "$FILE"
      ;;
    test)
      [ "${1:-}" = "-e" ] || die "priv-io test : seul test -e <chemin> est autorisé"
      FILE="${2:-}"
      [ -n "$FILE" ] || die "priv-io test : chemin requis"
      case "$FILE" in
        */docker-data/*) ;;
        *) die "priv-io : chemin hors docker-data: $FILE" ;;
      esac
      exec test -e -- "$FILE"
      ;;
    *) die "priv-io op refusée: ${OP:-<vide>} (cat|tee|chmod|rm|test)" ;;
  esac
fi
case "$SUB" in
  update|backup|migrate-stack|ls|start|stop|logs) ;;
  *) die "sous-commande refusée: ${SUB:-<vide>} (update|backup|migrate-stack|ls|start|stop|logs|priv-io)" ;;
esac
shift || true
ORIG_ARGS=("$@")

# Validation des arguments : flags connus + valeurs saines, brand-root en
# allowlist /opt/docker/<repo> existant. Itère sur une copie — ORIG_ARGS est
# rejoué tel quel après validation.
BRAND_ROOT=""
set -- "${ORIG_ARGS[@]}"
HAS_BRAND_ROOT=0
while [ $# -gt 0 ]; do
  a="$1"
  case "$a" in
    --brand-root)
      BRAND_ROOT="${2:-}"; HAS_BRAND_ROOT=1; shift 2 ;;
    --brand-root=*)
      BRAND_ROOT="${a#--brand-root=}"; HAS_BRAND_ROOT=1; shift ;;
    --tag)
      # tags semver (0.7.0) ET auto (auto.202608101152.441a96c) — charset sûr.
      [[ "${2:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]] || die "tag invalide: ${2:-}"
      shift 2 ;;
    --tag=*)
      [[ "${a#--tag=}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]] || die "tag invalide: ${a#--tag=}"
      shift ;;
    --image)
      [[ "${2:-}" =~ ^[A-Za-z0-9./:@_-]+$ ]] || die "image invalide"
      shift 2 ;;
    --image=*)
      [[ "${a#--image=}" =~ ^[A-Za-z0-9./:@_-]+$ ]] || die "image invalide"
      shift ;;
    --registry)
      [[ "${2:-}" =~ ^[A-Za-z0-9.:-]+$ ]] || die "registry invalide"
      shift 2 ;;
    --registry=*)
      [[ "${a#--registry=}" =~ ^[A-Za-z0-9.:-]+$ ]] || die "registry invalide"
      shift ;;
    --host-port|--tail)
      [[ "${2:-}" =~ ^[0-9]+$ ]] || die "valeur numérique requise: $a"
      shift 2 ;;
    --host-port=*|--tail=*)
      [[ "${a#*=}" =~ ^[0-9]+$ ]] || die "valeur numérique requise: $a"
      shift ;;
    --backup|--follow|--no-stack|--stack)
      shift ;;
    --*)
      die "flag refusé: $a" ;;
    *)
      # nom d'instance : [a-z0-9][a-z0-9-]*
      [[ "$a" =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "argument invalide: $a"
      shift ;;
  esac
done

[ "$HAS_BRAND_ROOT" = 1 ] || die "--brand-root requis"
case "$BRAND_ROOT" in
  /opt/docker/*) ;;
  *) die "brand-root hors allowlist: $BRAND_ROOT" ;;
esac
[ -d "$BRAND_ROOT" ] || die "brand-root inexistant: $BRAND_ROOT"

# Rejoue la commande validée telle quelle (arguments déjà filtrés).
exec "$NODE" "$CLI" server-docker "$SUB" "${ORIG_ARGS[@]}"
