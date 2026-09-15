# Réception Cloudflare Email Routing

L’intégration **Cloudflare Email** dans Lite active le module Mail et fournit l’envoi par l’API Email Sending. La réception nécessite de relier les règles Email Routing de votre domaine à ce Worker.

1. Dans Lite, ouvrir **Mail → Réception Cloudflare → Créer l’accès de réception**. Copier l’URL, le secret affiché une seule fois et le domaine.
2. Dans ce dossier, installer avec `pnpm install --frozen-lockfile`. Renseigner `INBOUND_URL` et `MAIL_DOMAIN` dans `wrangler.jsonc`, avec le nom de Worker de votre choix. Aucune valeur de secret dans ce fichier.
3. S’authentifier avec Cloudflare puis exécuter `pnpm exec wrangler secret put EMAIL_INBOUND_SECRET` pour saisir le secret de réception. Déployer avec `pnpm exec wrangler deploy` dans votre compte Cloudflare.
4. Dans **Email Routing** du domaine, ajouter une règle pour l’adresse souhaitée vers ce Worker. Choisir une règle catch-all seulement si vous souhaitez recevoir toutes les adresses de ce domaine. Préserver les règles et enregistrements DNS existants ; suivre la configuration MX demandée par Cloudflare.
5. Envoyer un message de contrôle à cette adresse, puis actualiser Mail. Cette étape est réalisée par le propriétaire du domaine ; le connecteur ne fait aucun envoi de test automatique.

Le Worker parse le MIME (texte, HTML, en-têtes et pièces jointes), authentifie l’ajout dans un espace précis et refuse les autres domaines. Lite déduplique les Message-ID et conserve les pièces jointes dans R2. Renouveler l’accès dans Lite invalide l’ancien secret ; mettre alors le Worker à jour. Désactiver l’intégration désactive aussi la réception associée.

Limites : message MIME de 4 Mo au maximum, pièces jointes totalisant 3 Mo au maximum. Les erreurs ne sont jamais présentées comme une réception réussie. Le HTML s’affiche dans une iframe isolée sans scripts ni chargements distants.

Documentation officielle : [Email Routing](https://developers.cloudflare.com/email-service/), [API Email Sending](https://developers.cloudflare.com/email-service/).
