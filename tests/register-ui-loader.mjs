import { registerHooks, createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const deps = createRequire(new URL('../template/package.json', import.meta.url));
const ts = deps('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const templateURL = new URL('../template/package.json', import.meta.url).href;
function source(path) { const stem=path.replace(/\/dist\//g,'/src/').replace(/\.js$/,''); return [path,stem+'.ts',stem+'.tsx',join(stem,'index.ts')].find(existsSync); }
registerHooks({
  resolve(spec, context, next) {
    if (spec === 'next/dist/shared/lib/app-router-context.shared-runtime') spec = 'vinext/shims/internal/app-router-context';
    if (spec.startsWith('@creezio/')) {
      const [name,...parts]=spec.slice(9).split('/');
      const base=join(root,'packages',name), manifest=JSON.parse(readFileSync(join(base,'package.json'),'utf8'));
      const entry=manifest.exports?.[parts.length?'./'+parts.join('/'):'.'];
      const file=source(resolve(base,typeof entry==='string'?entry:entry?.import??parts.join('/')));
      if(file)return next(pathToFileURL(file).href,context);
    }
    if(spec.startsWith('.')&&/\.(?:ts|tsx)$/.test(context.parentURL??'')) {
      const file=source(fileURLToPath(new URL(spec,context.parentURL)));
      if(file)return next(pathToFileURL(file).href,context);
    }
    if(!spec.startsWith('.')&&!spec.startsWith('/')&&!spec.includes(':'))return next(spec,{...context,parentURL:templateURL});
    return next(spec,context);
  },
  load(url, context, next) {
    if (/\.[cm]?tsx?$/.test(url) && !url.endsWith('.d.ts')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: fileURLToPath(url),
      }).outputText,
    };
    return next(url, context);
  },
});
