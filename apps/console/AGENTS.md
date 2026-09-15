# Guide agents - `apps/console`

## Mission

Maintenir une console ops Next.js lisible et sûre pour le parc desktop Creezio :
inventaire kit, feeds, statuts de build, gates, fabrique plugins, observabilité,
automations et registre plugins org.

La console doit rester une surface d'observation et de pilotage contrôlé. Les
opérations risquées (build réel, publish, mutation de feeds) doivent rester
gated et explicites.

## Ne pas faire

- Ne pas transformer la console en application métier ou en CRM.
- Ne pas déclencher de build/publish réel par défaut depuis l'UI ou une route
  API. `dryRun:false` doit rester refusé sans `CREEZIO_CONSOLE_ALLOW_BUILD=1`.
- Ne pas écrire dans les feeds publics ni modifier les manifests de marques
  depuis cette app.
- Ne pas ajouter de dépendance ou de store global client pour des snapshots
  serveur déjà relus à chaque requête.
- Ne pas commiter les fichiers de runtime local sous `var/`, `.next/`, logs ou
  sorties de build.
- Ne pas remplacer les helpers `@creezio/*` par des parsing ad hoc des manifests
  ou des `latest.yml`.

## Points d'entrée

- `src/app/page.tsx` : composition de la page console et chargement des
  snapshots.
- `src/app/api/kit-versions/route.ts` : inventaire packages, gates et docs.
- `src/app/api/feeds/route.ts` : snapshot feeds de toutes les marques.
- `src/app/api/status/route.ts` : statut local ou remote par marque.
- `src/app/api/remote-build/route.ts` : wrapper CLI remote-build, dry-run par
  défaut.
- `src/app/api/plugin-factory/route.ts` : simulation/persistance V1.
- `src/app/api/observability/route.ts` : lecture/ecriture événements V2.
- `src/app/api/automations/route.ts` : dispatch V3.
- `src/app/api/org-plugins/route.ts` : registre plugins L3.
- `src/lib/*.ts` : logique serveur et résolution des chemins `var/`.
- `src/components/*.tsx` : rendu des panneaux et action client remote-build.

## Modifier sans casser

- Conserver `dynamic = "force-dynamic"` sur la page et les routes qui lisent des
  états externes.
- Valider toute entrée API (`brandId`, `kind`, `trigger`, actions registry)
  avant d'appeler les packages.
- Pour les chemins de données locales, garder l'ordre env override -> valeur par
  défaut sous `<kitRoot>/var`.
- Pour le parc, utiliser `@creezio/brand-config` et
  `@creezio/desktop-tooling`; les sandboxes doivent rester non fetchées en live
  si le code les marque comme feeds jetables.
- Pour V1/V2/V3, préserver la persistance SQLite existante et les fallbacks
  déterministes sans LLM.
- Limiter le client React aux interactions nécessaires. Les panneaux qui
  affichent des snapshots peuvent rester des server components.
- Si vous ajoutez une route, documentez-la dans `README.md` et
  `docs/FILES.md`.

## Tests et vérifications

Pour du code console :

```bash
npm run typecheck -w @creezio/console
npm run build -w @creezio/console
```

Selon la zone touchée :

```bash
node --test scripts/test-phase-c.mjs      # socle console + remote-build
node --test scripts/test-phase-f.mjs      # propagation / kit versions
node --test scripts/test-phase-i0.mjs     # gouvernance kit
node --test scripts/test-phase-i6.mjs     # registre plugins org
node --test scripts/test-phase-v2.mjs     # observabilité
node --test scripts/test-phase-c4.mjs     # SQLite console V2/V3
```

Pour de la documentation seule, vérifier au minimum les liens relatifs et
`git status --short`. Ne pas créer de commit si la tâche le demande.
