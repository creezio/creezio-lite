# Module support — tickets clients agrégés de la flotte

## Vision

Le support de la marque en un seul endroit : les tickets ouverts par les
clients sur **leurs** serveurs marque (brique serveur `@creezio/support`,
mount `platform-support`, page `/support` du CRM) sont **agrégés en pull**
dans l'app admin, avec fil de messages complet. La réponse de l'admin est
**relayée** au serveur marque d'origine (le client la voit sur sa page
`/support`) et copiée localement.

## Utilisateurs & parcours

- **Agent support de la marque** : ouvre `/tickets` → sync automatique de
  toute la flotte au chargement (+ bouton manuel) → liste des tickets,
  sélection → fil de messages → réponse (relayée au client) → statut
  (résolu/fermé, propagé).
- **Client final** : n'interagit jamais avec ce module — il voit les
  réponses sur la page `/support` de SON serveur marque.

## Capacités (fonctionnel)

- Agrégation pull de toute la flotte (backend flotte → agents → instances).
- Upsert idempotent des tickets par provenance
  `(host_id, server_name, remote_id)` et des messages par
  `(ticket_id, remote_id)`.
- Fil de conversation (origine client/admin).
- Réponse admin relayée + copie locale ; statut local + propagation
  best-effort.
- Ingestion directe (`POST ingest`) pour tests/imports.

## Modèle de données

Tickets — migration `admin_001_native_modules` :

```sql
CREATE TABLE IF NOT EXISTS admin_support_tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- provenance flotte
  host_id TEXT,
  server_name TEXT,
  remote_id TEXT,
  -- contenu
  sujet TEXT NOT NULL,
  corps TEXT,
  auteur TEXT,
  statut TEXT NOT NULL DEFAULT 'ouvert',
  derniere_reponse TEXT
);
```

Messages — migration `admin_002_support_messages_billing_events` :

```sql
CREATE TABLE IF NOT EXISTS admin_support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  remote_id TEXT,
  created_at TEXT NOT NULL,
  origine TEXT NOT NULL DEFAULT 'client',
  auteur TEXT,
  corps TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_support_messages_ticket
  ON admin_support_messages (ticket_id, created_at);
```

## API

Mount : `createSupportAdminMount(opts?: { fleet?: FleetAdminMountOptions })`
— `dbLayer: "brand"`, monté sous `/api/v1/modules/support`. Session OS
admin sur tout le mount.

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `` | Tickets + `messages_count` (sous-requête), `ORDER BY updated_at DESC` → `{ ok, items }` |
| POST | `sync` | Pull de TOUTE la flotte (détail ci-dessous) → `{ ok, scanned, tickets, messages, errors: string[] }` ; 502 si le backend flotte est injoignable |
| POST | `ingest` | Upsert direct : body `{ tickets: [...] }`, clé `(host_id, server_name, remote_id \|\| id)` ; champs FR ou EN acceptés (`sujet`/`subject`, `corps`/`body`, `auteur`/`author`, `statut`/`status`) ; tickets sans remote_id ignorés → `{ ok, upserted }` |
| GET | `<id>` | Ticket + fil `messages` (created_at ASC) ou 404 |
| POST | `<id>/reply` | Réponse admin (détail ci-dessous) |
| POST | `<id>/statut` | body `{ statut }` (défaut `ouvert`) : update local + propagation **best-effort** au serveur marque (`POST …/support/<remote_id>/statut`) — l'échec de propagation n'échoue pas la requête |

### POST sync — algorithme

1. `GET {backend}/admin/api/servers` (via `fleetFetch`, Basic) ; 502 si KO.
2. Pour chaque serveur non `orphan` avec brandId+name : `GET` de l'export
   support via `supportPathFor` — local :
   `/admin/api/servers/{brandId}/{name}/support/export` ; hôte enrôlé :
   `/admin/api/hosts/{hostId}/servers/{brandId}/{name}/support/export`.
   Erreur réseau → poussée dans `errors`, serveur suivant ; réponse non-ok
   → serveur ignoré silencieusement.
3. Pour chaque ticket distant (id requis) : upsert par
   `(host_id = hostId||"local", server_name, remote_id)` avec :
   - `sujet` (défaut `(sans sujet)`), `statut` (défaut `ouvert`),
     `auteur` ;
   - `corps` = corps du **premier message d'origine ≠ admin** (sinon
     `t.corps`) ;
   - `derniere_reponse` = `created_at` du **dernier message admin** (null
     sinon) ;
   - insert : `created_at` distant conservé ; update : `updated_at` = now.
4. Messages : insert **uniquement** si `(ticket_id, remote_id)` inconnu
   (jamais réécrits), avec origine (défaut `client`), auteur (nullable),
   corps, created_at distant.

### POST <id>/reply — algorithme

1. `corps` requis (400).
2. Ticket local requis (404).
3. Résolution du serveur d'origine via `GET /admin/api/servers` (match
   `hostId||"local"` + `name`) ; introuvable → 502.
4. Relais `POST {supportPath}/{remote_id}/reply` avec
   `{ corps, auteur: body.auteur || "support" }` ; non-ok → 502
   `{ error: "relais réponse KO", detail }` (PAS de copie locale — le
   client doit voir la réponse ou rien).
5. Succès : insertion locale d'un message `origine=admin`
   (`remote_id = NULL`), ticket → `statut='repondu'`,
   `derniere_reponse = updated_at = now`.

## UI

Client `TicketsAdminClient` (`ui/tickets-admin-client.tsx`), exporté par
`@creezio/admin/ui`, matérialisé par l'app admin (TempoFlow : `/tickets`).
Sans props.

- Chargement : `GET` liste puis `POST sync` automatique ; bouton
  « Synchroniser la flotte » avec résumé (`N serveur(s) scanné(s),
  N ticket(s), N nouveau(x) message(s)`).
- Layout 2 colonnes : liste de cartes ticket (sujet + badge statut +
  extrait + badge `server_name @ hostId` + date + compteur messages) /
  panneau conversation (messages admin sur fond `bg-primary/10`, client
  `bg-muted`), `<textarea>` réponse + « Envoyer la réponse », boutons
  « Marquer résolu » / « Fermer ».
- Statuts affichés : `ouvert` (destructive), `repondu` (default),
  `resolu`/`ferme` (secondary) — labels FR.
- Erreurs sync/reply affichées dans une `Card` destructive.

Composants kit : `Badge`, `Button`, `Card` (`@creezio/shell-ui/ui/kit`).

## Tools MCP

Aucun.

## Logique métier non triviale

- **Le pull ne supprime jamais** : un ticket disparu côté serveur marque
  reste dans l'agrégat (historique support).
- `corps` du ticket = premier message **client** du fil (l'export marque
  peut mettre la réponse admin en premier corps).
- `derniere_reponse` = horodatage du dernier message admin — sert au tri
  visuel et au SLA.
- Idempotence à deux niveaux : tickets upsertés (contenu rafraîchi),
  messages insérés une seule fois (dédup par remote_id).
- La réponse locale a `remote_id = NULL` : au sync suivant, la même
  réponse revient de l'export marque avec SON id distant → elle est
  insérée comme nouveau message (doublon d'affichage possible — dette
  SUPP-2).

## Seeds & données initiales

Aucun.

## Cas limites & règles de gestion

- Backend flotte down : sync → 502 explicite ; la liste locale reste
  servie.
- Serveur marque down pendant le sync : compté dans `errors`, les autres
  serveurs sont quand même traités.
- Ticket sans id distant / message sans id distant : ignorés.
- Reply sur ticket dont le serveur a quitté la flotte : 502 « serveur
  d'origine introuvable dans la flotte ».
- Statut : propagation best-effort (try/catch avale tout) — le statut
  local est la référence de l'admin même si le serveur marque est down.

## Hors périmètre

- La brique serveur côté marque (`@creezio/support`, tickets + export +
  reply + statut du CRM client).
- Notifications (mail/push) à l'agent support.
- Le naming (« restaurants »…) : labels de l'app admin.
