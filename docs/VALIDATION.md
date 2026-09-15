# Validation du profil Sites 0.2.0

Vérifications du 15 septembre 2026 : **18 tests réussis, aucun échec ni test ignoré**. Ce rapport porte sur les adaptations effectivement branchées ; les tests réussis de 0.1 ne validaient ni la fidélité au kit ni le portage de ses packages.

- Sources : empreintes des 1 740 fichiers du monorepo d’origine et inventaire explicite des patchs ; 36 manifests natifs conservés.
- UI : import des composants originaux WorkspaceRoot, Sidebar, DataTable, thème, Tâches, Support, Navigation et visites. Le shell de remplacement de 0.1 est supprimé.
- D1 réel via Miniflare : sessions, espaces, refus d’accès inter-espaces, kanban humain, affectation, statuts, tickets/messages, personnalisation de navigation et préférences de visite.
- Contrôles : écriture refusée aux lecteurs, CSRF refusé, auteur de ticket issu de l’identité vérifiée, préférences d’un autre utilisateur refusées, exécuteurs IA/Hermes non simulés.
- Extensions web : CRUD, conflits de version, invitations, fichiers R2 privés, compensations en cas d’échec de stockage et WebMCP dans un registre de test.
- Générateur : deux applications indépendantes embarquent plus de 1 190 sources ; aucun identifiant de Site, secret ou donnée du template transmis ; modification locale détectée avant upgrade.
- Typecheck et build Worker réussis pour le template, Réserve (catalogue), Atelier (services) et la mise à jour de l’application Atelier existante.
- Smoke HTTP du Worker compilé : session native, création de tâche, CRUD métier, catalogue et refus anonyme vérifiés avec des identités de fixture ; la réponse HTML de connexion charge l’amorçage React. Ce contrôle ne prouve pas l’affichage après hydratation.
- Les fichiers CSS construits contiennent les tokens originaux orange `#f0701d` et encre `#14182f` ; ce contrôle de provenance ne remplace pas une comparaison visuelle.

## Limites de cette preuve

Aucune parité totale de backend n’est revendiquée. Le portage des 36 packages, les connecteurs externes, un parcours de connexion multi-comptes ChatGPT, les interactions dans un navigateur réel et une comparaison pixel par pixel ne sont pas prouvés par ces tests. Les fonctionnalités non intégrées sont détaillées dans COMPATIBILITY.md.

La CI du profil Sites est `.github/workflows/ci.yml`. Les workflows upstream, dont la publication npm et la propagation, sont conservés dans `upstream-workflows/` et ne sont pas actifs dans ce fork.
