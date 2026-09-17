# Profils, capacités, groupes — proposition KIT-ACCESS-CONTRACT

Statut : proposition. B1–B8 levés. B9 catalogue helper (`4991f36`). Raccordement `ScopeProvider` (signature additive). Ancêtres `0e85503`, `800f348`, `9b3bf63`, `482f7ba`. Pas de runtime livré. Astra tranche. Aucun schéma privé d’app.

## 1. Limite actuelle

Identité, invitations, `lite_members`, admin d’espace : natifs (`types.ts`, `api.ts`, `access.ts`). `operationAllowed` : `op.roles`, puis `essential` **ou owner → true**, puis seul `deny` ; **`allow` inerte**. `canReadModule` : owner → true, deny `module:${id}` (`operations.ts`). `AppExtensions` = `beforeWrite` | `operations` | `scope` (`types.ts`) ; `defineExtensions` n’a pas de détecteur d’accès (`commands.ts`). Nav / `session.me` / `modules.list` (essential) s’appuient sur `canReadModule`. Groupes `role:*` exposés comme groupes UI. Pas de helper consommable. Pas d’ops `access.receipt.*`.

## 2. Décisions (B1–B9)

1. Opt-in = `AppExtensions.access?: AccessDeclaration`. **Absent ⇒ `legacy`.** Présent ⇒ `incomplete` | `adopted` selon le reçu. `defineExtensions` **valide** la déclaration (fail-closed) ; deux kits ne divergent pas sur « présent ».
2. Récupération `incomplete`→`adopted` : ops natives `access.receipt.update` (adopt/rebind), `access.bind`, `access.unbind` ∈ `workspaceAdminOperationIds`. Skip (7) **n’exempte pas** `authorizeDelegationDecision`.
3. `groupId` matching `/^(role:)/` **refusé** à bind/adopt (pas de profil métier inféré de owner/admin/member/viewer). Invitations, `members.remove`, `access.groups.delete` d’un groupe **lié** : `DelegationMutation` + délégation avant commit. Ce n’est **pas** un refus de `AccessDeclaration`.
4. `op.roles` = **plafond**. Déclaration invalide si un `receivableBy` ∉ `op.roles` d’une op citée.
5. Helper **pur** `evaluateAccessDecision` / `authorizeDelegationDecision`. Catalogue d’entrée = projection kit `AccessCatalogEntry` (`method`, `moduleId` existant, `tokenAllowed`) — **B9**. Le helper, pas l’app, applique deny `module:${moduleId}` et credential read/write. Fermetures **de cette requête** sur `AppOperationContext`, `BeforeWrite`, `FileDeletionContext`. CRUD, search, files, `canReadModule`, nav, `session.me`, `tools/list`, OpenAPI : **le même** évaluateur. `observedProfileIds` = observation, pas un droit.
6. Owner : aucun shortcut hors liste §3, **y compris** découverte. `module:` n’est jamais un **grant** (deny `module:` reste fail-closed).
7. `assignmentApproval` v1 = `'owner'` seulement. `'workspace-rule'` **hors v1** (pas de hook, pas T21 moteur app).
8. Listes vides, capability inconnue, op `module:` / essential, `assignableBy`/`receivableBy` vides → **refus de déclaration**.
9. Capability query : liaison **exacte** de la capability demandée (profil vivant + `receivableBy` ; pas d’emprunt d’une autre capability qui partage des ops) **et** toutes ses ops passent deny / rôles / credential. `observedProfileIds` n’est pas une autorisation. Cardinalité : N liaisons / groupe custom ; unique `(groupId, profileId)` ; `groupId` = id `lite_access_groups` (pas `role:*`).
10. `catalogRevision` : chaîne opaque, égalité seulement. `validUntil` : RFC3339 optionnel vs `now` **serveur**. `AccessDecision.reason` est **interne** au helper, jamais le `error.code` HTTP. Public inchangé : `403 operation_forbidden`, `403 read_only_token` / `token_scope`, `409 version_conflict`.
11. `mcp.tools.available` / `mcp.tools.call` essential = enveloppe ; l’outil interne passe par le même évaluateur (comme `tools.ts` ∩ `operationAllowed` aujourd’hui).
12. Legacy permissif **uniquement** sans déclaration. `allow` inertes au premier reçu. Inconnus → refus. Snapshot par requête ; jobs revalident. Scope user↔entité ≠ RBAC. Audit sans `resource_id` hors scope.
13. `recordFilter` / `fileFilter` : 4e argument additif `ScopeAccessContext` (`evaluateAccess` lié au **même** snapshot). Helper **non récursif**. `allowed` n’autorise pas une ligne ni un champ. Intersection filtre user↔entité **toujours**, owner inclus. Opt-in absent = callbacks 3 args historiques. Opt-in présent + contexte omis = fail-closed. Snapshot non forgeable, non réutilisable inter-espace / inter-requête / job.

## 3. Types

```ts
export type AccessProfileId = string;
export type AccessCapabilityId = string;
export type AccessCapability = {
  id: AccessCapabilityId; label?: string;
  operations: readonly string[]; // Operation.id, uniques, pas de module:
};
export type AccessProfile = {
  id: AccessProfileId; label?: string; revision: number;
  capabilities: readonly AccessCapabilityId[];
  receivableBy: readonly Role[]; // non vide
  assignableBy: readonly Role[]; // non vide
  assignmentApproval: 'owner';   // v1 ; workspace-rule hors v1
};
export type GroupProfileBinding = {
  groupId: string; // id lite_access_groups ; interdit si /^(role:)/ (groupes rôle natifs)
  profileId: AccessProfileId; profileRevision: number;
};
export type AccessAdoptionReceipt = {
  catalogRevision: string;
  bindings: readonly GroupProfileBinding[];
  validUntil?: string;
};
export type AccessDeclaration = {
  catalogRevision: string;
  profiles: readonly AccessProfile[];
  capabilities: readonly AccessCapability[];
};
export type AppExtensions = {
  beforeWrite?: BeforeWrite;
  operations?: AppOperationDefinition[];
  scope?: ScopeProvider;
  access?: AccessDeclaration; // absent ⇒ legacy
};
export type AccessAdoptionState = 'legacy' | 'incomplete' | 'adopted';
export type AccessDecisionReason =
  | 'allowed' | 'denied_incomplete' | 'denied_policy' | 'denied_role'
  | 'denied_credential' | 'denied_unbound' | 'denied_revision'
  | 'denied_unknown' | 'denied_delegation' | 'denied_conflict';
export type AccessQuery =
  | { kind: 'operation'; operationId: string }
  | { kind: 'capability'; capabilityId: AccessCapabilityId };
export type AccessDecision = Readonly<{
  allowed: boolean; reason: AccessDecisionReason;
  operationId?: string;
  capabilityIds: readonly AccessCapabilityId[];
}>;
export type AccessSnapshot = Readonly<{
  state: AccessAdoptionState;
  catalogRevision: string | null;
  receiptRevision: string | null;
  observedProfileIds: readonly AccessProfileId[];
}>;
export type DelegationMutation =
  | { kind: 'bind' | 'unbind'; groupId: string; profileId: AccessProfileId; profileRevision?: number }
  | { kind: 'groupMembers'; groupId: string; userIds: readonly string[] }
  | { kind: 'memberRole'; userId: string; role: Role }
  | { kind: 'memberRemove'; userId: string }
  | { kind: 'groupDelete'; groupId: string }
  | { kind: 'inviteCreate'; role: Role }
  | { kind: 'adopt' | 'rebind'; receipt: AccessAdoptionReceipt };
/** Projection du `Operation` kit. `moduleId` = champ existant (core, session, files, access, mcp, id métier…). Ce n’est pas un module métier inventé pour une op globale. */
export type AccessCatalogEntry = Readonly<{
  id: string;
  roles: Role[];
  essential?: boolean;
  method: string;        // write ⇔ method ∉ GET|HEAD (tools.ts)
  moduleId: string;
  tokenAllowed: boolean;
}>;
export type EvaluateAccessInput = Readonly<{
  snapshot: AccessSnapshot;
  declaration: AccessDeclaration | null;
  receipt: AccessAdoptionReceipt | null;
  principal: Principal; // snapshot déjà noyau, pas recalculé du body
  credential: CredentialContext;
  denials: readonly { operationId: string; effect: 'deny' }[]; // id d’op ou `module:${moduleId}` tels que stockés
  catalog: readonly AccessCatalogEntry[];
  query: AccessQuery;
}>;
export function evaluateAccessDecision(input: EvaluateAccessInput): AccessDecision;
// Pur : grant/deny/credential seulement. Interdit : appeler ScopeProvider, lire rows, projections, search, files.
export type ScopeAccessContext = Readonly<{
  snapshot: AccessSnapshot; // cette requête, cet org_id ; pas un argument client
  evaluateAccess: (query: AccessQuery) => AccessDecision;
}>;
// Signatures actuelles inchangées si `access?` omis (legacy).
// recordFilter(principal, ref, action, access?: ScopeAccessContext): SqlFragment
// fileFilter(principal, ref, action, access?: ScopeAccessContext): SqlFragment
// recordScope(..., access?: ScopeAccessContext) ; fileScope(..., access?: ScopeAccessContext)

export function authorizeDelegationDecision(
  input: EvaluateAccessInput & {
    mutation: DelegationMutation;
    group: { id: string; version: number; memberIds: readonly string[]; builtin: boolean } | null;
    actorUserId: string;
  }
): AccessDecision;
export const workspaceAdminOperationIds = [
  'workspaces.update',
  'members.list','members.get','members.update','members.remove',
  'invites.list','invites.create','invites.revoke',
  'audit.list','audit.get',
  'access.catalog','access.groups.create','access.groups.update',
  'access.groups.delete','access.policies.update',
  'access.receipt.update','access.bind','access.unbind',
  'tokens.list','tokens.create','tokens.revoke',
  'mcp.status','mcp.tools','mcp.clients','mcp.diagnostics','mcp.metrics',
  'mcp.clients.revoke','mcp.diagnostics.export','mcp.policies.update',
  'mcp.tools.create','mcp.tools.delete',
] as const;
```

`defineExtensions(app, ext, catalog?)` : si `ext.access` absent → legacy, pas d’autre contrôle d’accès ; si présent → valide ou throw (même famille qu’aujourd’hui pour les ops).

**Fail-closed déclaration** : IDs profils/capabilities uniques ; `profile.capabilities ⊆ capabilities.id` ; chaque `operations[]` unique, ⊂ catalogue, **sans** `module:` ni `essential` ; chaque `receivableBy` ⊆ `op.roles` de **chaque** op citée (plafond) ; `assignableBy`/`receivableBy` **non vides** (vide = invalide, pas « personne » fail-open) ; `assignmentApproval === 'owner'` ; `catalogRevision` non vide ; pas de défaut `assignableBy=['admin']`. `AccessDeclaration` ne porte **pas** de `groupId`. Bindings du reçu / bind : `groupId` ne matche **pas** `/^(role:)/` ; `(groupId, profileId)` unique ; `profileId` ∈ déclaration ; `profileRevision` = révision déclarée.

## 4. États, snapshot, évaluation

| État | Détecteur | (7) ops/données | Admin §3 + essential enveloppe |
|---|---|---|---|
| `legacy` | `access` **absent** | `operationAllowed` actuel | inchangé |
| `incomplete` | `access` présent et (reçu absent, `validUntil` dépassé côté serveur, ou révision ≠) | **default-deny** | récupération ; `access.receipt.update` **avec** délégation |
| `adopted` | reçu vivant, révisions égales | helper (7) | skip (7) ≠ skip délégation |

`legacy` n’est jamais le repli d’un reçu manquant. `allow` ignorés dès que `access` est présent.

**Snapshot** (noyau, par requête) : `declaration` = `AppExtensions.access` ; `receipt` = reçu vivant d’espace ; `observedProfileIds` = profils des liaisons **custom** dont le membre fait partie et dont la révision concorde — **pas** une autorisation. Jobs : reconstruire l’entrée, rappeler le helper. Body/query (`access`, `profileId`, `observedProfileIds`, `catalogRevision`, `evaluateAccess`, `authorizeDelegation`) → 400, ignorés.

Le **helper** applique deny `module:` et credential ; l’app ne pré-filtre pas `denials` ni le mode. Pour l’entrée catalogue `e` visée : `denied_policy` si une denial a `operationId === e.id` **ou** `operationId === 'module:' + e.moduleId` ; `denied_credential` si (`token`/`oauth` et `!e.tokenAllowed`) ou (`mode==='read'` et `e.method` ∉ `GET|HEAD`). Pas de grant `module:`.

Éval `adopted` : (1) identité + membership `org_id` ; (2)+(5) **dans le helper** (ci-dessus) ; (3) `e.roles` ; (4) essential **enveloppe** (session/health/`mcp.tools.*` transport) — le **contenu** découverte n’est pas essential ; (6) si op ∈ liste §3 : rôle natif, skip (7), **délégation si mutation** ; (7) sinon liaison vivante, op ∈ capability, rôle ∈ `receivableBy` ; (8) `ScopeProvider`. `kind:'capability'` : `allowed` ssi la capability **demandée** est liée par un profil vivant `receivableBy` (7 exact — une autre capability qui cite les mêmes ops n’emprunte pas) **et** toutes ses ops passent (2)(5)(3). Owner sans profil métier : pas de bypass. `incomplete` : refuse (7). `canReadModule` / nav / `modules.list` / `session.me` permissions / OpenAPI / `tools/list` : `evaluateAccessDecision` sur `module.<id>.list` (ou get) — **pas** owner→true.

Pas de keep-alive shell implicite après adoption : dashboard/search/files/mail/assistant exigent des **IDs d’op** dans une capability liée (proposition : l’app les déclare ; le kit n’invente pas un profil magique).

## 5. Fermetures request-scope et ScopeProvider

Noyau construit `EvaluateAccessInput` **une fois par requête** (`requestId` + `workspaceId`). Fermetures :

`evaluateAccess(query)` → `evaluateAccessDecision` (même snapshot)  
`authorizeDelegation(mutation, group)` → `authorizeDelegationDecision`

sur `AppOperationContext`, `BeforeWrite`, `FileDeletionContext`, et 4e argument de `recordFilter` / `fileFilter`.

Surfaces natives qui **passent** ce contexte (opt-in présent) : `recordScope` / `fileScope` (CRUD, dashboard, history), `searchScope` (`search.ts` : index records **et** files), listes/métadonnées/téléchargement fichiers. Les projections champs/extraits de recherche/fichiers **n’ont pas** d’API parallèle : elles reçoivent le même `ScopeAccessContext` uniquement par ces surfaces. Pas de SQL groupes ; `observedProfileIds` n’est pas une permission. Plusieurs profils = autant d’appels au **même** `evaluateAccess` kit (deny prioritaire déjà dans le helper). Aucun bypass owner dans le filtre.

**Non-récursion.** `evaluateAccessDecision` ne rappelle pas `ScopeProvider`, ne lit aucune ligne, n’applique aucune projection. Un `allowed` n’ouvre pas de row/champ : le fragment app (user↔entité) est **AND** obligatoire, y compris owner. Un filtre qui se fonderait sur des IDs de profil comme ACL viole le contrat.

**Additif / fail-closed.** `access` absent : appels 3 arguments, `openScope` `1=1`, comportement historique. `access` présent : la surface native **doit** fournir `ScopeAccessContext` ; omission → fragment fail-closed `0=1` (pas `1=1`). Un callback legacy à 3 paramètres reste callable (4e argument JS ignoré) ; le kit n’omet pas le contexte. Snapshot d’une autre requête, d’un autre `org_id` ou d’un job antérieur : interdit ; le job reconstruit l’entrée (§4).

## 6. Délégation

Réutiliser `requireRole`, `role:owner` locked, `owner_protected`, `members.update` owner-only, `WHERE version=?` / `changes()=1`.

Avant transaction, état serveur : `bind`/`unbind`/`adopt`/`rebind` ; `groupMembers` si groupe lié ; `memberRole` / `memberRemove` si l’utilisateur est dans un groupe lié ; `groupDelete` si lié ; `inviteCreate` (rôle natif seulement — aucun profil, car `role:*` interdit ; si un bind `role:` fuyait : refus). Self-grant (acteur dans le groupe cible ou nouvelles ops app) → `assignmentApproval: 'owner'`. `builtin === true` (`role:*`) → `denied_delegation`. CAS `group.version` + révision liaison + membership **ou** batch atomique. Concurrent / révision périmée / revoke : `denied_conflict` | `denied_delegation`, **zéro effet**.

Audit : pas d’oracle `resource_id` hors scope. Owner : pas de bypass row-scope.

## 7. Hors lot

Runtime, tests exécutables, migration, version, changelog, skill, R01, C01, `'workspace-rule'`, forme physique de la liaison (inventaire). Suggestions : format hash de `catalogRevision` ; profil « shell » kit — **non retenues** en v1 (opaque + ops explicites).

Prochaine action : revue indépendante, puis Astra. Pas de fusion.
