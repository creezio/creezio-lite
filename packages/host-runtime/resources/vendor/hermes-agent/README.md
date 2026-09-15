# Hermes Agent — pin TempoFlow Desktop

Upstream : https://github.com/nousresearch/hermes-agent  
Version cible : `VERSION`  
Manifest runtime : `runtime-manifest.json` (décision taille + pin WebUI + SHA-256)

## Pourquoi le runtime Python n’est PAS dans l’exe

| Mesure | Valeur |
|--------|--------|
| Exe TempoFlow actuel | ~221 Mo |
| Venv Hermes seul | ~295 Mo |
| Full install typique | 300–800 Mo+ |

Embarquer le venv dans `TempoFlow-Setup-*.exe` ferait exploser NSIS / remote-build TempoFlow / SmartScreen.  
**Décision** : download-on-first-run (installeur officiel + archive WebUI pinée).

## Comportement desktop

1. Mode **Héberger** + `hermes.mode=embedded` :  
   - cherche CLI (`TF2_HERMES_BIN`, PATH, `%LOCALAPPDATA%\hermes`, `~/.local/bin`, …)  
   - si absente → `install.ps1` / `install.sh` (`-NonInteractive -SkipSetup -SkipBrowser`)  
   - télécharge WebUI (checksum) → `userData/hermes-runtime/webui`  
   - spawn `hermes gateway run` + `python server.py` (kanban)
2. Mode **Rejoindre** : aucun spawn / bootstrap.
3. Configuration → bouton **Installer runtime** si échec réseau au boot.

## Override

| Variable | Rôle |
|----------|------|
| `TF2_HERMES_BIN` / `HERMES_BIN` | Chemin absolu du CLI |
| `TF2_HERMES_REMOTE_KEY` | Clé Bearer mode distant |
| `HERMES_API_SERVER_KEY` | Alias clé API |

## Install manuelle (debug)

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --skip-setup --non-interactive --skip-browser
```

Voir `docs/PLAN-HERMES-EMBEDDED.md`.
