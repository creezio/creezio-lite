# Contrat d’expérience et de module

Référence de restauration : Creezio `6bd6507633b4c17bfc31206d82d1caa9a8af19af` et WinHub `b326a2650588115e4b82b6a404406bbdb12b427c`. Les primitives existantes `PaneHrefContext`, pool keep-alive, historique d’onglet et déclarations de modules sont conservées.

## Navigation

Les vues à l’intérieur du workspace emploient `usePanePathname`, `usePaneSearchParams` et `useWorkspaceRouter` depuis `@lite/shell-ui/ui/workspace/pane-location`. Le chrome global conserve les hooks du routeur hôte. Deux fiches `?record=A` et `?record=B` ont des identités distinctes ; filtres et pagination ne créent pas une nouvelle identité de page. Les liens internes restent interceptables par le workspace. Les redirections d’authentification, changements d’espace et destinations externes conservent leur comportement dédié.

Sous Sites/Vinext, `app/sites-pane-router.tsx` doit réexporter `SitesPaneRouter` et `SitesWorkspaceLocation` depuis `@lite/sites-adapter/ui/pane-router`. L’implémentation est gérée dans le runtime : ses mises à jour suivent le kit. `doctor` et `upgrade` signalent une intégration ancienne ou absente dans `hostIntegration`. L’upgrade ne remplace pas silencieusement le code applicatif : adopter cette réexportation et les hooks de pane est requis une fois pour les anciennes applications. Entourer `WorkspaceRoot` de `SitesWorkspaceLocation` dans le chrome pour associer le contenu RSC à sa route de rendu, même avant le commit de l’URL. Le plugin `build/lite-source.ts` appelle aussi `stabilizeVinextSlotContexts` : Vinext charge ses quatre contextes de slot via des URL avec et sans le paramètre Vite `?v`. Comme les autres contextes de navigation Vinext, ils doivent partager un objet React unique. Cette adaptation ciblée vérifie la forme de la dépendance et exige une revue si elle change. Aucun fichier node_modules n’est modifié. Vérifier aussi les alias TypeScript du template.

## Données

`moduleDataSchema(module)` produit aussi un schéma de commande fermé à partir de ces champs, compatible avec les valeurs facultatives vides des formulaires ; l’option `partial` sert aux mises à jour/restaurations dont le serveur reconstruit les données complètes. Une déclaration `Module.fields` alimente la validation scalaire, le schéma d’opération, les formulaires et les listes. `integer` décrit les unités stockées ; `scale` et `unit` décrivent leur présentation. Exemple : centimes stockés, `integer:true, scale:100, unit:"EUR"`. Ne pas déduire ces règles des noms de champs à l’exécution. Les références déclarent leur module, leur champ de libellé et éventuellement leur multiplicité ; les choix sont lus via l’API autorisée.

La référence est un contrat de déclaration et de sélection, pas une nouvelle contrainte de clé étrangère. Les droits et validations métier de la cible restent contrôlés côté serveur par les opérations existantes. Aucune migration SQL ou réécriture de données n’est effectuée par ces métadonnées.

`useLoad` sépare les dépendances d’actualisation de l’identité des données. Fournir l’API/l’identité d’accès et l’identifiant de fiche dans le troisième argument ; une révision dans le deuxième. Une actualisation conserve le contenu monté, une nouvelle identité le masque immédiatement, une erreur le retire et une réponse obsolète est ignorée.

## Vérification

Les tests `pane-location`, `workspace-isolation`, `load-retention` et `field-contract` couvrent les contextes Vinext réels, deux fiches du même module, les saisies conservées, les réponses tardives et les unités de stockage. La génération, le typage et la construction des exemples restent requis. Une application migrée doit aussi adapter ses propres vues et vérifier ses parcours métier.

Une fiche générique inactive ferme son portail de lecture : le cache ne doit pas laisser une boîte de dialogue au-dessus de l’onglet suivant. Les tests navigateur vérifient l’ouverture/fermeture de fiche puis un aller-retour inter-module avec conservation du filtre et du document navigateur.
