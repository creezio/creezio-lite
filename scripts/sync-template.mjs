import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(join(root,'template/runtime'),{recursive:true,force:true});
await mkdir(join(root,'template/runtime'),{recursive:true});
await cp(join(root,'runtime'),join(root,'template/runtime'),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(path)});
console.log('Runtime Lite synchronisé.');
