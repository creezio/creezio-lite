/** Types bridge desktop (SoT @creezio/shell) — re-export UI pour cutover O9p. */
export type {
  DesktopContentRect,
  DesktopTabLoadState,
  DesktopTabInfo,
} from "@creezio/shell";

/** Types update desktop plateforme (O9) — extrait gold TF. */

export type DesktopUpdateState =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

export type DesktopUpdateStatus = {
  state: DesktopUpdateState | string;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  updateAvailable: boolean;
};
