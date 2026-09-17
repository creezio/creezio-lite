# Profils, capacités, groupes — proposition KIT-ACCESS-CONTRACT

Statut : **proposition** (heads `0e85503` → `800f348`). Pas de capacité livrée. Astra tranche ; pilotes d’app gardent leur plan. Aucun schéma privé d’app.

## 1. Limite actuelle

Identité, invitations, `lite_members`, admin d’espace : natifs. Rôles `owner|admin|member|viewer` (`types.ts`). Groupes `lite_access_groups.members_json` ⊂ membres du `org_id` (`access.ts`). `workspace()` unionne `role:{role}` et groupes custom (`api.ts`). `operationAllowed` : `op.roles`, puis `essential` **ou owner → true**, puis seul `deny` refuse ; **`allow` inerte**. UI : inherit ≠ grant ; deny prioritaire ; effet à la requête suivante. MCP ∩ `tokenAllowed` ∩ mode ; OAuth `crm:read`/`crm:write`. Clé : membership vivant. `ScopeProvider` filtre SQL ; pas de bypass owner sur les lignes ; owner court-circuite ops/module. Native : tout admin `PUT` membres/politiques des groupes non-owner — **pas** de séparation délégation/détention, **pas** d’API d’évaluation consommable.

## 2. Décisions

1. Identité/auth/membership/invitations/admin d’espace **natifs**.
2. Profils/capacités déclarés, IDs stables ≠ labels, **révision** par profil. Capacités v1 = **IDs d’opération explicites** (pas de joker `module:<id>`).
3. Liaison versionnée `groupId→profileId` ; **interdit** de la reconstruire depuis `allow`. Stockage additif **après inventaire** (pas de schéma/numéro ici). Pas de RBAC app parallèle. Groupes/UI deny-inherit conservés.
4. Lien métier `userId`↔entité sans y stocker rôle/auth/adhésion. `ScopeProvider` app **ne refait pas** le RBAC.
5. **Q2** : bypass owner **seulement** `workspaceAdminOperationIds`. Ops app **et** données : profil + scope. `kind:'system'` n’est pas un blanc-seing. Owner : **aucun** bypass row-scope. Audit admin **n’expose pas** d’IDs de ressources privées.
6. Deny prioritaire. Grant n’élève pas le rôle et n’ouvre pas d’`essential`.
7. **Legacy permissif uniquement si `AccessDeclaration` absente.** Déclaration présente + reçu absent / périmé / `catalogRevision` ≠ déclaration = **configuration incomplète** : default-deny ops/données app ; **seule** récupération = admin d’espace borné (§3) + essential.
8. Premier reçu : `allow` inertes **non** activés ; bindings explicites ; default-deny initial.
9. Inconnus (profil, capacité, révision, scope, mode, snapshot) → refus. Snapshot **par requête** ; jobs/`defer` **revalident** ; provenance body/query **refusée**.
10. Délégation transitive : binding, `PUT` membres d’un groupe déjà lié, changement de rôle natif, adoption/rebind — `assignableBy`/`receivableBy`/`assignmentApproval`. Autorité **avant** transaction, état serveur, CAS révisions ou garde atomique. Échec → **zéro effet**.
11. Helper natif readonly : intersection deny ∩ credential ∩ révision ∩ bornes ; décision + raison bornée. IDs de profil observés **≠** autorisation.

## 3. Types minimaux

```ts
export type AccessProfileId = string;
export type AccessCapabilityId = string;
export type AccessCapability = {
  id: AccessCapabilityId; label?: string;
  operations: readonly string[]; // Operation.id v1
};
export type AccessProfile = {
  id: AccessProfileId; label?: string; revision: number;
  capabilities: readonly AccessCapabilityId[];
  receivableBy: readonly Role[];
  assignableBy: readonly Role[];
  assignmentApproval: 'owner' | 'workspace-rule';
};
export type GroupProfileBinding = {
  groupId: string; profileId: AccessProfileId; profileRevision: number;
};
export type AccessAdoptionReceipt = {
  catalogRevision: string;
  bindings: readonly GroupProfileBinding[];
  validUntil?: string; // optionnel ; dépassé ⇒ incomplet
};
export type AccessDeclaration = {
  catalogRevision: string;
  profiles: readonly AccessProfile[];
  capabilities: readonly AccessCapability[];
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
  capabilityIds: readonly AccessCapabilityId[]; // celles qui autorisent vraiment ; [] si refus
}>;
export type AccessSnapshot = Readonly<{
  state: AccessAdoptionState;
  catalogRevision: string | null;
  receiptRevision: string | null;
  observedProfileIds: readonly AccessProfileId[]; // observation, pas un jeton
}>;
export type DelegationMutation =
  | { kind: 'bind' | 'unbind'; groupId: string; profileId: AccessProfileId; profileRevision?: number }
  | { kind: 'groupMembers'; groupId: string; userIds: readonly string[] }
  | { kind: 'memberRole'; userId: string; role: Role }
  | { kind: 'adopt' | 'rebind'; receipt: AccessAdoptionReceipt };
export const workspaceAdminOperationIds = [
  'workspaces.update',
  'members.list','members.get','members.update','members.remove',
  'invites.list','invites.create','invites.revoke',
  'audit.list','audit.get',
  'access.catalog','access.groups.create','access.groups.update',
  'access.groups.delete','access.policies.update',
  'tokens.list','tokens.create','tokens.revoke',
  'mcp.status','mcp.tools','mcp.clients','mcp.diagnostics','mcp.metrics',
  'mcp.clients.revoke','mcp.diagnostics.export','mcp.policies.update',
  'mcp.tools.create','mcp.tools.delete',
] as const;
```

Hors liste (incomplet/adopté → pas de bypass owner) : files, dashboard, search.query, mail, CRUD modules, search admin, `api.catalog`, logs, analytics, integrations, assistant.

Validation déclaration : IDs uniques, ops ⊂ catalogue non-essential, bornes ⊂ `Role`, `assignmentApproval` obligatoire. **Pas** de défaut `assignableBy=['admin']`.

## 4. États et évaluation

| État | Condition | Ops/données app | Admin espace + essential |
|---|---|---|---|
| `legacy` | **pas** de `AccessDeclaration` | régime actuel (`op.roles`, deny, owner bypass deny) | inchangé |
| `incomplete` | déclaration **et** (reçu absent \| `validUntil` dépassé \| `receipt.catalogRevision` ≠ déclaration) | **default-deny** | récupération native bornée seulement |
| `adopted` | reçu vivant, révisions concordantes | § évaluation (7) | liste §3, régime natif |

`legacy` n’est **jamais** le repli d’un reçu manquant. `allow` historiques ignorés dès qu’une déclaration existe.

Évaluation `adopted`, serveur : (1) identité + membership `org_id` ; (2) credential ∩ mode/scopes ; (3) `op.roles` ; (4) `essential` inchangé ; (5) deny groupe → refuse (**y compris owner** hors liste) ; (6) liste §3 → rôle natif, skip (7) ; (7) liaison vivante `profileRevision` = déclaration, op ∈ capability, rôle ∈ `receivableBy` — via helper, pas via « j’ai le profil P » ; (8) `ScopeProvider` (owner inclus). `incomplete` : (1)–(6) puis refuse (7). Snapshot figé **pour cette requête** ; un job reconstruit puis rappelle le helper.

## 5. API consommable (bind, pas l’implémentation)

Champs **additifs readonly**, construits par le noyau, jamais depuis body/query (`rejectedCommandFields` déjà : `principal`, `role`, … — y ajouter `access`, `evaluateAccess`).

- `Principal.access: AccessSnapshot`
- `AppOperationContext.access` + `evaluateAccess(query: AccessQuery): AccessDecision` (fermeture sur le snapshot de **cette** requête)
- `BeforeWrite` : reçoit `principal` (donc le snapshot) — delta vs signature actuelle `{workspace, identity}`
- `ScopeProvider.recordFilter(principal, …)` : relation user↔entité ; **interdit** de réimplémenter groupes/profils/SQL d’accès

```ts
evaluateAccess(query: AccessQuery): AccessDecision;
authorizeDelegation(mutation: DelegationMutation): AccessDecision;
```

Le helper intersecte deny, credential, révisions, `receivableBy`/`assignableBy`. Sortie = `AccessDecision` (raison fermée, pas d’internals SQL). `observedProfileIds` ne suffit jamais. Appels jobs : **nouvel** `evaluateAccess` / `authorizeDelegation` à l’exécution. Pas une promesse livrée par ce lot.

## 6. Délégation transitive et atomicité

Réutiliser : `requireRole`, `role:owner` locked, `owner_protected`, `members.update` owner-only, `WHERE version=?` / `changes()=1`.

**Requis (absent aujourd’hui)** : `authorizeDelegation` **avant** toute mutation, sur l’état serveur (membres réels du groupe, liaisons, rôles, reçu, révisions) :

- `bind`/`rebind`/`adopt` ; `groupMembers` si le groupe **a déjà** un profil ; `memberRole` si l’utilisateur est dans un groupe lié (le nouveau rôle peut entrer dans `receivableBy`) ; l’acteur dans le groupe cible **ou** qui gagnerait des ops app = self-grant → `assignmentApproval`.

Garde : CAS `group.version` + révision de liaison + empreinte membership **ou** batch atomique unique. Concurrent membership/binding, révision périmée, revoke : `denied_conflict` / `denied_delegation`, **zéro effet** (aucun membre ajouté, aucune liaison). Pas un simple contrôle « un profil est lié ».

Audit `audit.list`/`get` : métadonnées d’action ; **pas** d’`resource_id` de fiche/fichier hors scope (pas d’oracle via alias admin). Row-scope owner : inchangé, pas de bypass.

## 7. Hors lot

Runtime, tests code, migration, version, changelog, skill, R01, C01. Forme physique de la liaison : inventaire. `workspace-rule` = déclaration d’app.

Prochaine action : revue indépendante, puis Astra. Pas de fusion ici.
