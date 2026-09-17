# Tests futurs — profils d’accès (KIT-ACCESS-CONTRACT)

Matrice contractuelle (HTTP, MCP, search, files, UI, **helper pur** `evaluateAccessDecision`). Aucun test exécutable ici. Fixtures `fx_*`. Provenance serveur.

| # | Cas | `adopted` | `incomplete` | `legacy` |
|---|---|---|---|---|
| T1 | Binding custom ; op ∈ capability ; rôle ∈ `receivableBy` ⊆ `op.roles` | 200 ; `allowed` + `capabilityIds` | 403 `denied_incomplete` | `op.roles` moins deny ; owner bypass deny |
| T2 | Op hors capability ; `observedProfileIds` contient le profil | `denied_unbound` (IDs ≠ droit) | `denied_incomplete` | 200 si rôle ok |
| T3 | Deny + grant | deny, owner inclus hors §3 | deny / incomplet | deny **sauf owner** |
| T4 | Body forge `access`, `profileId`, `observedProfileIds`, `catalogRevision`, `evaluateAccess`, `authorizeDelegation` | 400 ; snapshot noyau | idem | champs contexte refusés |
| T5 | Autre `org_id` | 404/403 workspace | idem | inchangé |
| T6 | Owner, ligne hors scope | 404 | 404 | scope SQL ; owner bypass deny **ops** |
| T7 | Credential `read` ∩ write | `denied_credential` | idem | `read_only_token` |
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
| T22 | Concurrent membership+bind ; `group.version` périmé | `denied_conflict` 409, zéro effet | idem | 409 version groupe |
| T23 | Unbind déjà absent | zéro effet | idem | N/A |
| T24 | `audit.list`/`get` | pas de `resource_id` hors scope | idem | `resource_id` brut — delta |
| T25 | `{kind:'capability'}` | `allowed` ssi **toutes** les ops passent deny∩credential∩révision∩(7) | `denied_incomplete` | N/A |
| T26 | Bind `groupId: 'role:member'` | `denied_delegation` ; déclaration/reçu rejetés | idem | N/A |
| T27 | `POST invites` role=member, profil métier existant sur un groupe custom | **aucun** profil inféré ; adhérent sans binding | invite admin ok ; pas de grant | invite native |
| T28 | `receivableBy:['member']` alors que l’op est `roles:['owner','admin']` | **refus `defineExtensions`** | — | N/A |
| T29 | `assignableBy: []` ou capability id inconnu ou ops dupliquées | refus déclaration | — | N/A |
| T30 | `evaluateAccessDecision` sans SQL app (entrée §3 seulement) | décision déterministe | `denied_incomplete` | N/A |

Hors : perf, DDL, UI d’assignation, `findByTitle` app sans scope (dette consommateur, pas un modèle).
