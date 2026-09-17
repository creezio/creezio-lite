# Tests futurs — profils d’accès (KIT-ACCESS-CONTRACT)

Statut : **matrice de contrat**. Aucun test exécuté, aucun harness local. À implémenter seulement après tranchage Astra et mission runtime. Fixtures génériques (`fx_*`) ; pas de schéma privé d’app.

Provenance exigée : identité dispatcher/clé/OAuth **serveur** ; `workspace()` relit membership et politiques ; handlers ne reconstruisent pas rôle/profil depuis body/query (`domain-extension.md`).

| # | Cas | Attendu (app déclarée) | Compat sans déclaration |
|---|---|---|---|
| T1 | Membre + profil dont la capability liste l’op app ; rôle ∈ `op.roles` et ∈ `roleBounds` | 200 API, outil MCP présent, search/files si scope ok | N/A (pas de profil) ; op app suivent `op.roles` moins deny |
| T2 | Même membre, op app hors capability | 403 `operation_forbidden` ; outil absent | 200 si rôle ∈ `op.roles` |
| T3 | Deux groupes : l’un allow, l’autre deny sur la même op | deny gagne, toutes surfaces | deny gagne déjà |
| T4 | Allow d’un groupe custom, rôle hors `op.roles` | refuse ; pas d’élévation de rôle | allow inerte ; refuse par `op.roles` |
| T5 | Allow sur op native `essential` | grant sans effet ; op reste le régime essential | inchangé (toujours ouverte si rôle ok) |
| T6 | Utilisateur membre d’un autre `org_id` ; mêmes ids de groupe/profil | 404/403 workspace ; politiques non lues | inchangé (`workspace()` joint `lite_members`) |
| T7 | Body/query forge `role`, `profileId`, `capabilities` | 400 ; décision inchangée | champs contexte déjà refusés |
| T8 | `AccessDeclaration` référence un profil ou une capability absents | refus à la déclaration (catalogue) | N/A |
| T9 | Politique / membre / token révoqués ; requête suivante API, MCP `tools/list`+`call`, search, files, UI catalogue | refuse ; pas de cache de permission | déjà : relecture `workspace()`, notice UI, assistant relit |
| T10 | Job/`defer` lancé avant révocation | l’effet ultérieur revalide à l’exécution ; l’opération engagée n’est pas annulée rétroactivement | même limite à documenter, pas une promesse nouvelle |
| T11 | Record/fichier hors `ScopeProvider` ; rôle owner ou profil large | 404 `record_not_found` / fichier équivalent ; search sans extrait | scope SQL déjà appliqué ; owner bypass deny ops **sauf** ce filtre |
| T12 | Credential `read` ou OAuth `crm:read` ∩ capability write | 403 scope/mode ; intersection | `read_only_token` / outils GET only |
| T13 | Scope ou mode credential **inconnus** | erreur refuse, pas de repli | `invalid_scope` / mode hors `read\|write` |
| T14 | Admin assigne un profil hors `roleBounds` du rôle des membres | 400/403 anti-escalade | N/A ; admin peut deny dans le rôle |
| T15 | App sans `access` : `allow` en base, pas de deny | `allow` inerte ; régime actuel | **preuve de non-régression native** |

Couverture des surfaces pour T1–T6, T9, T11–T12 : HTTP catalogue, MCP, search, files, UI access (lecture droits). T7 provenance serveur. T10 caches/jobs. T15 legacy.

Hors matrice : perf, inventaire SQL, UI complète d’assignation de profils (lot runtime/UI).
