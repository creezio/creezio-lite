# Phase C7 — Control-plane unifié `startHostPluginControlPlane`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | kit + TF + Certivan + Fidu + demobrand |
| **Prérequis** | C4–C6, I4/I10/I16/I18 |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Un seul boot control-plane HTTP : **`startHostPluginControlPlane`**
(`@creezio/electron-shell`) sur les 4 surfaces — fin des 3 styles divergents.

## Contrat C7

| Surface | Avant | Après |
|---------|-------|-------|
| TempoFlow | `createPluginControlPlaneHandler` + HTTP maison | `startHostPluginControlPlane` + `preHandle` extras |
| Certivan | idem | idem |
| Fidu | `startPluginControlPlane` direct | `startHostPluginControlPlane` |
| demobrand | ACL seule | `sandbox.startControlPlane()` |

Kit : `pluginsHost` optionnel (auto `createPluginsHost`), `preHandle`,
`controlToken` override.

## Vérif

```bash
cd /opt/docker/creezio && node --test scripts/test-phase-c7.mjs
cd /opt/docker/tempoflow2/crm && npm run test:plugin-acl-l3
cd /opt/docker/certivan-app/crm && npm run test:plugin-acl-l3
cd /opt/docker/fidu/crm && npm run test:plugin-acl-l3
```

## Verdict

**Phase C7 : TERMINÉE.**
