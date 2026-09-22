import { defineExtensions } from '../runtime/modules/sites-adapter/src/catalog';
import { appDefinition } from './app-definition';
import { moduleRegistry } from './modules';
import { beforeWrite } from './business-rules';
export const appExtensions=defineExtensions(appDefinition,{registry:moduleRegistry,beforeWrite});
