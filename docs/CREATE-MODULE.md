# Ajouter un module

Ajouter un objet dans `brand.json.modules`. Le générateur valide le brief avant d'écrire le projet ; le serveur revalide la définition au chargement.

```json
{
  "id": "interventions",
  "name": "Interventions",
  "singular": "Intervention",
  "description": "Suivi des interventions et des échéances.",
  "icon": "tasks",
  "titleField": "title",
  "fields": [
    {"key":"title","label":"Titre","type":"text","required":true},
    {"key":"status","label":"Statut","type":"select","required":true,"options":["À planifier","En cours","Terminée"]},
    {"key":"due_date","label":"Échéance","type":"date"},
    {"key":"notes","label":"Notes","type":"textarea"}
  ]
}
```

L'app affiche automatiquement l'entrée de navigation, le compteur, la liste, la recherche et le formulaire du module. Ses routes sont sous `/api/v1/modules/interventions/records`.

## Contrat

- Identifiant de module : lettre minuscule puis lettres/chiffres/tirets, 48 caractères maximum, unique. `overview`, `files`, `team`, `audit`, `settings` sont réservés.
- Clé de champ : lettre minuscule puis lettres/chiffres/underscore, unique dans le module.
- `titleField` désigne un champ texte ou e-mail obligatoire.
- Types : `text`, `textarea`, `email`, `number`, `date`, `select`, `boolean`.
- Options : `required`, `maxLength`, `min`, `max` et `options` selon le type.
- `readRoles` et `writeRoles` sont optionnels. Par défaut tous les membres lisent, et owner/admin/member écrivent. Les droits d'écriture ne donnent pas implicitement le droit de lecture.
- 32 modules et 30 champs par module au maximum dans ce format initial. Les valeurs sont validées côté serveur et les champs inconnus sont refusés.

## Règles métier

`app/business-rules.ts` permet de refuser une écriture avant la persistance, avec un `ApiError` explicite. Il reçoit les anciennes/nouvelles données, l'espace et l'identité vérifiés.

Pour des invariants entre plusieurs documents, créer des tables D1 et une route transactionnelle dédiée : un contrôle `beforeWrite` suivi d'une écriture séparée ne protège pas contre une course concurrente. Ne pas construire un solde de stock ou un montant comptable sensible sur plusieurs mises à jour JSON indépendantes.

Un renommage de clé ou un changement de type peut exiger une migration des données existantes. Le simple changement du formulaire ne migre pas les enregistrements.
