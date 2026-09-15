# packages/propagation — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs propagation` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/brand-surfaces.ts`](../src/brand-surfaces.ts) | Mapping packages kit → surfaces apps marques (contrat canal de mise à jour). Phase F : contrat uniquement — pas de modification des repos marques. Phase G : les PR automatisables consomment ce mapping. |
| [`src/channels.ts`](../src/channels.ts) | Contrat « kit bump → PR automatisable par marque ». Phase F livre le contrat + templates ; l'automation GitHub Actions côté repos marques est Phase G (gated). |
| [`src/extension-points.ts`](../src/extension-points.ts) | Points d'extension — descente (cœur→métier→org→user) et remontée (plugin terrain→review→kit). Notion §3–4. Contrats purs : les apps / console s'y branchent en Phase G. |
| [`src/impact.ts`](../src/impact.ts) | Dry-run d'impact : bump package → packages dépendants + surfaces + marques. |
| [`src/index.ts`](../src/index.ts) | @creezio/propagation — Phase F Semver / impacts / canaux PR / registre plugins org (L3) / extension points. Aucune écriture dans les repos marques (fidu, certivan-app, tempoflow2). |
| [`src/kit-inventory.ts`](../src/kit-inventory.ts) | Inventaire versions packages kit (local workspace + métadonnées). Utilisé par la console et `kit:version`. |
| [`src/org-plugin-registry-file.ts`](../src/org-plugin-registry-file.ts) | Registre org plugins **persisté fichier JSON** (Phase I6). Survives restart — console ops / dry-run remontée. Pas de cloud multi-tenant ; pas d'auto-promotion. |
| [`src/org-plugin-registry.ts`](../src/org-plugin-registry.ts) | Registre plugins organisation (contrat L3 — Notion §2–4). - Mémoire : tests / dry-run - Fichier : `createFileOrgPluginRegistry` (Phase I6) — console ops Cloud registry / auto-promotion = hors scope. |
| [`src/packages.ts`](../src/packages.ts) | Catalogue des packages @creezio et graphe de dépendances internes. Source de vérité pour impacts de bump et canaux de mise à jour. |
| [`src/release-notes.ts`](../src/release-notes.ts) | Helpers changelog / release notes (Keep a Changelog + Conventional Commits). |
| [`src/semver-policy.ts`](../src/semver-policy.ts) | Policy semver @creezio — Conventional Commits → bump. Convention changelog : voir docs/PROPAGATION.md § Semver. |
