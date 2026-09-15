/**
 * Entrée légère client-safe — primitives + helpers desktop (pas de workspace/assistant).
 * À préférer dans les packages kit UI (@creezio/mails, tasks, cockpit, auth…).
 */
export * from "./primitives/button";
export * from "./primitives/badge";
export * from "./primitives/input";
export * from "./primitives/card";
export * from "./primitives/tabs";
export * from "./primitives/label";
export * from "./primitives/separator";
export * from "./primitives/skeleton";
export * from "./primitives/dialog";
export * from "./primitives/sheet";
export * from "./primitives/select";
export * from "./primitives/dropdown-menu";
export * from "./primitives/scroll-area";
export * from "./primitives/avatar";
export * from "./primitives/breadcrumb";
export * from "./primitives/command";
export * from "./primitives/sonner";
export * from "./primitives/chart";
export * from "./primitives/resizable";
export * from "./primitives/tooltip";
export * from "./primitives/textarea";

export { isRemoteDesktopClient } from "./lib/desktop-host";
export { useShellUiBrand } from "./lib/use-shell-ui-brand";
export type { ShellUiBrand, ShellUiLoginBrand } from "../dist/brand.js";
export { openAiWorkspaceView, aiWorkspaceAvailable } from "./lib/ai-workspace-client";
