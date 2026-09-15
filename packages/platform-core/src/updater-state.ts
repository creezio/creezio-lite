/**
 * État auto-update — logique PURE (reduce), sans Electron.
 * Extrait de electron/updater.ts (kit).
 */

export type UpdateState =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

export type UpdateStatus = {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  updateAvailable: boolean;
};

export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | {
      type: "progress";
      percent: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string }
  | { type: "disabled"; reason?: string }
  | { type: "idle" };

export function initialUpdateStatus(version = "0.0.0"): UpdateStatus {
  return {
    state: "disabled",
    currentVersion: version,
    updateAvailable: false,
  };
}

/** Pure helper — testable sans Electron. */
export function reduceUpdateEvent(
  prev: UpdateStatus,
  event: UpdateEvent,
): UpdateStatus {
  switch (event.type) {
    case "checking":
      return {
        ...prev,
        state: "checking",
        error: undefined,
        percent: undefined,
      };
    case "available":
      return {
        ...prev,
        state: "available",
        availableVersion: event.version,
        updateAvailable: true,
        error: undefined,
        percent: undefined,
      };
    case "not-available":
      return {
        ...prev,
        state: "not-available",
        availableVersion: undefined,
        updateAvailable: false,
        error: undefined,
        percent: undefined,
      };
    case "progress":
      return {
        ...prev,
        state: "downloading",
        percent: event.percent,
        bytesPerSecond: event.bytesPerSecond,
        transferred: event.transferred,
        total: event.total,
        error: undefined,
      };
    case "downloaded":
      return {
        ...prev,
        state: "ready",
        availableVersion: event.version,
        updateAvailable: true,
        percent: 100,
        error: undefined,
      };
    case "error":
      return {
        ...prev,
        state: "error",
        error: event.message,
      };
    case "disabled":
      return {
        ...prev,
        state: "disabled",
        error: event.reason,
        updateAvailable: false,
      };
    case "idle":
      return {
        ...prev,
        state: "idle",
        error: undefined,
      };
    default:
      return prev;
  }
}
