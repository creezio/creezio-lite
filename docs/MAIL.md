# Mail natif

Le module `/mails` reprend les composants Creezio : dossiers, liste, lecture, fils, composition, brouillons et pièces jointes. La boîte est commune à l’espace. Les accès serveur, la recherche, l’API et les outils MCP suivent les droits actuels du registre. Aucun secret ni contenu de message n’est inscrit dans les journaux de requêtes.

Le module reste visible avant configuration. Une connexion activée dans **Intégrations** rend ses capacités disponibles immédiatement, sans installation d’un plugin supplémentaire. Les labels et références des fournisseurs natifs sont automatiques.

| Service | Paramètres | Capacité |
| --- | --- | --- |
| SMTP | Serveur, port, TLS/STARTTLS, identifiant, mot de passe ou mot de passe d’application, adresse d’expédition | Envoi par passerelle HTTPS |
| IMAP | Serveur, port, TLS/STARTTLS, identifiant, mot de passe ou mot de passe d’application, dossier | Réception incrémentale par passerelle HTTPS |
| Cloudflare Email | Jeton API, Account ID, adresse du domaine vérifié, nom d’expéditeur facultatif | Envoi REST ; réception via Email Routing |
| Resend | Clé API, adresse du domaine vérifié, nom d’expéditeur facultatif | Envoi REST |

## SMTP et IMAP sur Sites

L’hébergement Sites ne fournit pas de sockets TCP sortantes. Le connecteur [mail-gateway](../connectors/mail-gateway) se déploie sur un serveur Node ayant accès aux serveurs de messagerie. Son URL HTTPS et sa clé d’accès se configurent avec la connexion. Les identifiants mail et ceux de la passerelle sont chiffrés et utilisés côté serveur uniquement. Le connecteur réalise les échanges SMTP/IMAP réels ; aucune réponse simulée ne remplace un serveur indisponible. **Tester** vérifie l’authentification sans envoyer de message.

La synchronisation se lance dans Mail. Elle conserve son curseur et déduplique les messages ; un changement de boîte ou de validité IMAP réinitialise la lecture. Il n’y a pas de tâche de relève périodique provisionnée automatiquement.

## Cloudflare

L’envoi appelle l’API Email Sending du compte configuré et nécessite ses droits et un domaine validé. Le bouton Tester vérifie le jeton ; il ne prouve pas l’autorisation d’envoyer depuis le domaine. Aucun e-mail de test automatique n’est envoyé.

Pour recevoir, ouvrir **Mail → Réception Cloudflare** et créer l’accès. Installer le [Worker Email Routing fourni](../connectors/cloudflare-mail) dans le compte Cloudflare, puis relier la règle de réception du domaine à ce Worker. La configuration du domaine n’est pas modifiée silencieusement. Le secret de réception n’est affiché qu’une fois et son renouvellement révoque l’ancien accès.

## Persistance et résultats

Quatre tables additives stockent messages, métadonnées de pièces jointes, accès de réception et curseurs IMAP. Les fichiers vivent dans R2. Les brouillons portent une version pour éviter d’écraser une modification concurrente. L’index de recherche est maintenu dans la transaction SQLite.

L’envoi est synchrone, avec prise en charge unique du brouillon. Le statut « envoyé » indique l’acceptation par le fournisseur, pas la lecture ni la livraison finale. Les refus partiels et les résultats inconnus restent visibles. Un résultat inconnu n’est jamais renvoyé automatiquement ; il faut vérifier auprès du fournisseur. Resend et la passerelle disposent en plus d’une clé d’idempotence. La passerelle conserve ces clés dans SQLite à travers les redémarrages.

Limites : 20 pièces jointes et 3 Mo de fichiers au total par message ; 5 Mo de JSON ; 20 messages par lot IMAP ; 4 Mo de MIME côté connecteurs. Le HTML reçu est isolé et les contenus distants sont bloqués. Les tests automatisés utilisent des services simulés et des messages MIME de contrôle ; ils ne valident pas les identifiants du compte de production.
