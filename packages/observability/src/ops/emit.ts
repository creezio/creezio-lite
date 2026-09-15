/**
 * Émission d'événements ops depuis un SOUS-PROCESS Node vanilla
 * (meili-indexer, migrations…) : ligne ops JSONL sur stdout.
 */

import { TF2EVENT_PREFIX, type OpsEventInput } from "./types.js";

export function emitOpsEvent(evt: OpsEventInput): void {
  try {
    console.log(`${TF2EVENT_PREFIX}${JSON.stringify(evt)}`);
  } catch {
    /* best-effort : jamais de throw depuis l'instrumentation */
  }
}
