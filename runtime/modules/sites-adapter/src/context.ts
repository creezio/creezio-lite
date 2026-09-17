import type { RequestAccessContext } from '@lite/core/access-profiles-store';
import type { D1Database } from '@cloudflare/workers-types';
import type { Identity, Workspace } from '@lite/core';
import { fail, requireRole } from '@lite/core/validation';

export type NativeContext = { db: D1Database; user: Identity; workspace: Workspace; access?:RequestAccessContext };
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function write(c: NativeContext) { requireRole(c.workspace.role,['owner','admin','member']); }
export function admin(c: NativeContext) { requireRole(c.workspace.role,['owner','admin']); }
export function textValue(value: unknown, max: number, required = true): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400,'invalid_text','Texte invalide.');
  return value.trim();
}
export function audit(c: NativeContext, action: string, id: string) {
  return c.db.prepare('INSERT INTO lite_audit(id,org_id,user_id,action,resource_id,details,created_at) VALUES(?,?,?,?,?,?,?)').bind(uid(),c.workspace.id,c.user.userId,action,id,'{}',now());
}
