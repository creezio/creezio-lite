// @ts-nocheck — Electron shell.openExternal (shim kit mince)
/**
 * OAuth 2.0 RFC 8252 (native apps) Google — gold kit paramétré.
 * Store tokens injecté ; Electron via loadElectron (pas d'import top-level).
 */

import http from "node:http";
import crypto from "node:crypto";
import { loadElectron } from "@creezio/host-runtime";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_SCOPES = ["openid", "email", "profile"];

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  token_type: string;
  obtained_at: string;
};

export type GoogleOAuthTokenStore = {
  setGoogleTokens: (rawJson: string) => void;
  getGoogleTokens: () => string | null | undefined;
};

export type GoogleOAuthLoopbackOptions = {
  productName: string;
  store: GoogleOAuthTokenStore;
  clientId?: string;
  clientSecret?: string;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function clientConfig(opts: GoogleOAuthLoopbackOptions): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = (
    opts.clientId ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    ""
  ).trim();
  const clientSecret = (
    opts.clientSecret ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    ""
  ).trim();
  if (!clientId) return null;
  return { clientId, clientSecret };
}

function doneHtml(productName: string): string {
  const safe = String(productName || "App")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><meta charset="utf-8">
<title>${safe}</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center">
<h2>Connexion réussie ✓</h2>
<p>Vous pouvez fermer cet onglet et revenir dans ${safe}.</p>
</div></body>`;
}

export async function googleLoginLoopback(
  opts: GoogleOAuthLoopbackOptions,
  scopes: string[] = DEFAULT_SCOPES,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = clientConfig(opts);
  if (!cfg) {
    return {
      ok: false,
      error:
        "GOOGLE_OAUTH_CLIENT_ID non configuré — créer un client OAuth « Desktop app » dans Google Cloud Console.",
    };
  }

  const { shell } = loadElectron();
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  const state = b64url(crypto.randomBytes(16));
  const html = doneHtml(opts.productName);

  return new Promise((resolve) => {
    const server = http.createServer();
    const timeout = setTimeout(() => {
      server.close();
      resolve({ ok: false, error: "Login Google abandonné (timeout 5 min)." });
    }, 300000);

    server.on("request", (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(html);

      clearTimeout(timeout);
      server.close();

      if (err || !code || gotState !== state) {
        resolve({ ok: false, error: err || "callback OAuth invalide" });
        return;
      }
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      void exchangeCode(cfg, code, verifier, `http://127.0.0.1:${port}/callback`)
        .then((tokens) => {
          opts.store.setGoogleTokens(JSON.stringify(tokens));
          resolve({ ok: true });
        })
        .catch((e) =>
          resolve({
            ok: false,
            error: e instanceof Error ? e.message : "échange token échoué",
          }),
        );
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set("client_id", cfg.clientId);
      authUrl.searchParams.set(
        "redirect_uri",
        `http://127.0.0.1:${port}/callback`,
      );
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      void shell.openExternal(authUrl.toString());
    });
  });
}

async function exchangeCode(
  cfg: { clientId: string; clientSecret: string },
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `échange token Google HTTP ${res.status} : ${await res.text()}`,
    );
  }
  const tokens = (await res.json()) as Omit<GoogleTokens, "obtained_at">;
  return { ...tokens, obtained_at: new Date().toISOString() };
}

export function storedGoogleTokens(
  store: GoogleOAuthTokenStore,
): GoogleTokens | null {
  const raw = store.getGoogleTokens();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GoogleTokens;
  } catch {
    return null;
  }
}
