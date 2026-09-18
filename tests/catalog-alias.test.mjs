import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './helpers.mjs';
import { createApp } from '../bin/lite.mjs';

// Same consumer shape as Certivan PR 28 (app/integration/foundation/extensions.ts): the public catalogue export only.
const consumer=`import { defineExtensions } from '@lite/sites-adapter/catalog';
import { appDefinition } from '@/app/app-definition';
import { beforeWrite } from '@/app/business-rules';
export const extensions = defineExtensions(appDefinition, { beforeWrite });
`;
const templateModules=join(root,'template/node_modules');

function run(cwd,args,timeout){
  const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout,maxBuffer:64*1024*1024});
  return {status:result.status,signal:result.signal,output:`${result.stdout??''}\n${result.stderr??''}`};
}

test('a generated app builds with the public @lite/sites-adapter/catalog import wired into its API route',async(t)=>{
  assert.ok(existsSync(join(templateModules,'vinext')),'template dependencies are required: pnpm --dir template install --frozen-lockfile');
  const temp=await mkdtemp(join(tmpdir(),'lite-catalog-alias-'));
  try{
    const app=join(temp,'app');
    await createApp({out:app,spec:join(root,'examples/services.json')});
    await mkdir(join(app,'app/integration/foundation'),{recursive:true});
    await writeFile(join(app,'app/integration/foundation/extensions.ts'),consumer);
    // The route consumes the extensions so the consumer belongs to the real server build graph, as in the application.
    await writeFile(join(app,'app/api/v1/[...path]/route.ts'),`import { dispatchRequest } from '@lite/sites-adapter/dispatch';
import { env } from 'cloudflare:workers';
import { after } from 'next/server';
import type { LiteEnvironment } from '@/runtime/core/index';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { appDefinition } from '@/app/app-definition';
import { extensions } from '@/app/integration/foundation/extensions';
export const dynamic = 'force-dynamic';
async function route(request: Request) {
  return dispatchRequest(request,{env:env as unknown as LiteEnvironment,defer:after,identity:await getChatGPTUser(),app:appDefinition},extensions);
}
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;
export const PUT=route;
`);
    // Dependencies are borrowed from the installed template checkout; nothing from the kit is copied into the fixture.
    try { await symlink(templateModules,join(app,'node_modules'),'junction'); }
    catch(error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows symlink permissions are unavailable'); throw error; }
    // Same steps as the application's `pnpm build`: prebuild then the vinext build, without requiring pnpm here.
    const prepare=run(app,['scripts/prepare-lite.mjs'],60_000);
    assert.equal(prepare.status,0,prepare.output);
    const build=run(app,['scripts/run-framework.mjs','build'],180_000);
    assert.equal(build.signal,null,`build interrupted by ${build.signal}\n${build.output}`);
    assert.doesNotMatch(build.output,/UNLOADABLE_DEPENDENCY|index\.ts\/catalog/,build.output);
    assert.equal(build.status,0,build.output);
    assert.ok(existsSync(join(app,'dist/server/index.js')),'the server bundle is emitted');
  }finally{await rm(temp,{recursive:true,force:true});}
});
