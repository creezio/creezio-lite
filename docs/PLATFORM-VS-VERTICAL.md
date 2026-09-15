# Plateforme vs vertical — règles de décision

Comment décider si une fonctionnalité appartient au **kit** (`@creezio/*`)
ou au **vertical** (repo marque).

> La matrice historique d'extraction TF2 → kit (fichier par fichier, phases
> A/B) est archivée :
> [archive/PLATFORM-VS-VERTICAL-EXTRACTION.md](./archive/PLATFORM-VS-VERTICAL-EXTRACTION.md).

## Kit (plateforme)

Va dans le kit tout ce qui est **agnostique du secteur** :

- infrastructure d'app : boot, paths, SQLite, embeds, updater, tray, splash ;
- CMS : auth, mails, tâches, assistant, observabilité, admin database ;
- surfaces OS (`os-ui`), chrome CRM (`shell-ui`), API `/api/v1`, MCP ;
- outillage : factory, publish, propagation, serveur Docker, navigateur IA.

Un besoin marqué « métier » qui apparaît dans **3 marques** devient un
générique kit configurable (règle ×3) — jamais du vocabulaire marque dans le
code natif ([ADR](./adr/ADR-no-brand-domain-in-native-packages.md)).

## Vertical (marque)

Reste chez la marque :

- entités et écrans sectoriels (catalogue, panier, dossiers clients…) ;
- migrations `brand` + `registerModuleApi` + nav `brand.*` ;
- feed Meili marque (descripteur `BrandMeiliFeed`) ;
- prompts/tools métier de l'assistant (via MCP) ;
- BrandSpec (identité, modules, features).

## Anti-patterns

- Copier du code kit dans une marque « pour aller vite » → corriger le kit.
- Promouvoir un besoin mono-marque dans le kit « pour faire joli ».
- Réécrire une page OS côté marque au lieu de rematérialiser `os-ui`.

## Voir aussi

- [MATRICE-NATIVE-METIER-PLUGIN.md](./MATRICE-NATIVE-METIER-PLUGIN.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
