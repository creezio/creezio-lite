# Tests futurs — profils d’accès (KIT-ACCESS-CONTRACT)

Matrice contractuelle (HTTP, MCP, search, files, UI, **helper pur** `evaluateAccessDecision`). Aucun test exécutable ici. Fixtures `fx_*`. Provenance serveur.

| # | Cas | `adopted` | `incomplete` | `legacy` |
|---|---|---|---|---|
| T1 | Binding custom ; op ∈ capability ; rôle ∈ `receivableBy` ⊆ `op.roles` | 200 ; helper `allowed` + `capabilityIds` | HTTP 403 `operation_forbidden` (reason `denied_incomplete`) | `op.roles` moins deny ; owner bypass deny |
| T2 | Op hors capability ; `observedProfileIds` contient le profil | `denied_unbound` (IDs ≠ droit) | `denied_incomplete` | 200 si rôle ok |
| T3 | Deny + grant | deny, owner inclus hors §3 | deny / incomplet | deny **sauf owner** |
| T4 | Body forge `access`, `profileId`, `observedProfileIds`, `catalogRevision`, `evaluateAccess`, `authorizeDelegation` | 400 ; snapshot noyau | idem | champs contexte refusés |
| T5 | Autre `org_id` | 404/403 workspace | idem | inchangé |
| T6 | Owner, ligne hors scope | 404 | 404 | scope SQL ; owner bypass deny **ops** |
| T7 | `catalog.method` POST/PATCH/… + `credential.mode==='read'` (helper, pas l’app) | reason `denied_credential` → HTTP 403 `read_only_token` | idem | `read_only_token` (authorizeToken) |
| T8 | Inconnu profil/capacité/révision/mode | `denied_unknown` | incomplet / unknown | `invalid_scope` |
| T9 | Révocation ; requête suivante toutes surfaces y compris nav / `modules.list` / `tools/list` / OpenAPI | refuse ; pas de cache | refuse (7) | relecture `workspace()` |
| T10 | Job : ancien snapshot | **nouvel** `EvaluateAccessInput` | idem | appel engagé non annulé |
| T11 | `access` présent, reçu absent | — | default-deny (7) ; sortie = `access.receipt.update` **+** `authorizeDelegationDecision` | — |
| T12 | Révision / `validUntil` mismatch | — | comme T11, **pas** `legacy` | — |
| T13 | Premier reçu, `allow` legacy, bindings `[]` | default-deny (7) ; allow inerte | T11 si reçu invalide | allow inerte |
| T14 | Deux profils, mêmes ops ; un révoqué | seul le `profileId` encore lié | incomplet | N/A |
| T15 | Nouvelle op ; capability sans cet id ; grant `module:` | refuse ; déclaration `module:` rejetée | incomplet | deny `module:` possible |
| T16 | `profileRevision` ≠ déclaration | `denied_revision` | incomplet | N/A |
| T17 | Owner + liste §3 (dont receipt/bind) | natif + délégation si mutation | récupération **possible** (B1) | inchangé |
| T18 | Owner + files/records/search/mail/CRUD/`canReadModule`/nav/`session.me` permissions, pas de profil | refuse découverte **et** (7) | refuse (7)+découverte | owner `canReadModule` true |
| T19 | Admin `PUT` membres : se rajoute à un groupe custom **déjà** lié | `denied_delegation`, zéro effet | délégation refusée | N/A |
| T20 | `memberRole` / `memberRemove` / `groupDelete` sur groupe lié ; `inviteCreate` | `authorizeDelegationDecision` avant commit | idem | rôle/invite natifs |
| T21 | `adopt`/`rebind` acteur déjà membre ; `assignmentApproval: 'owner'` | owner only (workspace-rule **hors v1**) | T12 si mismatch | — |
| T22 | Concurrent membership+bind ; `group.version` périmé | reason `denied_conflict` → HTTP 409 `version_conflict`, zéro effet | idem | 409 `version_conflict` |
| T23 | Unbind déjà absent | zéro effet | idem | N/A |
| T24 | `audit.list`/`get` | pas de `resource_id` hors scope | idem | `resource_id` brut — delta |
| T25 | `{kind:'capability'}` ; une op deny `module:${moduleId}` ou credential write | `allowed` ssi **toutes** les ops passent (helper deny `module:` ∩ credential ∩ révision ∩ (7)) | `denied_incomplete` | N/A |
| T26 | Bind / adopt `groupId` matching `/^(role:)/` | `denied_delegation` / reçu rejeté ; **déclaration inchangée** (pas de `groupId` dans `access`) | bind/adopt refusés | N/A |
| T27 | `POST invites` role=member, profil métier existant sur un groupe custom | **aucun** profil inféré ; adhérent sans binding | invite admin ok ; pas de grant | invite native |
| T28 | `receivableBy:['member']` alors que l’op est `roles:['owner','admin']` | **refus `defineExtensions`** | — | N/A |
| T29 | `assignableBy: []` ou capability id inconnu ou ops dupliquées | refus déclaration | — | N/A |
| T30 | Helper pur : `AccessCatalogEntry` + `denials` bruts (`id` et `module:…`) ; pas d’expansion app, pas de SQL | déterministe (T7/T25 inclus) | `denied_incomplete` | N/A |
| T31 | Owner adopté, aucune capability ; `recordFilter` + `evaluateAccess` | helper refuse (7) **avant** les rows ; filtre non court-circuité | refuse (7) | owner `canReadModule` |
| T32 | Deux profils ; deny sur l’op d’un groupe | `evaluateAccess` deny prioritaire ; le filtre ne choisit pas un profil | incomplet | deny sauf owner |
| T33 | Helper `allowed` + filtre user↔entité `0=1` | 404 ligne ; `allowed` ≠ row | 404 si filtre atteint | scope SQL |
| T34 | `evaluateAccess` depuis `recordFilter` | pas de réentrée `ScopeProvider` / search / files | idem | N/A |
| T35 | Opt-in présent, surface native **sans** `ScopeAccessContext` | fail-closed `0=1` | idem | N/A (3 args) |
| T36 | Snapshot d’un autre `org_id` / job | interdit ; nouvel input | idem | N/A |

Hors : perf, DDL, UI d’assignation, `findByTitle` app sans scope (dette consommateur, pas un modèle). Oracles T31–T34 : owner sans capability, deny multi-profils, row préservée, non-récursion.
