# Registre des modules

`runtime/core/registry.ts` est le catalogue consommé par les différentes surfaces. Les modules métier proviennent de `brand.json`, validé par `defineApp`. Les modules système ont leur contrat de stockage et leurs routes dédiées.

```json
{
  "id": "recettes",
  "name": "Recettes",
  "singular": "Recette",
  "description": "Les recettes de l’équipe",
  "titleField": "name",
  "fields": [
    {"key":"name","label":"Nom","type":"text","required":true},
    {"key":"instructions","label":"Préparation","type":"textarea"},
    {"key":"cout","label":"Coût","type":"number","min":0}
  ]
}
```

Cette déclaration fournit automatiquement une route `/recettes`, une entrée de navigation, des fiches D1, l’indexation des champs, les réglages d’administration, l’API `/api/v1/modules/recettes/records` et les outils `lite_recettes_list/get/create/update/archive`.

Le titre doit être un champ texte ou e-mail obligatoire. Les types disponibles sont text, textarea, email, number, date, select et boolean. Les contraintes incluent required, options, maxLength, min et max. Les limites actuelles sont 32 modules et 30 champs par module.

`readRoles` et `writeRoles` contrôlent les accès. Les rôles sont owner, admin, member et viewer. Par défaut, tous lisent et seuls owner/admin/member écrivent. Un rôle autorisé à écrire doit aussi pouvoir lire. Les autorisations sont vérifiées à chaque appel, quelle que soit sa provenance (interface, API ou MCP).

La recherche est active par défaut pour les champs. `searchable:false` sur un champ ou `search:{enabled:false,fields:[...]}` définit le réglage initial ; l’administrateur peut le personnaliser par espace. Retirer un module de la navigation ne retire pas le droit de consulter ses données.

Les règles métier supplémentaires vont dans `app/business-rules.ts`. Les mêmes règles sont exécutées pour l’interface, l’API et MCP. Des relations, transactions entre fiches ou traitements asynchrones exigent du code dédié ; un formulaire déclaratif ne les invente pas.

Un module utilisant une table ou un service spécifique doit fournir son contrat de stockage, ses permissions, ses opérations et sa source d’indexation. Le branchement automatique sans code supplémentaire concerne les modules déclaratifs sur `lite_records`.

## Catalogue API et groupes

Le registre des opérations fournit automatiquement les routes documentées, OpenAPI, les outils MCP et les lignes de permissions. Les routes natives proviennent des mounts réellement enregistrés ; leurs alias renvoient à la même opération et aux mêmes droits. Déclarer le `inputSchema` dans chaque opération native pour documenter les paramètres.

`/admin/api` présente toutes les routes servies ; `/admin/mcp` expose les outils, leur état, leurs paramètres et la création d’alias nommés ; `/admin/access` configure les groupes et restrictions. Chaque rôle conserve ses limites : les groupes les restreignent et un refus est prioritaire. Le propriétaire et les fonctions indispensables sont protégés. Les API, MCP HTTP, WebMCP et les résultats de recherche utilisent les droits actuels, y compris pour les clés déjà émises.

Un outil désactivé disparaît des listes et est refusé à l’exécution. Les API binaires et les opérations de session ou d’administration des identités restent explicitement hors MCP. Les utilisateurs peuvent lire le motif dans le catalogue ; aucun endpoint absent n’est présenté comme fonctionnel.
