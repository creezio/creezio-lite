# PRD produit — TempoFlow (expérience « brief non technique »)

vertical: chr

Ce document est volontairement **non technique**.  
Il décrit le produit pour un restaurateur / acheteur CHR.  
Si un agent ne peut pas créer l’app à partir de **ce seul brief** + le repo
`creezio`, **c’est creezio qu’il faut enrichir** (factory, doc agent, scaffolds),
pas le brief.

## Problème

Les restaurateurs et responsables d’achats CHR passent trop de temps à :

- ouvrir les sites de leurs fournisseurs ;
- comparer les prix à la main ;
- suivre les promos et hausses ;
- préparer des commandes sans vision claire du panier et des écarts.

## Produit

**TempoFlow** — application **bureau** pour les professionnels de la restauration
qui veulent **surveiller les prix fournisseurs**, centraliser leur catalogue, et
préparer / suivre leurs commandes.

## Utilisateurs

- Chef / responsable de cuisine  
- Responsable achats d’un restaurant ou d’un petit groupe  
- (plus tard) collaborateur qui aide sur les commandes  

## Ce que l’app doit permettre (minimum)

1. **Avoir ses fournisseurs** au même endroit (fiche, contact, site).  
2. **Voir les produits / tarifs** suivis localement.  
3. **Surveiller les prix** (évolutions, promos, écarts).  
4. **Remplir un panier** et en faire une **commande**.  
5. **Retrouver l’historique** des commandes.  
6. **Chercher** rapidement dans le catalogue.  
7. Travailler **sur son ordinateur**, avec ses données chez lui (pas un CRM cloud
   obligatoire).  
8. Pouvoir être aidé par un **assistant** pour des tâches répétitives.  
9. (Bonus même vague) accès depuis le téléphone via un lien sécurisé quand le
   poste est allumé.

## Ce que ce n’est pas

- Pas une app pour cabinets comptables (GED, bilan).  
- Pas une app d’homologation véhicules.  
- Pas un simple tableur Excel en ligne.  
- Pas « je dois connaître Electron / MCP / SQLite pour m’en servir ».

## Succès

Un restaurateur comprend l’app en 5 minutes :  
fournisseurs → prix → panier → commande.

Référence de richesse fonctionnelle historique : TempoFlow tel qu’il
fonctionnait fin juillet 2026 pour les achats fournisseurs — **sans** exiger
que le code ressemble à l’ancienne version.

## Contrainte plateforme (une seule phrase)

L’app doit être construite **sur la plateforme Creezio** (repo `creezio`) :
tout ce qui est générique (compte, fenêtres, mises à jour, assistant, tâches,
mails, extensions…) vient de la plateforme ; le projet TempoFlow ne décrit que
le métier restaurateur / fournisseurs / prix / commandes.
