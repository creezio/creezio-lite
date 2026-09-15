# Architecture du profil Sites

Le monorepo d’origine est conservé. Le profil web compose les vrais composants `shell-ui`, `auth/ui`, `os-ui/boot`, `tasks/ui`, `support/ui`, `nav/ui` et `interactive-demo/ui`.

Le serveur reçoit l’identité du dispatcher Sites. Il vérifie l’appartenance à l’espace et son rôle avant chaque opération. Le sélecteur d’espace utilise un cookie HttpOnly ; ce cookie est seulement une préférence, jamais une autorisation.

`packages/sites-adapter` branche le **kernel original** et les véritables handlers de nav, support et interactive-demo. Ces handlers acceptent une persistance optionnelle asynchrone ; sans cet argument, leur chemin SQLite historique est conservé. Les requêtes D1 sont paramétrées et filtrées par espace. Le kanban humain respecte le contrat des composants tasks via un service D1 spécifique. Les exécuteurs non disponibles renvoient une erreur explicite.

Le profil ne fournit pas le runtime SQLite au kernel. Il ne simule donc ni les handles synchrones ni l’isolation physique core/brand/plugin. Une base D1 appartient à chaque application ; les espaces sont isolés par `org_id`. Le contrôle du rôle s’effectue à l’entrée des opérations et dans la persistance des mutations.

Les extensions Lite (modules métier JSON, documents R2, membres, invitations et journal) restent dans `packages/core`. Elles utilisent les grilles et primitives natives via `packages/ui`. Elles sont distinctes des packages Database, access-control, search et observability complets de l’amont.

La résolution Vite compile les sources restaurées. Les manifests upstream et leurs dépendances sont préservés ; le template installe les dépendances nécessaires aux composants réellement importés, avec des versions compatibles. Les liens locaux `dist → src` servent uniquement à la résolution TypeScript des imports historiques, sont ignorés par Git et recréés par le script de préparation. Aucune dépendance desktop n’est remplacée par un faux module vide.

Le générateur copie le snapshot du kit et ses empreintes dans une app indépendante. Il ne copie ni données, secrets, identité de Site, environnement de validation ni dépôt Git. La factory originale reste disponible dans `packages/factory` pour ses cibles historiques ; le CLI Lite crée le profil Sites explicitement.
