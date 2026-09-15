# ADR — Hostnames tunnel aplatis (Universal SSL)

## Statut

Accepté (2026-08-07) — **amendé 0.10.0** : le mode de hostnames est désormais
piloté par `CREEZIO_CF_UNIVERSAL_SSL` (truthy → nested, défaut flat ;
remplace `CREEZIO_TUNNEL_FLAT_HOSTS`) et le provisioner VPS est supprimé
(auto-provisioning par l'instance via l'API CF). Le présent ADR reste
l'historique de la décision flat/nested.

## Contexte

Cloudflare **Universal SSL** ne couvre qu'un seul niveau de sous-domaine
(`*.exemple.fr`). Les hostnames multi-niveau du kit —

`n8n.{slug}.{zone}`, `hermes.{slug}.{zone}`, `agent.{slug}.{zone}` —

produisent des certificats invalides / erreurs SSL sur ces zones.

Les zones avec **Advanced Certificate Manager** (ou équivalent) continuent
de supporter le schéma nested historique (TempoFlow).

## Décision

Deux modes SoT dans `packages/platform-core/src/tunnel-urls.ts` et
`packages/platform-core/src/tunnel-cf.ts` :

| Mode | Hosts embeds/agent | DNS |
|------|--------------------|-----|
| `nested` (défaut) | `n8n.{slug}.{zone}` | CNAME `{slug}` + `*.{slug}` |
| `flat` | `n8n-{slug}.{zone}` | CNAME plats `n8n-{slug}`, `hermes-{slug}`, `agent-{slug}` |

Le CRM reste `{slug}.{zone}` dans les deux modes.

Activation explicite :

1. Env provisioner / instance : `CREEZIO_TUNNEL_FLAT_HOSTS=1`
2. Optionnel marque : `AppManifest.tunnelHostMode: "flat"` (clients join
   dérivent les URLs sans env)

Pas d'auto-détection réseau : le flag est opt-in pour ne pas casser les
marques nested existantes.

## Conséquences

- WinHub (`winhub.fr`, Universal SSL) : flag sur le provisioner +
  `tunnelHostMode: "flat"` sur le manifest ; TempoFlow reste nested.
- Migration d'un slug déjà réservé : poser le flag, redémarrer le
  provisioner, `POST /configure` (réécrit ingress + crée les CNAME plats).
  Le wildcard `*.{slug}` peut rester orphelin (nettoyé au `/deprovision`).
- Les slugs CRM `n8n-*` / `hermes-*` / `agent-*` sont refusés en mode flat
  (collision DNS avec les embeds).
