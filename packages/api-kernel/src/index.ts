/**
 * @creezio/api-kernel — façade HTTP unique (Phase H1.1 / isolation H2 / P17).
 */

export type {
  ApiAuthorizeModuleAccessFn,
  ApiAuthorizePluginAccessFn,
  ApiHandlerContext,
  ApiKernelOptions,
  ApiMount,
  ApiMountHandler,
  ApiPluginAccessDecision,
  ApiRequest,
  ApiResponse,
  ApiSpace,
  ListedModuleOperation,
  ModuleOperation,
  ModuleOperationMethod,
  MountedApiInfo,
} from "./types.js";

export type { DbAccessMode, ScopedDbAccess } from "./db-scope.js";
export {
  CrossLayerWriteDeniedError,
  createScopedDbAccess,
  mountLayerRef,
} from "./db-scope.js";

export type { ApiKernel } from "./kernel.js";
export {
  API_CORE_PREFIX,
  API_MODULES_PREFIX,
  API_PLATFORM_PREFIX,
  API_PLUGINS_PREFIX,
  API_V1_PREFIX,
  createApiKernel,
} from "./kernel.js";

export type {
  ApiMountEntry,
  RegisterApiMountsInput,
} from "./register.js";
export { registerApiMounts } from "./register.js";

export type {
  EntityColumnSpec,
  EntityColumnType,
  EntityHookContext,
  EntityHooks,
  EntitySpec,
} from "./entity-mount.js";
export {
  CREEZIO_DATA_CHANGED_HEADER,
  createEntityApiMount,
  entityOperationsFromSpec,
  operationsFromEntitySpec,
  registerEntityMounts,
} from "./entity-mount.js";

export type {
  EntityMeiliBinding,
  EntityMeiliConfig,
  MeiliBrowseOutcome,
  MeiliBrowseRequest,
  MeiliBrowseResult,
} from "./meili-browse.js";
export {
  browseMeiliIndex,
  browseMeiliIndexOutcome,
  configureEntityMeili,
  configureEntityMeiliFromFeed,
  getEntityMeiliConfig,
  hydrateRowsByIds,
  meiliFilterEq,
  resetEntityMeiliForTests,
  tableForMeiliIndex,
} from "./meili-browse.js";

export type { KernelOperationRoute } from "./operations.js";
export {
  KIT_INTERNAL_MODULE_MOUNT_IDS,
  collectKernelOperationRoutes,
  collectListedOperationRoutes,
  isKitInternalModuleMount,
  isModuleOperationMethod,
  kernelMountPrefix,
  matchModuleOperation,
  normalizeModuleOperationPath,
  resolveOperationHttpPath,
} from "./operations.js";

export type {
  ApiKernelHonoSpace,
  ApiKernelLike,
  ApiKernelResolver,
  HonoLike,
  MountApiKernelOnHonoOptions,
} from "./hono.js";
export {
  apiKernelToHonoHandler,
  applyApiResponse,
  mountApiKernelOnHono,
} from "./hono.js";
