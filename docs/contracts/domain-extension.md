# Extension générique du registre et des opérations

Contrat validé par l’orchestrateur le 16/09/2026 pour D01. Référence complète côté consommateur : https://github.com/creezio/certivan-bo/blob/main/docs/contracts/m01-implementation.md . Les types et contrôles ci-dessous sont génériques ; les tables cv_* et la politique métier restent dans Certivan. Aucun code n’est annoncé comme implémenté par ce document.

## 2. Registre : modules, entités et collections

Le kit étend `Module` par des champs facultatifs et conserve exactement le comportement d’un module existant lorsque ces champs sont absents :

```ts
export type ModuleKind = 'module' | 'entity' | 'collection';
export type ModuleExtension = {
  kind?: ModuleKind;
  parent?: string;       // moduleId de l’entité parente, pour une collection
  parentField?: string;  // champ réel portant son recordId : party_id, vehicle_id…
  navigation?: boolean;
};
```

| Propriété | module / kind absent | entity | collection |
|---|---|---|---|
| CRUD généré | list/get/create/update/archive | list/get | list/get |
| Écritures | CRUD natif | opérations applicatives déclarées | opérations déclarées |
| Navigation | oui par défaut | oui, sauf navigation:false | non |
| Compteur dashboard | si navigable | si navigable | non |
| Recherche | règle actuelle | activée par défaut | désactivée sauf search.enabled:true |
| Permission module.<id>.read | conservée | explicite | explicite |
| Outils | CRUD actuel | lectures + opérations déclarées | lectures + opérations déclarées |

`defineApp` valide `kind`, `navigation`, le parent déclaré de kind entity, l’absence de cycle et le `parentField` déclaré dans les champs de la collection. Une collection ne devient pas parent. Les champs parent/parentField sont interdits hors collection. Pas de convention implicite `data.parent_id` : `recordHref` lit le champ réellement déclaré ; un parent absent/invalide ne fabrique pas une URL vers « undefined ». Une collection ne peut pas imposer navigation:true.

Le plafond passe à 64 dans le kit, avec tests de borne ; les motifs d’identifiants et noms réservés sont conservés. Les métadonnées sont exposées par le registre à l’UI, la navigation, l’API et la recherche. La page générique masque les boutons créer/modifier/archiver des entités commandées.

Défense en profondeur : aucune opération CRUD d’écriture n’est générée pour entity/collection ; le dispatcher répond 404 avant handler. `handleApi` refuse aussi directement POST/PATCH/DELETE par `405 command_required`. Les contrôles de portée s’appliquent également aux lectures génériques. Clients reste un module natif inchangé en M01.

## 3. Extension commune : AppOperationDefinition

### 3.1 Interface fixée

Une extension applicative déclare une **Operation du catalogue existant et son handler**. Elle accepte les GET comme les POST : history et jobs ne sont pas des exceptions hors catalogue.

```ts
export type Principal = {
  userId: string;
  role: Role;
  workspaceId: string;
  credential: 'session' | 'token' | 'oauth';
};
export type AppOperationDefinition = {
  operation: Operation; // construite avec le helper operation() existant
  handle(ctx: AppOperationContext): Promise<AppOperationResult>;
};
export type AppOperationContext = {
  db: D1Database;
  env: LiteEnvironment;
  app: AppDefinition;
  identity: Identity;
  workspace: Workspace;
  principal: Principal;
  operation: Operation;
  requestId: string;
  now: string;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, unknown>>;
  body: Readonly<Record<string, unknown>>;
  scope: ScopeProvider;
  defer(promise: Promise<unknown>): void;
};
export type AppOperationResult = {
  status?: 200 | 201 | 202;
  body: unknown;
  changed?: string[]; // modules invalidés via x-lite-data-changed
  replayed?: boolean; // produit Idempotent-Replayed: true, jamais fourni par le client
};
export type AppExtensions = {
  beforeWrite?: BeforeWrite;
  operations?: AppOperationDefinition[];
  scope?: ScopeProvider;
};
```

K01 possède et exporte ces types dans le kit ; K02 utilise l’interface publiée. Aucun second type concurrent ni copie du dispatcher dans l’application.

Les opérations applicatives sont ajoutées à `operationCatalog` avant sa détection de doublons. Refuser à la déclaration les collisions d’ID, méthode/chemin/alias et noms d’outils. Le dispatcher exécute le handler applicatif **après** les contrôles existants d’identité, espace, rôle, politique, jeton et origine, **avant** le kernel natif ; une route absente du catalogue reste 404.

Le schéma de chemin, query et corps est validé serveur pour toute entrée HTTP, MCP ou assistant. Les GET n’acceptent pas un corps métier. Seules les propriétés déclarées sont acceptées. Les handlers ne reconstruisent jamais l’acteur, le rôle ou l’espace depuis body/query.

Toutes les constructions du catalogue reçoivent les extensions : HTTP, protocole MCP, outils assistant avec relecture des droits, endpoints administratifs et OpenAPI. Ne pas n’ajouter les opérations qu’au premier chemin HTTP. Les opérations et outils restent soumis aux politiques vivantes.

### 3.2 Routes et corps de commande validés

Le helper de commande construit une AppOperationDefinition POST sous :

- `/api/v1/modules/<moduleId>/commands/<name>` ;
- `/api/v1/modules/<moduleId>/records/:id/commands/<name>`.

ID stable : `command.<moduleId>.<name>`, kind business, moduleId déclaré dans l’application. Une commande nommée get reste une mutation POST ; le dispatch ne déduit jamais la méthode de son dernier segment.

**Corps aplati validé par l’orchestrateur :**

```json
{
  "expectedVersion": 7,
  "idempotencyKey": "demo-remplacement-001",
  "reason": "Remplacement confirmé",
  "replacement": {"category": "heater", "productReferenceId": "produit-demo"},
  "transformation": {"installerPartyId": "installateur-demo"}
}
```

Il n’y a pas d’objet enveloppant `payload`. `expectedVersion`, `idempotencyKey` et `reason` sont des noms réservés ; les champs métier sont au même niveau. L’ID de commande est déterminé par l’opération déclarée, pas par un champ libre du client. Un champ `command` n’est pas nécessaire et est rejeté par défaut. Le schéma de chaque commande précise les champs requis :

- expectedVersion : entier positif, obligatoire pour chaque cible existante modifiée ; plusieurs cibles ⇒ versions attendues explicites par cible, aucune version relue puis substituée silencieusement ;
- idempotencyKey : obligatoire pour création ; facultative seulement si le contrat de la mutation permet une exécution sans rejeu ;
- reason : texte borné à 500 caractères lorsqu’exigé par le contrat métier ; M01 n’invente pas de nouvelle action sensible.

L’alias HTTP `Idempotency-Key` est normalisé avant validation ; si header et body sont présents et différents, 400 invalid_arguments. La valeur normalisée appartient à l’empreinte selon §6.

Ce choix remplace explicitement le préfixe `/api/v1/certivan/...` proposé et l’objet `payload` d’A01 §10. L’orchestrateur aligne A01 lors de l’intégration. Les anciens exemples du plan Notion sont des chemins proposés, non livrés ; leur mise à jour passe par Notion et la synchronisation, jamais une édition manuelle du miroir.

Réponse métier conservée : `{result, events}`. Un résultat rejoué garde son status/body et ajoute uniquement l’en-tête de rejeu. Aucune propriété libre du résultat ne permet d’injecter un en-tête d’authentification.

### 3.3 Lectures et opérations transversales

History : `GET /api/v1/modules/<moduleId>/records/:id/history`, opération business déclarée, rôles de lecture et portée read de l’entité, pagination bornée.

Jobs : opérations déclarées `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/retry`, `POST /api/v1/jobs/drain`. Elles utilisent un descripteur transversal explicite kind system, moduleId `certivan-jobs`, nom « Traitements Certivan », rôles owner/admin ; pas de faux module métier dans brand.json. L’identifiant reste soumis aux politiques `module:certivan-jobs` et aux politiques par opération. Toutes les lignes sont filtrées par l’espace courant. Cette surface minimale concerne l’outbox M01, pas les futurs agents fournisseurs.

Les outils générés à partir d’AppOperationDefinition utilisent `Operation.inputSchema` et une sérialisation générique des paramètres/query/body ; ils ne passent pas par la branche legacy business CRUD de tools.ts. Ajouter un marqueur explicite aux métadonnées internes du catalogue ou transmettre la liste d’IDs applicatifs ; ne pas deviner leur transport par le nom. Conserver l’entrée et le comportement des outils CRUD existants.

## 4. Portée, grants et suppression des fichiers

### 4.1 Interface fixée

```ts
export type ScopeAction = 'read' | 'write';
export type SqlFragment = { sql: string; bindings: unknown[] };
export type ScopeProvider = {
  recordFilter(
    principal: Principal,
    ref: { alias: string; idColumn: string; moduleColumn: string },
    action: ScopeAction
  ): SqlFragment;
  fileFilter(
    principal: Principal,
    ref: { alias: string; idColumn: string },
    action: ScopeAction
  ): SqlFragment;
  deleteFile?: (ctx: FileDeletionContext) => Promise<FileDeletionResult>;
};
export type FileDeletionContext = {
  db: D1Database;
  env: LiteEnvironment;
  principal: Principal;
  workspace: Workspace;
  fileId: string;
  requestId: string;
  now: string;
  defer(promise: Promise<unknown>): void;
};
export type FileDeletionResult = {
  cleanup: 'queued' | 'complete';
};
```

Sans provider, openScope retourne 1=1 et conserve les routes natives actuelles. La validation des rôles/modules/catalogue n’est jamais remplacée par ce filtre. Les aliases/colonnes SQL sont exclusivement fournis par le code de confiance, validés comme identifiants ; toutes les valeurs sont bindées.

Le ScopeProvider Certivan lit les tables cv_*. Les opérations sur record vérifient le module réellement attendu, l’espace, l’état non supprimé, les rôles/politiques de ce module et la portée :

- **read** sur liste, détail, compteurs, recherche/FTS et extraits, history, outils, liens et rejeu de résultat ;
- **write** pour chaque cible modifiée ou détachée ; un grant read ne suffit jamais à une écriture ;
- les grants actifs testent user_id, org_id, project_id, révocation, expiration et présence de l’action requise dans actions_json ;
- une relation ne peut accorder des droits par elle-même. Lire une fiche ne révèle pas une extrémité de relation non autorisée.

La politique interne jalon A prévue par A01 peut autoriser owner/admin/member à tous les projets de leur espace. Elle est une constante explicite de la politique applicative, indépendante du mécanisme ; viewer ne bénéficie pas de ce bypass et ne devient pas lisible si readRoles ne l’admet pas. K02 teste cette politique séparément et injecte une politique restrictive pour prouver le filtrage entre deux members. Aucune restriction métier supplémentaire n’est décidée ici.

Une fiche déclarée à portée projet ne devient pas publique par absence accidentelle de cv_record_scopes : son type/handler connaît sa portée attendue, et l’absence de scope requis refuse. Les fiches explicitement d’espace, dont Clients actuel, conservent leur comportement. Les créations posent fiche et scopes dans la même transaction.

### 4.2 Surfaces obligatoires

| Surface | Application du contrôle |
|---|---|
| Liste générique, détail | prédicat SQL avant résultat/pagination |
| Dashboard | même prédicat avant COUNT ; collections non navigables exclues |
| Recherche/records?q | dans matches, avant COUNT et construction des extraits |
| History et relations | mêmes droits vivants que le record courant, autres extrémités filtrées |
| Fichiers natifs liste/métadonnées/téléchargement | fileFilter read, tombstones exclus |
| Fichiers natifs suppression | rôle/opération + fileFilter write puis politique transactionnelle |
| Commandes | contrôles de toutes les cibles et assertions transactionnelles |
| API/MCP/assistant | même catalogue et mêmes handlers ; aucun chemin direct contournant HTTP |
| OpenAPI/navigation/catalogue | métadonnées filtrées selon les politiques existantes |

Hors portée/espace ⇒ 404 record_not_found (ou code natif fichier équivalent), sans détails d’existence. Opération interdite par rôle/politique ⇒ 403. Un diagnostic ne divulgue ni valeur métier ni résultat d’une cible refusée.

### 4.3 Fichiers : politique serveur atomique

Un fichier lié à Certivan est lisible seulement si au moins **une liaison active** mène à une ressource non supprimée que le principal peut lire : rôle du module, canReadModule/politiques et portée read. Une liaison voided ou vers un record archivé ne suffit pas. Les fichiers réellement natifs sans liaison Certivan conservent leur politique native.

Quand `scope.deleteFile` est configuré, le kit délègue **toute suppression native de fichier dans cet espace** à cette politique après ses contrôles d’accès ; il ne réalise ensuite ni tombstone ni bucket.delete en parallèle ou en fallback. Le provider traite aussi le cas sans lien. Il ne peut pas retourner « null, reprendre le chemin natif » après un simple contrôle préalable.

Politique Certivan :

1. Dans un batch D1, vérifier l’espace, la visibilité, les droits write, l’absence de liaison active et de verrou interdisant la suppression.
2. Poser le tombstone avec un UPDATE conditionnel contenant ces prédicats ; assertion immédiate changes()=1.
3. Écrire l’événement de demande et une outbox r2.delete dans le même batch ; conserver object_key serveur, jamais une clé fournie par body.
4. Répondre avec l’enveloppe native conservée et cleanup queued ; le kit ne prétend pas que l’objet R2 a déjà disparu.
5. Après commit seulement, déclencher le drain opportuniste ou explicite. Le téléchargement natif refuse immédiatement le tombstone, même si R2 répond encore.
6. Sur échec conditionnel, aucune écriture n’a eu lieu ; relecture autorisée pour classifier file_locked/file_linked/introuvable. Ne pas supprimer R2.

L’insertion d’un lien, son verrouillage et sa révocation sont eux aussi transactionnels. Une commande attach vérifie dans le même batch que le fichier est encore disponible et dans le même espace ; une suppression gagnante interdit ainsi un attachement tardif. La commande de détachement exige write et expectedVersion du propriétaire, refuse les verrous métier, et ne demande la suppression physique qu’après le dernier lien actif. Ces commandes de démonstration restent des fixtures de test, pas des fonctionnalités publiées.

