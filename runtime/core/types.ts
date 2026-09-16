import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Identity = { userId: string; email: string; displayName: string };
export type Field = {
  key: string; label: string;
  type: 'text' | 'textarea' | 'email' | 'number' | 'date' | 'select' | 'boolean';
  required?: boolean; options?: string[]; maxLength?: number; min?: number; max?: number;
  searchable?: boolean;
};
/** A module without kind keeps the historical CRUD behaviour exactly. */
export type ModuleKind = 'module' | 'entity' | 'collection';
export type ModuleExtension = {
  kind?: ModuleKind;
  parent?: string;       // moduleId of the parent entity, collections only
  parentField?: string;  // declared field carrying the parent recordId
  navigation?: boolean;
};
export type Module = {
  id: string; name: string; singular: string; description: string; icon?: string;
  titleField: string; fields: Field[]; readRoles?: Role[]; writeRoles?: Role[];
  search?: { enabled?: boolean; fields?: string[] };
} & ModuleExtension;
export type AppDefinition = { id: string; name: string; description: string; modules: Module[] };
export type RecordData = { id: string; module_id: string; data: Record<string, unknown>; version: number; created_at: string; updated_at: string };
export type Workspace = { id: string; name: string; role: Role; operationPolicies?: import('./operations.ts').OperationPolicy[] };
export type LiteEnvironment = { DB: D1Database; BUCKET?: R2Bucket; LITE_INTEGRATION_SECRET?: string };
export type CredentialKind = 'session' | 'token' | 'oauth';
export type ApiContext = { app: AppDefinition; env: LiteEnvironment; identity: Identity | null; workspace?:Workspace; operations?:import('./operations.ts').Operation[]; credential?:CredentialKind; defer?:(promise:Promise<unknown>)=>void };
export type BeforeWrite = (input: { module: Module; data: Record<string, unknown>; previous: Record<string, unknown> | null; workspace: Workspace; identity: Identity }) => Promise<void> | void;

/** The verified actor of one request. Handlers never rebuild it from body or query. */
export type Principal = {
  userId: string;
  role: Role;
  workspaceId: string;
  credential: CredentialKind;
};

export type ScopeAction = 'read' | 'write';
export type SqlFragment = { sql: string; bindings: unknown[] };
export type ScopeProvider = {
  recordFilter(
    principal: Principal,
    ref: { alias: string; idColumn: string; moduleColumn: string },
    action: ScopeAction
  ): SqlFragment;
  fileFilter(
    principal: Principal,
    ref: { alias: string; idColumn: string },
    action: ScopeAction
  ): SqlFragment;
  deleteFile?: (ctx: FileDeletionContext) => Promise<FileDeletionResult>;
};
export type FileDeletionContext = {
  db: D1Database;
  env: LiteEnvironment;
  principal: Principal;
  workspace: Workspace;
  fileId: string;
  requestId: string;
  now: string;
  defer(promise: Promise<unknown>): void;
};
export type FileDeletionResult = {
  cleanup: 'queued' | 'complete';
};

export type AppOperationContext = {
  db: D1Database;
  env: LiteEnvironment;
  app: AppDefinition;
  identity: Identity;
  workspace: Workspace;
  principal: Principal;
  operation: import('./operations.ts').Operation;
  requestId: string;
  now: string;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, unknown>>;
  body: Readonly<Record<string, unknown>>;
  scope: ScopeProvider;
  defer(promise: Promise<unknown>): void;
};
export type AppOperationResult = {
  status?: 200 | 201 | 202;
  body: unknown;
  changed?: string[]; // modules invalidated through x-lite-data-changed
  replayed?: boolean; // emits Idempotent-Replayed: true, never supplied by the client
};
export type AppOperationDefinition = {
  operation: import('./operations.ts').Operation; // built with the existing operation() helper
  handle(ctx: AppOperationContext): Promise<AppOperationResult>;
};
export type AppExtensions = {
  beforeWrite?: BeforeWrite;
  operations?: AppOperationDefinition[];
  scope?: ScopeProvider;
};
