# ADR — Fidu `clientSlim` (Phase I17)

| | |
|--|--|
| **Statut** | Accepté — remplacé par [ADR-FIDU-CLIENTSLIM-D5](ADR-FIDU-CLIENTSLIM-D5.md) |
| **Date** | 2026-07-29 |
| **Contexte** | Gate G2 / fondation H6 (I17) |

## Décision

**Conserver `clientSlim: false`** pour Fidu en I17–I18.

## Contexte

- G2 a volontairement laissé Client et Serveur avec stack locale complète
  (Next / Meili / embeds) — zéro perte métier GED cabinet.
- `build-builder-config.mjs` hardcode `clientSlim: false` avec commentaire G2.
- Le host-stack lazy Certivan/TF n’est pas encore validé sur le parcours GED
  Fidu (index Meili pièces, dépôt, Pennylane, embeds).

## Conséquences

| Option | Impact |
|--------|--------|
| **Rester `false` (choisi)** | Client embarque encore la stack ; republish I18 inchangé côté packaging |
| Migrer `true` | Exige host-stack lazy + smokes GED Client thin ; hors I17/I18 |

## Révision

**Clôturée en D5** : voir [ADR-FIDU-CLIENTSLIM-D5.md](ADR-FIDU-CLIENTSLIM-D5.md)
(`false` définitif + critères de réouverture explicites — plus de « reporté »).

## Références

- `/opt/docker/fidu/crm/scripts/electron/build-builder-config.mjs`
- [gates/G2-FIDU.md](gates/G2-FIDU.md)
- [PHASE-I17.md](PHASE-I17.md)
- [PHASE-D5.md](PHASE-D5.md)
