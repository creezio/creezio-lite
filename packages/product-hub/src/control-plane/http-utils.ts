import type http from "node:http";

export function sendJson(
  res: http.ServerResponse,
  code: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

export function readBody(
  req: http.IncomingMessage,
  maxBytes = 2 * 1024 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body trop gros"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function authOk(req: http.IncomingMessage, token: string): boolean {
  const h = String(req.headers.authorization || "");
  if (h === `Bearer ${token}`) return true;
  const alt = String(req.headers["x-api-key"] || "");
  return alt === token;
}

export function normalizeHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
