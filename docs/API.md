# API HTTP 0.1

Préfixe : `/api/v1`. Toutes les routes sauf `GET /health` exigent une identité Sites. Un paramètre `workspace=<id>` sélectionne un espace auquel l'utilisateur appartient ; sans ce paramètre, le premier espace de l'utilisateur est utilisé.

Les mutations du navigateur doivent transmettre l'Origin exact du Site. JSON exige `Content-Type: application/json`. Les clés API machine et le serveur MCP OAuth distant ne sont pas implémentés ; cette API est utilisée dans la session authentifiée du Site.

| Méthode et route | Usage |
|---|---|
| `GET /health` | Vérifier que le schéma D1 répond |
| `POST /bootstrap` | Initialiser idempotemment l'identité et son espace personnel |
| `GET /session` | Identité et espaces autorisés |
| `POST /workspaces` | Créer un espace : `{name}` |
| `PATCH /workspaces/current` | Renommer l'espace (owner/admin) |
| `GET /modules` | Modules visibles et rôle dans l'espace |
| `GET /dashboard` | Compteurs des modules visibles |
| `GET /modules/:module/records` | Liste : `q`, `offset`, `limit` (1–100), `field` et `value` |
| `GET /modules/:module/records/:id` | Lire un document de l'espace |
| `POST /modules/:module/records` | Créer : `{data:{...}}` |
| `PATCH /modules/:module/records/:id` | Remplacer tous les champs : `{data:{...},version:1}` |
| `DELETE /modules/:module/records/:id` | Archiver : `{version:1}` |
| `GET /files` | Liste de fichiers, 50 par page avec `offset` |
| `POST /files` | Corps binaire, en-tête `x-file-name` encodé par encodeURIComponent, 10 Mo maximum |
| `GET /files/:id` | Télécharger comme pièce jointe |
| `DELETE /files/:id` | Supprimer un fichier (hors viewer) |
| `GET /members` | Membres (owner/admin) |
| `PATCH /members/:userId` | Modifier un rôle (owner) : `{role}` |
| `DELETE /members/:userId` | Retirer un membre (owner), propriétaire protégé |
| `GET /invites` | Invitations sans les jetons (owner/admin) |
| `POST /invites` | Créer : `{email,role}` ; jeton retourné une seule fois, aucun e-mail envoyé |
| `DELETE /invites/:id` | Révoquer une invitation (owner/admin) |
| `POST /invites/accept` | Accepter : `{token}` avec l'identité e-mail attendue |
| `GET /audit` | Journal de l'espace (owner/admin), pages de 50 |

Les listes de documents renvoient `items`, `total`, `limit`, `offset` et `searchEngine: "d1-contains"`. Les réponses sont privées et non mises en cache. Les champs JSON sont sérialisés comme un objet dans les réponses.

Erreurs : `{error:{code,message,requestId}}`. Codes HTTP principaux : 400 (validation), 401 (connexion), 403 (rôle/origine), 404 (absent ou inaccessible), 409 (conflit de version), 413 (taille), 415 (format), 503 (stockage/service). Un conflit de version impose une nouvelle lecture ; ne pas réessayer en remplaçant aveuglément la version.

Les écritures d'un document et de son audit sont atomiques. Un hook métier qui exige une atomicité multi-documents doit utiliser une route dédiée et un batch/une contrainte de base de données.
