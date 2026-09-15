# Compatibilité du profil Sites 0.2

Tous les **36 packages upstream** sont restaurés au commit `6bd6507633b4c17bfc31206d82d1caa9a8af19af`. Cette table distingue la restauration des sources et l’intégration effective. Aucune ligne « source conservée » ne signifie « fonctionnalité testée sur Sites ».

| Package original | État dans Sites 0.2 |
|---|---|
| `shell-ui` | Shell, sidebar, onglets, recherche de pages, DataTable, primitives et thème originaux intégrés. Les panneaux desktop ne sont pas tous exposés. |
| `os-ui` | Boot UI original intégré ; seules les pages branchées sont publiées. Le catalogue complet de routes reste dans les sources. |
| `auth` | SessionProvider, RequireSession et LoginPage originaux ; identité ChatGPT adaptée à `/auth/me`. Les mots de passe/JWT, API keys et impersonation historiques ne sont pas portés. |
| `api-kernel` | Kernel original utilisé, espaces et opérations conservés. Pas de faux driver SQLite ; `/core/sqlite/status` indique son indisponibilité. |
| `nav` | Handler et page admin originaux ; persistance D1 injectable, droits, renommage, visibilité et ordre testés. |
| `support` | Handler et page originaux ; tickets, messages, réponses, statuts et export sur D1, filtrés par espace. L’accès de la flotte admin externe n’est pas configuré. |
| `interactive-demo` | Player, scénario OS, validation, merge et handler originaux ; contenu et préférences stockés dans D1. |
| `tasks` | Kanban et détail originaux ; tâches humaines, affectation et statuts sur D1. Service D1 spécifique, pas le service SQLite synchrone original. Aucun run IA/Hermes simulé. |
| `platform-core` | Sources complètes. Constante d’architecture utilisée ; runtime SQLite/fichiers, sauvegardes locales et services embarqués non exécutés dans Sites. |
| `access-control` | Sources complètes. Le profil applique ses rôles d’espace ; l’éditeur ACL et le système de rôles natifs complets restent à adapter. |
| `database` | Sources complètes. L’éditeur de base natif, vues, boutons, relations et automatisations ne sont pas portés. Le CRUD JSON Lite est une extension distincte. |
| `assistant` | Sources et provider requis par le shell conservés ; assistant masqué. L’agent dépend d’un moteur/hôte à configurer ; aucune réponse IA fictive. |
| `automations` | Sources complètes ; moteur et planificateur non portés. |
| `mails` | Sources complètes ; stockage, comptes, réception/envoi et synchronisation non portés. Nécessite des comptes et une intégration fournisseur/hôte. |
| `granola` | Sources complètes ; intégration et stockage natifs non portés. |
| `grokbot` | Sources complètes ; intégration et stockage natifs non portés. |
| `integrations` | Sources complètes ; configuration des connecteurs et gestion des secrets restent à adapter. |
| `observability` | Sources complètes ; analytics et API request-logs natifs non portés. Le journal d’activité Lite est distinct. |
| `onboarding` | Sources complètes ; onboarding natif multiétape non branché. Initialisation de l’espace Sites disponible. |
| `landing` | Sources complètes ; composants réutilisables lors de la création d’une app, sans page publique générée automatiquement. |
| `mcp-facade` | Sources complètes ; serveur MCP/OAuth natif non porté. Les outils WebMCP Lite exposent quelques opérations métier lorsque le navigateur les prend en charge. |
| `brand-config` | Sources et manifests originaux conservés. Identité du profil Sites fournie au boot par sa configuration web. |
| `brand-spec` | Contrat YAML, loaders et doctor originaux conservés. Pas de conversion automatique d’une application historique vers Sites. |
| `factory` | CLI et générateurs natifs restaurés. Le générateur Sites est un profil distinct ; ne pas prétendre que les commandes desktop produisent un Worker. |
| `app-runtime` | Orchestration native conservée ; nécessite un runtime serveur/desktop, non utilisée comme faux Worker. |
| `shell` | Contrats IPC et runtime natif conservés ; l’IPC Electron n’existe pas dans un Site web. |
| `electron-shell` | Sources complètes pour les applications desktop ; pas d’exécution Electron dans Sites. |
| `browser-host` | Sources complètes ; hôte navigateur natif non déployé dans Sites. |
| `host-runtime` | Sources complètes ; processus locaux, binaires et services persistants exigent un hôte. |
| `desktop-tooling` | Scripts et distribution desktop conservés ; non utilisés par le déploiement Sites. |
| `fleet` | Sources complètes ; agents, tunnels, Docker et gestion de flotte nécessitent un environnement externe. |
| `cockpit` | Sources complètes ; surfaces de supervision de l’hôte non branchées. |
| `admin` | Sources complètes ; modules de l’application admin originale non portés. |
| `product-hub` | Sources complètes ; services natifs non portés. |
| `propagation` | Outillage original conservé. Pas de propagation automatique vers des dépôts ou de publication npm déclenchée depuis ce fork. |
| `search` | Sources Meilisearch complètes ; indexation, facettes et recherche native non portées. Recherche de pages native et recherche textuelle D1 des modules Lite disponibles, sans les présenter comme Meilisearch. |

Hermes et n8n ne sont pas deux packages autonomes dans cette liste : leurs intégrations vivent notamment dans platform-core, host-runtime et shell-ui. Elles restent conservées en source pour garder le kit cohérent, mais sont **désactivées dans le profil Sites** à la demande du propriétaire.

## Différences structurelles

Sites héberge ici un Worker avec D1/R2. Le kit original organise notamment des processus Node/Electron et des bases SQLite synchrones. Copier ses packages ne transforme pas ces services en services Workers. Les adaptateurs sont donc explicites, et les fonctionnalités non branchées restent identifiées.

La présence d’un composant UI dans le bundle ne prouve pas que son backend est connecté. La référence de validation est `docs/VALIDATION.md`. Ne pas annoncer une parité totale, un portage des données historiques, une recherche Meili ou un serveur MCP complet à partir des seuls tests du profil web.
