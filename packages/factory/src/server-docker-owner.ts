import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

/**
 * Politique owner first-run de `server-docker create` — fail-closed VPS / prod.
 *
 * Un create « prod / VPS » ne réussit pas sans compte owner utilisable
 * (`POST /api/v1/os/setup` + login kit). Contrat unique cloud + VPS :
 *   CREEZIO_OWNER_EMAIL
 *   CREEZIO_OWNER_PASSWORD
 * `CREEZIO_TUNNEL_LOCAL=1` (dev machine) : owner optionnel.
 * Jamais le mot de passe dans les logs ni les messages d'erreur.
 */

export const CREATE_OWNER_ENV_KEYS = [
  "CREEZIO_OWNER_EMAIL",
  "CREEZIO_OWNER_PASSWORD",
] as const;

/** Compte recette / smoke optionnel — jamais requis par le fail-closed create. */
export const E2E_OWNER_ENV_KEYS = [
  "CREEZIO_E2E_EMAIL",
  "CREEZIO_E2E_PASSWORD",
] as const;

export type CreateOwnerPolicyInput = {
  /** Aligné sur la politique tunnel : `true` seulement si create LOCAL (pas `--profile prod`). */
  local: boolean;
  /** Env fusionné (process + .env marque + `--env`) — jamais de secrets en log. */
  env: Record<string, string | undefined>;
};

export type CreateOwnerPolicy =
  | { mode: "skip"; reason: "local-optional" }
  | { mode: "create"; email: string; password: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function formatMissingOwnerError(): string {
  return [
    "create VPS/prod refuse une instance sans compte owner utilisable : CREEZIO_OWNER_EMAIL et CREEZIO_OWNER_PASSWORD sont requis.",
    "",
    "Poser les vars dans le .env de la marque (gitignoré), les exporter avant create,",
    "ou les injecter en Runtime Secrets cloud (mêmes noms — pas E2E_OWNER_*).",
    "Le create appelle POST /api/v1/os/setup puis vérifie POST /api/v1/auth/login.",
    "",
    "Dev local (owner optionnel) : CREEZIO_TUNNEL_LOCAL=1",
  ].join("\n");
}

export function formatInvalidOwnerError(kind: "email" | "password" | "partial"): string {
  if (kind === "partial") {
    return "CREEZIO_OWNER_EMAIL et CREEZIO_OWNER_PASSWORD doivent être posés ensemble (un seul des deux est une erreur).";
  }
  if (kind === "email") {
    return "CREEZIO_OWNER_EMAIL invalide — attendu un e-mail (ex. owner@acme.example).";
  }
  return "CREEZIO_OWNER_PASSWORD trop court (min. 6 caractères, même règle que le setup kit).";
}

function readOwnerCreds(env: Record<string, string | undefined>): {
  email: string;
  password: string;
} {
  return {
    email: String(env.CREEZIO_OWNER_EMAIL || "").trim(),
    password: String(env.CREEZIO_OWNER_PASSWORD || "").trim(),
  };
}

/**
 * Décide skip vs create. Défaut VPS/prod = create obligatoire (fail-closed).
 * LOCAL=1 : skip si les deux vars manquent ; partiel / invalide = échec.
 */
export function resolveCreateOwnerPolicy(
  input: CreateOwnerPolicyInput,
): CreateOwnerPolicy {
  const { email, password } = readOwnerCreds(input.env);
  if (!email && !password) {
    if (input.local) return { mode: "skip", reason: "local-optional" };
    throw new Error(formatMissingOwnerError());
  }
  if (!email || !password) {
    throw new Error(formatInvalidOwnerError("partial"));
  }
  if (!EMAIL_RE.test(email)) {
    throw new Error(formatInvalidOwnerError("email"));
  }
  if (password.length < 6) {
    throw new Error(formatInvalidOwnerError("password"));
  }
  return { mode: "create", email, password };
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

export function formatOwnerLoginLog(email: string): string {
  return `login : ${email}`;
}

export async function applyFirstRunOwner(opts: {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; username: string }> {
  const fetchFn = opts.fetchImpl || fetch;
  const base = String(opts.baseUrl || "").replace(/\/+$/, "");
  const email = opts.email;
  const password = opts.password;
  const wrap = (err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    return new Error(redactSecret(raw, password));
  };

  let statusJson: { setupComplete?: boolean; username?: string | null };
  try {
    const statusRes = await fetchFn(`${base}/api/v1/os/setup`);
    statusJson = (await statusRes.json()) as typeof statusJson;
  } catch (err) {
    throw wrap(err);
  }

  if (statusJson?.setupComplete) {
    const existing = String(statusJson.username || "").trim();
    if (existing && existing !== email) {
      throw new Error(
        `setup déjà complet pour ${existing} — CREEZIO_OWNER_EMAIL=${email} ne correspond pas (pas d'écrasement).`,
      );
    }
    return { ok: true, username: existing || email };
  }

  let setupJson: { ok?: boolean; error?: string; username?: string };
  try {
    const setupRes = await fetchFn(`${base}/api/v1/os/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: email, password }),
    });
    setupJson = (await setupRes.json()) as typeof setupJson;
    if (setupRes.status !== 200 || !setupJson?.ok) {
      throw new Error(
        `POST /api/v1/os/setup → ${setupRes.status} ${String(setupJson?.error || "échec first-run")}`,
      );
    }
  } catch (err) {
    throw wrap(err);
  }

  try {
    const loginRes = await fetchFn(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (loginRes.status !== 200) {
      const body = await loginRes.text().catch(() => "");
      throw new Error(
        `owner créé mais POST /api/v1/auth/login → ${loginRes.status} ${body.slice(0, 160)}`,
      );
    }
  } catch (err) {
    throw wrap(err);
  }

  return { ok: true, username: String(setupJson.username || email) };
}

function cookiesFromResponse(res: {
  headers?: { getSetCookie?: () => string[]; get?: (name: string) => string | null };
}): string {
  const headers = res.headers;
  if (!headers) return "";
  const list =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get?.("set-cookie")].filter(Boolean);
  return list
    .map((c) => String(c).split(";")[0]?.trim() || "")
    .filter(Boolean)
    .join("; ");
}

export function formatMissingDemoError(detail: string): string {
  return [
    "create refuse une instance sans démo interactive jouable.",
    detail,
    "La factory câble createInteractiveDemoMount + interactiveDemoMigrations ;",
    "chaque module doit exposer ≥ 1 scénario (genericOsTourScenario inclus).",
    "Une app Creezio sans démo interactive est invalide.",
    "CREATE LOCAL sans owner (CREEZIO_TUNNEL_LOCAL=1) : ce contrôle runtime est sauté —",
    "la gate factory (test-phase-create-brand) reste le filet dur.",
  ].join("\n");
}

/**
 * Après setup owner : GET /api/v1/modules/interactive-demo/scenarios ≥ 1.
 * Session requise (garde /api/v1/modules/*) — relogin avec les creds owner.
 * Sauté si owner policy = skip (dev local sans first-run).
 */
export async function assertInteractiveDemoScenarios(opts: {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; count: number }> {
  const fetchFn = opts.fetchImpl || fetch;
  const base = String(opts.baseUrl || "").replace(/\/+$/, "");
  const email = opts.email;
  const password = opts.password;
  const wrap = (err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    return new Error(redactSecret(raw, password));
  };

  let cookie = "";
  try {
    const loginRes = await fetchFn(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (loginRes.status !== 200) {
      const body = await loginRes.text().catch(() => "");
      throw new Error(
        formatMissingDemoError(
          `login owner pour lire les scénarios → ${loginRes.status} ${body.slice(0, 120)}`,
        ),
      );
    }
    cookie = cookiesFromResponse(loginRes);
  } catch (err) {
    throw wrap(err);
  }

  const url = `${base}/api/v1/modules/interactive-demo/scenarios`;
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await fetchFn(url, {
      headers: cookie ? { cookie } : {},
    });
  } catch (err) {
    throw wrap(
      new Error(
        formatMissingDemoError(`GET ${url} impossible (${err instanceof Error ? err.message : String(err)})`),
      ),
    );
  }

  if (res.status === 404) {
    throw new Error(
      formatMissingDemoError(`GET ${url} → 404 (mount createInteractiveDemoMount absent).`),
    );
  }
  if (res.status === 401) {
    throw new Error(
      formatMissingDemoError(
        `GET ${url} → 401 (session owner requise — cookie login absent ou rejeté).`,
      ),
    );
  }
  if (res.status !== 200) {
    throw new Error(formatMissingDemoError(`GET ${url} → ${res.status}.`));
  }

  let json: { scenarios?: unknown };
  try {
    json = (await res.json()) as { scenarios?: unknown };
  } catch (err) {
    throw wrap(err);
  }
  const scenarios = json?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length < 1) {
    throw new Error(
      formatMissingDemoError(`GET ${url} : 0 scénario (attendu ≥ 1).`),
    );
  }
  return { ok: true, count: scenarios.length };
}

export function defaultE2eEmail(instanceName: string, brandId: string): string {
  const hint = String(brandId || "creezio").replace(/\d+$/, "") || "creezio";
  return `owner@${instanceName}.${hint}.local`;
}

/** Mot de passe fort (≥ 6) — jamais loggé. */
export function generateOwnerPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function readPair(
  env: Record<string, string | undefined>,
  emailKey: string,
  passwordKey: string,
): { email: string; password: string } {
  return {
    email: String(env[emailKey] || "").trim(),
    password: String(env[passwordKey] || "").trim(),
  };
}

/**
 * Creds pour `ensure-owner` : owner et/ou e2e.
 * Partiel (un seul des deux d'une paire) = erreur. Les deux paires absentes = vide.
 */
export function resolveEnsureOwnerCreds(env: Record<string, string | undefined>): {
  owner: { email: string; password: string } | null;
  e2e: { email: string; password: string } | null;
} {
  const owner = readPair(env, "CREEZIO_OWNER_EMAIL", "CREEZIO_OWNER_PASSWORD");
  const e2e = readPair(env, "CREEZIO_E2E_EMAIL", "CREEZIO_E2E_PASSWORD");
  if (Boolean(owner.email) !== Boolean(owner.password)) {
    throw new Error(formatInvalidOwnerError("partial"));
  }
  if (Boolean(e2e.email) !== Boolean(e2e.password)) {
    throw new Error(
      "CREEZIO_E2E_EMAIL et CREEZIO_E2E_PASSWORD doivent être posés ensemble (un seul des deux est une erreur).",
    );
  }
  if (e2e.email && !EMAIL_RE.test(e2e.email)) {
    throw new Error("CREEZIO_E2E_EMAIL invalide — attendu un e-mail (ex. owner@resto.example.local).");
  }
  if (e2e.password && e2e.password.length < 6) {
    throw new Error("CREEZIO_E2E_PASSWORD trop court (min. 6 caractères).");
  }
  if (owner.email && owner.password) {
    if (owner.password.length < 6) {
      throw new Error(formatInvalidOwnerError("password"));
    }
  }
  return {
    owner: owner.email && owner.password ? owner : null,
    e2e: e2e.email && e2e.password ? e2e : null,
  };
}

export async function fetchSetupStatus(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ setupComplete: boolean; username: string }> {
  const fetchFn = opts.fetchImpl || fetch;
  const base = String(opts.baseUrl || "").replace(/\/+$/, "");
  const statusRes = await fetchFn(`${base}/api/v1/os/setup`);
  const statusJson = (await statusRes.json()) as {
    setupComplete?: boolean;
    username?: string | null;
  };
  return {
    setupComplete: Boolean(statusJson?.setupComplete),
    username: String(statusJson?.username || "").trim(),
  };
}

export async function verifyOwnerLogin(opts: {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchFn = opts.fetchImpl || fetch;
  const base = String(opts.baseUrl || "").replace(/\/+$/, "");
  const loginRes = await fetchFn(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  return loginRes.status === 200;
}

/**
 * Rattrapage instance déjà setup : crée / met à jour le hash kit dans le
 * container (même geste que fleet-ops §2 étape b). Password passé en env
 * du `docker exec` (pas sur la ligne de commande, pas en log).
 */
export function seedKitUserViaContainer(opts: {
  containerName: string;
  email: string;
  password: string;
}): { ok: true; action: string; email: string } {
  const email = String(opts.email || "").trim();
  const password = String(opts.password || "");
  if (!email || password.length < 6) {
    throw new Error("seed kit : e-mail + mot de passe (≥6) requis.");
  }
  const script = [
    "import { migrateBrandCredentialsToKit } from '@creezio/auth';",
    "import { DatabaseSync } from 'node:sqlite';",
    "import crypto from 'node:crypto';",
    "const email = process.env.CREEZIO_SEED_EMAIL || '';",
    "const password = process.env.CREEZIO_SEED_PASSWORD || '';",
    "const r = await migrateBrandCredentialsToKit({",
    "  username: email, password, displayName: email,",
    "});",
    "if (!r.ok) {",
    "  console.log(JSON.stringify({ ok: false, action: '', email, error: r.error || '' }));",
    "} else {",
    "  const db = new DatabaseSync('/data/sqlite/core.db');",
    "  db.exec(`CREATE TABLE IF NOT EXISTS creezio_platform_users (",
    "    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,",
    "    role TEXT NOT NULL DEFAULT 'collaborator',",
    "    kind TEXT NOT NULL DEFAULT 'human',",
    "    active INTEGER NOT NULL DEFAULT 1,",
    "    permissions TEXT NOT NULL DEFAULT '[]',",
    "    created_at TEXT NOT NULL DEFAULT (datetime('now')),",
    "    updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);",
    "  const row = db.prepare('SELECT id FROM creezio_platform_users WHERE username = ?').get(email);",
    "  if (!row) {",
    "    const sample = db.prepare(",
    "      \"SELECT permissions FROM creezio_platform_users WHERE kind = 'human' AND active = 1 LIMIT 1\"",
    "    ).get();",
    "    const perms = sample && sample.permissions ? sample.permissions : '[]';",
    "    db.prepare(",
    "      \"INSERT INTO creezio_platform_users (id, username, role, kind, active, permissions) VALUES (?, ?, 'collaborator', 'human', 1, ?)\"",
    "    ).run('human-' + crypto.randomUUID().slice(0, 8), email, perms);",
    "  }",
    "  console.log(JSON.stringify({ ok: true, action: r.action || '', email: r.email || email, error: '' }));",
    "}",
  ].join("");
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-w",
      "/app",
      "-e",
      "CREEZIO_CORE_DB_PATH=/data/sqlite/core.db",
      "-e",
      `CREEZIO_SEED_EMAIL=${email}`,
      "-e",
      `CREEZIO_SEED_PASSWORD=${password}`,
      opts.containerName,
      "node",
      "--input-type=module",
      "-e",
      script,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    const err = redactSecret(
      String(r.stderr || r.stdout || `docker exec exit ${r.status}`).slice(0, 240),
      password,
    );
    throw new Error(`seed kit via container : ${err}`);
  }
  let parsed: { ok?: boolean; action?: string; email?: string; error?: string };
  try {
    parsed = JSON.parse(String(r.stdout || "").trim()) as typeof parsed;
  } catch {
    throw new Error("seed kit via container : réponse illisible (pas de secret en log).");
  }
  if (!parsed?.ok) {
    throw new Error(
      redactSecret(`seed kit via container : ${parsed?.error || "échec"}`, password),
    );
  }
  return {
    ok: true,
    action: String(parsed.action || "updated"),
    email: String(parsed.email || email),
  };
}

/* ------------------------------------------ access : bootstrap sans UI */

export type AccessCliResult = {
  ok: true;
  userId: string;
  email: string;
  role: string | null;
  overrides: Array<{ permission: string; effect: "allow" | "deny" }>;
};

const ACCESS_PERMISSION_RE = /^[a-z0-9._-]+$/i;

/**
 * Geste `server-docker access` — attribution de permissions de modules à un
 * compte SANS UI ni login owner (bootstrap, cohérent `ensure-owner`) :
 * `docker exec` + écriture directe `core.db` (tables access_* de
 * @creezio/access-control, DDL idempotent identique au store kit) + ligne
 * d'audit `actor=server-docker-cli`. Le serveur voit le changement au plus
 * tard après le cache 30 s de resolvePermissions (pas de restart requis).
 */
export function applyAccessOverridesViaContainer(opts: {
  containerName: string;
  email: string;
  grant?: string[];
  revoke?: string[];
  reset?: boolean;
  /** Rôle access-control à poser (`none` = revenir au rôle plateforme). */
  role?: string;
}): AccessCliResult {
  const email = String(opts.email || "").trim();
  if (!email) throw new Error("access : --user <email> requis.");
  const grant = (opts.grant ?? []).map((p) => p.trim()).filter(Boolean);
  const revoke = (opts.revoke ?? []).map((p) => p.trim()).filter(Boolean);
  for (const p of [...grant, ...revoke]) {
    if (!ACCESS_PERMISSION_RE.test(p)) {
      throw new Error(`access : permission invalide « ${p} » (attendu ex. nav.billing).`);
    }
  }
  const payload = JSON.stringify({
    email,
    grant,
    revoke,
    reset: Boolean(opts.reset),
    role: opts.role ?? null,
  });
  const script = [
    "import { DatabaseSync } from 'node:sqlite';",
    "const req = JSON.parse(process.env.CREEZIO_ACCESS_REQUEST || '{}');",
    "const db = new DatabaseSync('/data/sqlite/core.db');",
    // DDL idempotent — même schéma que ACCESS_CONTROL_CORE_SQL (@creezio/access-control).
    "db.exec(`CREATE TABLE IF NOT EXISTS access_user_overrides (",
    "  user_id TEXT NOT NULL, permission TEXT NOT NULL,",
    "  effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),",
    "  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),",
    "  PRIMARY KEY (user_id, permission));`);",
    "db.exec(`CREATE TABLE IF NOT EXISTS access_user_roles (",
    "  user_id TEXT PRIMARY KEY, role TEXT NOT NULL,",
    "  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);",
    "db.exec(`CREATE TABLE IF NOT EXISTS access_audit_log (",
    "  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL,",
    "  action TEXT NOT NULL, role TEXT, permission TEXT, effect TEXT,",
    "  target_user_id TEXT, detail_json TEXT,",
    "  created_at TEXT NOT NULL DEFAULT (datetime('now')));`);",
    "const user = db.prepare(",
    "  \"SELECT id, username, role FROM creezio_platform_users WHERE username = ? AND active = 1\"",
    ").get(req.email);",
    "if (!user) {",
    "  console.log(JSON.stringify({ ok: false, error: 'compte introuvable ou inactif : ' + req.email }));",
    "} else {",
    "  const audit = db.prepare(",
    "    \"INSERT INTO access_audit_log (actor, action, role, permission, effect, target_user_id) VALUES ('server-docker-cli', ?, ?, ?, ?, ?)\"",
    "  );",
    "  if (req.reset) {",
    "    db.prepare('DELETE FROM access_user_overrides WHERE user_id = ?').run(user.id);",
    "    audit.run('user.override.clear', null, null, null, user.id);",
    "  }",
    "  const put = db.prepare(",
    "    \"INSERT INTO access_user_overrides (user_id, permission, effect, updated_by) VALUES (?, ?, ?, 'server-docker-cli') \" +",
    "    \"ON CONFLICT(user_id, permission) DO UPDATE SET effect = excluded.effect, updated_by = excluded.updated_by, updated_at = datetime('now')\"",
    "  );",
    "  for (const p of req.grant) { put.run(user.id, p, 'allow'); audit.run('user.override.set', null, p, 'allow', user.id); }",
    "  for (const p of req.revoke) { put.run(user.id, p, 'deny'); audit.run('user.override.set', null, p, 'deny', user.id); }",
    "  if (req.role === 'none') {",
    "    db.prepare('DELETE FROM access_user_roles WHERE user_id = ?').run(user.id);",
    "    audit.run('user.role', null, null, null, user.id);",
    "  } else if (req.role) {",
    "    db.prepare(",
    "      \"INSERT INTO access_user_roles (user_id, role, updated_by) VALUES (?, ?, 'server-docker-cli') \" +",
    "      \"ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, updated_by = excluded.updated_by, updated_at = datetime('now')\"",
    "    ).run(user.id, req.role);",
    "    audit.run('user.role', req.role, null, null, user.id);",
    "  }",
    "  const roleRow = db.prepare('SELECT role FROM access_user_roles WHERE user_id = ?').get(user.id);",
    "  const overrides = db.prepare(",
    "    'SELECT permission, effect FROM access_user_overrides WHERE user_id = ? ORDER BY permission'",
    "  ).all(user.id);",
    "  console.log(JSON.stringify({ ok: true, userId: user.id, email: user.username, role: roleRow ? roleRow.role : null, overrides }));",
    "}",
  ].join("");
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-w",
      "/app",
      "-e",
      `CREEZIO_ACCESS_REQUEST=${payload}`,
      opts.containerName,
      "node",
      "--input-type=module",
      "-e",
      script,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(
      `access via container : ${String(r.stderr || r.stdout || `docker exec exit ${r.status}`).slice(0, 240)}`,
    );
  }
  let parsed: {
    ok?: boolean;
    error?: string;
    userId?: string;
    email?: string;
    role?: string | null;
    overrides?: Array<{ permission: string; effect: "allow" | "deny" }>;
  };
  try {
    parsed = JSON.parse(String(r.stdout || "").trim()) as typeof parsed;
  } catch {
    throw new Error("access via container : réponse illisible.");
  }
  if (!parsed?.ok) {
    throw new Error(`access via container : ${parsed?.error || "échec"}`);
  }
  return {
    ok: true,
    userId: String(parsed.userId || ""),
    email: String(parsed.email || email),
    role: parsed.role ?? null,
    overrides: parsed.overrides ?? [],
  };
}
