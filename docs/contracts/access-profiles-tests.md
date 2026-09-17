# Tests futurs — profils d’accès (KIT-ACCESS-CONTRACT)

Matrice **observable** (HTTP, MCP, search, files, UI, helper). Aucun test exécuté. Fixtures `fx_*`. Provenance serveur ; snapshot body/query ignoré.

| # | Cas | `adopted` | `incomplete` (déclaration, reçu absent/périmé/mismatch) | `legacy` (pas de déclaration) |
|---|---|---|---|---|
| T1 | Binding+révision ; op ∈ capability ; rôle ∈ `receivableBy` ∩ `op.roles` | 200 ; `evaluateAccess` `allowed` + `capabilityIds` | 403 `denied_incomplete` | `op.roles` moins deny ; owner bypass deny |
| T2 | Op hors capability ; `observedProfileIds` contient le profil | 403 `denied_unbound` (IDs ≠ droit) | `denied_incomplete` | 200 si rôle ok |
| T3 | Deny + grant multi-groupes | deny, **owner inclus** hors liste admin | deny / incomplet | deny **sauf owner** |
| T4 | Body forge `access` / `profileId` / `evaluateAccess` | 400 ; snapshot noyau inchangé | idem | champs contexte refusés |
| T5 | Autre `org_id` | 404/403 workspace | idem | inchangé |
| T6 | Owner, ligne hors `ScopeProvider` | 404 ; pas de bypass | 404 | scope SQL ; owner bypass **deny ops** seulement |
| T7 | Credential `read` ∩ op write | 403 `denied_credential` | idem | `read_only_token` |
| T8 | Scope/mode/profil/capacité inconnus | `denied_unknown` | `denied_unknown` / incomplet | `invalid_scope` |
| T9 | Révocation ; requête suivante toutes surfaces | refuse ; pas de cache | incomplet refuse (7) | relecture `workspace()` |
| T10 | Job/`defer` : snapshot de la 1ʳᵉ requête | **revalide** helper à l’exécution | idem | même limite d’appel engagé |
| T11 | Reçu absent, déclaration présente | — | default-deny app/données ; admin §3 + essential **seuls** | — |
| T12 | `receipt.catalogRevision` ≠ déclaration ou `validUntil` dépassé | — | comme T11, **pas** `legacy` | — |
| T13 | Premier reçu, `allow` legacy, bindings vides | default-deny (7) ; allow non activés | si reçu invalide : T11 | allow inerte |
| T14 | Deux profils mêmes ops ; un révoqué | seul `profileId` encore lié | incomplet | N/A |
| T15 | Nouvelle op catalogue, capability sans cet id | refuse ; pas de `module:` | incomplet | deny `module:` possible |
| T16 | Binding `profileRevision` ≠ déclaration | `denied_revision` | incomplet | N/A |
| T17 | Owner + `workspaceAdminOperationIds` | régime natif | **récupération** native | inchangé |
| T18 | Owner + files/records/search/mail/CRUD, pas de profil | refuse (7)+scope | refuse (7)+scope | owner bypass deny ops |
| T19 | Admin `PUT` membres : se rajoute à un groupe **déjà** lié privilégié | `denied_delegation`, zéro effet | délégation refusée | N/A (pas de profil) |
| T20 | `memberRole` vers un rôle ∈ `receivableBy` d’un groupe lié | `authorizeDelegation` avant commit | idem | `members.update` owner-only natif |
| T21 | `adopt`/`rebind` alors que l’acteur est membre du groupe | self-grant / `assignmentApproval` | reçu mismatch : T12 | — |
| T22 | Concurrent `groupMembers` + `bind` ; révision groupe périmée | `denied_conflict` 409, zéro effet | idem | versions groupe déjà 409 |
| T23 | Revoke liaison déjà absente | zéro effet, pas de privilège | idem | N/A |
| T24 | `audit.list`/`get` | pas de `resource_id` de fiche/fichier hors scope | idem (alias admin ≠ oracle) | aujourd’hui `resource_id` brut — **delta** |
| T25 | `evaluateAccess({capability})` vs ops réellement autorisées | `capabilityIds` ∩ deny ∩ credential ∩ révision | `denied_incomplete` | N/A |

Hors : perf, DDL, UI d’assignation (lot runtime).
