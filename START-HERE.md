# Créer une application à partir de Creezio Lite

Ce fichier est le point d’entrée pour une nouvelle conversation ChatGPT. Dépôt : https://github.com/creezio/creezio-lite.

## Contrat à respecter

Creezio Lite est un fork du kit Creezio avec un profil Sites. **Il faut réutiliser le vrai code et le vrai design.** Ne pas redessiner une sidebar, un système d’onglets, une palette ou des écrans ressemblants. Le shell est `WorkspaceRoot` ; les composants viennent des packages `@creezio/*` restaurés.

Lire `README.md`, `docs/COMPATIBILITY.md` et `AGENTS.md`. La matrice indique ce qui fonctionne, ce qui est seulement conservé en source et ce qui exige un hôte externe. Ne pas annoncer une compatibilité générale à partir de la seule présence des packages. Hermes et n8n sont désactivés dans le profil Sites.

## Parcours pour l’agent

1. Utiliser les plugins GitHub et Sites disponibles dans la conversation. Lire leurs instructions. Si Sites n’est pas disponible, préparer le projet et expliquer qu’il faut activer Sites pour le publier ; ne pas inventer de lien.
2. Lire le besoin métier, préciser seulement les inconnues bloquantes, puis choisir les modules et les droits adaptés. Une fonction native non portée ne doit pas être remplacée silencieusement par un faux écran ou une liste en mémoire.
3. Récupérer ce dépôt sans l’écraser. Il est le kit, pas l’application finale. Lire ses sources avant de les modifier.
4. Pour le profil Sites, créer un brief JSON à partir de `examples/services.json` ou `examples/catalogue.json`. Ce format propre au profil web ne remplace pas le BrandSpec YAML ni la factory desktop du monorepo.
5. Générer une application **indépendante** dans un dossier vide :

   ```bash
   node /chemin/creezio-lite/bin/creezio-lite.mjs create --spec /chemin/brief.json --out /chemin/nouvelle-app
   ```

   Le générateur copie les vrais packages, leur configuration source, les adaptateurs Sites et le template. Il ne copie aucun secret, donnée, dépôt Git ni `project_id`. Il ne crée pas lui-même de Site.
6. Lire `AGENTS.md` dans le projet généré. Utiliser le workflow Sites pour ce projet existant : configuration du profil, installation depuis son lockfile, migrations D1, construction, enregistrement et publication. Ne pas lancer un autre initializer qui remplacerait le shell.
7. Personnaliser l’identité et le métier dans `brand.json`, `app` et les migrations applicatives. Les fonctions spécifiques restent dans l’application. Pour une modification générique, corriger le kit puis propager le changement avec contrôle de provenance.
8. Vérifier `doctor`, les opérations réelles, les droits, le typecheck et le build. Tester les règles métier relationnelles avec des tables et transactions adaptées ; le CRUD JSON n’est pas une comptabilité ou un moteur de réservation.
9. Enregistrer un nouveau Site quand l’application ne possède pas de `project_id`. Pour les modifications suivantes, préserver ce `project_id`, ses données et son audience. Publier puis remettre l’URL confirmée par Sites.

## Points de vigilance techniques

- Backend Sites : Worker, D1 asynchrone, R2 ; aucune équivalence automatique avec `better-sqlite3` ou le runtime Electron.
- Identité : `getChatGPTUser()` lit l’identité vérifiée par le dispatcher Sites. Ne pas accepter un rôle ou un identifiant utilisateur arbitraire dans les données client.
- Les couches du kernel original existent. L’isolation physique SQLite core/brand/plugin n’est pas simulée : le profil utilise une base D1 par app avec isolation des espaces dans les requêtes.
- Les routes natives branchées sont visibles dans `packages/sites-adapter`. Les fonctions absentes de cette intégration ne sont pas déclarées opérationnelles.
- Ne pas recopier une application métier dans `creezio/creezio-lite`. Le code propre à l’app appartient à son dépôt et au projet Sites.
- Ne pas reprendre l’application Atelier ni son identifiant : c’est seulement une validation du kit.
