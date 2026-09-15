#!/usr/bin/env bash
# REFUSÉ — ce script posait admin.{zone} derrière Nginx Proxy Manager
# (A record → IP VPS). Ce n'est plus une voie Creezio.
#
# Contrat unique : l'app OS admin expose admin.{zone} + lp.{zone} via
# Cloudflare Tunnel in-process (CREEZIO_DOMAIN + CREEZIO_TUNNEL_EXTRA_HOSTNAMES).
# Le backend flotte (:18800) reste loopback.
set -euo pipefail
echo "configure-admin-npm.sh : retiré." >&2
echo "L'admin publique se pose avec :" >&2
echo "  CREEZIO_DOMAIN=admin.<zone>" >&2
echo "  CREEZIO_TUNNEL_EXTRA_HOSTNAMES=lp.<zone>" >&2
echo "  creezio server-docker create main --brand-root <admin-repo> --profile prod" >&2
echo "Pas de NPM, pas de sidecar, pas d'A record vers le VPS." >&2
exit 1
