import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {claimBrowserWindowIdentity} from '../runtime/modules/assistant/ui/browser-session-identity.ts';

const storage=(initial={})=>{
 const values=new Map(Object.entries(initial));
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};
};
const ids=()=>{
 let next=0;
 return ()=>`fixture-window-${String(++next).padStart(4,'0')}`;
};
function channels(){
 const peers=new Set();
 return ()=>{const channel={onmessage:null,postMessage(message){for(const peer of peers)if(peer!==channel)peer.onmessage?.({data:message});},close(){peers.delete(channel);}};peers.add(channel);return channel;};
}

test('browser identity: reload and full navigation keep the tab identity',async()=>{
 const tab=storage(),createId=ids(),openChannel=channels();
 const first=await claimBrowserWindowIdentity({storage:tab,createId,openChannel,probeMs:0});
 first.close();
 const reloaded=await claimBrowserWindowIdentity({storage:tab,createId,openChannel,probeMs:0});
 assert.equal(reloaded.windowId,first.windowId);
 reloaded.close();
});

test('browser identity: a copied sessionStorage still yields a distinct live tab identity',async()=>{
 const originalStorage=storage(),createId=ids(),openChannel=channels();
 const original=await claimBrowserWindowIdentity({storage:originalStorage,createId,openChannel,probeMs:0});
 const copiedStorage=storage(Object.fromEntries(originalStorage.values));
 const copied=await claimBrowserWindowIdentity({storage:copiedStorage,createId,openChannel,probeMs:0});
 assert.notEqual(copied.windowId,original.windowId);
 copied.close();original.close();
});

test('browser identity: independent windows receive distinct identities',async()=>{
 const createId=ids();
 const first=await claimBrowserWindowIdentity({storage:storage(),createId,openChannel:undefined,probeMs:0});
 const second=await claimBrowserWindowIdentity({storage:storage(),createId,openChannel:undefined,probeMs:0});
 assert.notEqual(second.windowId,first.windowId);
 second.close();first.close();
});


test('browser identity: local live claim separates copied tabs when BroadcastChannel fails',async()=>{
 const tab=storage(),live=storage(),createId=ids(),failedChannel=()=>{throw new Error('unavailable');};
 const first=await claimBrowserWindowIdentity({storage:tab,liveStorage:live,createId,openChannel:failedChannel,probeMs:0});
 const copied=await claimBrowserWindowIdentity({storage:storage(Object.fromEntries(tab.values)),liveStorage:live,createId,openChannel:failedChannel,probeMs:0});
 assert.notEqual(copied.windowId,first.windowId);
 copied.close();first.close();
});
