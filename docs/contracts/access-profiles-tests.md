# Tests futurs — profils d’accès (KIT-ACCESS-CONTRACT)

Statut : **matrice**. Aucun test exécuté. Fixtures `fx_*` ; pas de schéma privé d’app. Provenance serveur uniquement (dispatcher/clé/OAuth, `workspace()` vivant).

| # | Cas | Adopté (déclaration + reçu) | Sans déclaration |
|---|---|---|---|
| T1 | Binding `groupId→profileId`+révision ; op ∈ capability ; rôle ∈ `receivableBy` ∩ `op.roles` | 200 API, MCP, search/files si scope | N/A ; ops selon `op.roles` moins deny (**owner** : bypass deny) |
| T2 | Même membre, op hors capability / hors binding | 403 ; outil absent | 200 si rôle ∈ `op.roles` (owner : même si deny) |
| T3 | Deux groupes : grant via profil A, deny sur l’op | deny gagne, **y compris owner** hors liste admin espace | deny gagne **sauf owner** (bypass historique) |
| T4 | Binding vers profil `receivableBy` hors rôle du membre | refuse ; pas d’élévation de rôle | `allow` inerte ; filtre `op.roles` |
| T5 | Grant / binding sur op `essential` | sans effet | essential ouvert si rôle ok |
| T6 | Autre `org_id`, mêmes ids groupe/profil | 404/403 workspace | inchangé |
| T7 | Body/query forge `role`/`profileId` | 400 ; décision inchangée | champs contexte déjà refusés |
| T8 | Profil, révision, capacité ou `catalogRevision` inconnus | refus déclaration **ou** requête | N/A |
| T9 | Révocation membre/token/binding ; requête suivante API, MCP list+call, search, files, UI | refuse ; pas de cache | relecture `workspace()`, notice UI |
| T10 | `defer`/job avant révocation | revalidation à l’exécution ; appel engagé non annulé | même limite |
| T11 | Owner, record/fichier hors scope ; avec ou sans profil large | 404 ; search sans extrait | scope SQL déjà ; owner bypass **deny ops** seulement |
| T12 | Credential `read` / `crm:read` ∩ op write du profil | 403 intersection | `read_only_token` / GET only |
| T13 | Scope/mode credential inconnus | refuse, pas de repli | `invalid_scope` / mode hors `read\|write` |
| T14 | Admin se lie (groupe où il est membre) un profil qui étend ses ops app, sans owner / `workspace-rule` | 403 self-grant | N/A ; admin peut deny/inherit dans le rôle |
| T15 | Sans déclaration : `allow` en base, pas de deny | N/A ici | **`allow` inerte** ; non-régression |
| T16 | Premier opt-in, `allow` legacy, **aucun** binding dans le reçu | **default-deny** (7) ; `allow` **non** activés ; deny conservés | — |
| T17 | Deux profils, mêmes `operations[]` ; binding puis révocation de l’un | l’autre n’autorise que s’il reste **explicitement** lié ; pas d’inférence | N/A |
| T18 | Nouvelle op au catalogue (même `moduleId`) ; capability sans cet id | refuse ; pas de joker `module:` | deny `module:` possible, pas un grant |
| T19 | Binding `profileRevision` ≠ révision déclarée (profil modifié) | refuse jusqu’à re-liaison | N/A |
| T20 | Owner + liste `workspaceAdminOperationIds` | régime natif (dont bypass deny) | inchangé |
| T21 | Owner + files/records/search/mail/CRUD, pas de profil | refuse (7) + scope | owner bypass deny ops ; données visibles si scope `1=1` |

Surfaces T1–T6, T9, T11–T12, T16–T18, T21 : HTTP, MCP, search, files, UI lecture. T7 provenance. T10 jobs. T14 délégation. T15–T16 legacy/opt-in. T17 ambiguïté. T19 révision.

Hors : perf, DDL, UI complète d’assignation (lot runtime).
