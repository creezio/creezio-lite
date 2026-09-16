# B00 — Minimiser les journaux API et MCP
Base vérifiée : a9e94131e1f77fe73c01ddb2fa9d56402fa231ca. Branche attribuée : fix/request-log-minimization.

## Résultat
Corriger la duplication des corps métier, paramètres de recherche et arguments MCP dans lite_request_logs. Conserver les métadonnées de diagnostic utiles, les droits, les fonctions natives et une rétention explicite. Livrer le correctif réutilisable dans Creezio Lite avec des tests de comportement.

## Lecture
Lire AGENTS.md, START-HERE.md, docs/ARCHITECTURE.md, docs/MODULES.md, docs/UPDATES.md, runtime/core/observability.ts, runtime/modules/sites-adapter/src/dispatch.ts et les tests existants. Examiner tous les appels persistRequestLog. Ne pas confondre les journaux de requêtes avec les données métier et l'historique volontaire des conversations.

## Périmètre exclusif
runtime/core/observability.ts ; runtime/modules/sites-adapter/src/dispatch.ts ; tests de journalisation et leurs utilitaires nécessaires ; documentation de journalisation et de mise à jour ; fichiers générés correspondants dans template/runtime uniquement via npm run sync:template. Si une migration additive est indispensable pour les anciennes traces, proposer sa stratégie avant de l'ajouter. Ne pas changer package versions : l'orchestrateur gère la publication.
Aucun changement du registre métier, des ACL de projet, des autres migrations, de l'interface ou des intégrations.

## Exigences
- Remplacer la copie arbitraire des body/query/args/result/message par une liste fermée de métadonnées : identifiant d'opération issu du catalogue, source, statut, durée, code d'erreur borné et validé, corrélation générée côté serveur et identifiants serveur nécessaires.
- Aucun contenu métier, nom, e-mail, téléphone, note, document, recherche libre, cookie, token ou clé dans ces diagnostics, même sous une clé arbitraire, imbriquée, dans les champs d'erreur ou un nom d'outil inconnu.
- Examiner aussi path/URL : ne pas conserver la query et ne pas enregistrer comme chemin de diagnostic un segment arbitraire pouvant contenir une valeur personnelle. Utiliser le chemin du catalogue lorsqu'il est résolu, un libellé neutre pour la route inconnue.
- Les opérations MCP HTTP, /api/v1/mcp/call, les erreurs et les sous-appels de l'assistant doivent rester traçables ; préserver la sémantique de source et d'opération. Une erreur métier MCP ne devient pas un succès dans le journal.
- Réutiliser les permissions admin existantes, l'isolation org et le plafond de 1000 lignes par espace. Définir une rétention de 30 jours et la faire respecter à la lecture et lors des écritures, sans prétendre qu'un ordonnanceur autonome existe.
- Les anciennes detail_json potentiellement sensibles ne doivent pas réapparaître via la lecture des diagnostics après mise à jour. Ne pas supprimer les données métier ni les conversations.
- Pas de nouvelle dépendance sauf nécessité démontrée.

## Réception
Tests sur SQLite/D1 de test : REST création/modification/refus avec marqueurs fictifs dans name/email/notes/query ; MCP direct et proxy ; erreurs, noms d'outils et URLs malveillants ; isolation de deux espaces ; détail/status/corrélation utiles ; rétention temporelle et plafond ; lecture d'une ancienne trace contenant les marqueurs. Rechercher les marqueurs dans les lignes réellement enregistrées et dans la réponse de consultation.
Exécuter npm test puis npm run check ; template synchronisé avant typecheck/build ; node scripts/validate-examples.mjs. Distinguer tests locaux/fixtures d'une production authentifiée. Rapporter les commandes et résultats exacts.

## Livraison
Committer et pousser uniquement sur la branche attribuée, ouvrir une PR vers main avec besoin, comportement, tests et limites. Aucun merge, déploiement, changement de secrets, appel payant ou nouvel agent. Aucun accès Notion Archives. L'orchestrateur relit, fusionne et intègre ensuite le kit à Certivan.
