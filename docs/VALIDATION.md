# Validation du profil Sites 0.2.2

Vérifications du 15 septembre 2026 : **20 tests réussis, aucun échec ni test ignoré**. Ce rapport porte sur les adaptations effectivement branchées ; les tests réussis de 0.1 ne validaient ni la fidélité au kit ni le portage de ses packages.

- Sources : empreintes des 1 740 fichiers du monorepo d’origine et inventaire explicite des patchs ; 36 manifests natifs conservés.
- UI : import des composants originaux WorkspaceRoot, Sidebar, DataTable, thème, Tâches, Support, Navigation et visites. Le shell de remplacement de 0.1 est supprimé.
- D1 réel via Miniflare : sessions, espaces, refus d’accès inter-espaces, kanban humain, affectation, statuts, tickets/messages, personnalisation de navigation et préférences de visite.
- Contrôles : écriture refusée aux lecteurs, CSRF refusé, auteur de ticket issu de l’identité vérifiée, préférences d’un autre utilisateur refusées, exécuteurs IA/Hermes non simulés.
- Extensions web : CRUD, conflits de version, invitations, fichiers R2 privés, compensations en cas d’échec de stockage et WebMCP dans un registre de test.
- Générateur : deux applications indépendantes embarquent plus de 1 190 sources ; aucun identifiant de Site, secret ou donnée du template transmis ; modification locale détectée avant upgrade.
- Typecheck et build Worker réussis pour le template, Réserve (catalogue), Atelier (services) et la mise à jour de l’application Atelier existante.
- Smoke HTTP du Worker compilé : session native, création de tâche, CRUD métier, catalogue et refus anonyme vérifiés avec des identités de fixture ; la réponse HTML de connexion charge l’amorçage React. Ce contrôle ne prouve pas l’affichage après hydratation.
- Les fichiers CSS construits contiennent les tokens originaux orange `#f0701d` et encre `#14182f` ; ce contrôle de provenance ne remplace pas une comparaison visuelle.

## Régression onglets de 0.2.0

Le test `workspace-isolation.test.mjs` a reproduit le défaut avant correction avec le vrai `Children`/`Slot` de Vinext : après passage Clients → Dossiers, la pane Clients affichait « Dossiers ». Il vérifie désormais les trois panes, leurs titres et saisies indépendantes, les bascules avant arrivée de la route, une cible froide, les retours répétés, le rafraîchissement de la page active, l’invalidation d’une pane fermée et les URL avec query. Le gel Next par défaut est vérifié séparément. Ce sont des tests de rendu React, pas des clics effectués dans un navigateur réel.

## Régression recherche de 0.2.1

Contrôle effectué dans Chromium le 15 septembre 2026 avec la page Vite `/__creezio-ui-check`, le véritable `GlobalSearchProvider`, la primitive native `Dialog` et le CSS applicatif. Seule la fonction de recherche fournit un résultat de fixture. L’iframe permet de modifier la largeur de rendu sans modifier les composants.

Avant correction à 1227 px : palette de 920 px, bord gauche à −314 px ; `transform: translateX(-50%)` et `translate: -50%` étaient tous les deux actifs. Après correction : `translate: none`, bord gauche à 146 px et bord droit à 1066 px. Le thème et le composant natifs sont identiques aux sources upstream.

| Largeur de l’iframe | Bords de la recherche (px) | Bords du formulaire (px) | Résultat |
| --- | --- | --- | --- |
| 1227 | 146 → 1066 | 222 → 990 | Centrés |
| 1024 | 44,5 → 964,5 | 120,5 → 888,5 | Centrés |
| 768 | 16 → 737 | 0 → 753 | Aucun débordement |
| 390 | 0 → 375 | 0 → 375 | Recherche plein écran |

Les 15 px restants correspondent à la compensation de scrollbar du navigateur/Radix. Saisie « Doc », résultat « Documents », sélection par Entrée vers `/documents`, fermeture par Échap et ouverture du formulaire ont été exercées dans le navigateur. Les formulaires conservent `translate: -50% -50%`. La visite guidée a été examinée dans le code : ses cartes centrées n’utilisent pas l’utilitaire Tailwind à l’origine de la collision ; son parcours n’a pas été exécuté dans ce contrôle.

Le middleware de contrôle est limité à `apply: 'serve'` et les fixtures restent en dehors de `app/` et `public/`. Ces vérifications ciblées ne prouvent pas les parcours authentifiés de l’application complète.

## Limites de cette preuve

Aucune parité totale de backend n’est revendiquée. Le portage des 36 packages, les connecteurs externes, un parcours de connexion multi-comptes ChatGPT, l’ensemble des interactions dans un navigateur réel et une comparaison pixel par pixel ne sont pas prouvés par ces tests. Les fonctionnalités non intégrées sont détaillées dans COMPATIBILITY.md.

La CI du profil Sites est `.github/workflows/ci.yml`. Les workflows upstream, dont la publication npm et la propagation, sont conservés dans `upstream-workflows/` et ne sont pas actifs dans ce fork.
