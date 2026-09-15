# AGENTS.md — @creezio/support

## Mission

Tickets support du **détenteur d'un serveur marque** (page `/support`) +
export pull vers l'app admin de la marque. Générique : zéro domaine marque.

## Frontières

- Monté nativement par `@creezio/app-runtime` (`platform-support`, core.db) —
  ne pas dupliquer le montage côté marque.
- Le côté **admin** (agrégation flotte, sync, réponse) vit dans
  `@creezio/admin` (module `support`) — pas ici.
- Transport : l'admin initie tout (host-agent → loopback instance). Jamais
  de push serveur marque → admin.
- UI : `@creezio/support/ui` → `SupportClient` (design system shell-ui) ;
  wrapper page dans `@creezio/os-ui/routes/support`.

## Pièges

- `support_tickets`/`support_messages` sont en **core.db** (platform mount) —
  pas dans brand.db.
- Toute évolution du schéma doit rester compatible avec l'upsert admin
  (`admin_support_tickets` — rapprochement par host/server/remote_id).
