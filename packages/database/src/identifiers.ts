/** Identifiants SQLite sûrs (tables / colonnes). */

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENT.test(value) && !value.startsWith("sqlite_");
}

export function quoteIdent(value: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Identifiant SQLite invalide : ${value}`);
  }
  return `"${value}"`;
}

export function isSystemTable(name: string): boolean {
  return (
    name.startsWith("sqlite_") ||
    name.startsWith("db_automation") ||
    name === "db_saved_views" ||
    name === "db_access_log"
  );
}
