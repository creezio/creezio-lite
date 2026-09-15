# @creezio/access-control

Module natif de **contrôle d'accès** des apps Creezio : visibilité des modules
et des entrées de sidebar par rôle, administrable depuis une UI native
(« Rôles & accès »), sans redéploiement.

## Concepts

- **Rôles déclaratifs** — la marque déclare ses rôles et leurs permissions
  par défaut dans la config (`configureAccessControl`). C'est la seule part
  « code » ; tout le reste vit en base.
- **Overrides en DB** — table `access_role_overrides` (dans `core.db`) :
  `(role, permission, effect allow|deny)`. Un `deny` l'emporte sur le défaut,
  un `allow` ajoute une permission hors défaut.
- **Rôle par compte** — table `access_user_roles` (dans `core.db`) par défaut,
  ou adaptateurs `getUserRole`/`setUserRole` si la marque a sa propre source
  de vérité métier (ex. `user_roles` de winhub).
- **Overrides PAR COMPTE** — table `access_user_overrides` (dans `core.db`) :
  `(user_id, permission, effect allow|deny)`. Ajuste un compte précis
  par-dessus son rôle — priorité sur les overrides de rôle. C'est le
  mécanisme des **permissions par module** des apps admin (un comptable
  voit billing mais pas la flotte).
- **Résolution dynamique** — `resolvePermissions(userId, kitRole)` =
  défauts du rôle + overrides de rôle + overrides du compte. Cache mémoire
  30 s, invalidé à chaque PUT.
- **Audit** — table `access_audit_log` : qui a changé quoi, quand.

## Configuration (marque)

```ts
import { configureAccessControl } from "@creezio/access-control";

configureAccessControl({
  roles: [
    { id: "manager", label: "Manager", defaultPermissions: [...] },
    { id: "backoffice", label: "Backoffice", defaultPermissions: [...] },
  ],
  defaultRole: "backoffice",
  permissionGroups: [
    { id: "ventes", label: "Ventes", permissions: [
      { id: "nav.crm", label: "CRM" },
      { id: "nav.panier", label: "Panier" },
    ]},
  ],
  // Optionnel — source de vérité métier pour les rôles :
  // getUserRole: (userId) => ...,
  // setUserRole: (userId, role) => ...,
});
```

Le montage (routes + store) est fait par `@creezio/app-runtime` dès lors que
`configureAccessControl` a été appelé au boot.

## API

Montée sous `/api/v1/access/` — gardée par la permission
`platform.access.manage` (le propriétaire l'a toujours).

| Route | Description |
| --- | --- |
| `GET /matrix` | Rôles × permissions groupées, défauts + effectifs + overrides |
| `PUT /matrix` | Sauvegarde `{ changes: [{ role, permission, effect: allow|deny|inherit }] }` |
| `GET /users` | Comptes avec rôle, permissions effectives, baseline du rôle et overrides |
| `PUT /users/:id/role` | Change le rôle d'un compte (`{ role }`, `null` = défaut) |
| `PUT /users/:id/permissions` | Overrides par compte `{ changes: [{ permission, effect: allow|deny|inherit }] }` |
| `GET /audit?limit=` | Journal d'audit, plus récent d'abord |

## UI

`AccessAdminClient` (export `@creezio/access-control/ui`) — enregistré comme
page admin native par app-runtime : **OS → Admin → Rôles & accès**.

Trois onglets : matrice des rôles (toggles allow/deny, retour au défaut par
cellule), comptes (changement de rôle + **permissions par compte** — éditeur
tri-état hérite/autorisé/refusé par permission), journal d'audit.

## Apps admin (permissions par module)

Les apps admin générées par la factory appellent
`configureAccessControl(adminAccessControlPreset())` (`@creezio/admin`) dans
`brand-platform-bindings.ts` : rôle unique `collaborator` avec **tous les
modules par défaut** (politique de migration sans lockout) — l'owner
restreint ensuite compte par compte (onglet Comptes) ou pour tout le rôle
(matrice). Bootstrap sans UI :

```bash
creezio server-docker access main --brand-root <admin> \
  --user compta@marque.fr --reset --grant nav.billing,nav.clients
```

## Tests

```bash
npm run build --workspace @creezio/access-control
npm test --workspace @creezio/access-control
```