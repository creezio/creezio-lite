"use client";

/**
 * Brand shell-ui réactive — LiteUiBoot applique la marque en useEffect
 * (après le 1er render) : lire la brand via ce hook (useSyncExternalStore)
 * plutôt que getShellUiBrand() direct pour re-render à la configuration.
 */

import { useSyncExternalStore } from "react";
import {
  getShellUiBrand,
  subscribeShellUiBrand,
  type ShellUiBrand,
} from "../../src/brand.js";

export function useShellUiBrand(): ShellUiBrand {
  return useSyncExternalStore(
    subscribeShellUiBrand,
    getShellUiBrand,
    getShellUiBrand,
  );
}
