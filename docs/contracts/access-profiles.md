# Profils, capacités, groupes — proposition KIT-ACCESS-CONTRACT

Statut : **proposition**. Aucune capacité livrée. Astra tranche ; chaque pilote d’app garde plan et intégration. Aucun nom ni schéma privé d’application dans ce standard.

## 1. Limite actuelle (constat)

Identité, session, invitations, `lite_members`, admin d’espace : natifs. Rôles techniques figés `owner|admin|member|viewer` (`runtime/core/types.ts`).

Groupes custom : `lite_access_groups.members_json`, IDs ∈ `lite_members` du même `org_id` (`runtime/core/access.ts`). Politiques `lite_api_policies` `allow|deny` ; `inherit` = suppression de ligne. Groupes `role:*` dérivés du rôle ; `role:owner` verrouillé.

`workspace()` (`runtime/core/api.ts`) agrège les politiques de `role:{role}` et des groupes dont `members_json` contient l’utilisateur.

`operationAllowed` (`runtime/core/operations.ts`) : (1) `op.roles` contient le rôle ; (2) `essential` ou `owner` → true ; (3) seul `deny` (id d’opération ou `module:<id>`) refuse. **`allow` n’ajoute aucune capacité.** `canReadModule` : même deny ; owner true. Une op applicative ne peut pas être `essential` ; ses rôles sont ∩ `readRoles` du module.

UI (`runtime/ui/access-settings.tsx`) : restriction **dans** le rôle ; « Autoriser » = inherit ; deny prioritaire si plusieurs groupes ; essential et owner protégés ; effet annoncé aux **prochains** appels API/MCP.

MCP : `lite_mcp_policies.enabled` ∩ `operationAllowed` ∩ `tokenAllowed` (machine) ∩ mode write (`runtime/core/tools.ts`, `mcp-admin.ts`). OAuth `crm:read`/`crm:write` (`mcp-oauth.ts`). Clé API : membership vivant, pas de rôle figé (`access-tokens.ts`, `docs/ARCHITECTURE.md`). Assistant : relecture membership/politiques/MCP avant outil (`sites-adapter/src/dispatch.ts`). Search : pas de cache de permissions (`search.ts`).

`ScopeProvider` (`scope.ts`, contrat `domain-extension.md`) : filtre SQL avant résultat ; `openScope` = `1=1`. Le kit n’offre pas de bypass owner sur ce filtre ; owner court-circuite **opération/module**, pas le fragment SQL.

Écart : pas de profils/capacités déclaratifs ; default-allow par rôle pour les ops app ; `allow` inerte ; admin d’espace confondu avec accès données via le court-circuit owner.

## 2. Décisions

1. Identité, auth, membership, invitations, admin d’espace **restent natifs**.
2. Profils et capacités : **déclaration d’app**, IDs stables distincts des labels.
3. Affectation et stratégie : **groupes existants**. Pas de stockage RBAC parallèle sans nécessité prouvée ; migration additive seulement après inventaire (hors ce lot).
4. Une app peut lier un `userId` membre à une entité métier **sans** y stocker rôle, auth ou adhésion. Le modèle de rôles **ne dépend pas** de la relation métier.
5. Pas de bypass row-scope privé pour l’owner technique. Administration d’espace ≠ accès aux données app.
6. Nouvelles ops app : **opt-in explicite, default-deny**.
7. Capacités positives uniquement dans la borne déclarée (rôle ∩ profil ∈ `roleBounds` ∩ capability ∩ ops du catalogue).
8. Multi-groupes : **deny prioritaire**, composition explicite. Un `allow` n’élève jamais le rôle technique et n’ouvre jamais une op native `essential`.
9. App **sans** `AccessDeclaration` : comportement actuel conservé. Aucun changement silencieux du natif ancien.
10. Révocation : **requête suivante** (API, MCP, search, files, UI). Caches/jobs : revalidation à l’**exécution** ; pas de révocation atomique d’une opération déjà engagée.
11. Credentials : intersection session | (`tokenAllowed` ∩ mode) | (scopes OAuth) ∩ membership vivant ∩ politiques. Profil ou capacité **inconnus** → refus avec erreur, jamais ignorés.
12. Profils = déclaration figée. Admins assignent et restreignent ; ils n’inventent pas de capacités (anti auto-escalade).
13. `ScopeProvider` toujours intersecté ; rôle, profil et owner ne le contourne pas.

## 3. Interfaces minimales

Réutilisent `Role`, `Operation`, `AppExtensions`, `ScopeProvider`. Champ additif facultatif.

```ts
export type AccessProfileId = string;
export type AccessCapabilityId = string;

export type AccessCapability = {
  id: AccessCapabilityId;
  label?: string; // affichage, jamais une clé
  operations: readonly string[]; // Operation.id ou `module:<id>` déjà au catalogue
};

export type AccessProfile = {
  id: AccessProfileId;
  label?: string;
  capabilities: readonly AccessCapabilityId[];
};

export type AccessRoleBounds = Partial<Record<Role, readonly AccessProfileId[]>>;

export type AccessDeclaration = {
  profiles: readonly AccessProfile[];
  capabilities: readonly AccessCapability[];
  roleBounds: AccessRoleBounds; // absent d’un rôle = aucun profil pour ce rôle
};

// AppExtensions.access?: AccessDeclaration
```

Validation à la déclaration : IDs uniques, `operations` ⊂ catalogue, `capabilities` des profils existent, `roleBounds` ⊂ profils, aucun `essential` natif dans une capability, aucune op hors `op.roles` du rôle borné.

Affectation : `lite_access_groups` / `role:*`. **Recommandation** : jusqu’à inventaire, persister via `lite_api_policies` (`allow` sur les ops de la capability, `deny`/`inherit` inchangés). Pas de colonne `profile_id` dans cette proposition.

## 4. Évaluation future (app déclarée)

Ordre serveur, jamais depuis body/query : (1) identité + membership de **cet** `org_id` ; (2) credential ∩ mode/scopes ; inconnue → refuse ; (3) `op.roles` ; (4) `essential` natif : inchangé ; (5) **deny** d’un groupe applicable (rôle ou custom) → refuse ; (6) capacité positive — **ops app et métier seulement** : un `allow` du groupe dont l’op ∈ une capability d’un profil ∈ `roleBounds[role]` (défense même si l’affectation a été persistée en lignes `allow` sans `profile_id`) ; (7) `ScopeProvider` sur chaque ligne/fichier. Les ops natives d’admin d’espace (members, invites, access, mcp admin, tokens) sautent (6) et gardent le régime rôle actuel.

Sans déclaration : (1)–(5) + court-circuit owner actuel ; (6) absente (`allow` inerte).

| Cas | Avec déclaration | Sans (compat) |
|---|---|---|
| deny et allow multi-groupes | deny gagne | deny gagne |
| allow hors `op.roles` | refuse | allow inerte |
| allow sur essential native | grant ignoré/refusé | essential déjà ouvert |
| owner, ligne hors scope | scope refuse | scope SQL appliqué ; owner bypass deny ops/module |
| owner, admin espace | membres/invites/groupes natifs | inchangé |
| op app sans allow | refuse | autorisée si rôle ∈ `op.roles` |
| profil/capacité inconnus | erreur | N/A |
| autre espace | 404/403 workspace | inchangé |

## 5. Compatibilité — limites honnêtes

Conservé sans déclaration : rôles, groupes, deny, inherit, essential, bypass owner sur ops/module, UI actuelle, switch MCP, intersection token/OAuth.

Non promis sans opt-in : default-deny app, capacités positives, séparation owner/données, anti-escalade de profils. Un `allow` déjà en base **reste sans effet** jusqu’à `AccessDeclaration` validée. Pas de bascule globale du kit.

## 6. Anti-escalade et credentials

Admins natifs assignent des profils **déclarés** et posent des deny. Ils ne créent pas d’id de capacité, n’élargissent pas `operations[]`, n’assignent pas un profil hors `roleBounds`. Un admin ne s’octroie pas un profil réservé à un autre rôle.

Intersection credential : le plus étroit gagne. Scope OAuth inconnu, mode inconnu, profil/capacité inconnus → erreur. Une clé ou un grant ne fige pas le rôle ; relecture à chaque requête.

Révocation groupe/membre/politique/token : effective à la requête suivante. Un job/`defer` déjà lancé revalide **au moment d’exécuter** un effet (autre requête interne, drain) ; il ne promet pas d’interrompre l’opération HTTP/MCP déjà engagée.

## 7. Hors lot et questions

Hors : runtime, migration, schéma, version, changelog, skill, R01, C01. Ce lot ne code pas.

- **Q1** Colonne `profile_ids` sur groupes ? **Rec.** non tant que `lite_api_policies` suffit (inventaire ultérieur).
- **Q2** Portée du bypass owner à l’opt-in ? **Rec.** le limiter aux ops `kind:'system'` d’admin d’espace (members, invites, access, mcp admin, tokens). Données métier et ops app : profil + scope. Sans déclaration : inchangé.
- **Q3** `module:<id>` en capability ? **Rec.** raccourci des ops **déjà** au catalogue de ce module, pas un joker futur.

Prochaine action : Astra reçoit et tranche. Aucune implémentation avant mission runtime attribuée.
