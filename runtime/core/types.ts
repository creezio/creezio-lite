import type { AccessDeclaration } from './access-profiles-engine.ts';
import type { RequestAccessContext } from './access-profiles-store.ts';
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { PublicIngressDeclaration } from './public-ingress-engine.ts';
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
export type CredentialMode = 'read' | 'write';
/**
 * Immutable server-side reference to the credential that authenticated this request, built only by the
 * resolvers and the dispatcher. It carries verified, non-secret identifiers: never the raw secret, the
 * Authorization header or a hash. For OAuth the token and the grant are distinct references (t.id and g.id).
 */
export type CredentialContext =
  | Readonly<{ kind: 'session' }>
  | Readonly<{ kind: 'token'; tokenId: string; workspaceId: string; mode: CredentialMode }>
  | Readonly<{ kind: 'oauth'; tokenId: string; grantId: string; clientId: string; workspaceId: string; mode: CredentialMode }>;
export type ApiContext = { app: AppDefinition; env: LiteEnvironment; identity: Identity | null; workspace?:Workspace; operations?:import('./operations.ts').Operation[]; credential?:CredentialContext; requestId?:string; access?:RequestAccessContext; refreshAccess?:(request:Request,workspace:Workspace)=>Promise<RequestAccessContext>; defer?:(promise:Promise<unknown>)=>void };
export type BeforeWrite = (input: { module: Module; data: Record<string, unknown>; previous: Record<string, unknown> | null; workspace: Workspace; identity: Identity; access?:RequestAccessContext }) => Promise<void> | void;

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
    action: ScopeAction,
    access?: RequestAccessContext
  ): SqlFragment;
  fileFilter(
    principal: Principal,
    ref: { alias: string; idColumn: string },
    action: ScopeAction,
    access?: RequestAccessContext
  ): SqlFragment;
  deleteFile?: (ctx: FileDeletionContext) => Promise<FileDeletionResult>;
};
export type FileDeletionContext = {
  access?:RequestAccessContext;
  db: D1Database;
  env: LiteEnvironment;
  principal: Principal;
  credential: CredentialContext;
  workspace: Workspace;
  fileId: string;
  requestId: string; // the dispatcher correlation id, also sent as the response request id header
  now: string;
  defer(promise: Promise<unknown>): void;
};
export type FileDeletionResult = {
  cleanup: 'queued' | 'complete';
};

export type AppOperationContext = {
  access?:RequestAccessContext;
  db: D1Database;
  env: LiteEnvironment;
  app: AppDefinition;
  identity: Identity;
  workspace: Workspace;
  principal: Principal;
  credential: CredentialContext;
  operation: import('./operations.ts').Operation;
  requestId: string; // the dispatcher correlation id, also sent as the response request id header
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
  access?:AccessDeclaration;
  beforeWrite?: BeforeWrite;
  operations?: AppOperationDefinition[];
  scope?: ScopeProvider;
  /** Opt-in additif, distinct de `access`. Absent ⇒ aucune route publique. */
  publicIngress?: PublicIngressDeclaration;
};
