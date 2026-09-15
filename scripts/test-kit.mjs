import './sync-template.mjs';
import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=(await readdir(join(root,'tests'))).filter(p=>p.endsWith('.test.mjs')).sort().map(p=>join(root,'tests',p));
const result=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
