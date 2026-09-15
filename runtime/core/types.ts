import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type Identity = { userId: string; email: string; displayName: string };
export type Field = {
  key: string; label: string;
  type: 'text' | 'textarea' | 'email' | 'number' | 'date' | 'select' | 'boolean';
  required?: boolean; options?: string[]; maxLength?: number; min?: number; max?: number;
  searchable?: boolean;
};
export type Module = {
  id: string; name: string; singular: string; description: string; icon?: string;
  titleField: string; fields: Field[]; readRoles?: Role[]; writeRoles?: Role[];
  search?: { enabled?: boolean; fields?: string[] };
};
export type AppDefinition = { id: string; name: string; description: string; modules: Module[] };
export type RecordData = { id: string; module_id: string; data: Record<string, unknown>; version: number; created_at: string; updated_at: string };
export type Workspace = { id: string; name: string; role: Role; operationPolicies?: import('./operations.ts').OperationPolicy[] };
export type LiteEnvironment = { DB: D1Database; BUCKET?: R2Bucket };
export type ApiContext = { app: AppDefinition; env: LiteEnvironment; identity: Identity | null; workspace?:Workspace; operations?:import('./operations.ts').Operation[]; defer?:(promise:Promise<unknown>)=>void };
export type BeforeWrite = (input: { module: Module; data: Record<string, unknown>; previous: Record<string, unknown> | null; workspace: Workspace; identity: Identity }) => Promise<void> | void;
