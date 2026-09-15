# @creezio/browser-host

Navigateur Chromium **côté serveur** pour les IA (sidecar Docker) — sans
aucune dépendance Electron. C'est le jumeau serveur de l'espace IA Electron
(`electron-shell/host/ai-workspace`) : mêmes verbes `external_*` / `ui_*`,
mêmes scripts driver, même hub screencast.

## Rôle

- **Spawn/supervision Chromium** : `--remote-debugging-port=0`,
  `--user-data-dir=/data/browser/<aiUserId>` (profil persistant),
  headful sous Xvfb ou headless, UA `chrome-ua.ts` (parité Electron).
- **Client CDP websocket** : Target/Page/Runtime/Input/Network, sessions
  par page (`CdpPage`), monde isolé persistant pour le driver.
- **Driver partagé** : `driver-scripts.ts` est la **source of truth** des
  helpers `external_*` (`DRIVER_HELPERS`, `FAKE_CURSOR_INJECT`) — la version
  Electron (`electron-shell/browser-tabs`) les importe d'ici via
  `shared-driver.ts` (`CdpTransport` commun, pas de fork).
- **`AiSessionHost`** : par IA → page CRM sidecar (cookie session persona
  via `Network.setCookie`) + onglets externes ; expose les actions
  workspace (`ensure`, `openTab`, `web-action`, `ui_*`).
- **Screencast** : `BrowserScreencaster` capture `Page.startScreencast`
  (~3 fps JPEG) et publie **in-process** sur le hub
  (`publishScreencastFrame`, même clé `globalThis` que `shell-ui`) —
  stop auto sans spectateur.

## Utilisation (kit)

Câblé par `@creezio/app-runtime` :
`wire-brand-browser-sidecar.ts` (env `CREEZIO_BROWSER_SIDECAR=1`, image
Docker variant `--browser`) démarre l'hôte, enregistre les exécuteurs
in-process par userId IA (`syncAiExecutors`) et publie l'étape boot-status
« Navigateur IA ».

```bash
# smoke local (Chromium requis, CREEZIO_CHROMIUM_BIN sinon détection)
node scripts/smoke-live.mjs
```

## Env

| Var | Effet |
|-----|-------|
| `CREEZIO_CHROMIUM_BIN` | Chemin binaire Chromium prioritaire |
| `CREEZIO_BROWSER_HEADFUL` | `1` = Xvfb headful (défaut container) |
| `CREEZIO_BROWSER_PROXY` | Proxy sortant Chromium (`--proxy-server=`), ex. `http://user:pass@host:3128` |

## Modèle de menace (profils IA)

Les profils Chromium persistants (`{dataDir}/browser/<aiUserId>`) contiennent
des **cookies et sessions en clair** (sessions CRM persona + sessions des
sites externes visités par l'IA). À savoir :

- **Accès disque hôte = accès aux sessions.** Les profils sont créés en
  `0700` (propriétaire uniquement), mais quiconque a un accès root/volume
  Docker sur l'hôte peut lire les cookies. Traiter le volume `data/browser`
  comme un secret.
- **Pas de chiffrement au repos** : Chromium sous Linux stocke les cookies
  avec une clé locale triviale. Pour un besoin fort, monter le volume sur un
  système de fichiers chiffré (LUKS / fscrypt) — non fourni par le kit
  (dette assumée, voir `docs/BACKLOG.md` du kit).
- **Proxy sortant** (`CREEZIO_BROWSER_PROXY`) : plombé jusqu'à
  `--proxy-server=`. Limitation assumée : une IP **datacenter** (VPS, cloud)
  est détectée/bloquée par beaucoup de sites ; une offre proxy résidentiel
  n'est pas incluse dans le kit.
- **Sandbox Chromium désactivé en container root** (`--no-sandbox` auto si
  uid 0) : préférer un user non-root ou userns si l'IA visite des sites non
  fiables.

Voir [AGENTS.md](./AGENTS.md) et [docs/FILES.md](./docs/FILES.md).
