import './register-ui-loader.mjs';
import test from 'node:test';import assert from 'node:assert/strict';const {default:React}=await import('react');const {create,act}=await import('react-test-renderer');
const {OnboardingWizard}=await import('../runtime/ui/onboarding/onboarding-wizard.tsx');
test('historical wizard preserves the step on failed D1 progress and exits through the supplied SPA router',async t=>{
 const oldWindow=global.window,oldAct=global.IS_REACT_ACT_ENVIRONMENT;global.window={scrollTo(){}};global.IS_REACT_ACT_ENVIRONMENT=true;let tree,offline=true,exits=0;
 t.after(async()=>{if(tree)await act(async()=>tree.unmount());global.window=oldWindow;global.IS_REACT_ACT_ENVIRONMENT=oldAct;});
 const steps=[0,1].map(index=>({id:'s'+index,label:'Step '+index,render:ctx=>React.createElement('section',{'data-step':index},React.createElement('button',{onClick:index?ctx.complete:ctx.advance},index?'Finish':'Next'))}));
 await act(async()=>{tree=create(React.createElement(OnboardingWizard,{steps,flags:{interstitials:false},transport:{persistStep:async()=>{if(offline)throw Error('Storage temporarily unavailable');},complete:async()=>{},skip:async()=>{}},onExit:href=>{assert.equal(href,'/dashboard');exits++;}}));});
 await act(async()=>tree.root.findByType('button').props.onClick());assert.equal(tree.root.findByType('section').props['data-step'],0);assert.match(JSON.stringify(tree.toJSON()),/Storage temporarily unavailable/);
 offline=false;await act(async()=>tree.root.findByType('button').props.onClick());assert.equal(tree.root.findByType('section').props['data-step'],1);
 await act(async()=>tree.root.findByType('button').props.onClick());assert.equal(exits,1);
});
