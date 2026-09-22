import brand from '../brand.json' with {type:'json'};
import { defineApp } from '../runtime/core/index.ts';
import {moduleSchemas} from './modules/schemas.ts';
export const appDefinition = defineApp({...brand,modules:moduleSchemas});
