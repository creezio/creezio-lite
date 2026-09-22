/** Adapted from Creezio app-runtime/module-contract: one owner, shared collectors.
 * Runtime handlers stay server-side; the serialisable schemas remain in AppDefinition.
 * No external engine and no implicit conversion of existing D1 records.
 */
import type { AppDefinition, AppExtensions, AppOperationDefinition, BeforeWrite, Module, RecordData, Workspace, Identity, LiteEnvironment } from './types.ts';
import type { RequestAccessContext } from './access-profiles-store.ts';
import type { DemoScenario } from '../modules/interactive-demo/src/types.ts';
import { collectInteractiveDemoDefaults } from '../modules/interactive-demo/src/contributions.ts';
import { idPattern } from './validation.ts';
import { assertEntityStorage, type EntityStorage } from './entity-storage.ts';

export type EntityHookContext = {db:LiteEnvironment['DB']; module:Module; workspace:Workspace; identity:Identity; access?:RequestAccessContext};
export type EntityHooks = {
  afterCreate?:(input:EntityHookContext & {record:RecordData})=>void|Promise<void>;
  afterUpdate?:(input:EntityHookContext & {record:RecordData})=>void|Promise<void>;
  afterArchive?:(input:EntityHookContext & {record:RecordData})=>void|Promise<void>;
  beforeCreate?:BeforeWrite;
  beforeUpdate?:BeforeWrite;
  beforeArchive?:(input:EntityHookContext & {record:RecordData})=>void|Promise<void>;
  /** Projection only: the record id, module id and version cannot be replaced. */
  afterRead?:(input:EntityHookContext & {record:RecordData})=>Record<string,unknown>|Promise<Record<string,unknown>>;
  afterList?:(input:EntityHookContext & {records:readonly RecordData[]})=>Record<string,unknown>[]|Promise<Record<string,unknown>[]>;
};
export type ModuleMigration = {id:string; file:string; tables:readonly string[]};
export type ModuleEntitySpec = {
  /** The very same serialisable schema used by forms, HTTP and MCP. */
  schema:Module;
  storage:EntityStorage;
  /** Trusted module SELECT over its base source. Preserve the envelope and tenant joins; no writes. */
  readProjection?:(baseSource:string)=>string;
  hooks?:EntityHooks;
};
export type BrandModuleAssistantSource =
 | {kind:'entity';entityKind:string;titleFields:readonly string[];titleMode?:'first'|'join';type:string;urlWhenId:string;urlWhenSearch:string}
 | {kind:'context';id:string;title:string;body:string}
 | {kind:'tool';name:string;description:string};
export type OnboardingStepContent={id:string;label:string;interstitialTitle?:string;interstitialTagline?:string;texts?:Record<string,string>};
export type BrandModuleOnboarding={steps:OnboardingStepContent[];texts?:Record<string,string>;mascot?:{poses?:Record<string,string>;baseUrl?:string}};
export type BrandModuleDef = {
  id:string;
  entitySpecs:Record<string,ModuleEntitySpec>;
  operations?:AppOperationDefinition[];
  beforeWrite?:BeforeWrite;
  /** Existing application SQL is owned here; the deployment migration runner remains authoritative. */
  migrations?:ModuleMigration[];
  /** Tables accessed by custom D1 operations; never a licence to bypass workspace/permission checks. */
  tables?:readonly string[];
  assistantSources?:BrandModuleAssistantSource[];
  assistantSourcesJustification?:string;
  onboarding?:BrandModuleOnboarding;
  demo?:{scenarios:DemoScenario[]};
  demoJustification?:string;
};
export type BrandModuleRegistry=ReturnType<typeof createBrandModuleRegistry>;
/** Same first-step-wins composition as Creezio onboarding/content. */
export function composeOnboardingFromModules(modules:readonly BrandModuleDef[]):BrandModuleOnboarding{
 const steps:OnboardingStepContent[]=[],seen=new Set<string>(),texts:Record<string,string>={};let mascot:BrandModuleOnboarding['mascot'];
 for(const mod of modules){const o=mod.onboarding;if(!o)continue;for(const step of o.steps){if(seen.has(step.id))continue;seen.add(step.id);steps.push({...step,...(step.texts?{texts:{...step.texts}}:{})});}Object.assign(texts,o.texts);if(o.mascot)mascot={...mascot,...(o.mascot.baseUrl?{baseUrl:o.mascot.baseUrl}:{}),poses:{...mascot?.poses,...o.mascot.poses}};}
 return {steps,...(Object.keys(texts).length?{texts}:{}),...(mascot?{mascot}:{})};
}
export function createBrandModuleRegistry(app:AppDefinition,modules:readonly BrandModuleDef[]){
 const owners=new Map<string,BrandModuleDef>(),ids=new Set<string>(),tables=new Map<string,string>(),migrations=new Map<string,string>(),entityTables=new Set<string>();
 for(const mod of modules){
  if(!idPattern.test(mod.id)||ids.has(mod.id))throw new Error(`Module contract id invalid or duplicated: ${mod.id}`);ids.add(mod.id);
  for(const [id,spec] of Object.entries(mod.entitySpecs)){
   if(owners.has(id))throw new Error(`Entity owned by two modules: ${id}`);
   const declared=app.modules.find(m=>m.id===id);
   if(!declared||spec.schema.id!==id||JSON.stringify(declared)!==JSON.stringify(spec.schema))throw new Error(`Entity schema differs from the shared app schema: ${id}`);
   assertEntityStorage(spec);
   if(spec.storage.kind==='relational'){if(entityTables.has(spec.storage.table))throw new Error('Relational table owned by two entities');entityTables.add(spec.storage.table);}
   if(spec.storage.kind==='relational'&&!mod.tables?.includes(spec.storage.table))throw new Error(`Relational table must be owned by module: ${id}`);
   for(const hook of Object.values(spec.hooks??{}))if(typeof hook!=='function')throw new Error(`Invalid entity hook: ${id}`);
   owners.set(id,mod);
  }
  if(mod.beforeWrite!==undefined&&typeof mod.beforeWrite!=='function')throw new Error(`Invalid beforeWrite: ${mod.id}`);
  for(const table of mod.tables??[]){if(!/^[a-z][a-z0-9_]*$/.test(table)||tables.has(table))throw new Error(`D1 table invalid or owned twice: ${table}`);tables.set(table,mod.id);}
  for(const migration of mod.migrations??[]){
   if(!migration.id.startsWith(`mod_${mod.id.replaceAll('-','_')}_`)||!/^drizzle\/[a-zA-Z0-9_-]+\.sql$/.test(migration.file)||migrations.has(migration.file))throw new Error(`Migration invalid or owned twice: ${migration.file}`);
   if(migration.tables.some(table=>!mod.tables?.includes(table)))throw new Error(`Cross-module migration: ${migration.id}`);migrations.set(migration.file,mod.id);
  }
  for(const source of mod.assistantSources??[]){
   if(source.kind==='entity'&&(!mod.entitySpecs[source.entityKind]||source.titleFields.some(key=>!mod.entitySpecs[source.entityKind].schema.fields.some(f=>f.key===key))))throw new Error(`Unknown assistant entity projection: ${mod.id}`);
   if(source.kind==='context'&&(!source.id||!source.title||typeof source.body!=='string'))throw new Error(`Invalid assistant context: ${mod.id}`);
  }
 }
 for(const entity of app.modules)if(!owners.has(entity.id))throw new Error(`Entity has no owning module: ${entity.id}`);
 for(const mod of modules)for(const def of mod.operations??[])if(owners.get(def.operation.moduleId)!==mod&&def.operation.moduleId!==mod.id)throw new Error(`Operation outside owning module: ${def.operation.id}`);
 const demo=collectInteractiveDemoDefaults(modules.flatMap(mod=>mod.demo?[{moduleId:mod.id,scenarios:mod.demo.scenarios}]:[]));
 return {
  modules:[...modules] as readonly BrandModuleDef[],
  ownerOf:(id:string)=>owners.get(id),
  collectEntitySpecs:()=>Object.fromEntries(modules.flatMap(m=>Object.entries(m.entitySpecs))),
  collectOperations:()=>modules.flatMap(m=>m.operations??[]),
  collectModuleMigrations:()=>modules.flatMap(m=>m.migrations??[]),
  collectAssistantSources:()=>modules.flatMap(m=>m.assistantSources??[]),
  collectOnboardingContent:()=>composeOnboardingFromModules(modules),
  collectDemoScenarios:()=>[...demo],
 };
}
/** Called once at declaration time. Existing global extensions remain compatible during adoption. */
export function composeModuleExtensions(extensions:AppExtensions):AppExtensions{
 const registry=extensions.registry;if(!registry)return extensions;
 const global=extensions.beforeWrite;
 return {...extensions,operations:[...registry.collectOperations(),...(extensions.operations??[])],
  entitySpecs:registry.collectEntitySpecs(),
  entityHooks:{...Object.fromEntries(Object.entries(registry.collectEntitySpecs()).map(([id,spec])=>[id,spec.hooks??{}])),...extensions.entityHooks},
  beforeWrite:async input=>{await global?.(input);await registry.ownerOf(input.module.id)?.beforeWrite?.(input);},
 };
}
