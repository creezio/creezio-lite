/**
 * Configuration marque pour `@creezio/mails` (domaine public, UI, secrets inbound).
 * Zéro domaine hardcodé dans le package — injecté via configureMails.
 */

export type MailsConfig = {
  /**
   * Domaine racine public des instances (ex. `acme.example`, `acme.example`).
   * Dérive `{slug}.mail.{rootDomain}` depuis `{slug}.{rootDomain}`.
   */
  rootDomain: string;
  /**
   * Libellé page /mails (AppShell subtitle).
   * Défaut dérivé du rootDomain.
   */
  pageSubtitle?: string;
  /** Hint empty-state quand aucun EMAIL_DOMAIN / tunnel. */
  emptyStateNoDomainHint?: string;
  /**
   * UI boîte activée (Fidu peut mettre `false` — capacité native reste).
   * Défaut `true`.
   */
  uiEnabled?: boolean;
  /**
   * Noms d'env pour le secret inbound (premier non vide gagne).
   * Défaut : `EMAIL_INBOUND_SECRET` seul.
   */
  inboundSecretEnvKeys?: string[];
  /** Prefixe sous-domaine mail (défaut `mail` → `{slug}.mail.{root}`). */
  mailSubdomain?: string;
};

const DEFAULT: MailsConfig = {
  rootDomain: "",
  uiEnabled: true,
  inboundSecretEnvKeys: ["EMAIL_INBOUND_SECRET"],
  mailSubdomain: "mail",
};

let config: MailsConfig = { ...DEFAULT };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function configureMails(next: Partial<MailsConfig>): void {
  config = {
    ...config,
    ...next,
    inboundSecretEnvKeys: next.inboundSecretEnvKeys
      ? [...next.inboundSecretEnvKeys]
      : config.inboundSecretEnvKeys,
  };
}

export function getMailsConfig(): MailsConfig {
  return {
    ...config,
    inboundSecretEnvKeys: [...(config.inboundSecretEnvKeys || DEFAULT.inboundSecretEnvKeys!)],
  };
}

export function resetMailsConfigForTests(): void {
  config = { ...DEFAULT, inboundSecretEnvKeys: [...DEFAULT.inboundSecretEnvKeys!] };
}

/** Domaine mail public de l'instance (EMAIL_DOMAIN ou dérivé APP_PUBLIC_URL). */
export function resolveEmailDomain(cfg?: MailsConfig): string | null {
  const c = cfg || getMailsConfig();
  const fromEnv = (process.env.EMAIL_DOMAIN || "").trim().toLowerCase();
  if (fromEnv) return fromEnv;

  const root = (c.rootDomain || "").trim().toLowerCase().replace(/^\.+/, "");
  if (!root) return null;

  const publicUrl = (
    process.env.APP_PUBLIC_URL ||
    process.env.MCP_PUBLIC_URL ||
    ""
  ).trim();
  if (!publicUrl) return null;

  try {
    const host = new URL(publicUrl).hostname.toLowerCase();
    const re = new RegExp(
      `^([a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?)\\.${escapeRegex(root)}$`,
    );
    const m = host.match(re);
    if (!m) return null;
    const slug = m[1]!;
    const sub = (c.mailSubdomain || "mail").trim() || "mail";
    return `${slug}.${sub}.${root}`;
  } catch {
    return null;
  }
}

export function resolveInboundSecret(cfg?: MailsConfig): string {
  const c = cfg || getMailsConfig();
  const keys = c.inboundSecretEnvKeys?.length
    ? c.inboundSecretEnvKeys
    : DEFAULT.inboundSecretEnvKeys!;
  for (const key of keys) {
    const v = (process.env[key] || "").trim();
    if (v) return v;
  }
  return "";
}

export function resolvePageSubtitle(cfg?: MailsConfig): string {
  const c = cfg || getMailsConfig();
  if (c.pageSubtitle?.trim()) return c.pageSubtitle.trim();
  const root = (c.rootDomain || "").trim() || "example.com";
  const sub = (c.mailSubdomain || "mail").trim() || "mail";
  return `Boîte de réception locale — *@slug.${sub}.${root}`;
}

export function resolveEmptyStateNoDomainHint(cfg?: MailsConfig): string {
  const c = cfg || getMailsConfig();
  if (c.emptyStateNoDomainHint?.trim()) return c.emptyStateNoDomainHint.trim();
  const root = (c.rootDomain || "").trim() || "example.com";
  const sub = (c.mailSubdomain || "mail").trim() || "mail";
  return `Réservez un tunnel pour activer une adresse *@slug.${sub}.${root}.`;
}
