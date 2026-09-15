# @creezio/mails

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/shell-ui@0.26.0
  - @creezio/api-kernel@0.26.0
  - @creezio/auth@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [17ae2a4]
- Updated dependencies [2da43ad]
  - @creezio/auth@0.25.0
  - @creezio/platform-core@0.25.0
  - @creezio/api-kernel@0.25.0
  - @creezio/shell-ui@0.25.0

## 0.24.1

### Patch Changes

- @creezio/platform-core@0.24.1
- @creezio/api-kernel@0.24.1
- @creezio/shell-ui@0.24.1
- @creezio/auth@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/shell-ui@0.24.0
  - @creezio/api-kernel@0.24.0
  - @creezio/auth@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/api-kernel@0.23.0
  - @creezio/auth@0.23.0
  - @creezio/shell-ui@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/api-kernel@0.22.0
- @creezio/shell-ui@0.22.0
- @creezio/auth@0.22.0

## 0.21.0

### Patch Changes

- @creezio/platform-core@0.21.0
- @creezio/api-kernel@0.21.0
- @creezio/shell-ui@0.21.0
- @creezio/auth@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/api-kernel@0.20.0
  - @creezio/auth@0.20.0
  - @creezio/shell-ui@0.20.0

## 0.19.0

### Patch Changes

- 7254406: Token renseigné mais send 550 : la config reste OK ; l'UI affiche clairement que l'envoi réel est indisponible (domaine non onboardé).
- Updated dependencies [9324b6c]
- Updated dependencies [cc2724a]
- Updated dependencies [fe20ca7]
- Updated dependencies [02927c6]
  - @creezio/shell-ui@0.19.0
  - @creezio/auth@0.19.0
  - @creezio/platform-core@0.19.0
  - @creezio/api-kernel@0.19.0

## Unreleased

- Token / `secret_ref` renseigné : les réglages restent enregistrables si le probe send échoue (550, domaine non onboardé). `POST /settings/verify` renvoie `ok: true` + `send.state=unavailable` au lieu d'invalider les identifiants. Bandeau `/parametres/email` et file d'attente : « Email Sending non configuré » vs « Token présent, envoi réel indisponible ». `nodemailer_absent` et l'absence de token ne sont pas masqués.

## 0.18.0

### Patch Changes

- Updated dependencies [7c40c12]
  - @creezio/shell-ui@0.18.0
  - @creezio/auth@0.18.0
  - @creezio/platform-core@0.18.0
  - @creezio/api-kernel@0.18.0

## 0.17.1

### Patch Changes

- @creezio/platform-core@0.17.1
- @creezio/api-kernel@0.17.1
- @creezio/shell-ui@0.17.1
- @creezio/auth@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/api-kernel@0.17.0
  - @creezio/auth@0.17.0
  - @creezio/shell-ui@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/api-kernel@0.16.0
  - @creezio/platform-core@0.16.0
  - @creezio/auth@0.16.0
  - @creezio/shell-ui@0.16.0

## 0.15.0

### Patch Changes

- @creezio/platform-core@0.15.0
- @creezio/api-kernel@0.15.0
- @creezio/shell-ui@0.15.0
- @creezio/auth@0.15.0

## 0.14.0

### Patch Changes

- @creezio/platform-core@0.14.0
- @creezio/api-kernel@0.14.0
- @creezio/shell-ui@0.14.0
- @creezio/auth@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/platform-core@0.13.0
  - @creezio/api-kernel@0.13.0
  - @creezio/shell-ui@0.13.0
  - @creezio/auth@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [17c82b1]
  - @creezio/platform-core@0.12.0
  - @creezio/api-kernel@0.12.0
  - @creezio/auth@0.12.0
  - @creezio/shell-ui@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b0856ee]
  - @creezio/platform-core@0.11.0
  - @creezio/api-kernel@0.11.0
  - @creezio/auth@0.11.0
  - @creezio/shell-ui@0.11.0

## 0.10.15

### Patch Changes

- @creezio/platform-core@0.10.15
- @creezio/api-kernel@0.10.15
- @creezio/shell-ui@0.10.15
- @creezio/auth@0.10.15

## 0.10.14

### Patch Changes

- @creezio/platform-core@0.10.14
- @creezio/api-kernel@0.10.14
- @creezio/shell-ui@0.10.14
- @creezio/auth@0.10.14

## 0.10.13

### Patch Changes

- Updated dependencies [e07d2cf]
  - @creezio/api-kernel@0.10.13
  - @creezio/platform-core@0.10.13
  - @creezio/shell-ui@0.10.13
  - @creezio/auth@0.10.13

## 0.10.12

### Patch Changes

- Updated dependencies [0823798]
  - @creezio/api-kernel@0.10.12
  - @creezio/platform-core@0.10.12
  - @creezio/shell-ui@0.10.12
  - @creezio/auth@0.10.12

## 0.10.11

### Patch Changes

- Updated dependencies [38beaeb]
  - @creezio/auth@0.10.11
  - @creezio/platform-core@0.10.11
  - @creezio/api-kernel@0.10.11
  - @creezio/shell-ui@0.10.11

## 0.10.10

### Patch Changes

- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/api-kernel@0.10.10
  - @creezio/shell-ui@0.10.10
  - @creezio/auth@0.10.10

## 0.10.9

### Patch Changes

- @creezio/platform-core@0.10.9
- @creezio/api-kernel@0.10.9
- @creezio/shell-ui@0.10.9
- @creezio/auth@0.10.9

## 0.10.8

### Patch Changes

- Updated dependencies [a2fea46]
  - @creezio/api-kernel@0.10.8
  - @creezio/platform-core@0.10.8
  - @creezio/shell-ui@0.10.8
  - @creezio/auth@0.10.8

## 0.10.7

### Patch Changes

- Updated dependencies [55b1cd5]
  - @creezio/api-kernel@0.10.7
  - @creezio/platform-core@0.10.7
  - @creezio/shell-ui@0.10.7
  - @creezio/auth@0.10.7

## 0.10.6

### Patch Changes

- Updated dependencies [1c7ec66]
  - @creezio/api-kernel@0.10.6
  - @creezio/platform-core@0.10.6
  - @creezio/shell-ui@0.10.6
  - @creezio/auth@0.10.6

## 0.10.5

### Patch Changes

- @creezio/platform-core@0.10.5
- @creezio/api-kernel@0.10.5
- @creezio/shell-ui@0.10.5
- @creezio/auth@0.10.5

## 0.10.4

### Patch Changes

- @creezio/platform-core@0.10.4
- @creezio/api-kernel@0.10.4
- @creezio/shell-ui@0.10.4
- @creezio/auth@0.10.4

## 0.10.3

### Patch Changes

- @creezio/platform-core@0.10.3
- @creezio/api-kernel@0.10.3
- @creezio/shell-ui@0.10.3
- @creezio/auth@0.10.3

## 0.10.2

### Patch Changes

- @creezio/platform-core@0.10.2
- @creezio/api-kernel@0.10.2
- @creezio/shell-ui@0.10.2
- @creezio/auth@0.10.2

## 0.10.1

### Patch Changes

- @creezio/platform-core@0.10.1
- @creezio/api-kernel@0.10.1
- @creezio/shell-ui@0.10.1
- @creezio/auth@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/api-kernel@0.10.0
  - @creezio/auth@0.10.0
  - @creezio/shell-ui@0.10.0

## 0.9.4

### Patch Changes

- @creezio/platform-core@0.9.4
- @creezio/api-kernel@0.9.4
- @creezio/shell-ui@0.9.4
- @creezio/auth@0.9.4

## 0.9.3

### Patch Changes

- @creezio/platform-core@0.9.3
- @creezio/api-kernel@0.9.3
- @creezio/shell-ui@0.9.3
- @creezio/auth@0.9.3

## 0.9.2

### Patch Changes

- @creezio/platform-core@0.9.2
- @creezio/api-kernel@0.9.2
- @creezio/shell-ui@0.9.2
- @creezio/auth@0.9.2

## 0.9.1

### Patch Changes

- @creezio/platform-core@0.9.1
- @creezio/api-kernel@0.9.1
- @creezio/shell-ui@0.9.1
- @creezio/auth@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [a8bf57a]
  - @creezio/auth@0.9.0
  - @creezio/shell-ui@0.9.0
  - @creezio/platform-core@0.9.0
  - @creezio/api-kernel@0.9.0

## 0.8.1

### Patch Changes

- @creezio/platform-core@0.8.1
- @creezio/api-kernel@0.8.1
- @creezio/shell-ui@0.8.1
- @creezio/auth@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/auth@0.8.0
  - @creezio/shell-ui@0.8.0
  - @creezio/api-kernel@0.8.0
  - @creezio/platform-core@0.8.0

## 0.7.1

### Patch Changes

- @creezio/platform-core@0.7.1
- @creezio/api-kernel@0.7.1
- @creezio/shell-ui@0.7.1
- @creezio/auth@0.7.1

## 0.7.0

### Patch Changes

- @creezio/platform-core@0.7.0
- @creezio/api-kernel@0.7.0
- @creezio/shell-ui@0.7.0
- @creezio/auth@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [d948fcc]
  - @creezio/auth@0.6.0
  - @creezio/shell-ui@0.6.0
  - @creezio/platform-core@0.6.0
  - @creezio/api-kernel@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [8b4c876]
- Updated dependencies [0ff4ed2]
- Updated dependencies [d674c86]
  - @creezio/auth@0.5.0
  - @creezio/shell-ui@0.5.0
  - @creezio/platform-core@0.5.0
  - @creezio/api-kernel@0.5.0
