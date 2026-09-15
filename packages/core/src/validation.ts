import type { AppDefinition, Module, Role } from './types.ts';

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
export const roles: Role[] = ['owner', 'admin', 'member', 'viewer'];
const keyPattern = /^[a-z][a-z0-9_]{0,47}$/;
const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

export function defineApp(input: unknown): AppDefinition {
  if (!input || typeof input !== 'object') throw new Error('Le brief doit être un objet JSON.');
  const app = input as AppDefinition;
  if (!idPattern.test(app.id) || typeof app.name !== 'string' || !app.name.trim() || app.name.length > 100 || typeof app.description !== 'string') throw new Error('Identité de marque invalide.');
  if (!Array.isArray(app.modules) || app.modules.length < 1 || app.modules.length > 32) throw new Error('Déclarer entre 1 et 32 modules.');
  const ids = new Set<string>();
  for (const mod of app.modules) {
    if (!idPattern.test(mod.id) || ids.has(mod.id) || ['overview','files','team','audit','settings','dashboard','taches','support','documents','collaborateurs','parametres','admin','api','login','setup','onboarding','signin-with-chatgpt','signout-with-chatgpt','callback','nav','interactive-demo','tasks'].includes(mod.id)) throw new Error('Identifiant de module invalide, réservé ou dupliqué.');
    ids.add(mod.id);
    if (![mod.name, mod.singular, mod.description].every(v => typeof v === 'string') || !mod.name.trim() || !mod.singular.trim()) throw new Error('Libellés de module manquants.');
    if (!Array.isArray(mod.fields) || mod.fields.length < 1 || mod.fields.length > 30) throw new Error('Déclarer entre 1 et 30 champs par module.');
    const keys = new Set<string>();
    for (const field of mod.fields) {
      if (!keyPattern.test(field.key) || forbidden.has(field.key) || keys.has(field.key) || typeof field.label !== 'string' || !field.label.trim()) throw new Error('Champ invalide ou dupliqué.');
      keys.add(field.key);
      if (!['text','textarea','email','number','date','select','boolean'].includes(field.type)) throw new Error('Type de champ non pris en charge.');
      if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.length || field.options.length > 50 || !field.options.every(v => typeof v === 'string' && v.length > 0 && v.length <= 100) || new Set(field.options).size !== field.options.length)) throw new Error('Options de sélection invalides.');
      if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 10000)) throw new Error('Longueur de champ invalide.');
      if ([field.min, field.max].some(n => n !== undefined && !Number.isFinite(n)) || (field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new Error('Bornes numériques invalides.');
    }
    if (!mod.fields.some(f => f.key === mod.titleField && ['text','email'].includes(f.type) && f.required)) throw new Error('titleField doit désigner un champ texte obligatoire.');
    for (const grant of [mod.readRoles, mod.writeRoles]) if (grant && (!Array.isArray(grant) || !grant.every(r => roles.includes(r)))) throw new Error('Rôles de module invalides.');
  }
  return app;
}

export function validateData(mod: Module, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_data', 'Les données doivent être un objet.');
  const source = input as Record<string, unknown>;
  const allowed = new Set(mod.fields.map(f => f.key));
  if (Object.keys(source).some(k => !allowed.has(k))) fail(400, 'unknown_field', 'Un champ ne fait pas partie du module.');
  const result: Record<string, unknown> = {};
  for (const f of mod.fields) {
    let value = source[f.key];
    if (typeof value === 'string') value = value.trim();
    const empty = value === undefined || value === null || value === '';
    if (empty) { if (f.required) fail(400, 'required_field', `${f.label} est obligatoire.`); result[f.key] = f.type === 'boolean' ? false : null; continue; }
    if (f.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) fail(400, 'invalid_number', `${f.label} : nombre hors limites.`);
    } else if (f.type === 'boolean') {
      if (typeof value !== 'boolean') fail(400, 'invalid_boolean', `${f.label} : valeur oui/non attendue.`);
    } else {
      if (typeof value !== 'string' || value.length > (f.maxLength ?? (f.type === 'textarea' ? 5000 : 300))) fail(400, 'invalid_text', `${f.label} : texte invalide ou trop long.`);
      if (f.type === 'select' && !f.options?.includes(value)) fail(400, 'invalid_option', `${f.label} : option invalide.`);
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, 'invalid_email', `${f.label} : e-mail invalide.`);
      if (f.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) fail(400, 'invalid_date', `${f.label} : date invalide.`);
    }
    result[f.key] = value;
  }
  return result;
}

export function requireRole(role: Role, permitted: Role[]) { if (!permitted.includes(role)) fail(403, 'forbidden', 'Votre rôle ne permet pas cette action.'); }
export function requireModuleRole(mod: Module, role: Role, write = false) {
  requireRole(role, mod.readRoles ?? roles);
  if (write) requireRole(role, mod.writeRoles ?? ['owner','admin','member']);
}
export function boundedInteger(value: string | null, fallback: number, max: number) {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) fail(400, 'invalid_pagination', 'Pagination invalide.');
  return n;
}
