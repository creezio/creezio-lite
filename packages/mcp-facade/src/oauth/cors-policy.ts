import { resolveMcpPublicUrl } from "./store.js";

const SAFE_DEFAULTS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
];

export function mcpCorsAllowlist(): string[] {
  const configured = (process.env.MCP_CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const publicUrl = resolveMcpPublicUrl();
  return Array.from(
    new Set([
      ...(configured.length ? configured : SAFE_DEFAULTS),
      ...(publicUrl ? [publicUrl] : []),
    ]),
  );
}

export function resolveMcpCorsOrigin(origin: string): string {
  // Requêtes serveur-à-serveur et loopback sans Origin.
  if (!origin) return "*";
  const normalized = origin.replace(/\/+$/, "");
  return mcpCorsAllowlist().includes(normalized) ? origin : "";
}
