# Plan P* — Atteindre 100 % intention OS (post-O11)

**SoT écart + checklist :** [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md)

**Baseline** : kit tip au commit de cet état des lieux · marques TF/CV/Fidu
post-O11 feeds.

**Règles non négociables**

- Intention = ARCHITECTURE-INTENTION (CMS + 3 couches), **pas** « finir MCP ».
- Commun = `@creezio/*` ; marques = minimum métier.
- **Arbitrage ×3 (§0 état des lieux) :** présent dans TF+CV+Fidu → **NATIF**
  (config optionnelle ok). Pas de vague « décider si métier ».
- Façades / stubs / jumeaux = **NON done**.
- Extraire TempoFlow gold ; ne pas inventer.
- **Pas de P(n+1) si gate intention P(n) rouge.**

## Vagues

| Vague | Contenu | Effort |
|-------|---------|--------|
| **P0** | Gates intention + matrice honnête (+ doc §0) — [PHASE-P0.md](PHASE-P0.md) | S |
| **P1** | Shell-UI jumeaux → kit (sidebar/workspace/cockpit/setup/onboarding/search) + cutover ×3 | XL |
| **P2** | Tasks/AI/Hermes kanban → kit SoT + extinction jumeaux TF/CV/Fidu | XL |
| **P3** | Product Hub routes + n8n provisioning | L |
| **P4** | MCP SoT unique | L |
| **P5** | Assistant routes / mounts | M |
| **P6** | Auth login UI + mails parité (config Fidu ok) | M |
| **P7** | Fleet collector → kit/ops | M |
| **P8** | Server twins (schemas, mcp/oauth) | L |
| **P9** | Boot + multi-DB paths | M |
| **P10** | Purge vocabulaire TF kit | L |
| **P11** | Obs / automations lifecycle parité | M |
| **P12** | Fabrique plugins shippée ≥1 marque | L |
| **P13** | Scripts/tests twins | L |
| **P14** | Freeze intention 100 % + republish | S |

**P0 code effectif = P1+P2** (tout ×3 encore local shell/tasks). Pas de P1
« humain / trous ».

Détail done / étapes / risques : §F–H de l’état des lieux.
