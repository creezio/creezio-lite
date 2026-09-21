import type { AppDefinition, Module, ModuleKind, Role } from './types.ts';

/** A public detail is a scalar or a short list of scalars; nothing nested, no exception, no SQL cause. */
export type PublicDetail = string | number | boolean | null;
export type PublicDetails = Readonly<Record<string, PublicDetail | readonly PublicDetail[]>>;
const DETAIL_LIMITS = { keys: 16, keyPattern: /^[A-Za-z][A-Za-z0-9_]{0,39}$/, string: 200, items: 20, bytes: 2048 } as const;
const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api_?key|jwt|bearer|credential|hash|session/i;
const scalar = (value: unknown): value is PublicDetail => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= DETAIL_LIMITS.string && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value));
/**
 * Validate the public details an adapter attaches to an error. The adapter chooses the fields per code;
 * the kit only accepts a plain object of at most 16 identifier keys with scalar values (strings ≤ 200
 * characters) or lists of at most 20 scalars, 2 KiB of UTF-8 once serialised, and refuses sensitive key names.
 * Anything else returns undefined: an invalid detail set is dropped as a whole, never partially serialised.
 */
export function publicDetails(value: unknown): PublicDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Error) return undefined;
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length || entries.length > DETAIL_LIMITS.keys) return undefined;
  const result: Record<string, PublicDetail | readonly PublicDetail[]> = {};
  for (const [key, item] of entries) {
    if (!DETAIL_LIMITS.keyPattern.test(key) || SENSITIVE_KEY.test(key)) return undefined;
    if (scalar(item)) result[key] = item;
    else if (Array.isArray(item) && item.length <= DETAIL_LIMITS.items && item.every(scalar)) result[key] = Object.freeze([...item]) as readonly PublicDetail[];
    else return undefined;
  }
  // The bound is on the wire size: UTF-8 bytes of the serialised object, not JS string units.
  if (new TextEncoder().encode(JSON.stringify(result)).length > DETAIL_LIMITS.bytes) return undefined;
  return Object.freeze(result);
}
export class ApiError extends Error {
  status: number; code: string;
  /** Validated public details, or undefined when none were given or they failed publicDetails. */
  details?: PublicDetails;
  /** Correlation id of the request that produced this error, set by the dispatcher when it converts an internal response. */
  requestId?: string;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message); this.status = status; this.code = code;
    if (details !== undefined) { const checked = publicDetails(details); if (checked) this.details = checked; else console.error(JSON.stringify({ event: 'lite.error-details-rejected', code })); }
  }
}
export function fail(status: number, code: string, message: string, details?: unknown): never { throw new ApiError(status, code, message, details); }
/** The public error body shared by every executor: code, message, request id and validated details only. */
export function errorBody(error: ApiError, requestId: string | undefined = error.requestId): { error: { code: string; message: string; requestId?: string; details?: PublicDetails } } {
  return { error: { code: error.code, message: error.message, ...(requestId ? { requestId } : {}), ...(error.details ? { details: error.details } : {}) } };
}
export const roles: Role[] = ['owner', 'admin', 'member', 'viewer'];
export const MODULE_LIMIT = 64;
export const moduleKinds: ModuleKind[] = ['module', 'entity', 'collection'];
/** Effective kind: an absent kind is the historical CRUD module. */
export function moduleKind(mod: Pick<Module, 'kind'>): ModuleKind { return mod.kind ?? 'module'; }
/** Entities and collections are only written through declared commands. */
export function moduleWritable(mod: Pick<Module, 'kind'>): boolean { return moduleKind(mod) === 'module'; }
/** Navigation and dashboard counters follow this flag; collections never navigate. */
export function moduleNavigable(mod: Pick<Module, 'kind' | 'navigation'>): boolean { return moduleKind(mod) !== 'collection' && mod.navigation !== false; }
const keyPattern = /^[a-z][a-z0-9_]{0,47}$/;
export const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

export function defineApp(input: unknown): AppDefinition {
  if (!input || typeof input !== 'object') throw new Error('Le brief doit être un objet JSON.');
  const app = input as AppDefinition;
  if (!idPattern.test(app.id) || typeof app.name !== 'string' || !app.name.trim() || app.name.length > 100 || typeof app.description !== 'string') throw new Error('Identité de marque invalide.');
  if (!Array.isArray(app.modules) || app.modules.length < 1 || app.modules.length > MODULE_LIMIT) throw new Error(`Déclarer entre 1 et ${MODULE_LIMIT} modules.`);
  const ids = new Set<string>();
  for (const mod of app.modules) {
    if (!mod || typeof mod !== 'object') throw new Error('Déclaration de module invalide.');
    if (!idPattern.test(mod.id) || ids.has(mod.id) || ['mail','mails','email','assistant','integrations','observability','overview','files','team','audit','members','search','registry','mcp','oauth','settings','dashboard','taches','support','documents','collaborateurs','parametres','admin','api','login','setup','onboarding','signin-with-chatgpt','signout-with-chatgpt','callback','nav','interactive-demo','tasks'].includes(mod.id)) throw new Error('Identifiant de module invalide, réservé ou dupliqué.');
    ids.add(mod.id);
    if (![mod.name, mod.singular, mod.description].every(v => typeof v === 'string') || !mod.name.trim() || !mod.singular.trim()) throw new Error('Libellés de module manquants.');
    if (!Array.isArray(mod.fields) || mod.fields.length < 1 || mod.fields.length > 30) throw new Error('Déclarer entre 1 et 30 champs par module.');
    const keys = new Set<string>();
    if(mod.serverFields!==undefined&&(!Array.isArray(mod.serverFields)||mod.serverFields.length>128))throw new Error('Champs serveur invalides.');
    if(mod.serverFields?.some(f=>f.editable===true||f.storage==='computed'))throw new Error('Les champs serveur doivent être stockés et non éditables.');
    for (const field of [...mod.fields,...(mod.serverFields??[])]) {
      if (!keyPattern.test(field.key) || forbidden.has(field.key) || keys.has(field.key) || typeof field.label !== 'string' || !field.label.trim()) throw new Error('Champ invalide ou dupliqué.');
      keys.add(field.key);
      if(field.storage!==undefined&&!['stored','computed'].includes(field.storage))throw new Error('Stockage de champ invalide.');
      if(field.editable!==undefined&&typeof field.editable!=='boolean')throw new Error('editable doit être un booléen.');
      if(field.storage==='computed'&&(field.editable===true||field.searchable===true))throw new Error('Un champ calculé ne peut être éditable ou indexé.');
      if(field.encoding!==undefined&&(field.encoding!=='json'||!['text','textarea'].includes(field.type)))throw new Error('Encodage de champ invalide.');
      if(field.integer!==undefined&&(typeof field.integer!=='boolean'||field.type!=='number'))throw new Error('Un entier exige un champ numérique.');
      if(field.scale!==undefined&&(field.type!=='number'||!Number.isSafeInteger(field.scale)||field.scale<1||field.scale>1000000))throw new Error('Échelle numérique invalide.');
      if(field.unit!==undefined&&(field.type!=='number'||typeof field.unit!=='string'||!field.unit.trim()||field.unit.length>20))throw new Error('Unité numérique invalide.');
      if(field.reference!==undefined&&(field.type!=='text'&&field.type!=='textarea'||!field.reference||!idPattern.test(field.reference.moduleId)||(field.reference.multiple!==undefined&&typeof field.reference.multiple!=='boolean')))throw new Error('Déclaration de référence invalide.');
      if(field.searchable!==undefined&&typeof field.searchable!=='boolean')throw new Error('searchable doit être un booléen.');
      if (!['text','textarea','email','number','date','select','boolean'].includes(field.type)) throw new Error('Type de champ non pris en charge.');
      if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.length || field.options.length > 50 || !field.options.every(v => typeof v === 'string' && v.length > 0 && v.length <= 100) || new Set(field.options).size !== field.options.length)) throw new Error('Options de sélection invalides.');
      if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > (field.encoding==='json'?1000000:10000))) throw new Error('Longueur de champ invalide.');
      if ([field.min, field.max].some(n => n !== undefined && !Number.isFinite(n)) || (field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new Error('Bornes numériques invalides.');
    }
    if (!mod.fields.some(f => f.key === mod.titleField && f.storage!=='computed' && ['text','email'].includes(f.type) && f.required)) throw new Error('titleField doit désigner un champ texte obligatoire.');
    if(mod.search){
      if(typeof mod.search!=='object'||(mod.search.enabled!==undefined&&typeof mod.search.enabled!=='boolean'))throw new Error('Configuration de recherche invalide.');
      if(mod.search.fields&&(!Array.isArray(mod.search.fields)||new Set(mod.search.fields).size!==mod.search.fields.length||mod.search.fields.some(k=>!mod.fields.some(f=>f.key===k&&f.storage!=='computed'))))throw new Error('Champs de recherche invalides.');
    }
    for (const grant of [mod.readRoles, mod.writeRoles]) if (grant && (!Array.isArray(grant) || !grant.every(r => roles.includes(r)))) throw new Error('Rôles de module invalides.');
    validateModuleKind(mod, keys);
  }
  validateModuleParents(app.modules);
  for(const mod of app.modules)for(const field of [...mod.fields,...(mod.serverFields??[])])if(field.reference){
    const target=app.modules.find(m=>m.id===field.reference!.moduleId);
    if(!target||field.reference.labelField&&!target.fields.some(f=>f.key===field.reference!.labelField))throw new Error('Cible ou libellé de référence inconnu.');
  }
  return app;
}

/** Kind-specific declaration rules. A module without kind is unchanged. */
function validateModuleKind(mod: Module, keys: Set<string>) {
  if (mod.kind !== undefined && !moduleKinds.includes(mod.kind)) throw new Error(`Kind de module invalide : ${String(mod.kind)}.`);
  if (mod.navigation !== undefined && typeof mod.navigation !== 'boolean') throw new Error('navigation doit être un booléen.');
  const kind = moduleKind(mod);
  if (kind !== 'collection') {
    if (mod.parent !== undefined || mod.parentField !== undefined) throw new Error(`Le module ${mod.id} ne peut déclarer parent ou parentField : réservés aux collections.`);
    return;
  }
  if (typeof mod.parent !== 'string' || !idPattern.test(mod.parent) || mod.parent === mod.id) throw new Error(`La collection ${mod.id} doit déclarer l’identifiant de son entité parente.`);
  if (typeof mod.parentField !== 'string' || !keys.has(mod.parentField)) throw new Error(`La collection ${mod.id} doit déclarer un parentField présent dans ses champs.`);
  const field = mod.fields.find(f => f.key === mod.parentField)!;
  if (!['text', 'email'].includes(field.type) || !field.required) throw new Error(`Le parentField ${mod.parentField} de ${mod.id} doit être un champ texte obligatoire.`);
  if (mod.navigation === true) throw new Error(`La collection ${mod.id} ne peut pas imposer navigation:true.`);
}

/** Parents must be declared entities; a collection is never a parent and chains never loop. */
function validateModuleParents(modules: Module[]) {
  const byId = new Map(modules.map(m => [m.id, m]));
  for (const mod of modules) {
    if (moduleKind(mod) !== 'collection') continue;
    const seen = new Set<string>([mod.id]);
    let current: Module | undefined = mod;
    while (current && current.parent !== undefined) {
      const parent: Module | undefined = byId.get(current.parent);
      if (!parent) throw new Error(`La collection ${current.id} référence un parent absent : ${current.parent}.`);
      if (seen.has(parent.id)) throw new Error(`Cycle de parenté détecté sur ${parent.id}.`);
      if (moduleKind(parent) !== 'entity') throw new Error(`Le parent ${parent.id} de ${current.id} doit être un module de kind entity.`);
      seen.add(parent.id);
      current = parent;
    }
  }
}

export function validateData(mod: Module, input: unknown, options: {stored?: boolean} = {}): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_data', 'Les données doivent être un objet.');
  const source = input as Record<string, unknown>;
  const allowed = new Set(mod.fields.map(f => f.key));
  if (Object.keys(source).some(k => !allowed.has(k))) fail(400, 'unknown_field', 'Un champ ne fait pas partie du module.');
  const result: Record<string, unknown> = {};
  for (const f of mod.fields) {
    let value = source[f.key];
    if (typeof value === 'string' && !options.stored) value = value.trim();
    if (options.stored && f.required && typeof value === 'string' && !value.trim()) fail(400, 'required_field', `${f.label} est obligatoire.`);
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (f.required) fail(400, 'required_field', `${f.label} est obligatoire.`);
      // Server commands already selected their values: validation must not turn
      // an empty text into NULL, or an unknown optional boolean into false.
      result[f.key] = options.stored
        ? (value === '' && !f.encoding && ['text','textarea'].includes(f.type) ? '' : null)
        : (f.type === 'boolean' ? false : null);
      continue;
    }
    if (f.encoding === 'json') {
      try { if(typeof value==='string')value=JSON.parse(value); const encoded=JSON.stringify(value); if(encoded===undefined||encoded.length>(f.maxLength??5000))throw new Error(); value=JSON.parse(encoded); }
      catch { fail(400,'invalid_json',`${f.label} : JSON invalide ou trop long.`); }
    } else if (f.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (f.integer&&!Number.isSafeInteger(value)) || (f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) fail(400, 'invalid_number', `${f.label} : nombre hors limites.`);
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
