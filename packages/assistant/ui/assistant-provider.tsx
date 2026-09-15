"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ASSISTANT_FAB_SAFE_PX } from "../dist/runtime/active-surface.js";
import { assistantIdentity } from "../dist/brand/registry.js";

/** Largeur du panneau docké (desktop) — utilisée pour décaler le shell CRM. */
export const ASSISTANT_PANEL_WIDTH_PX = 400;

/**
 * Empreinte approximative du FAB (tests géométrie / hit-box).
 * En desktop Electron le FAB est une vue topmost — pas un padding shell.
 */
export { ASSISTANT_FAB_SAFE_PX };

type StoredUi = {
  open?: boolean;
  activeConversationId?: string | null;
};

type AssistantUiContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  hydrated: boolean;
};

const AssistantUiContext = createContext<AssistantUiContextValue | null>(null);

function storageKey(): string {
  try {
    return assistantIdentity().uiStorageKey;
  } catch {
    return "creezio-assistant-ui";
  }
}

function readStored(): StoredUi {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return {};
    return JSON.parse(raw) as StoredUi;
  } catch {
    return {};
  }
}

function writeStored(partial: StoredUi) {
  if (typeof window === "undefined") return;
  try {
    const prev = readStored();
    localStorage.setItem(
      storageKey(),
      JSON.stringify({ ...prev, ...partial }),
    );
  } catch {
    /* ignore quota */
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [activeConversationId, setActiveIdState] = useState<string | null>(
    null,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setOpenState(Boolean(stored.open));
    setActiveIdState(stored.activeConversationId ?? null);
    setHydrated(true);
  }, []);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeStored({ open: next });
  }, []);

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      writeStored({ open: next });
      return next;
    });
  }, []);

  const setActiveConversationId = useCallback((id: string | null) => {
    setActiveIdState(id);
    writeStored({ activeConversationId: id });
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle,
      activeConversationId,
      setActiveConversationId,
      hydrated,
    }),
    [
      open,
      setOpen,
      toggle,
      activeConversationId,
      setActiveConversationId,
      hydrated,
    ],
  );

  return (
    <AssistantUiContext.Provider value={value}>
      {children}
    </AssistantUiContext.Provider>
  );
}

export function useAssistantUi(): AssistantUiContextValue {
  const ctx = useContext(AssistantUiContext);
  if (!ctx) {
    throw new Error("useAssistantUi must be used within AssistantProvider");
  }
  return ctx;
}

export function useAssistantUiOptional(): AssistantUiContextValue | null {
  return useContext(AssistantUiContext);
}
