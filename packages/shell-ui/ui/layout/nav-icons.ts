"use client";

/**
 * Résolution nom lucide → composant. Allowlist kit (ceux déjà utilisés
 * par la sidebar OS + Bot / NotebookPen). Inconnu → `Circle` + warning,
 * jamais de throw UI.
 */
import {
  Activity,
  Bot,
  Braces,
  Cable,
  Circle,
  Database,
  FileText,
  KeyRound,
  LayoutDashboard,
  List,
  ListTodo,
  Mail,
  NotebookPen,
  Package,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { isKnownNavIcon } from "../../dist/nav-catalog.js";

const NAV_ICONS: Record<string, LucideIcon> = {
  Activity,
  Bot,
  Braces,
  Cable,
  Circle,
  Database,
  FileText,
  KeyRound,
  LayoutDashboard,
  List,
  ListTodo,
  Mail,
  NotebookPen,
  Package,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  Workflow,
};

export function resolveNavIcon(name: string): LucideIcon {
  const icon = NAV_ICONS[name];
  if (icon && isKnownNavIcon(name)) return icon;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[shell-ui] resolveNavIcon: icône inconnue "${name}", fallback Circle`,
    );
  }
  return Circle;
}
