# CREATE-PLUGIN — créer un plugin Creezio

Un plugin = un **sidecar Node** (process séparé, sans dépendance npm)
piloté par le host plugins du kit : manifest déclaratif, port loopback,
DB isolée, clé API scopée, panel UI optionnel, tools MCP `plugin.<id>.*`
avec ACL fail-closed.

Deux niveaux, même contrat :

| Niveau | Où vit le code | Exemple vivant |
|---|---|---|
| Template kit (installable par toute marque) | `packages/factory/templates/plugins/<id>/` | [`insights-assistant`](../../packages/factory/templates/plugins/insights-assistant/manifest.json) |
| Plugin de marque (embarqué dans le repo marque) | `<brand>/server/plugins/<id>/` | `recettes-cuisine` (repo `tempoflow3`) |

## 1. Layout

```text
<id>/
├── manifest.json      # contrat déclaratif (voir §2)
├── index.js           # sidecar Node pur (node: builtins uniquement)
└── migrations/        # *.sql appliqués par le sidecar (table _plugin_migrations)
```

Id valide : `[a-z0-9-]` (`isValidPluginId`, `@creezio/platform-core`).

## 2. `manifest.json`

```json
{
  "id": "mon-plugin",
  "name": "Mon plugin",
  "version": "1.0.0",
  "description": "…",
  "main": "index.js",
  "permissions": ["crm:read", "llm:use", "ui:panel", "net:loopback"],
  "panel": { "title": "Mon plugin", "path": "/" },
  "mcpTools": [
    {
      "name": "mon_tool",
      "description": "…",
      "method": "POST",
      "path": "/api/mon-endpoint",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

Permissions (union fermée `PluginPermission`,
`platform-core/src/plugins/plugin-manifest.ts`) : `crm:read`, `crm:write`,
`n8n:read`, `n8n:write`, `ui:panel`, `net:loopback`, `llm:use`.

## 3. Contrat d'environnement du sidecar

Le host (`electron-shell/src/host/plugins/host.ts` — câblé prod desktop ET
harness Docker via `@creezio/app-runtime`) spawn `node index.js` avec :

| Env | Rôle |
|---|---|
| `PLUGIN_ID` | Id du plugin |
| `PLUGIN_DIR` | Dossier du plugin — DB sous `data/plugin.sqlite` |
| `PORT` | Port loopback alloué (le sidecar DOIT écouter dessus) |
| `CRM_PORT` | Port de l'API applicative |
| `API_URL` / `API_KEY` / `API_SCOPES` | Base loopback + clé API **scopée** (seulement si permission `crm:*`) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_BASE` | Clés LLM (seulement si `llm:use` — supprimées sinon, ne pas contourner) |

Contrats côté sidecar :

- annoncer le port sur stdout : `console.log(JSON.stringify({ event: "ready", port }))` ;
- exposer `GET /health` (health-check du proxy MCP `plugin.<id>.status`) ;
- DB : `data/plugin.sqlite` dans `PLUGIN_DIR` (node:sqlite `DatabaseSync`),
  migrations `migrations/*.sql` suivies dans la table `_plugin_migrations`
  (voir le template `insights-assistant`). Ne jamais toucher aux DB de
  l'app : l'isolation `core`/`brand`/`plugin/<id>.db` de l'api-kernel
  s'applique aux mounts kernel, le sidecar n'a QUE sa DB et l'API HTTP.

## 4. Surfaces exposées par le kit (rien à coder)

- **API** : `/api/v1/plugins/<id>/<subPath>` → proxy vers le sidecar
  (`plugin-proxy-mount.ts`, `@creezio/app-runtime`) — monté au start,
  démonté au stop (`plugin_not_mounted` ensuite). L'ACL Product Hub
  s'applique AVANT le mount.
- **MCP** : `plugin.<id>.status`, `plugin.<id>.call` + un tool par entrée
  `manifest.mcpTools` (`plugin-tools-discovery.ts`). ACL **fail-closed** :
  sans grant Product Hub, un plugin n'est ni visible ni appelable, sauf
  acteur owner/clé service (`plugin-acl-wiring.ts`).
- **Panel UI** : permission `ui:panel` + `panel.path` — servi via le proxy
  `/api/v1/plugins/<id>/<path>` (même origine, y compris tunnel public).
  L'admin web (`/admin/plugins`) liste les runtimes via
  `GET /api/v1/os/plugins` et ouvre le panel dans un onglet navigateur —
  Electron n'est **pas** requis pour voir/ouvrir. Les gestes Git /
  enable-disable / accept-check restent Desktop (IPC) pour l'instant.

## 5. Installation & cycle de vie

- **Plugin embarqué marque** : livrer sous `<appRoot>/server/plugins/<id>/`
  — au boot, `seedPluginsFromDirs` (`plugin-seed.ts`) copie vers le répertoire
  runtime `<userData>/plugins/<id>/` et pose `.enabled`. Idempotent et non
  destructif : un plugin déjà installé n'est jamais écrasé, un plugin
  désactivé n'est pas réactivé. Le scaffold factory installe déjà le template
  kit `insights-assistant` via `installKitPluginTemplate` ; un plugin métier
  (ex. `recettes-cuisine`) reste manuel / hors factory.
- **Kill-switch** : `CREEZIO_PLUGINS=0` (ou `features.plugins=false`).
- Enable/disable/restart : control plane plugins (UI admin + API), état
  listé par `GET /api/v1/os/plugins`.

## 6. Pièges

| Piège | Règle |
|---|---|
| Restart launcher | Dans `launcher.ts`, le handler `child.on("exit")` doit comparer `cur?.child === child` avant `running.delete(id)` — sinon un restart après PUT files efface le process respawné. |
| Clés LLM | Jamais lues directement depuis l'env global : la permission `llm:use` est le seul canal (le host les supprime sinon — parité volontaire host/launcher). |
| Port | Ne pas hardcoder : lire `PORT`, écouter en loopback, annoncer `ready`. |
| Métier dans le kit | Un template `packages/factory/templates/plugins/` doit rester générique (zéro domaine marque — `insights-assistant` découvre les modules via `/api/v1/core/architecture`). Le métier va dans le plugin de marque. |

## 7. Preuve / gates

```bash
cd /opt/docker/creezio
node --test scripts/test-phase-plugins-default.mjs   # seed + control plane
node --test scripts/test-phase-plugin-tools.mjs      # tools MCP + ACL
node --test scripts/test-phase-plugin-insights.mjs   # template insights-assistant E2E
# Côté marque (TF3) : npm run test:fast -- --from recettes-plugin
```

Vérification manuelle sur un serveur qui tourne :

```bash
curl -sS http://127.0.0.1:18791/api/v1/os/plugins
curl -sS http://127.0.0.1:18791/api/v1/plugins/<id>/health
```
