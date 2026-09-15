# AGENTS — @creezio/access-control

## Rôle du package

Contrôle d'accès natif : rôles déclaratifs (config marque) + overrides DB,
résolution dynamique des permissions, API `/api/v1/access/*`, UI admin
« Rôles & accès ».

## Règles

- **Aucun fallback** vers l'ancien système de permissions figées : les marques
  migrées ne doivent plus avoir de mécanisme local de filtrage de sidebar.
- Le store vit dans **`core.db`** (`access_role_overrides`,
  `access_user_overrides`, `access_user_roles`, `access_audit_log`) — jamais
  dans la base métier.
- `resolvePermissions` est la SEULE source de vérité des permissions
  effectives. Ne jamais lire `creezio_platform_users.permissions` pour les
  marques configurées.
- Toute écriture (override, rôle) passe par le store qui écrit l'audit ET
  invalide le cache (les routes le font déjà — ne pas contourner).
- La permission de gestion est `platform.access.manage` ; le rôle owner est
  verrouillé (toujours tous les accès, jamais modifiable).
- Si la marque a une source de vérité métier pour les rôles, utiliser les
  adaptateurs `getUserRole`/`setUserRole` — ne pas dupliquer dans
  `access_user_roles`.
- **Overrides PAR COMPTE (P4)** : `access_user_overrides` ajuste un compte
  précis par-dessus son rôle (`allow` ajoute, `deny` retire, priorité sur
  les overrides de rôle). Routes `PUT /users/:id/permissions`
  (`{ changes: [{ permission, effect: allow|deny|inherit }] }`), UI onglet
  « Comptes », audit `user.override.set|clear`. C'est le mécanisme des
  permissions par module des apps admin (`adminAccessControlPreset` de
  `@creezio/admin`) — bootstrap sans UI : `creezio server-docker access`.

## Fichiers

Voir `FILES.md`.