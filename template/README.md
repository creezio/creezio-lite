# Application Lite

Application autonome pour GPT Sites : React/Vinext, backend Worker, base D1 et fichiers R2. Le produit et ses modules sont décrits dans `brand.json`.

Lire `AGENTS.md` avant de modifier le projet. Pour ajouter un module, compléter le brief et reconstruire ; la navigation, la recherche des données, l’API et MCP consomment le même registre.

- `/admin/search` : choisir les modules et champs recherchables.
- `/admin/connections` : clés API personnelles et adresse MCP.
- `/api/v1/registry` : catalogue des modules accessibles.
- `/api/mcp` : serveur MCP HTTP ; WebMCP est aussi disponible dans les navigateurs compatibles.

Les clés, paramètres de connexion et identités Sites ne font pas partie du code métier. Préserver `.openai/hosting.json` lors d’une mise à jour.

La recherche de pièces jointes couvre leurs noms et métadonnées, sans OCR ni extraction des fichiers binaires. Les données des formulaires, tâches et messages sont indexées dans D1.
