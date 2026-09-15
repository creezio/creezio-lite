## Kit bump → marque

> Template contrat Phase F (`@creezio/propagation`).  
> Générer le corps détaillé via `npm run kit:impact -- --package=<pkg>` puis
> `buildBrandPrPayload`.

### Métadonnées

- **Package kit** : `@creezio/…`
- **Bump** : major / minor / patch
- **Marque** : certivan (G1) / fidu (G2) / tempoflow (G3) / demobrand
- **Gate doc** : `docs/gates/G….md`

### Surfaces touchées

- [ ] `package-json-deps`
- [ ] `electron-main`
- [ ] `electron-preload`
- [ ] `product-hub`
- [ ] `desktop-scripts`
- [ ] `electron-builder`
- [ ] `next-host-env`
- [ ] `factory-scaffold`

### Checklist (ne pas skipper)

- [ ] Bump dépendances `@creezio/*` dans `package.json` marque
- [ ] `npm install` + `npm run build`
- [ ] Smoke Client (+ Serveur si `buildServerArtifact`)
- [ ] Feeds `latest.yml` vérifiés
- [ ] Modules dupliqués remplacés selon `PLATFORM-VS-VERTICAL.md`
- [ ] Runtime legacy conservé jusqu'à smoke vert
- [ ] Aucun hardcode marque remonté dans le kit
- [ ] Ordre gates respecté (G1 → G2 → G3)

### Notes

_Impact report / liens commits kit :_

### Hors scope

- Pas de publish exe sans verts
- Pas d'ouverture de la gate suivante sans sign-off
