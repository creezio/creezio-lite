# Email Worker — inbound `@creezio/mails`

Worker Cloudflare Email Routing **paramétrable** (zéro fork domaine marque).

## Flux

1. Catch-all Email Routing → ce Worker
2. Worker parse MIME + PJ
3. `POST https://{slug}.{MAIL_ROOT_DOMAIN}/api/v1/email/inbound`
4. CRM marque : `createEmailInboxRoutes()` (secret Bearer)

## Variables Worker

| Var | Exemple | Rôle |
|-----|---------|------|
| `EMAIL_INBOUND_SECRET` | *(secret)* | Bearer partagé CRM |
| `MAIL_ROOT_DOMAIN` | `tempoflow.fr` | Zone publique instances |
| `MAIL_SUBDOMAIN` | `mail` | `{slug}.mail.{root}` |
| `CRM_INBOUND_URL_TEMPLATE` | `https://{slug}.{root}/api/v1/email/inbound` | Override URL |

## Déploiement marque

```bash
# TempoFlow
export CF_API_TOKEN=… CF_ZONE_ID=…
MAIL_ROOT_DOMAIN=tempoflow.fr \
WORKER_NAME=tf2-email-inbound \
INBOUND_SECRET_ENV_NAME=TF2_EMAIL_INBOUND_SECRET \
  node packages/mails/email-worker/bootstrap.mjs

# Certivan
MAIL_ROOT_DOMAIN=certivan.creez.io \
WORKER_NAME=certivan-email-inbound \
INBOUND_SECRET_ENV_NAME=CERTIVAN_EMAIL_INBOUND_SECRET \
  node packages/mails/email-worker/bootstrap.mjs
```

Ou manuellement : copier `wrangler.toml.example` → `wrangler.toml`,
renseigner `[vars]`, `wrangler secret put EMAIL_INBOUND_SECRET`, `wrangler deploy`.

## Côté marque CRM

```ts
import { configureMails, createEmailInboxRoutes } from "@creezio/mails";

configureMails({
  rootDomain: "tempoflow.fr",
  inboundSecretEnvKeys: ["EMAIL_INBOUND_SECRET", "TF2_EMAIL_INBOUND_SECRET"],
});

api.route("/email", createEmailInboxRoutes());
```

Les MX/SPF `{slug}.mail.{root}` sont assurés par l'auto-provisioning
tunnel de l'instance (client CF `@creezio/platform-core`, best-effort au
boot — 0.10.0).
