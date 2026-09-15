"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { normalizeHref } from "../workspace/types";

/** Clé stable pour la toolbar : pathname seul (les vues `?view=` partagent les actions). */
export function toolbarKey(href: string): string {
  return normalizeHref(href).split("?")[0] || "/";
}

type RegisterFn = (href: string, actions: ReactNode | null) => void;

const RegisterContext = createContext<RegisterFn | null>(null);
const ToolbarVersionContext = createContext(0);

/** Ref module — lecture synchrone dans usePageToolbarActions sans recréer le contexte. */
const entriesRef = { current: new Map<string, ReactNode | null>() };

export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [version, bump] = useState(0);

  const register = useCallback<RegisterFn>((href, actions) => {
    const key = toolbarKey(href);
    const prev = entriesRef.current.get(key);
    if (actions == null) {
      if (!entriesRef.current.has(key)) return;
      entriesRef.current.delete(key);
    } else if (prev === actions) {
      return;
    } else {
      entriesRef.current.set(key, actions);
    }
    bump((n) => n + 1);
  }, []);

  return (
    <RegisterContext.Provider value={register}>
      <ToolbarVersionContext.Provider value={version}>
        {children}
      </ToolbarVersionContext.Provider>
    </RegisterContext.Provider>
  );
}

function useToolbarRegister(): RegisterFn | null {
  return useContext(RegisterContext);
}

/** Publie les actions de page vers le bandeau sticky (clé = pathname de la pane). */
export function useRegisterPageToolbar(
  href: string | null,
  actions?: ReactNode,
) {
  const register = useToolbarRegister();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useLayoutEffect(() => {
    if (!register || !href) return;
    register(href, actionsRef.current ?? null);
  });

  useEffect(() => {
    if (!register || !href) return;
    return () => register(href, null);
  }, [register, href]);
}

export function usePageToolbarActions(href: string): ReactNode | null {
  const version = useContext(ToolbarVersionContext);
  void version;
  return entriesRef.current.get(toolbarKey(href)) ?? null;
}
