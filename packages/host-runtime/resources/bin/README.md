# Binaires OS kit (Meili / cloudflared)

Convention :

| Fichier | Usage |
|---------|--------|
| `meili`, `cloudflared` | Dev / preuves Linux (`ensure-kit-binaries.mjs`) |
| `meilisearch-win.exe`, `cloudflared.exe` | Packaging **serveur** Windows (parité TF2, pas d’alias `meili.exe`) |

**Règles packaging**

1. Ces bins ne sont **jamais** syncés fat dans `vendor/…/electron-shell/resources/bin`
   des marques (seul `.gitkeep` + ce README).
2. Ils ne doivent **jamais** entrer dans l’asar (`!**/host-runtime/resources/bin/**`).
3. **Client** slim : pas de `resources/bin` du tout (parité TF2).
4. **Serveur** Win : stage via `creezio-stage-win-bins` → `.creezio/win-bin-stage`
   puis `win.extraResources` filtré (`WIN_SERVER_BIN_FILTER` dans brand-config).
