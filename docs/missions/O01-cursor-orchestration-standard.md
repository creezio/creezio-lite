# O01 — Standard d’orchestration Creezio Lite

Base validée : 2e3ee4bf59ba7f0d41fbb9f40526cdf91cdd860e (v0.11.0). Branche attribuée : agents/O01-cursor-orchestration-standard. Agent de réalisation : Cursor Fable 5.1 ; l’orchestrateur (Astra) conserve architecture, priorités, revue ciblée, décision finale et fusion. Aucun autre agent, fusion, release ou déploiement ; migrations appliquées, données, secrets, Sites et providers IA métier inchangés.

## Résultat
Toutes les applications présentes et futures appliquent un même standard simple, autonome, canonique et court : Astra orchestre et décide, Cursor réalise tout développement délégable (développement, corrections, tests nouveaux, investigations, préparation d’upgrade, revues mécaniques). Pas de développement local ni de sous-agent Codex ; Cursor indisponible ⇒ blocage explicite, aucun changement de modèle.

## Livrables
1. Source canonique compacte : `.cursor/skills/lite-orchestration/` (SKILL.md avec name/description, CONTRACT.md, cursor-model.json, scripts). Copies distribuées générées, pas de sources parallèles.
2. Installation par le générateur ; adoption des applications existantes par inspection puis `--apply` idempotent, préservation des règles métier et fichiers non gérés, refus des conflits, manifeste versionné appartenant au kit. Aucun écrasement d’AGENTS ni du verrou runtime.
3. Sélection du modèle choisie une fois à l’attribution et conservée toute la mission (Fable 5.1 par défaut ; dernière Claude Opus ou Grok 4.6 seulement pour une mission clairement plus simple et bornée ; `fast`/`cyber` désactivés par défaut ; aucun contexte inventé). Préflight du catalogue authentifié et daté : identifiant exact et variante complète valide, aucun alias ni repli. `POST` de création documente `model` ; `POST` de reprise n’en envoie pas. Reçu distinguant demandé / catalogue validé / requête acceptée / `modelObserved` (null si non exposé). Clé uniquement en environnement.
4. Brief et réception compacts ; checkpoints courts, polling progressif, déduplication des missions/PR, réconciliation des appels incertains ; revue Cursor indépendante proportionnée, Astra tranche.
5. AGENTS kit/template, règles .cursor, START-HERE/MAINTENANCE/UPDATES renvoient à la source canonique. Aucun cron applicatif créé ni schedule retiré.
6. Version 0.12.0 cohérente (package/lock/template/API/MCP/tests), changelog, adoption. Remplace la priorité CRLF/K02/K05 ; aucun autre sujet.

## Validation
Variante complète valide/invalide au lancement, modèle absent, catalogue indisponible, absence de repli, sélection conservée aux reprises sans champ `model` ni prétendu changement, secrets absents des sorties, déduplication et appel incertain ; projet généré indépendant ; adoption sur fixture avec règles personnalisées, second passage sans changement, conflit préservé et signalé ; cohérence source/copies ; providers métier inchangés ; `npm test`, `npm run check`, typecheck/build du template, `node scripts/validate-examples.mjs`, CI du head. Réception dans docs/reviews/O01-reception.md.
