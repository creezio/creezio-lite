# Publication Sites : contrôle distinct de la recette locale

Les migrations locales et celles de Sites peuvent emprunter des exécuteurs différents.
Un build réussi, une CI verte ou `pnpm db:local` ne prouvent pas que la publication Sites fonctionne.
Le correctif de [migrations locales](https://github.com/creezio/creezio-lite/blob/main/docs/LOCAL-MIGRATIONS.md) ne corrige pas le moteur distant.

## Avant le développement métier d’une nouvelle application

1. Installer les dépendances figées et exécuter `pnpm check:sites-migrations`.
   Ce contrôle lit les fichiers sans les modifier et compare chaque statement Drizzle au
   découpage du Wrangler installé. Une divergence bloque la validation de compatibilité.
   Un succès ne certifie pas le parseur utilisé par Sites.
2. Construire et publier le socle privé avec les outils Sites natifs, dans le projet définitif.
   Réutiliser ensuite ce même project_id. Ne pas attendre la livraison pour ce premier essai.
3. Conserver le SHA, la version Sites, le déploiement et son statut final. Tester un accès
   authentifié, une écriture puis sa relecture dans D1 et un fichier R2 avant de déclarer le socle validé.
4. Refaire le contrôle après chaque changement de migrations ou de dépendances.

## Compatibilité du contrôle local corrigée

Wrangler 4.92.0 peut fragmenter un trigger quand un CASE suit une virgule ou un opérateur
sans espace. Le END du CASE est alors traité comme celui du BEGIN du trigger.
Le résultat peut produire `incomplete input: SQLITE_ERROR`.
Voir le [signalement Cloudflare](https://github.com/cloudflare/workers-sdk/pull/15226).
À partir de Lite 0.15.14, la migration canonique `0003_search_index.sql` espace les deux
expressions concernées. Le garde est exécuté dans la CI du kit sur toutes les migrations
du template et doit réussir avec la version de Wrangler figée.

Cette correction prouve uniquement la compatibilité avec le découpage du Wrangler installé
et conserve le même schéma et les mêmes triggers SQLite. Une publication Sites peut encore
échouer avec `incomplete input` si l’hébergement emploie un autre découpage ou exécuteur.
Le contrôle local ne prouve ni le parseur utilisé par Sites, ni l’application des migrations.
La première publication du socle et la recette D1/R2 restent obligatoires.

## Reprise après échec

Conserver le projet, les bindings, l’archive, son hash et les identifiants retournés.
Demander le fichier, le statement fautif et la liste des migrations déjà appliquées.
L’absence de binding dans l’outil de lecture ne prouve pas qu’aucune migration n’a été appliquée.
Ne pas rejouer l’archive identique, supprimer les triggers ou réinitialiser le Site quand cette
frontière est inconnue. Une application existante ne reçoit pas cette modification par une mise
à jour du seul runtime : si `0003_search_index.sql` n'a jamais été appliquée, reporter explicitement
les deux espaces depuis la migration canonique ; si elle a déjà été appliquée, conserver son historique.

Le correctif de l’exécuteur doit transmettre chaque statement complet (frontières Drizzle)
à D1, préserver les points-virgules internes et enregistrer atomiquement l’application.
Un correctif local du lanceur n’est pas un correctif du service Sites.
Pour une application existante, copier explicitement le script et ajouter la commande :
une mise à jour du seul runtime ne distribue pas ce contrôle.
