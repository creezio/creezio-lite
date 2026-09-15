# Passerelle SMTP et IMAP

Sites ne permet pas les connexions TCP brutes. Cette passerelle tourne sur votre serveur Node 24, derrière un reverse proxy HTTPS. Cloudflare Email et Resend n’en ont pas besoin pour envoyer.

1. Installer avec `pnpm install --frozen-lockfile`.
2. Configurer `MAIL_GATEWAY_TOKEN` avec un secret aléatoire d’au moins 32 caractères et `MAIL_ALLOWED_HOSTS` avec les noms exacts des serveurs autorisés, séparés par des virgules. Ne pas les enregistrer dans Git.
3. Définir `MAIL_GATEWAY_STATE` vers un fichier SQLite sur un disque durable. Ce fichier garde l’état des envois pour éviter de les répéter après une interruption.
4. Lancer `node server.mjs` via votre gestionnaire de services. L’écoute reste sur `127.0.0.1:8787` ; le proxy expose HTTPS avec un certificat valide et une limite de requête de 5 Mo. Restreindre les accès au service selon votre infrastructure.
5. Dans **Intégrations → SMTP/IMAP**, renseigner serveur, port, identifiant, mot de passe, TLS, URL HTTPS de la passerelle et sa clé. SMTP demande aussi l’adresse d’expédition. IMAP peut choisir le dossier.

Le bouton Tester vérifie la connexion sans envoyer de message. Mail synchronise IMAP sur demande avec un curseur UID/UIDVALIDITY. Les domaines publics sont autorisés explicitement ; la passerelle épingle l’adresse résolue et vérifie le certificat TLS. Les mots de passe transitent uniquement dans la requête HTTPS et ne sont ni stockés dans la passerelle ni journalisés.

Un envoi au résultat inconnu n’est jamais répété automatiquement. Vérifier son état côté fournisseur avant de créer un nouvel envoi. La synchronisation s’arrête avec une erreur sur un message trop volumineux, sans avancer son curseur ni annoncer son import.

Le dépôt fournit le connecteur ; il ne provisionne pas votre serveur ni son reverse proxy.
