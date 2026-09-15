# Feature-parity demobrand — gel kit H6 (Phase I8)

Checklist preuve kit avant ouverture conso marques (I9+).

| Capacité | Preuve | Statut |
|----------|--------|--------|
| `ARCHITECTURE_VERSION = H6` | platform-core | ✅ I8 |
| Sync vendor assert H6 + packages I3 | `scripts/sync-creezio-vendor.sh` | ✅ |
| Auth sqlite core | demobrand `sandbox.auth` + test-i1 | ✅ I1 |
| Assistant sqlite core | `sandbox.assistant` + test-i2 | ✅ I2 |
| Tasks/mails sqlite + file-sink | mounts + test-i3 | ✅ I3 |
| Control-plane ACL from store | `controlPlaneAcl()` + test-i4 | ✅ I4 |
| Admin Plugins L3 UI/API | `admin-plugins` + test-i5 | ✅ I5 |
| Registre org persisté | file registry + console | ✅ I6 |
| Shell-UI adapter | `createNavShellAdapter` + test-i7 | ✅ I7 |
| Factory new-app shell-ui adapter | scaffold main | ✅ I8 |
| ACL H5 see/install/execute | test-phase-h5 | ✅ |
| MCP proxy H4 | test-phase-h4 | ✅ |
| SqliteRuntime multi-DB | test-phase-h2 | ✅ |

**Gate go/no-go marques** : cette checklist ✅ → TempoFlow I9.
