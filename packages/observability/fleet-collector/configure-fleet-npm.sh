#!/usr/bin/env bash
# DNS Cloudflare + NPM proxy host pour le cockpit fleet (domaine injecté).
#
# Requis :
#   FLEET_PUBLIC_DOMAIN  (ex. fleet.example.com)
#   FLEET_PORT           (ex. 8665)
#   CF_ENV               chemin .env Cloudflare (token + zone)
# Optionnel :
#   NPM_CONTAINER, NPM_API, WP_ENV, PROV_SCRIPTS, VPS_IP, FORWARD_HOST
set -euo pipefail

: "${FLEET_PUBLIC_DOMAIN:?set FLEET_PUBLIC_DOMAIN}"
: "${FLEET_PORT:?set FLEET_PORT}"
: "${CF_ENV:?set CF_ENV (cloudflare env file)}"

NPM_CONTAINER="${NPM_CONTAINER:-nginx-proxy-manager}"
NPM_API="${NPM_API:-http://127.0.0.1:81/api}"
WP_ENV="${WP_ENV:-/opt/docker/wp-provisioner/.env}"
PROV_SCRIPTS="${PROV_SCRIPTS:-/opt/docker/wp-provisioner/scripts}"
CF_API="https://api.cloudflare.com/client/v4"

DOMAIN="$FLEET_PUBLIC_DOMAIN"
PORT="$FLEET_PORT"
FORWARD_HOST="${FORWARD_HOST:-127.0.0.1}"
VPS_IP="${VPS_IP:-104.168.10.36}"

set -a; . "$WP_ENV"; . "$CF_ENV"; set +a
: "${NPM_EMAIL:?}"; : "${NPM_PASSWORD:?}"; : "${CF_API_TOKEN:?}"; : "${CF_ZONE_ID:?}"

echo "==> DNS A $DOMAIN → $VPS_IP (proxied)"
EXIST_DNS=$(curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "$CF_API/zones/$CF_ZONE_ID/dns_records?name=$DOMAIN&type=A" | jq -r '.result[0].id // empty')
DNS_BODY=$(jq -nc --arg n "$DOMAIN" --arg ip "$VPS_IP" \
  '{type:"A",name:$n,content:$ip,ttl:1,proxied:true,comment:"Creezio fleet cockpit"}')
if [ -n "$EXIST_DNS" ]; then
  curl -sS -X PUT -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    -d "$DNS_BODY" "$CF_API/zones/$CF_ZONE_ID/dns_records/$EXIST_DNS" | jq -e '.success==true' >/dev/null
  echo "   DNS mis à jour ($EXIST_DNS)"
else
  curl -sS -X POST -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
    -d "$DNS_BODY" "$CF_API/zones/$CF_ZONE_ID/dns_records" | jq -e '.success==true' >/dev/null
  echo "   DNS créé"
fi

echo "==> Authentification NPM"
TOKEN=$(docker exec "$NPM_CONTAINER" curl -sS -X POST "$NPM_API/tokens" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg i "$NPM_EMAIL" --arg s "$NPM_PASSWORD" '{identity:$i,secret:$s}')" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "ERREUR: token NPM vide"; exit 1; }

echo "==> Proxy host $DOMAIN -> $FORWARD_HOST:$PORT"
EXIST=$(docker exec "$NPM_CONTAINER" curl -sS -H "Authorization: Bearer $TOKEN" "$NPM_API/nginx/proxy-hosts" \
  | jq -r --arg d "$DOMAIN" '(if type=="array" then . else [] end)[]|select((.domain_names//[])|index($d)!=null)|.id' | head -1)
if [ -z "$EXIST" ] || [ "$EXIST" = "null" ]; then
  PAYLOAD=$(jq -nc --arg d "$DOMAIN" --arg fh "$FORWARD_HOST" --argjson p "$PORT" \
    '{domain_names:[$d],forward_scheme:"http",forward_host:$fh,forward_port:$p,
      certificate_id:0,ssl_forced:false,hsts_enabled:false,
      hsts_subdomains:false,http2_support:true,block_exploits:true,caching_enabled:false,
      allow_websocket_upgrade:true,advanced_config:"",enabled:true,
      meta:{letsencrypt_agree:false,dns_challenge:false},locations:[]}')
  HOST_ID=$(docker exec "$NPM_CONTAINER" curl -sS -X POST "$NPM_API/nginx/proxy-hosts" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$PAYLOAD" | jq -r '.id // empty')
  [ -n "$HOST_ID" ] || { echo "ERREUR: création proxy host échouée"; exit 1; }
  echo "   proxy host créé (id=$HOST_ID)"
else
  HOST_ID="$EXIST"
  echo "   proxy host déjà présent (id=$HOST_ID)"
fi

echo "==> Certificat Cloudflare Origin pour $DOMAIN"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/openssl.cnf" <<EOF
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req
[ dn ]
CN = $DOMAIN
[ v3_req ]
subjectAltName = @alt_names
[ alt_names ]
DNS.1 = $DOMAIN
EOF
openssl req -new -newkey rsa:2048 -nodes -keyout "$TMP/origin.key" -out "$TMP/origin.csr" -config "$TMP/openssl.cnf" >/dev/null 2>&1
CF_BODY=$(jq -n --rawfile csr "$TMP/origin.csr" --arg d "$DOMAIN" \
  '{hostnames:[$d],requested_validity:5475,request_type:"origin-rsa",csr:$csr,requested_bundle:"false"}')
CF_RESP=$(curl -sS -X POST "$CF_API/certificates" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" -d "$CF_BODY")
echo "$CF_RESP" | jq -e '.success==true' >/dev/null 2>&1 || { echo "ERREUR Cloudflare Origin CA: $(echo "$CF_RESP" | jq -c '.errors // .' | head -c 600)"; exit 1; }
CERT_PEM=$(echo "$CF_RESP" | jq -r '.result.certificate')

echo "==> Upload TLS NPM"
export DOM="$DOMAIN"
export FRONT_DOM=""
export FRONT_DEV_DOM=""
export EMAIL="$NPM_EMAIL"
export PASS="$NPM_PASSWORD"
export CERT_B64="$(printf '%s' "$CERT_PEM" | base64 | tr -d '\n')"
export KEY_B64="$(base64 < "$TMP/origin.key" | tr -d '\n')"
RESULT=$(bash "$PROV_SCRIPTS/n8n-npm-tls-install.sh" 2>&1 | grep -E '^\{.*\}' | tail -1)
echo "   $RESULT"
echo "$RESULT" | jq -e '.ok==true' >/dev/null 2>&1 || { echo "ERREUR install TLS NPM"; exit 1; }

echo "=================================================="
echo " OK -> https://$DOMAIN/"
echo "=================================================="
