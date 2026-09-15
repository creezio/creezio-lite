# Prompt produit — créer TempoFlow (non technique)

À coller tel quel à un agent.  
**Interdit** d’y ajouter host-stack, vendor sync, P0–P12, allowlist, etc.  
Si l’agent est bloqué faute d’instructions techniques, le trou est dans
**creezio** (factory / doc / générateur d’app depuis un PRD).

---

## Prompt

```text
Je veux créer une application pour les restaurateurs et responsables d’achats
en restauration.

Nom : TempoFlow.

Elle doit leur permettre de :
- suivre leurs fournisseurs au même endroit ;
- surveiller les prix et les promotions ;
- gérer un catalogue de produits / tarifs ;
- préparer un panier et passer / suivre des commandes ;
- retrouver facilement ce qu’ils ont commandé ;
- travailler sur leur ordinateur, avec leurs données en local ;
- être aidés par un assistant pour les tâches répétitives.

Ce n’est pas une app comptable, ni une app véhicules, ni un CRM cloud obligatoire.

Construis cette app en t’appuyant sur la plateforme Creezio
(repo / documentation du projet creezio). Tout ce qui est générique
(compte utilisateur, fenêtre desktop, mises à jour, assistant, tâches, mails,
extensions…) doit venir de Creezio. Dans TempoFlow, ne mets que ce qui est
spécifique au métier restaurateur / fournisseurs / prix / commandes.

Le détail produit est dans :
creezio/docs/experiences/tempoflow3/PRD-PRODUIT.md

Crée le projet (tempoflow3), fais en sorte que l’application démarre, et que
le parcours fournisseurs → prix → panier → commande fonctionne.
Quand quelque chose de générique manque dans Creezio, améliore Creezio plutôt
que de réinventer le générique dans TempoFlow.
```

---

## Critère d’échec de l’OS (important)

Si pour réussir on est obligé d’enrichir ce prompt avec du jargon kit
(`brand-runtime`, `sync-vendor`, `test:shell`, phases P0…), alors
**l’expérience produit a échoué** : il faut faire évoluer creezio pour qu’un
brief comme ci-dessus suffise (ex. `creezio new-app --from-prd`, doc agent
« créer une marque métier », templates métier, etc.).
