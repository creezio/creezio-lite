/**
 * Import dynamique type-erased pour les packages `@creezio/*` qui ne sont
 * PAS des dépendances de build de mcp-facade (`@creezio/auth`,
 * `@creezio/tasks` — façade utilisable standalone). Un `import("…")` littéral
 * ferait résoudre les types par tsc → TS2307 selon l'ordre topologique de
 * `scripts/build-workspaces.mjs` (tasks compile APRÈS mcp-facade). Résolution
 * au RUNTIME de l'app hôte, fail-closed chez les appelants — même pattern que
 * `@creezio/mails` (imapflow / nodemailer).
 */
type DynImport = (specifier: string) => Promise<unknown>;

export const dynImport = new Function(
  "specifier",
  "return import(specifier)",
) as DynImport;
