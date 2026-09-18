# Browser session transport errors (candidate)

The session client now checks content type and status before accepting a state. Plain-text/HTML gateway errors and malformed JSON produce a generic connection message with their HTTP status, rather than a JSON parser exception. HTTP 401 and 409 remain distinct; a successful response with no valid state is rejected.

After a transport error, **Retry connection** reconnects without forcing takeover. Only an explicit action from the confirmed inactive-window screen requests takeover. No business write or initial connection is retried automatically. The server lease rules are unchanged.

Validation includes response decoder fixtures, a React recovery test, and the existing server test covering two competing desktops, mobile controller, explicit takeover and non-replay of queued UI actions.

This does not fix the underlying workerd network-connection loss observed in a local application. It only handles that failure correctly. No schema migration or secret change is required.

## Adoption

This is an unversioned candidate based on 0.15.5, not a published release. The maintainer selects the next available patch release (0.15.6 if still available) after review; do not repoint an existing tag. For an authorized local evaluation pinned to this commit:

1. `node <kit>/bin/lite.mjs doctor --app <app>`
2. `node <kit>/bin/lite.mjs upgrade --app <app>`
3. Review the report, then `node <kit>/bin/lite.mjs upgrade --app <app> --apply`.
4. Run application checks and rebuild before serving it.

`adopt` distributes orchestration files only; it does not upgrade runtime. A local upgrade before release still reports 0.15.5; record the exact kit commit separately and do not treat that version string as proof of publication.
