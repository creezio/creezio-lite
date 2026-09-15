"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  subscribeDataChanged,
  type CreezioDataChangedDetail,
} from "@creezio/shell-ui";
import { usePaneActive } from "../workspace/keep-alive";

export type UseCreezioResourceOptions = {
  /**
   * Appelé à chaque mutation de la resource (pane active ou non).
   * Utile pour rafraîchir un store client (badge, provider…).
   */
  onChange?: (detail: CreezioDataChangedDetail) => void;
  /**
   * Si true (défaut), `router.refresh()` quand la pane est active et qu'une
   * mutation arrive — couvre les pages RSC keep-alive (Next 14 ne refetch
   * jamais à la réactivation d'onglet seule).
   */
  refreshOnChange?: boolean;
  /**
   * Si true (défaut), au moment où la pane redevient active, refresh s'il y a
   * eu des mutations pendant l'absence (compteur module-scope).
   */
  refreshOnActivate?: boolean;
};

const seqByResource = new Map<string, number>();
const seenByResource = new Map<string, number>();

function bump(resource: string): void {
  seqByResource.set(resource, (seqByResource.get(resource) || 0) + 1);
}

function consume(resource: string): boolean {
  const seq = seqByResource.get(resource) || 0;
  const seen = seenByResource.get(resource) || 0;
  if (seen === seq) return false;
  seenByResource.set(resource, seq);
  return true;
}

/**
 * Déclare qu'une page / composant dépend d'une resource métier.
 * Toute mutation émise via `emitDataChanged` (API header, MCP/chat, UI)
 * rafraîchit l'UI si la pane est ouverte — pattern app moderne, pas panier-only.
 */
export function useCreezioResource(
  resource: string,
  opts?: UseCreezioResourceOptions,
): void {
  const router = useRouter();
  const active = usePaneActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const onChangeRef = useRef(opts?.onChange);
  onChangeRef.current = opts?.onChange;
  const refreshOnChange = opts?.refreshOnChange !== false;
  const refreshOnActivate = opts?.refreshOnActivate !== false;
  const res = String(resource || "").trim();

  useEffect(() => {
    if (!res) return;
    if (refreshOnActivate && active && consume(res)) {
      router.refresh();
    }
  }, [active, res, refreshOnActivate, router]);

  useEffect(() => {
    if (!res) return;
    return subscribeDataChanged(
      (detail) => {
        bump(detail.resource);
        onChangeRef.current?.(detail);
        if (refreshOnChange && activeRef.current && consume(detail.resource)) {
          router.refresh();
        }
      },
      { resource: res },
    );
  }, [res, refreshOnChange, router]);
}

/** Version multi-resources (ex. page agrégée). */
export function useCreezioResources(
  resources: string[],
  opts?: UseCreezioResourceOptions,
): void {
  const list = resources.map((r) => r.trim()).filter(Boolean);
  const router = useRouter();
  const active = usePaneActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const onChangeRef = useRef(opts?.onChange);
  onChangeRef.current = opts?.onChange;
  const refreshOnChange = opts?.refreshOnChange !== false;
  const refreshOnActivate = opts?.refreshOnActivate !== false;
  const key = list.slice().sort().join(",");

  useEffect(() => {
    if (!list.length) return;
    if (refreshOnActivate && active) {
      let dirty = false;
      for (const r of list) if (consume(r)) dirty = true;
      if (dirty) router.refresh();
    }
  }, [active, key, refreshOnActivate, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!list.length) return;
    return subscribeDataChanged((detail) => {
      bump(detail.resource);
      onChangeRef.current?.(detail);
      if (refreshOnChange && activeRef.current && consume(detail.resource)) {
        router.refresh();
      }
    }, { resource: list });
  }, [key, refreshOnChange, router]); // eslint-disable-line react-hooks/exhaustive-deps
}
