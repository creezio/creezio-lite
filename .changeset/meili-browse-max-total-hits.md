---
"@creezio/search": patch
"@creezio/factory": patch
---

Le browse Meili ne coupe plus les listes à 1000 hits : `pagination.maxTotalHits` est posé à l'indexation et PATCHé au boot (sans réindexation) quand le fingerprint est déjà à jour.
