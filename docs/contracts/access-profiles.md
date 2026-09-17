# Profils, capacités, groupes — proposition KIT-ACCESS-CONTRACT

Statut : **proposition corrigée** (réception `0e85503`). Aucune capacité livrée. Astra a tranché Q2. Chaque pilote d’app garde plan et intégration. Aucun nom ni schéma privé d’app.

## 1. Limite actuelle

Identité, session, invitations, `lite_members`, admin d’espace : natifs. Rôles `owner|admin|member|viewer` (`runtime/core/types.ts`).

Groupes : `lite_access_groups.members_json` ⊂ `lite_members` du même `org_id` (`access.ts`). Politiques `lite_api_policies` `allow|deny` ; `inherit` = suppression. `role:*` dérivés ; `role:owner` verrouillé.

`workspace()` (`api.ts`) unionne `role:{role}` et les groupes custom du membre.

`operationAllowed` (`operations.ts`) : (1) `op.roles` ; (2) `essential` **ou `owner` → true** (court-circuit, deny ignoré) ; (3) seul `deny` refuse (`operation.id` ou `module:<id>`). **`allow` n’ajoute aucune capacité.** `canReadModule` : même deny ; owner true. Ops app : pas `essential` ; rôles ∩ `readRoles`.

UI (`access-settings.tsx`) : restriction **dans** le rôle ; « Autoriser » = inherit ; deny prioritaire multi-groupes ; essential/owner protégés ; effet aux **prochains** appels.

MCP : `lite_mcp_policies.enabled` ∩ `operationAllowed` ∩ `tokenAllowed` ∩ mode (`tools.ts`, `mcp-admin.ts`). OAuth `crm:read`/`crm:write`. Clé : membership vivant (`access-tokens.ts`). Assistant relit avant outil (`dispatch.ts`). Search : pas de cache de permissions.

`ScopeProvider` : filtre SQL avant résultat ; `openScope` = `1=1`. Pas de bypass owner sur ce filtre ; owner court-circuite **opération/module**.

Écart : pas de profils ; pas de liaison `groupId→profileId` ; `allow` inerte ; `kind:'system'` mélange admin d’espace et données natives (files, records, search, mail…). Native aujourd’hui : tout admin peut régler deny/inherit des groupes non-owner (`access.ts` `requireRole` owner|admin) — **aucune** séparation délégation/détention de profil, **aucune** approbation de self-grant.

## 2. Décisions (dont Q2 tranchée)

1. Identité, auth, membership, invitations, admin d’espace **natifs**.
2. Profils/capacités : déclaration d’app, IDs stables ≠ labels, **révision** par profil.
3. Affectation : groupes/tables/UI existants. **Liaison explicite versionnée `groupId → profileId`**. Reconstruire depuis des `allow` par opération est **interdit** (plusieurs profils, mêmes ops, déclaration qui évolue, suppression/révocation et provenance indécidables). Stockage **additif après inventaire** ; ce lot n’invente ni schéma ni numéro. On **ne conclut pas** qu’aucune colonne n’est nécessaire. Pas de RBAC applicatif parallèle.
4. Lien métier `userId`↔entité : sans y stocker rôle/auth/adhésion. Le modèle de rôles ne dépend pas de la relation métier.
5. **Q2** : bypass owner **uniquement** pour `workspaceAdminOperationIds` (liste fermée ci-dessous, déjà `protectedAdmin` / owner-lock). Ops app **et** données (records, files, search, dashboard, mail, CRUD modules, etc.) : **toujours profil + `ScopeProvider`**. `kind:'system'` n’est **pas** un blanc-seing.
6. Ops app nouvelles : opt-in, **default-deny**. Capacités v1 = **IDs d’opération explicites**, pas de joker `module:<id>` (un raccourci accorderait les ops ajoutées plus tard).
7. Deny prioritaire multi-groupes. Un grant n’élève pas le rôle technique et n’ouvre pas d’op native `essential`.
8. Sans `AccessDeclaration` : régime actuel, **y compris** le bypass owner sur deny d’ops. Aucun changement silencieux.
9. **Premier opt-in** : `allow` inertes **ne deviennent pas** des autorisations. Reçu d’adoption + liaisons explicites ; default-deny initial ; **aucun héritage positif**.
10. Révocation : requête suivante (API, MCP, search, files, UI). Jobs/`defer` : revalidation à l’exécution, pas d’annulation rétroactive d’un appel engagé. Profil modifié : la liaison porte une révision ; écart → état inconnu → **refus** jusqu’à re-liaison.
11. Credentials : intersection session | (token mode ∩ `tokenAllowed`) | scopes OAuth ∩ membership ∩ politiques. Inconnu (profil, révision, capacité, scope, mode) → refus erreur.
12. `roleBounds` / `receivableBy` **insuffisant** : distinguer **détention** et **délégation**. Owner/admin natifs n’impliquent aucun profil app. Self-grant : approbation selon règle **déclarée**.
13. `ScopeProvider` toujours intersecté ; rôle, profil, owner ne le contourne pas.

## 3. Interfaces minimales

```ts
export type AccessProfileId = string;
export type AccessCapabilityId = string;
export type AccessCapability = {
  id: AccessCapabilityId;
  label?: string;
  operations: readonly string[]; // Operation.id seulement (v1, pas de module:<id>)
};
export type ProfileAssignmentApproval = 'owner' | 'workspace-rule';
export type AccessProfile = {
  id: AccessProfileId;
  label?: string;
  revision: number; // monotone par id dans la déclaration
  capabilities: readonly AccessCapabilityId[];
  receivableBy: readonly Role[];   // qui peut détenir
  assignableBy: readonly Role[];   // qui peut lier au groupe
  assignmentApproval: ProfileAssignmentApproval; // self-grant / profil sensible
};
export type GroupProfileBinding = {
  groupId: string;           // lite_access_groups.id ou role:{role}
  profileId: AccessProfileId;
  profileRevision: number;   // révision liée ; ≠ déclaration courante ⇒ refus
};
export type AccessAdoptionReceipt = {
  catalogRevision: string;   // empreinte de la déclaration adoptée
  bindings: readonly GroupProfileBinding[];
};
export type AccessDeclaration = {
  catalogRevision: string;
  profiles: readonly AccessProfile[];
  capabilities: readonly AccessCapability[];
};
// AppExtensions.access?: AccessDeclaration
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

Hors liste (profil + scope à l’adoption, **pas** de bypass owner) : `files.*`, `dashboard.get`, `search.query`, mail, CRUD modules, `search.settings`/`configure`/`reindex`, `api.catalog`, logs, analytics, integrations, assistant. Ce n’est pas `kind:'system'`.

Validation déclaration : IDs uniques, `operations` ⊂ catalogue **non essential**, capabilities des profils existent, `receivableBy`/`assignableBy` ⊂ rôles, `assignmentApproval` présent. Défaut **interdit** : on n’infère pas `assignableBy=['admin']` ni « tout profil receivableBy admin ».

Liaison : obligatoire à l’évaluation positive. Forme physique (colonne, jonction, JSON sur groupe existant, …) : **inventaire**. Deny/inherit restent `lite_api_policies` + UI actuelle.

## 4. Évaluation (app adoptée)

Serveur seulement : (1) identité + membership de **cet** `org_id` ; (2) credential ∩ mode/scopes ; (3) `op.roles` ; (4) `essential` natif inchangé ; (5) **deny** d’un groupe applicable → refuse (**y compris owner**, hors liste §3) ; (6) si `op.id` ∈ `workspaceAdminOperationIds` : régime rôle natif (owner/admin, `protectedAdmin`, owner-lock) — **pas** (7) ; (7) sinon (ops app **et** données natives hors liste) : liaison vivante `groupId→profileId` dont `profileRevision` = révision déclarée, profil ∈ déclaration, op ∈ capability, rôle membre ∈ `receivableBy` ; (8) `ScopeProvider` sur chaque ligne/fichier.

Sans déclaration / sans reçu d’adoption : (1)–(5) + court-circuit owner actuel ; (7) absente ; `allow` **inerte**.

Opt-in : le reçu cite `catalogRevision` + bindings. Bindings vides = default-deny pour (7). `allow` historiques ignorés pour (7). Deny historiques **conservés**.

| Cas | Adopté | Sans déclaration (compat) |
|---|---|---|
| deny + grant multi-groupes | deny gagne | deny gagne (**sauf owner**, bypass historique) |
| deny ops app/données, acteur owner | deny gagne ; scope ensuite | owner ignore le deny ops/module |
| owner, ligne hors scope | 404 scope | scope SQL ; owner bypass deny ops |
| owner, admin espace (liste §3) | régime natif | inchangé |
| `allow` legacy, pas de binding | **pas** d’autorisation | `allow` inerte |
| op app / donnée sans binding | refuse | rôle ∈ `op.roles` (moins deny, sauf owner) |
| deux profils, mêmes ops ; un révoqué | seul le `profileId` encore lié compte | N/A |
| profil/révision/capacité inconnus | refuse | N/A |
| nouvelle op catalogue / `module:<id>` | pas de grant implicite | N/A / deny `module:` déjà possible |
| autre espace | 404/403 workspace | inchangé |

## 5. Compatibilité et adoption

Sans déclaration : rôles, groupes, deny, inherit, essential, **bypass owner deny-ops**, UI, MCP enabled, intersection token/OAuth.

Non promis sans reçu : default-deny app/données, capacités positives, fin du bypass owner hors liste §3, anti-escalade de délégation.

Premier opt-in **sans** héritage positif des `allow`. Migration logique = écrire les `GroupProfileBinding` autorisés dans le reçu, pas « activer les allow ».

## 6. Délégation — deltas natifs (ne pas prétendre présents)

Réutiliser : `requireRole`, `role:owner` locked, `owner_protected` politiques, `members.update` owner-only, versions groupes/politiques, deny prioritaire.

**Absents aujourd’hui (requis)** : (a) liaison `groupId→profileId`+révision ; (b) `assignableBy` ≠ `receivableBy` ; (c) self-grant — acteur membre du groupe cible **ou** acquiert de nouvelles ops app via la liaison : `assignmentApproval` owner ou `workspace-rule` déclarée (pas un défaut kit). Assigner à un groupe dont l’acteur est hors membres, si `assignableBy` l’autorise, n’est pas un self-grant. Un admin **ne peut pas** s’octroyer tout profil `receivableBy` admin ; (d) re-liaison après `revision` ; (e) reçu d’adoption. L’UI deny/inherit n’assigne pas les profils.

## 7. Hors lot

Hors : runtime, test code, migration, schéma, version kit, changelog, skill, R01, C01.

Question restante : forme physique de la liaison après inventaire (pas « zéro colonne » a priori). `workspace-rule` = déclaration d’app, pas un moteur d’approbation inventé ici.

Prochaine action : Astra / mainteneur ouvre la PR et revoit. Pas d’implémentation par ce lot.
