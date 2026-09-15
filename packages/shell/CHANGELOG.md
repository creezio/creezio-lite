# @creezio/shell

## 0.26.0

### Minor Changes

- 2f5b6ea: H13 — résidu allowlist runtime (ARCHITECTURE_VERSION H12 → H13, convention 0.x : minor comme H10/H11/H12).

  - Crash env : plus de dual-read `TF2_*` / `CERTIVAN_*` / `FIDU_*` / `TEMPOFLOW3_*` — `CREEZIO_*` + scan `envKey`.
  - `envForNodeScriptSpawn` : plus d'heuristique packagée nommée marque.
  - UI kit : `creezio-fake-cursor`, `creezio-titlebar-*`, cache SW `creezio-shell-*`.
  - Codemods `scripts/codemods/H13/` (`since: 0.26.0`), appliqués par `creezio upgrade`.

## 0.25.0

## 0.24.1

## 0.24.0

## 0.23.0

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.18.0

## 0.17.1

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

## 0.11.0

## 0.10.15

## 0.10.14

## 0.10.13

## 0.10.12

## 0.10.11

## 0.10.10

## 0.10.9

## 0.10.8

## 0.10.7

## 0.10.6

## 0.10.5

## 0.10.4

## 0.10.3

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.4

## 0.9.3

## 0.9.2

## 0.9.1

## 0.9.0

## 0.8.1

## 0.8.0

## 0.7.1

## 0.7.0

## 0.6.0

## 0.5.0

### Patch Changes

- d674c86: Peers internes @creezio/\* en `>=0.4.0` (au lieu de `^0.4.0`) : ?vite que le
  train lockstep escalade en 1.0.0 au premier bump minor (les peers restent
  satisfaits par toute version future du kit).
