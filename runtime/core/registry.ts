import type { AppDefinition, Field, Module, ModuleKind, Role } from './types.ts';
import { moduleKind, moduleNavigable, moduleWritable, roles } from './validation.ts';

export type RegisteredModule = {
  id: string; name: string; description: string; kind: 'business' | 'system';
  href: string; titleField: string; fields: Field[]; readRoles: Role[]; writeRoles: Role[];
  search: { enabled: boolean; fields: string[] };
  api: string; mcp: boolean;
  /** Declared kind of a business module; system modules behave as plain modules. */
  moduleKind: ModuleKind;
  /** True when the generic CRUD can write; entities and collections only accept declared commands. */
  writable: boolean;
  /** Navigation entry and dashboard counter; collections are never navigable. */
  navigation: boolean;
  parent?: string;
  parentField?: string;
};
const admin: Role[] = ['owner', 'admin'];
const writers: Role[] = ['owner', 'admin', 'member'];
const field = (key: string, label: string): Field => ({ key, label, type: 'text' });
const systems: RegisteredModule[] = [
  {id:'mail',name:'Mail',description:'Messagerie partagée de cet espace',href:'/mails',titleField:'subject',fields:[field('subject','Objet'),field('from_addr','Expéditeur'),field('to_addr','Destinataires'),field('text_body','Message')],api:'email',readRoles:roles,writeRoles:writers},
  { id:'tasks', name:'Tâches', description:'Le travail de l’équipe', href:'/taches', titleField:'title',
    fields:[field('title','Titre'),field('body','Description'),field('status','Statut')], api:'tasks', readRoles:roles, writeRoles:writers },
  { id:'files', name:'Documents', description:'Noms et métadonnées des fichiers', href:'/documents', titleField:'name',
    fields:[field('name','Nom du fichier'),field('content_type','Type de fichier')], api:'files', readRoles:roles, writeRoles:writers },
  { id:'support', name:'Support', description:'Tickets et messages', href:'/support', titleField:'title',
    fields:[field('title','Sujet'),field('body','Message'),field('author','Auteur'),field('status','Statut')], api:'platform/platform-support', readRoles:roles, writeRoles:writers },
  { id:'members', name:'Collaborateurs', description:'Personnes de cet espace', href:'/collaborateurs', titleField:'name',
    fields:[field('name','Nom'),field('email','E-mail'),field('role','Rôle')], api:'members', readRoles:admin, writeRoles:admin },
  { id:'audit', name:'Activité', description:'Historique des modifications', href:'/admin/activity', titleField:'action',
    fields:[field('action','Action'),field('resource_id','Référence'),field('user_name','Personne')], api:'audit', readRoles:admin, writeRoles:[] },
].map(m=>({...m,kind:'system' as const,mcp:true,search:{enabled:true,fields:m.fields.map(f=>f.key)},moduleKind:'module' as const,writable:true,navigation:true}));

/** Search stays on for modules and entities; a collection must opt in explicitly. */
export function moduleSearchEnabled(m: Module): boolean {
  if (m.search?.enabled !== undefined) return m.search.enabled;
  return moduleKind(m) !== 'collection';
}
/** A business module is registered once; every surface consumes this catalogue. */
export function moduleRegistry(app: AppDefinition): RegisteredModule[] {
  return [...systems.map(m=>({...m})), ...app.modules.map((m): RegisteredModule => ({
    id:m.id, name:m.name, description:m.description, kind:'business', href:`/${m.id}`,
    titleField:m.titleField, fields:m.fields, readRoles:m.readRoles??roles, writeRoles:m.writeRoles??writers,
    search:{enabled:moduleSearchEnabled(m),fields:m.search?.fields??m.fields.filter(f=>f.searchable!==false&&f.storage!=='computed').map(f=>f.key)},
    api:`modules/${m.id}/records`, mcp:true,
    moduleKind:moduleKind(m), writable:moduleWritable(m), navigation:moduleNavigable(m),
    ...(m.parent?{parent:m.parent}:{}), ...(m.parentField?{parentField:m.parentField}:{}),
  }))];
}
export function visibleModules(app: AppDefinition, role: Role) { return moduleRegistry(app).filter(m=>m.readRoles.includes(role)); }
/** Business modules that own a page, a navigation entry and a dashboard counter. */
export function navigableModules(app: AppDefinition): Module[] { return app.modules.filter(m=>moduleNavigable(m)); }
export function businessModule(app: AppDefinition, id: string): Module | undefined { return app.modules.find(m=>m.id===id); }
const recordId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\/\\]/.test(value) && value !== '.' && value !== '..';
export function recordHref(module: RegisteredModule, id: string, data: Record<string, unknown>): string {
  if(module.id==='mail')return `/mails?record=${encodeURIComponent(id)}`;
  if(module.id==='support')return `${module.href}?ticket=${encodeURIComponent(String(data._ticketId??id.replace(/^ticket:/,'')))}`;
  if(module.moduleKind==='collection'&&module.parent){
    // A collection has no page of its own: open the declared parent record. Never build a URL to "undefined".
    const parentId=module.parentField?data[module.parentField]:undefined;
    return recordId(parentId)?`/${module.parent}?record=${encodeURIComponent(parentId)}&${encodeURIComponent(module.id)}=${encodeURIComponent(id)}`:`/${module.parent}`;
  }
  return `${module.href}?record=${encodeURIComponent(id)}`;
}
