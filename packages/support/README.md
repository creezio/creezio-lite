# @creezio/support

Support natif OS côté **serveur marque** : le détenteur du serveur (ex.
restaurateur) ouvre des tickets et lit les réponses de l'admin de marque sur
la page `/support` de son CRM.

## Architecture (ADR-admin-app-os §5)

- **Mount natif** `platform-support` — monté par `create-brand-kernel.ts`
  (`@creezio/app-runtime`) comme tasks/mails → HTTP
  `/api/v1/platform/platform-support/*`, données en `core.db`
  (`support_tickets`, `support_messages`).
- **Page OS** `/support` — wrapper `@creezio/os-ui` → `SupportClient`
  (`@creezio/support/ui`), matérialisée dans chaque marque.
- **Transport** : *l'admin initie tout*. Le host-agent expose
  `/agent/api/servers/:brand/:name/support[/*]` (relais loopback vers le
  mount de l'instance) ; le backend flotte relaie
  `/admin/api/(hosts/:h/)servers/:brand/:name/support[/*]`. Côté app admin,
  le module `support` de `@creezio/admin` fait le pull (`POST sync`) et le
  relais des réponses (`POST <id>/reply`).

## API mount serveur marque

| Méthode | Chemin | Rôle |
|---------|--------|------|
| GET | `` | liste tickets (dernier message inclus) |
| POST | `` | créer `{ sujet, corps, auteur? }` |
| GET | `export` | tickets + fils complets (pull admin) |
| GET | `<id>` | ticket + messages |
| POST | `<id>/messages` | message client (réouvre) |
| POST | `<id>/reply` | réponse admin (statut → repondu) |
| POST | `<id>/statut` | `ouvert\|repondu\|resolu\|ferme` |


## Profil Creezio Lite / Sites

createSupportServerMount accepte persistence pour un dépôt asynchrone. Le handler et la voie SQLite d’origine restent disponibles. La variante de badge danger respecte les primitives du kit.
