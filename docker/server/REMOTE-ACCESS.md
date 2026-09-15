# Accès distant — reverse proxy (nginx-proxy-manager)

Les serveurs Docker et l'admin publient leurs ports sur **127.0.0.1**
(sécurité par défaut). Pour un accès distant, passer par un reverse proxy
TLS — sur les VPS Creezio/TempoFlow, **nginx-proxy-manager** (NPM) est déjà
en service.

## Principe

| Service | Port local | Auth intégrée | Exposition nominale |
|---------|-----------|----------------|---------------------|
| Serveur marque (CRM + API) | `127.0.0.1:1879x` (registre `docker-data/servers.json`) | Login CRM (session OS) | Tunnel `{slug}.{zone}` (provisioner) ou NPM |
| Backend flotte (`creezio-server-admin`) | `127.0.0.1:18800` | Basic auth (`docker-data/server-admin.json`) | Loopback (l'app admin proxifie par-dessus) |
| App admin de marque | `127.0.0.1:18801` | Login CRM (session OS) | Tunnel `admin.{zone}` |
| Agent hôte (`creezio-host-agent`) | `127.0.0.1:18810` (+ `172.17.0.1`) | Bearer agentToken | Tunnel `agent.{slug}.{zone}` (enroll) |
| Registre d'images (pull-only) | proxy `/v2/*` du backend admin | Basic `hostId:agentToken` | Tunnel `registry.{zone}` — push loopback `127.0.0.1:5000` uniquement |

Vérifier le mode réseau de NPM :

```bash
docker inspect nginx-proxy-manager --format '{{.HostConfig.NetworkMode}}'
```

- **`host`** (cas du VPS TempoFlow, vérifié) : NPM voit directement les
  ports loopback de l'hôte → *Forward Host* = `127.0.0.1`. Rien d'autre à
  changer.
- **bridge** : le loopback hôte n'est pas joignable depuis NPM → publier
  l'instance sur la passerelle Docker :

```bash
creezio server-docker create prod --brand-root … --bind 172.17.0.1
```

  (la passerelle n'est pas routée publiquement tant que le firewall bloque
  l'INPUT externe — à vérifier sur l'hôte).

## Proxy Host NPM (UI)

1. NPM → *Hosts → Proxy Hosts → Add Proxy Host*
2. Domain : `crm-demo.exemple.fr` — Scheme `http` — Forward Host
   `127.0.0.1` (NPM en host) ou `172.17.0.1` (bridge) — Forward Port
   `18793` (port de l'instance, voir `creezio server-docker ls`)
3. Onglet SSL : *Request a new SSL Certificate* (Let's Encrypt) + Force SSL
4. Websockets Support : **ON** (UI Next / assistant)

Pour l'admin (`18800`) : ajouter en plus une **Access List** NPM (ou laisser
la Basic auth intégrée — les deux se cumulent).

## Client Electron (kind=client) derrière le proxy

Le client thin se connecte au serveur via l'URL saisie dans le picker
(« Rejoindre un serveur ») ou pré-provisionnée (`defaultServerUrl` du
manifest / `<ENVPREFIX>_DEFAULT_SERVER_URL`). Exigences proxy :

1. **Websockets Support : ON** — UI Next, assistant.
2. **SSE sans buffering** — le bridge computer-use du client et le
   screencast « Voir comme IA » sont des streams `text/event-stream`
   long-lived. Dans NPM, onglet *Advanced* du proxy host :

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 1h;
proxy_send_timeout 1h;
```

3. **`/health`** doit répondre 200 à travers le proxy : le client teste
   cette route (`testRemoteHealth`) avant de valider l'URL et pour la
   bannière offline/reconnexion.

### Alternative tunnel cloudflared

`cloudflared` supporte nativement SSE + WebSockets sans réglage : un tunnel
`https://<slug>.<domaine>` → `http://127.0.0.1:1879x` suffit (c'est le mode
provisionné par l'onboarding marque). Pas de buffering à désactiver.

### Cookies fournisseurs — rien à synchroniser

Les sessions fournisseurs des humains (onglets incrustés `openTab`) vivent
dans des partitions Chromium **locales** persistantes du poste client
(`persist:<brand>-site-<id>`) : elles ne transitent jamais par le serveur.
Côté serveur, l'IA a ses propres profils Chromium persistants sous
`/data/browser/<aiUserId>` (variant `--browser`). Les deux mondes sont
étanches par conception — aucune synchro de cookies à configurer.

### Reconnexion client

- Health KO → l'app affiche l'écran offline et relance `testRemoteHealth`
  (backoff) ; le bridge computer-use se reconnecte seul (backoff SSE).
- « Changer de serveur » : `connection:rechoose` (menu) → repasse par le
  picker au prochain démarrage.

## Garde-fous

- Ne jamais exposer `--expose`/`SERVER_BIND=0.0.0.0` sans firewall + TLS.
- L'admin donne le contrôle Docker (create/rm) : ne l'exposer qu'avec TLS +
  Basic auth + idéalement une allowlist IP.
- Ne pas réutiliser les domaines prod TF2 (`crm.tempoflow.fr`, `/server/`)
  ni toucher leurs proxy hosts existants.
