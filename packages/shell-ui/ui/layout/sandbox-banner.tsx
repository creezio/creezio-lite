/**
 * Bandeau permanent en environnement sandbox (clone restaurant).
 * Activé via APP_ENV=sandbox — jamais en prod / client.
 *
 * Lecture dynamique de process.env pour éviter l'inlining Next au build.
 */
function runtimeEnv(name: string): string {
  return String((process.env as Record<string, string | undefined>)[name] ?? "").trim();
}

export function SandboxBanner() {
  const env = runtimeEnv("APP_ENV").toLowerCase();
  if (env !== "sandbox") return null;

  const tenant = runtimeEnv("SANDBOX_TENANT") || "sandbox";
  const url = runtimeEnv("SANDBOX_PUBLIC_URL");

  return (
    <div
      role="status"
      className="relative z-[60] flex items-center justify-center gap-3 bg-amber-500 px-3 py-1.5 text-center text-[12px] font-semibold tracking-wide text-amber-950"
    >
      <span className="rounded bg-amber-950/15 px-1.5 py-0.5 font-mono text-[10px] uppercase">
        Sandbox
      </span>
      <span>
        Environnement de test « {tenant} » — les changements ici ne touchent pas
        l&apos;instance client
        {url ? (
          <>
            {" "}
            · <span className="font-mono font-normal">{url.replace(/^https?:\/\//, "")}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
