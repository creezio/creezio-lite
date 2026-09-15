# Adaptateurs Sites

- Réutiliser les handlers originaux lorsque la persistance est injectable ; garder les différences d’API explicites.
- Chaque requête D1 doit inclure l’espace courant, issu d’une appartenance vérifiée. Toute mutation vérifie le rôle, et toute mutation navigateur l’origine.
- Ne pas accepter l’auteur d’un ticket, l’identité d’une préférence ou un rôle depuis les données client. Utiliser l’identité vérifiée.
- Garder le kernel original. Ne pas prétendre fournir un SqliteRuntime synchrone via D1.
- Ne jamais simuler une fonctionnalité manquante par des résultats de succès vides, des données en mémoire ou un faux run IA.
- Contrôler les validations, transactions, limites et accès inter-espaces avec la suite native Miniflare.
