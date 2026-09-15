# ADR — Fidu `clientSlim` (Phase D5 — réouverture post-I18)

| | |
|--|--|
| **Statut** | **Accepté — implémenté** (`false` définitif jusqu’aux critères ci-dessous) |
| **Date** | 2026-07-29 |
| **Remplace** | [ADR-FIDU-CLIENTSLIM-I17.md](ADR-FIDU-CLIENTSLIM-I17.md) « reporté » flou |

## Décision

**Conserver `clientSlim: false` de façon définitive** pour le produit Fidu
actuel (Client = stack locale complète Next/Meili/embeds), **sauf** si tous
les critères de réouverture ci-dessous sont verts.

Ce n’est plus un « reporté après I18 » : c’est un **choix produit verrouillé**
avec porte d’entrée explicite.

## Justification produit

1. **GED cabinet** : index Meili pièces, dépôt, Pennylane, embeds — parcours
   validé G2 avec stack embarquée Client **et** Serveur.
2. **Risque thin-client** : host-stack lazy Certivan/TF non prouvé sur Fidu
   (boot slim, recherche pièces, sync depot) — régression métier inacceptable
   sans campagne de smokes dédiée.
3. **Parité Client/Serveur** : cabinets joinent souvent un Serveur local ; un
   Client slim qui dépend d’un host non démarré casse le first-run.

## Conséquences

| Option | Impact |
|--------|--------|
| **`false` (choisi)** | Packaging inchangé ; republish D4/D5 sans migration host-stack |
| Migrer `true` | Exige host-stack lazy + smokes GED Client thin + bump majeur packaging |

## Critères de réouverture (tous obligatoires)

1. Host-stack Fidu lazy branché (`electron-shell` host-stack) sur Client.
2. Smokes verts : `test:client-slim-boot` **et** `smoke:ged` + `smoke:meili`
   + `smoke:depot` en mode Client thin.
3. First-run / join Serveur documenté sans régression.
4. Sign-off produit explicite (pas seulement technique).

Tant que 1–4 ne sont pas cochés : **ne pas** flipper `clientSlim` dans
`build-builder-config.mjs`.

## Références

- `/opt/docker/fidu/crm/scripts/electron/build-builder-config.mjs`
- [gates/G2-FIDU.md](gates/G2-FIDU.md)
- [PHASE-I17.md](PHASE-I17.md) · [PHASE-D5.md](PHASE-D5.md)
