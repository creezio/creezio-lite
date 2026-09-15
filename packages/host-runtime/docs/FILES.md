# packages/host-runtime — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs host-runtime` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `resources/scripts/`

| Fichier | Rôle |
|---|---|
| [`resources/scripts/meili-coherence-query.cjs`](../resources/scripts/meili-coherence-query.cjs) | (à documenter) |

## `resources/vendor/hermes-agent/`

| Fichier | Rôle |
|---|---|
| [`resources/vendor/hermes-agent/install.sh`](../resources/vendor/hermes-agent/install.sh) | (à documenter) |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/brand-host-runtime.ts`](../src/brand-host-runtime.ts) | (à documenter) |
| [`src/brand-host-stack.ts`](../src/brand-host-stack.ts) | (à documenter) |
| [`src/brand-kernel-http.ts`](../src/brand-kernel-http.ts) | (à documenter) |
| [`src/bridge-client.ts`](../src/bridge-client.ts) | (à documenter) |
| [`src/context.ts`](../src/context.ts) | (à documenter) |
| [`src/contracts.ts`](../src/contracts.ts) | (à documenter) |
| [`src/crash-reporter.ts`](../src/crash-reporter.ts) | (à documenter) |
| [`src/ensure-kit-binaries.ts`](../src/ensure-kit-binaries.ts) | (à documenter) |
| [`src/factory-reset-runtime.ts`](../src/factory-reset-runtime.ts) | (à documenter) |
| [`src/feature-off-host.ts`](../src/feature-off-host.ts) | (à documenter) |
| [`src/host-stack.ts`](../src/host-stack.ts) | (à documenter) |
| [`src/index.ts`](../src/index.ts) | (à documenter) |
| [`src/load-electron.ts`](../src/load-electron.ts) | (à documenter) |
| [`src/local-config.ts`](../src/local-config.ts) | (à documenter) |
| [`src/logger.ts`](../src/logger.ts) | (à documenter) |
| [`src/node-runtime.ts`](../src/node-runtime.ts) | (à documenter) |
| [`src/npm-cli.ts`](../src/npm-cli.ts) | (à documenter) |
| [`src/safe-storage.ts`](../src/safe-storage.ts) | (à documenter) |
| [`src/server-env.ts`](../src/server-env.ts) | (à documenter) |
| [`src/server-launcher.ts`](../src/server-launcher.ts) | (à documenter) |

## `src/ai-workspace/`

| Fichier | Rôle |
|---|---|
| [`src/ai-workspace/actions.ts`](../src/ai-workspace/actions.ts) | (à documenter) |
| [`src/ai-workspace/bindings.ts`](../src/ai-workspace/bindings.ts) | (à documenter) |
| [`src/ai-workspace/index.ts`](../src/ai-workspace/index.ts) | (à documenter) |
| [`src/ai-workspace/manager.ts`](../src/ai-workspace/manager.ts) | (à documenter) |
| [`src/ai-workspace/profile-window.ts`](../src/ai-workspace/profile-window.ts) | (à documenter) |
| [`src/ai-workspace/screencast.ts`](../src/ai-workspace/screencast.ts) | (à documenter) |
| [`src/ai-workspace/types.ts`](../src/ai-workspace/types.ts) | (à documenter) |

## `src/hermes/`

| Fichier | Rôle |
|---|---|
| [`src/hermes/crm-key.ts`](../src/hermes/crm-key.ts) | (à documenter) |
| [`src/hermes/ensure-crm-key-db.ts`](../src/hermes/ensure-crm-key-db.ts) | (à documenter) |
| [`src/hermes/launcher.ts`](../src/hermes/launcher.ts) | (à documenter) |
| [`src/hermes/runtime-bootstrap.ts`](../src/hermes/runtime-bootstrap.ts) | (à documenter) |
| [`src/hermes/skills-seed.ts`](../src/hermes/skills-seed.ts) | (à documenter) |

## `src/n8n/`

| Fichier | Rôle |
|---|---|
| [`src/n8n/agent-isolation.ts`](../src/n8n/agent-isolation.ts) | (à documenter) |
| [`src/n8n/api-key.ts`](../src/n8n/api-key.ts) | (à documenter) |
| [`src/n8n/launcher.ts`](../src/n8n/launcher.ts) | (à documenter) |
| [`src/n8n/runtime-bootstrap.ts`](../src/n8n/runtime-bootstrap.ts) | (à documenter) |

## `src/plugins/`

| Fichier | Rôle |
|---|---|
| [`src/plugins/accept-check.ts`](../src/plugins/accept-check.ts) | (à documenter) |
| [`src/plugins/brand-bindings.ts`](../src/plugins/brand-bindings.ts) | (à documenter) |
| [`src/plugins/control-adapters.ts`](../src/plugins/control-adapters.ts) | (à documenter) |
| [`src/plugins/control-extras.ts`](../src/plugins/control-extras.ts) | (à documenter) |
| [`src/plugins/control-plane.ts`](../src/plugins/control-plane.ts) | (à documenter) |
| [`src/plugins/control-token.ts`](../src/plugins/control-token.ts) | (à documenter) |
| [`src/plugins/crm-key.ts`](../src/plugins/crm-key.ts) | (à documenter) |
| [`src/plugins/data.ts`](../src/plugins/data.ts) | (à documenter) |
| [`src/plugins/events.ts`](../src/plugins/events.ts) | (à documenter) |
| [`src/plugins/execution-grant.ts`](../src/plugins/execution-grant.ts) | (à documenter) |
| [`src/plugins/git.ts`](../src/plugins/git.ts) | (à documenter) |
| [`src/plugins/host.ts`](../src/plugins/host.ts) | (à documenter) |
| [`src/plugins/launcher.ts`](../src/plugins/launcher.ts) | (à documenter) |
| [`src/plugins/runtime.ts`](../src/plugins/runtime.ts) | (à documenter) |
| [`src/plugins/test-runner.ts`](../src/plugins/test-runner.ts) | (à documenter) |

## `src/sandbox/`

| Fichier | Rôle |
|---|---|
| [`src/sandbox/embed-sandbox.ts`](../src/sandbox/embed-sandbox.ts) | (à documenter) |
| [`src/sandbox/os-sandbox.ts`](../src/sandbox/os-sandbox.ts) | (à documenter) |

## `src/tunnel/`

| Fichier | Rôle |
|---|---|
| [`src/tunnel/cloudflared-respawn.ts`](../src/tunnel/cloudflared-respawn.ts) | (à documenter) |
| [`src/tunnel/tunnel.ts`](../src/tunnel/tunnel.ts) | (à documenter) |
