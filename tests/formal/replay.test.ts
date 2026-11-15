import { expect, it } from 'vitest';
import { hash, evaluateModelConformance, FormalModelConfigSchema } from '../../packages/core/src/index.js';
const adapter:any=await import('../../packages/adapter-model-test/src/index.js').catch(()=>({}));
const production:any=await import('../../examples/formal-order/src/order.mjs').catch(()=>({}));
const digest='a'.repeat(64),faultHash='b'.repeat(64);
const identity={modelHash:digest,configHash:digest,commandHash:digest,driverHash:digest,implementationHash:digest,traceHash:digest};
const model=FormalModelConfigSchema.parse({id:'ORDER',contractId:'ORDER-MODEL',model:'specs/order.qnt',quint:{entry:'quint.js',version:'0.33.1'},properties:['refundAtMostOnce'],checks:['run'],maxSteps:8,maxSamples:20,seed:'42',report:'model.json',requiredActions:['init','Pay','Refund','Cancel'],minTraces:1,minComparisons:4,requireCanary:false});
const vars=['paid','shipped','cancelled','refunds','mbt::actionTaken','mbt::nondetPicks'];
const state=(index:number,action:string,paid:boolean,refunds:string,cancelled=false)=>({'#meta':{index},paid,shipped:false,cancelled,refunds:{'#bigint':refunds},'mbt::actionTaken':action,'mbt::nondetPicks':{}});
const raw=()=>({'#meta':{format:'ITF',status:'ok'},vars,states:[state(0,'init',false,'0'),state(1,'Pay',true,'0'),state(2,'Refund',true,'1'),state(3,'Cancel',true,'1',true)]});
const driver=(impl:any)=>{let value:any;return {dispatch(action:string){if(action==='init')value=impl.initialize();else value=impl[action.toLowerCase()](value);},observe(){return {...value,refunds:BigInt(value.refunds)};}};};
identity.traceHash=hash([adapter.readITF(raw(),{id:'trace-1'})]);
const replay=(change={})=>adapter.replayTraces({modelId:'ORDER',identity,traces:[adapter.readITF(raw(),{id:'trace-1'})],implementation:production,createDriver:driver,...change});
it('replays the real order module and compares every state independently',async()=>{
 const report=await replay();expect(report.complete,JSON.stringify(report)).toBe(true);expect(report.traces[0].steps.map((s:any)=>s.implementationCalls)).toEqual([1,1,1,1]);
 expect(report.traces[0].steps.map((s:any)=>s.status)).toEqual(['pass','pass','pass','pass']);
 expect(evaluateModelConformance(report,{model,identity,authenticated:true}).status).toBe('pass');
});
it('detects an implementation-only second refund and retains the actual mismatch',async()=>{
 const report=await replay({implementation:{...production,cancel:(s:any)=>({...s,cancelled:true,refunds:s.paid?s.refunds+1:0})}});
 expect(evaluateModelConformance(report,{model,identity,authenticated:true}).status).toBe('fail');
 expect(report.traces[0].steps[3]).toMatchObject({action:'Cancel',status:'fail',comparisonCount:1,implementationCalls:1,actual:{refunds:{'#bigint':'2'}},expected:{refunds:{'#bigint':'1'}}});
});
it('does not grant production observation to a Driver that only reimplements the expected behavior',async()=>{
 const fake=()=>{let value:any;return{dispatch(action:string){if(action==='init')value={paid:false,shipped:false,cancelled:false,refunds:0};if(action==='Pay')value.paid=true;if(action==='Refund')value.refunds=1;if(action==='Cancel')value.cancelled=true;},observe:()=>({...value,refunds:BigInt(value.refunds)})};};
 const report=await replay({createDriver:fake});expect(report.traces[0].steps.every((s:any)=>s.status==='pass')).toBe(true);
 expect(evaluateModelConformance(report,{model,identity,authenticated:true}).status).toBe('unknown');
});
it('preserves a selected module function receiver while observing the real call',async()=>{
 const module={...production,zero:0,initialize(){return {...production.initialize(),refunds:this.zero};}};
 const report=await replay({implementation:module});expect(report.complete).toBe(true);
 expect(report.traces[0].steps[0]).toMatchObject({status:'pass',implementationCalls:1});
});
it('reports missing comparisons, no traces, incomplete actions and thrown Driver errors',async()=>{
 expect(evaluateModelConformance(await replay({traces:[]}),{model,identity,authenticated:true}).status).toBe('unknown');
 const noSnapshot=await replay({createDriver:(impl:any)=>({dispatch:()=>impl.initialize()})});
 expect(evaluateModelConformance(noSnapshot,{model,identity,authenticated:true}).status).toBe('unknown');
 const missing=await replay({createDriver:()=>({dispatch(){throw Error('No such action');},observe:()=>({})})});
 expect(missing.complete).toBe(false);expect(evaluateModelConformance(missing,{model,identity,authenticated:true}).status).toBe('unknown');
});
it('does not let a Driver mutate an expected state through its parameter object',async()=>{
 const r=raw();r.states[1]!['mbt::nondetPicks']={input:{paid:true}} as any;
 const trace=adapter.readITF(r,{id:'trace-1'}),before=hash(trace);
 await adapter.replayTraces({modelId:'ORDER',identity,traces:[trace],implementation:production,createDriver:(impl:any)=>({dispatch(_action:string,picks:any){impl.initialize();if(picks.input)picks.input.paid=false;},observe:()=>({})})});
 expect(hash(trace)).toBe(before);
});
it('rejects duplicate indices, missing state variables, missing actions and oversized/deep ITF',()=>{
 const duplicate=raw();duplicate.states[1]!['#meta'].index=0;expect(()=>adapter.readITF(duplicate)).toThrow(/index/i);
 const missing=raw();delete (missing.states[1] as any).paid;expect(()=>adapter.readITF(missing)).toThrow(/variable|field/i);
 const metadata=raw();delete (metadata.states[1] as any)['mbt::actionTaken'];expect(()=>adapter.readITF(metadata)).toThrow(/action|metadata|variable/i);
 expect(()=>adapter.readITF(raw(),{maxBytes:20})).toThrow(/limit|size/i);
 let value:any=1;for(let n=0;n<70;n++)value={nested:value};const deep=raw();(deep.states[1] as any).paid=value;expect(()=>adapter.readITF(deep)).toThrow(/depth|limit/i);
});
it('preserves arbitrary integer precision and deterministic set/map state encoding',()=>{
 expect(adapter.toFormalJson({n:9007199254740993n,s:new Set([2n,1n]),m:new Map([['b',2n],['a',1n]])})).toEqual({n:{'#bigint':'9007199254740993'},s:{'#set':[{'#bigint':'1'},{'#bigint':'2'}]},m:{'#map':[['a',{'#bigint':'1'}],['b',{'#bigint':'2'}]]}});
 expect(()=>adapter.toFormalJson({n:NaN})).toThrow();
 expect(adapter.toFormalJson(new Set(['ä','z']))).toEqual({'#set':['z','ä']});
 const opaque=raw();(opaque.states[0] as any).paid={'#unserializable':'hidden'};expect(()=>adapter.readITF(opaque)).toThrow(/unsupported|unserializable/i);
});
it('generates a real same-Driver/trace fault canary rather than accepting a boolean',async()=>{
 const report=await replay({canary:{faultId:'double-refund',implementationHash:faultHash,implementation:{...production,cancel:(s:any)=>({...s,cancelled:true,refunds:s.paid?s.refunds+1:0})}}});
 expect(report.canary).toMatchObject({faultId:'double-refund',originalImplementationHash:digest,implementationHash:faultHash,driverHash:digest,traceHash:identity.traceHash,observedCalls:4,comparedSteps:4,detectedMismatches:1});
 expect(report.canary.failure).toMatchObject({traceId:'trace-1',index:3,action:'Cancel',expected:{refunds:{'#bigint':'1'}},actual:{refunds:{'#bigint':'2'}}});
 expect(evaluateModelConformance(report,{model:{...model,requireCanary:true},identity,authenticated:true,canaryImplementationHash:faultHash}).status).toBe('pass');
});
it('hashes semantic trace data without timestamps and retains distinct trace identities',()=>{
 const a=raw(),b=raw();(a['#meta'] as any).timestamp=1;(b['#meta'] as any).timestamp=2;
 expect(hash(adapter.readITF(a,{id:'trace-1'}))).toBe(hash(adapter.readITF(b,{id:'trace-1'})));
 expect(hash(adapter.readITF(a,{id:'trace-1'}))).not.toBe(hash(adapter.readITF(b,{id:'trace-2'})));
});
