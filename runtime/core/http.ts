import { fail } from './validation.ts';

export function json(data: unknown, status = 200) {
  return Response.json(data, {status, headers: {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Cookie, oai-authenticated-user-id'}});
}
export function checkOrigin(request: Request) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const expected = new URL(request.url).origin;
  if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'invalid_origin', 'Origine de la requête non autorisée.');
}
export async function readBytes(request: Request, maximum: number) {
  const size = request.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > maximum)) fail(413, 'payload_too_large', 'Le fichier ou la requête dépasse la taille autorisée.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const {value, done} = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) { await reader.cancel(); fail(413, 'payload_too_large', 'La taille maximale est dépassée.'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'json_required', 'Une requête JSON est attendue.');
  try { const data = JSON.parse(new TextDecoder().decode(await readBytes(request, 65536))); if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'invalid_json', 'Objet JSON attendu.'); return data; }
  catch (error) { if (error instanceof SyntaxError) fail(400, 'invalid_json', 'JSON invalide.'); throw error; }
}
export async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2,'0')).join(''); }
export function inviteToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join(''); }
