import {run,defineDriver,stateCheck} from '@firfi/quint-connect';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {hashBytes} from '../../packages/core/dist/index.js';
import * as normal from './src/order.mjs';
import * as faulty from './src/order-fault.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const source=fileURLToPath(new URL('../../',import.meta.url));
const results=[];
for(const [name,implementation] of [['normal',normal],['implementation-fault',faulty]]){
 let comparisons=0,calls=0;const started=performance.now();
 const factory=defineDriver({init:{},Pay:{},Ship:{},Cancel:{},Refund:{},Wait:{}},()=>{
  let state;
  const call=(name)=>{calls++;state=name==='initialize'?implementation.initialize():implementation[name](state);};
  return {init:()=>call('initialize'),Pay:()=>call('pay'),Ship:()=>call('ship'),Cancel:()=>call('cancel'),Refund:()=>call('refund'),Wait:()=>call('wait'),getState:()=>({...state,refunds:BigInt(state.refunds)})};
 });
 try{
  const result=await run({spec:join(root,'specs/order.qnt'),quintBin:join(root,'node_modules/.bin/quint'),backend:'typescript',nTraces:20,maxSteps:8,maxSamples:100,seed:'42',invariants:['refundAtMostOnce','noRefundAfterShipping'],driver:factory,stateCheck:stateCheck(raw=>({paid:raw.paid,shipped:raw.shipped,cancelled:raw.cancelled,refunds:raw.refunds}),(expected,actual)=>{comparisons++;return isDeepStrictEqual(expected,actual);})});
  if(name!=='normal'||result.tracesReplayed<1||comparisons<1||calls<1)throw Error('Expected a real compared replay');
  results.push({name,status:'pass',tracesReplayed:result.tracesReplayed,seed:result.seed,comparisons,calls,elapsedMs:Math.round(performance.now()-started)});
 }catch(error){
  if(name==='normal')throw error;
  if(error?._tag!=='StateMismatchError'&&!String(error).includes('StateMismatchError'))throw error;
  if(!comparisons||!calls)throw Error('Fault failed before compared implementation calls');
  results.push({name,status:'fail',errorTag:error._tag??error.name,comparisons,calls,elapsedMs:Math.round(performance.now()-started)});
 }
}
const record={schemaVersion:1,scope:'Opt-in compatibility PoC; actual stateCheck and module calls. Community run return alone is not authenticated conformance evidence.',quintVersion:'0.33.1',connectVersion:'2.1.0',backend:'typescript',node:process.version,modelSha256:hashBytes(await readFile(join(root,'specs/order.qnt'))),implementationSha256:hashBytes(await readFile(join(root,'src/order.mjs'))),driverSha256:hashBytes(await readFile(fileURLToPath(import.meta.url))),maxSteps:8,maxSamples:100,requestedTraces:20,seed:'42',results};
await mkdir(join(source,'docs/evidence'),{recursive:true});await writeFile(join(source,'docs/evidence/formal-connect-compatibility.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify(record));
