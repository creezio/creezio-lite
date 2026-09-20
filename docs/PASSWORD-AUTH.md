# Authentification autonome par mot de passe

Le runtime exporte `preparePasswordAccount`, `handlePasswordAuth` et
`resolvePasswordIdentity`. L’application choisit explicitement le `userId` : le helper ne
cherche jamais un utilisateur existant par email et ne crée aucun propriétaire ouvert.
`preparePasswordAccount` renvoie des statements D1 à joindre à la transaction métier ainsi
qu’un jeton d’activation brut réservé au serveur. Le mot de passe est défini par
`POST /api/v1/auth/activate`.

Les mots de passe utilisent PBKDF2-SHA-256 avec un sel aléatoire et 100 000 itérations, plafond
compatible avec WebCrypto Workers. Les sessions et jetons sont aléatoires sur 256 bits ; seuls
leurs SHA-256 vivent dans D1. Le cookie `__Host-lite_password_session` est `HttpOnly`, `Secure`,
`SameSite=Lax` et `Path=/`. Les sessions expirent après huit heures. Activation et reset expirent
respectivement après vingt-quatre heures et une heure. Un reset incrémente la version du compte
et révoque toutes ses sessions.

`handlePasswordAuth` traite uniquement les POST `login`, `logout`, `activate` et `reset` sous
`/api/v1/auth/`. Les mutations exigent la même origine et refusent `Sec-Fetch-Site: cross-site`.
L’application choisit explicitement de monter ces routes et de résoudre cette session ; le module
n’altère pas l’authentification GPT existante et permet de conserver les deux modes en parallèle.
Les limites de tentatives sont persistées dans D1 avec des clés hachées. La demande de reset
répond toujours `{ok:true}`, même si la notification échoue ; seul `onPasswordResetRequested`
reçoit le jeton brut et son `purpose` (`activation` ou `reset`). Une demande visant un compte non
activé renouvelle son activation pendant vingt-quatre heures. Les callbacks
`onAccountActivated` et `onPasswordReset` peuvent déclencher les notifications applicatives.
Ils ne remplacent ni la création transactionnelle du membre ni les contrôles d’accès métier.
