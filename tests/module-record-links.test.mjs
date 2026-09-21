import './register-ui-loader.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// Isolate the list-cell contract from unrelated dialogs/table hooks; keep the real anchor and Badge.
const emptyUI='export const '+['Button','Input','Textarea','Label','Checkbox','Select','SelectTrigger','SelectValue','SelectContent','SelectItem','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','Skeleton'].map(name=>name+'=()=>null').join(',')+';';
const dataUrl=source=>'data:text/javascript,'+encodeURIComponent(source);
registerHooks({resolve(spec,context,next){
 if(spec==='@lite/shell-ui/ui')return next(dataUrl('export const DataTable=()=>null,EntityHeader=()=>null;export {Badge} from '+JSON.stringify(new URL('../runtime/modules/shell-ui/ui/primitives/badge.tsx',import.meta.url).href)+';'),context);
 if(spec==='@lite/shell-ui/ui/kit'||spec==='@/components/ui/checkbox')return next(dataUrl(emptyUI),context);
 if(spec==='next/navigation')return next('next/navigation.js',context);
 return next(spec,context);
}});
const {renderToStaticMarkup}=await import('react-dom/server');
const {moduleRecordColumns}=await import('../runtime/ui/module-view.tsx');
const module={id:'clients',name:'Clients',singular:'Client',titleField:'name',fields:[{key:'name',label:'Nom',type:'text',required:true},{key:'status',label:'État',type:'select',options:['Actif']},{key:'count',label:'Quantité',type:'number'},{key:'notes',label:'Notes',type:'textarea'}]};
const record={id:'a/b?c=1&d=# é',data:{name:'Client & associé',status:'Actif',count:1234,notes:'Texte long'}};
const render=column=>renderToStaticMarkup(column.cell({row:{original:record}}));
test('record title renders a native link with encoded id and readable accessible name',()=>{const columns=moduleRecordColumns(module),html=render(columns.find(c=>c.id==='name'));assert.ok(html.includes('href="/clients?record='+encodeURIComponent(record.id)+'"'));assert.match(html,/<a /);assert.doesNotMatch(html,/data-workspace-nav="ignore"/,'record links must preserve workspace SPA navigation');assert.match(html,/Client &amp; associé/);assert.doesNotMatch(html,/tabindex="-1"|role="button"/);});
test('status badge and other columns keep their original rendering without navigation',()=>{const columns=moduleRecordColumns(module);assert.deepEqual(columns.map(c=>c.id),['name','status','count']);assert.match(render(columns[1]),/Actif/);assert.match(render(columns[1]),/bg-slate-100/);assert.doesNotMatch(render(columns[1]),/<a /);assert.doesNotMatch(render(columns[2]),/<a /);assert.equal(columns[2].accessorFn(record),Number(1234).toLocaleString('fr-FR'));});
test('title outside the first five fields remains reachable without dropping those columns',()=>{const fields=Array.from({length:5},(_,i)=>({key:'f'+i,label:'Champ '+i,type:'text'}));const columns=moduleRecordColumns({...module,fields:[...fields,module.fields[0]]});assert.deepEqual(columns.map(c=>c.id),['name','f0','f1','f2','f3','f4']);assert.match(render(columns[0]),/<a /);});
