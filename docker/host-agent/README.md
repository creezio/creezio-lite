# Creezio Host Agent — agent hôte flotte (VPS restaurant)

Image Docker de l'agent qui tourne sur chaque VPS hébergeant des serveurs
marque : il expose les gestes locaux (update avec backup/rollback, logs,
status) au backend flotte et **polle** les releases (updates en pull, F5 —
aucun push admin → agent).

Le code servi est `@creezio/fleet`
(`packages/fleet/dist/bin/host-agent-main.js` + `agent-updates.js`) ; le
contexte de build est stagé par le CLI (fleet-collector télémétrie +
`node_modules/@creezio/fleet`).

## Build & run

```bash
cd /opt/docker/creezio
docker build -f docker/host-agent/Dockerfile \
  -t creezio-host-agent:local packages/observability/fleet-collector
```

Le run nominal est fait par le CLI (voir la skill
[creezio-fleet-ops](../../.cursor/skills/creezio-fleet-ops/SKILL.md)) :

```bash
creezio server-docker agent up --brand-root /opt/docker/tempoflow3
# --network host, socket Docker monté, CREEZIO_AGENT_BRAND_ROOTS=<brandRoot>
```

Enrôlement auprès de l'admin flotte :

```bash
creezio server-docker enroll --admin <url> --token <enrollToken> --slug <slug>
```

## Tunnel dédié agent (T7)

L'ingress public `agent.{slug}.{zone}` vit sur un tunnel Cloudflare dédié
dont le connecteur tourne dans un container frère **`creezio-agent-tunnel`**
(image officielle cloudflared, network host, `--restart unless-stopped`,
token dans `{brandRoot}/docker-data/agent-tunnel.env` chmod 600). `enroll`
et `agent up` le provisionnent ; `agent up` migre un hôte déjà enrôlé
sans tunnel dédié. L'agent surveille ce container (respawn borné —
`@creezio/fleet` `agent-tunnel.ts`). `agent rm` retire tunnel + DNS agent.

## Env principales

| Variable | Défaut | Rôle |
|----------|--------|------|
| `CREEZIO_AGENT_PORT` | `18810` | Port HTTP de l'agent |
| `CREEZIO_AGENT_HOSTS` | `127.0.0.1` | Binds (ajouter `172.17.0.1` pour l'ingress tunnel) |
| `CREEZIO_AGENT_BRAND_ROOTS` | — | Racines marque séparées par `:` |
| `CREEZIO_AGENT_ADMIN_URL` / `CREEZIO_AGENT_FLEET_KEY` | — | Opt-in updates en pull (posés par `enroll`) |
| `CREEZIO_AGENT_TUNNEL_CONTAINER` | `creezio-agent-tunnel` | Container cloudflared dédié agent surveillé (T7) |

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [../server-admin/README.md](../server-admin/README.md) — backend flotte
