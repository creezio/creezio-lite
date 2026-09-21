import { appDefinition } from '../../app-definition.ts';
import type { BrandModuleDef } from '../../../runtime/core/module-contract.ts';
const schema=appDefinition.modules.find(module=>module.id==="clients")!;
export default {
 id:"clients",
 entitySpecs:{[schema.id]:{schema,storage:{kind:'records'}}},
 operations:[], migrations:[],
 onboarding:{steps:[{id:schema.id,label:schema.name,texts:{description:schema.description}}]},
 assistantSources:[{kind:'entity',entityKind:schema.id,titleFields:[schema.titleField],type:schema.singular,urlWhenId:'/'+schema.id+'?record={id}',urlWhenSearch:'/'+schema.id}],
 demo:{scenarios:[{id:schema.id+'-tour',title:schema.name,steps:[{id:'open',kind:'navigate',href:'/'+schema.id},{id:'intro',kind:'say',title:schema.name,body:schema.description}]}]},
} satisfies BrandModuleDef;
