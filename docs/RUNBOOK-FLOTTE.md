# Runbook flotte Creezio — opérations récurrentes

**Source of truth : [`.cursor/skills/creezio-fleet-ops/SKILL.md`](../.cursor/skills/creezio-fleet-ops/SKILL.md)**
(skill Cursor versionné — chargé automatiquement par les agents ; ce fichier
n'est qu'un index pour la lecture humaine / hors Cursor. Ne pas dupliquer le
contenu ici : éditer le skill).

Chaque procédure y est au format « Objectif → Commande exacte → Vérification
→ Où est la vérité (fichier) → Pièges », avec les commandes copiables
vérifiées sur le VPS TempoFlow.

Les zones Cloudflare et hostnames publics sont **ceux de la marque**
(`{slug}.{zone}` — ex. `resto-lyon.tempoflow.fr`, `{client}.crm.foove.io`,
`server-1.winhub.fr`), pas seulement `tempoflow.fr`.

## Table des matières (sections du skill)

1. **Créer un serveur** — `creezio server-docker create` (+ `--profile prod`,
   `--browser`), registre `docker-data/servers.json`, tunnel `{slug}.tempoflow.fr` ;
   clé assistant : `OPENAI_API_KEY` hôte forwardée par `--profile prod`
   (vérif `GET /api/v1/assistant/llm-status`)
2. **Créer un compte owner / user en headless** — `POST /api/v1/os/setup`
   (local-config) **et** `migrateBrandCredentialsToKit` (`creezio_users`,
   core.db) ; collaborateurs via `POST /api/v1/platform/users`
3. **Login / vérifier un compte** — `POST /api/v1/auth/login`
   (`{"email","password"}`), cookie `<brandId>_session`, `GET /api/v1/auth/me`
3b. **Vérification E2E canonique** — compte E2E
   `CREEZIO_E2E_EMAIL/_PASSWORD` persisté dans le `secrets.env` (600) de
   chaque instance (posé par `create|ensure-owner`), script
   `scripts/verify-prod.mjs --all` **matérialisé par la factory dans toute
   app générée** (checks plateforme par profil brand/admin ; checks métier
   dans `scripts/verify-prod.local.mjs`, jamais régénéré — gate
   `test-phase-factory-two-repos`) ; règle :
   tout reset E2E se persiste dans `secrets.env`, jamais seulement dans un
   journal
4. **Publier une image, updater, rollback** — `server-docker publish --tag`,
   registre `127.0.0.1:5000` ou GHCR `ghcr.io/creezio` (E2E prouvé
   2026-08-31 ; credentials root/600 dans
   `/opt/docker/creezio-secrets/ghcr.env`, hors git — jamais la valeur en
   clair ailleurs), update admin async (202 + `update-status`),
   backup + rollback auto. **hostPort persisté** dans `servers.json` et
   réutilisé à chaque update (plus de ports éphémères 32774→…). Fichiers
   stack `cf.env` / `secrets.env` root:root 600 : le CLI lit/écrit via
   `sudo -n` / wrapper `/usr/local/sbin/creezio-server-docker priv-io`
   (fail-closed — pas de chmod, pas de « lance en sudo »)
4b. **Déployer sur toute la flotte (releases pull)** — `publish --release`
   (draft), registre pull-only `registry.{zone}`, cycle
   draft → rolling (canary `wave_pct`) → done, kill-switch
   `paused`/`aborted`, hold/pin/canal par serveur, auto-pause sur échecs —
   ADR [adr/ADR-fleet-updates-docker-images.md](./adr/ADR-fleet-updates-docker-images.md)
5. **Admin flotte** — `admin up --admin-root …`, `server-admin.json` /
   `fleet-hosts.json`, Basic auth, `admin.tempoflow.fr`
6. **Agent hôte + enrôlement VPS** — `agent up`, enrollToken one-shot,
   `enroll --admin … --token … --slug …`, URL dédiée
   `agent-{slug}.{zone}` ; **règle UFW obligatoire** (voir ci-dessous) ;
   **tunnel dédié agent (T7)** : `enroll` et `agent up` provisionnent un
   tunnel Cloudflare propre à l'agent (container `creezio-agent-tunnel`,
   token `docker-data/agent-tunnel.env` 600) ; `agent up` migre tout seul
   un hôte déjà enrôlé sans tunnel dédié **et persiste `agentUrl`
   (host-agent.json + fleet-hosts.json + API admin)** — `fleet-hosts.json`
   root:root 600 : `sudo -n` puis POST admin, jamais chmod manuel ;
   `agent rm` est
   le seul geste qui retire DNS `agent.*` /
   tunnel dédié (`server-docker rm` d'une instance ne les touche jamais) ;
   respawn surveillé par le host-agent (gates `test-phase-agent-tunnel`,
   `test-phase-tunnel-self-provision` §10, `test-phase-server-docker`)
7. **Client desktop thin** — `pack:win` / `electron:publish`, feed `/tf3/`,
   GUID dédié, `defaultServerUrl` / `TF3_DEFAULT_SERVER_URL`
8. **Diagnostics boot** — `boot-status`, `health`, `version`, `ready`,
   logs JSONL `boot-step`, `/data/ops/*.jsonl`, `crash:list`
9. **Pièges connus** — ordre catalogue/listen, AUTH_SECRET par instance,
   setup ≠ login, package npm browser-host, symlinks electron-builder,
   publish local pas SSH, feed TF2, collector :8665, slugs réservés,
   timeouts Cloudflare, nommage Compose
10. **Entretien disque Docker (VPS)** — GC BuildKit native (`daemon.json`
    `builder.gc`), timer `docker-disk-maintenance` quotidien (prune sans
    `-a` + `--keep-storage` + rétention registre 5 tags + alerte ≥ 85 %),
    rétention auto post-publish (`--keep-tags` / `--no-retention`),
    **`creezio server-docker registry-gc`** (delete tags + `garbage-collect`,
    `--keep 2` pour `auto.*` + ≥ 3 semver indépendants, dry-run par défaut
    + `--apply`, jamais un tag en usage / `servers.json` / release fleet)
11. **n8n & Hermes embarqués** — superadmin flotte
    (`CREEZIO_SUPERADMIN_EMAIL/_PASSWORD`), owner n8n silencieux, clé API n8n
    (`.{brand}-n8n-api-key.json` → env Hermes), webhooks publics, MCP, skills
    seedés au boot
12. **Intégrations / clés API tierces** — page `/admin/integrations`, API
    `/api/v1/platform/integrations` (CRUD owner + `resolve` par référence
    `integration://<slug>` via clé service Hermes), sync push vers le n8n
    embarqué (`creezio:<slug>`), secrets chiffrés `core.db`

## Firewall hôte (UFW) — enrôlement & migration stacks compose

Tout port hôte consommé **depuis les conteneurs** (18800 backend flotte,
18810 host-agent) doit être autorisé par UFW depuis `172.16.0.0/12`
(**tous** les réseaux Docker, y compris les stacks compose en 172.25.x),
pas seulement `172.17.0.0/16` (docker0).

**Posée automatiquement** (0.18.0+) : `creezio server-docker agent up`,
`admin up` et `enroll` embarquent un préflight UFW fail-closed
(`packages/factory/src/server-docker-ufw.ts`, gate
`test-phase-server-docker-ufw`) — UFW actif + règle absente → la règle est
posée (droits root / `sudo -n`), sinon le geste **échoue** avec la commande
exacte ; jamais silencieux. La commande manuelle reste le fallback :

```bash
sudo ufw allow proto tcp from 172.16.0.0/12 to 172.17.0.1 port 18810   # host-agent
sudo ufw allow proto tcp from 172.16.0.0/12 to 172.17.0.1 port 18800   # backend flotte
```

Symptôme historique (kits < 0.18.0 ou geste manuel raté) :
`[UFW BLOCK] … DPT=188xx` dans le journal kernel
(`sudo journalctl -k | rg 'UFW BLOCK.*DPT=188'`), `agent.{slug}.{zone}` en
timeout alors que le CRM répond. Vécu 10–30/08/2026 : migration compose,
18800 élargi mais 18810 oublié → pilotage host-agent cassé 20 jours —
c'est l'incident qui a motivé l'automatisation.
Détail : skill fleet-ops §6/§8/§9.

## Protocole agent ↔ backend (P2.b / F4.4d, 0.15.0)

Backend flotte typé : SoT [`packages/fleet`](../packages/fleet/README.md)
(`@creezio/fleet`). Tous les échanges server-admin ↔ host-agent (+ pull
agent → app admin) portent le header `x-creezio-fleet-protocol` (v1) :

- version égale → OK ;
- header **absent** ou version **différente** → **refus fail-closed** (409)
  (`FLEET_PROTOCOL_ACCEPT_MISSING=false` depuis 0.19.0 — dual-accept
  0.15→0.18 terminé ; pas de bump v2). Mettre à jour via
  `creezio server-docker agent up` / `admin up`.

## Docs liées

- [`docker/server/README.md`](../docker/server/README.md) — serveurs headless
- [`docker/server-admin/README.md`](../docker/server-admin/README.md) — admin web
- `packages/platform-core/src/tunnel-cf-client.ts` — client API Cloudflare
  des tunnels (auto-provisioning instance au boot, 0.10.0) ; contrat env
  `CREEZIO_CF_*` : voir [RUNBOOK-AGENTS.md §7.3](./RUNBOOK-AGENTS.md)
- [`docs/adr/ADR-tunnel-flat-hosts.md`](./adr/ADR-tunnel-flat-hosts.md) — nested vs flat (Universal SSL)
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — vue d'ensemble
