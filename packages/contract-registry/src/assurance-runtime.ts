import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {isAbsolute,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {AssuranceBundleSchema,AssuranceDefinitionSchema,canonicalJson,hash,hashBytes,safeRead,RelativePathSchema,type Contract,type AssuranceCheck,type AssuranceObservation,type AssuranceComparison,type AssuranceReport,type AssuranceSubject,type AssuranceInputHashes,type AssuranceFaultDefinition,type AssuranceEffectEvent,type AssuranceLayerReceipt,type AssuranceCounterexample,type AssuranceMedia} from '@behavproof/core';
import {inspectArchitecture} from './architecture.js';
type Module=Record<string,unknown>;
export type RuntimeEnvironment={dependencies:any;captureMedia:(ref:string)=>Promise<void>;effect:(scope:string,id:string,targetRef:string,operation:string,input:unknown)=>Promise<unknown>;layer:(id:string,input:unknown)=>Promise<unknown>;invocationId:()=>string;withInvocation:<T>(id:string,fn:()=>Promise<T>)=>Promise<T>};
export type RuntimeContext={dependencies?:unknown;close?:()=>Promise<void>|void};
export type RuntimeDriver={createContext?:(input:{check:AssuranceCheck;input:unknown;harness:RuntimeEnvironment})=>RuntimeContext|Promise<RuntimeContext>};
export type AssuranceRunOptions={root:string;contracts:readonly Contract[];subject:AssuranceSubject;inputHashes:AssuranceInputHashes;implementationSources:readonly string[];driver?:RuntimeDriver};
const clone=<T>(v:T):T=>structuredClone(v);
const json=<T>(v:T):T & AssuranceComparison['input']=>{canonicalJson(v);return clone(v) as T & AssuranceComparison['input'];};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const fn=(m:Module,key:string)=>{const value=m[key];if(typeof value!=='function')throw Error(`Required export ${key} unavailable`);return value as (...args:any[])=>any;};
export function seededRandom(seed:string){let state=Number.parseInt(hash(seed).slice(0,8),16)>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000;};}

type LoadedSnapshot={root:string;identity:string;state:{tainted:boolean}};
// A nonce reloads the selected module, but Node retains its unqualified transitive imports.
// Keep reservations even after a failed import/run: a partial graph may already be cached.
const loadedSnapshots:LoadedSnapshot[]=[];
const freshProcess=()=>Error('Assurance source snapshot changed or a previous run failed after module loading; use a fresh Node process or the behavproof assurance run CLI');
const containsRoot=(parent:string,child:string)=>{const path=relative(parent,child);return path===''||(!isAbsolute(path)&&path!=='..'&&!path.startsWith(`..${sep}`));};
function reserveSnapshot(root:string,inputHashes:AssuranceInputHashes):LoadedSnapshot{
 const identity=hash(Object.fromEntries(Object.entries(inputHashes).map(([path,digest])=>[join(root,path),digest])));
 let shared:LoadedSnapshot|undefined,sameRoot:LoadedSnapshot|undefined;
 // No await between checking and reserving: concurrent runs must see this before import.
 for(const prior of loadedSnapshots)if(containsRoot(root,prior.root)||containsRoot(prior.root,root)){
  if(prior.identity!==identity||prior.state.tainted)throw freshProcess();
  shared=prior;if(prior.root===root)sameRoot=prior;
 }
 if(sameRoot)return sameRoot;
 const snapshot={root,identity,state:shared?.state??{tainted:false}};loadedSnapshots.push(snapshot);return snapshot;
}

/** Explicit execution only. Reused processes require unchanged selected source inventories/bytes.
 * Receipts establish selected export/adaptor calls, not arbitrary dependency isolation or inner-code honesty. */
export async function runAssurance(options:AssuranceRunOptions){
 const o={...options,root:await realpath(options.root),inputHashes:{...options.inputHashes},implementationSources:[...options.implementationSources]},cache=new Map<string,Module>(),sources:Record<string,Uint8Array>={},nonce=randomUUID();
 for(const [path,digest] of Object.entries(o.inputHashes)){const bytes=await safeRead(o.root,path);if(hashBytes(bytes)!==digest)throw Error(`Source input identity changed: ${path}`);sources[path]=bytes;}
 let snapshot:LoadedSnapshot|undefined;
 try{
 const load=async(path:string)=>{
  RelativePathSchema.parse(path);if(!Object.hasOwn(sources,path))throw Error(`Source outside selected input identity: ${path}`);
  snapshot??=reserveSnapshot(o.root,o.inputHashes);if(snapshot.state.tainted)throw freshProcess();
  if(!cache.has(path)){if(hashBytes(await safeRead(o.root,path))!==o.inputHashes[path])throw Error(`Source input identity changed: ${path}`);cache.set(path,await import(`${pathToFileURL(join(o.root,path)).href}?assurance=${nonce}`));}
  return cache.get(path)!;
 };
 const target=(ref:string)=>{const parts=ref.split('#');if(parts.length!==2||!parts[1])throw Error('Runtime target must be relative-file#export');return {path:RelativePathSchema.parse(parts[0]),name:parts[1]};};
 const reports:AssuranceReport[]=[];
 for(const contract of o.contracts){
  if(!contract.assurance)continue;
  const definition=AssuranceDefinitionSchema.parse(contract.assurance),checks:AssuranceObservation[]=[],faults:AssuranceReport['faults']=[];
  for(const check of definition.checks){
   let prepared:unknown;
   if(check.method==='property'){
    const generator=await load(check.generator),random=seededRandom(check.seed),trials=[];
    if(check.runs>10000)throw Error('Property trial bound exceeds report limit');
    for(let index=0;index<check.runs;index++){
     try{const input=json(await fn(generator,'generate')({random,index,domain:clone(check.domain)}));const accepted=typeof generator.accept==='function'?await (generator.accept as Function)(clone(input)):true;
      if(typeof accepted!=='boolean')throw Error('Generator accept must return boolean');
      const classes=accepted&&typeof generator.classify==='function'?json(await (generator.classify as Function)(clone(input))):[];
      if(!Array.isArray(classes)||classes.some(x=>typeof x!=='string'))throw Error('Generator classifications must be string[]');
      trials.push({id:`trial-${index}`,index,input,discarded:!accepted,classes:[...new Set(classes)]});
     }catch(e){trials.push({id:`trial-${index}`,index,input:null,discarded:false,classes:[],error:`Generator: ${err(e)}`});}
    }prepared=trials;
   }else if(check.method==='sequence'){
    if(check.minTraces*check.maxSteps>10000)throw Error('Sequence bound exceeds report limit');
    const generator=await load(check.generator),model=await load(check.model),projection=await load(check.projection),random=seededRandom(check.seed),traces=[];
    for(let i=0;i<check.minTraces;i++){
     const generated=json(await fn(generator,'generateTrace')({random,index:i,maxSteps:check.maxSteps}));
     if(!generated||!Array.isArray(generated.actions)||generated.actions.length>check.maxSteps)throw Error('Invalid generated trace bounds');
     let state=json(await fn(model,'initial')(clone(generated.initial??null)));const initialModel=clone(state),initialExpected=json(await fn(projection,'project')(clone(state))),steps=[];
     for(const [index,action] of generated.actions.entries()){
      if(!action||typeof action.action!=='string')throw Error('Invalid generated action');
      const before=clone(state);state=json(await fn(model,'next')(clone(state),clone(action)));
      steps.push({id:`trace-${i}:step-${index}`,index,action:action.action,input:{action:action.action,parameters:json(action.input??null)},expected:json(await fn(projection,'project')(clone(state))),modelBefore:before,modelAfter:clone(state)});
     }traces.push({id:`trace-${i}`,initial:generated.initial??null,initialModel,initialExpected,steps});
    }prepared=traces;
   }
   const collect=async(fault?:AssuranceFaultDefinition):Promise<AssuranceObservation>=>{
    if(check.method==='architecture')return inspectArchitecture(check,sources,fault?{source:sources[fault.implementation]!}:undefined);
    const selected=target(check.targetRef),path=fault?fault.implementation:selected.path;
    if(!fault&&!o.implementationSources.includes(path))throw Error('Target outside implementation sources');
    const implementation=await load(path),call=fn(implementation,selected.name),base={checkId:check.id,checkHash:hash(check),complete:true};
    const media:AssuranceMedia[]=[];
    const als=new AsyncLocalStorage<{callId:string;rowId:string;events:AssuranceEffectEvent[];layers:Map<string,AssuranceLayerReceipt[]>}>(),active=new Map<string,{callId:string;rowId:string;events:AssuranceEffectEvent[];layers:Map<string,AssuranceLayerReceipt[]>}>();
    let dependencies:unknown={};
    const context=()=>{const c=als.getStore();if(!c||!active.has(c.callId))throw Error('Observation outside active invocation/window');return c;};
    const harness:RuntimeEnvironment={
     get dependencies(){return dependencies;},
     invocationId:()=>context().callId,
     withInvocation:async(id,action)=>{const c=active.get(id);if(!c)throw Error('Unknown invocation correlation');return als.run(c,action);},
     captureMedia:async(ref)=>{
      if(check.method!=='journey'||!RelativePathSchema.parse(ref).startsWith('.behavproof/'))throw Error('Media must be explicitly captured from a managed journey path');
      const current=context(),bytes=await safeRead(o.root,ref);if(!active.has(current.callId))throw Error('Media capture did not complete within the active step');
      media.push({ref,sha256:hashBytes(bytes),stepId:current.rowId});
     },
     effect:async(scope,id,targetRef,operation,input)=>{
      if(check.method!=='effects')throw Error('Effect adapter is not selected');const resource=check.resources.find(r=>r.scope===scope);
      if(!resource||!resource.targets.includes(targetRef))throw Error('Effect resource/target outside declared scope');
      const c=context(),adapter=await load(resource.adapter);
      c.events.push({eventId:randomUUID(),id,scope,operation,targetRef,callId:c.callId});
      return fn(adapter,'perform')({id,scope,operation,targetRef,input:clone(input)},dependencies);
     },
     layer:async(id,input)=>{
      if(check.method!=='journey')throw Error('Layer adapter is not selected');const binding=check.layerBindings.find(b=>b.id===id);if(!binding)throw Error('Undeclared journey layer');
      const boundary=target(binding.targetRef);if(boundary.path!==binding.adapter)throw Error('Layer boundary must select its declared adapter export');
      const c=context(),adapter=await load(binding.adapter),actual=json(await fn(adapter,boundary.name)(clone(input),dependencies));
      const list=c.layers.get(id)??[];list.push({observationId:randomUUID(),invocationId:c.callId,targetRef:binding.targetRef,mocked:false,input:json(input),actual:clone(actual)});c.layers.set(id,list);return actual;
     },
    };
    Object.freeze(harness);
    const withContext=async<T>(input:unknown,work:()=>Promise<T>)=>{
     const ctx=await o.driver?.createContext?.({check:clone(check),input:clone(input),harness})??{};dependencies=ctx.dependencies??{};
     try{return await work();}finally{await ctx.close?.();dependencies={};}
    };
    const invoke=async(row:{id:string;input:unknown;expected:unknown},extend?:(row:AssuranceComparison,state:ReturnType<typeof context>)=>Promise<void>)=>{
     const captured={id:row.id,input:json(row.input),inputHash:hash(row.input),expected:json(row.expected),calls:0,receipts:[]} as AssuranceComparison;
     const receipt:AssuranceComparison['receipts'][number]={callId:randomUUID(),targetRef:check.targetRef,implementation:path,implementationHash:o.inputHashes[path]!,variant:fault?'fault':'baseline',...(fault?{faultId:fault.id}:{}),input:clone(captured.input)};
     const state={callId:receipt.callId,rowId:row.id,events:[] as AssuranceEffectEvent[],layers:new Map<string,AssuranceLayerReceipt[]>()};active.set(state.callId,state);
     try{await als.run(state,async()=>{
      captured.calls=1;captured.receipts.push(receipt);
      try{receipt.output=json(await call(clone(captured.input),harness));captured.actual=clone(receipt.output);}catch(e){receipt.error=err(e);captured.error=err(e);}
      await extend?.(captured,state);
     });}finally{active.delete(state.callId);}return captured;
    };
    if(check.method==='example'){
     const samples=[];for(const c of check.cases)samples.push(await withContext(c.input,()=>invoke(c)));
     return {...base,method:'example',samples,comparisonCount:samples.filter(s=>s.actual!==undefined).length};
    }
    if(check.method==='effects'){
     const samples=[];
     for(const c of check.cases)samples.push(await withContext(c.input,async()=>{
      const before:Record<string,any>={},after:Record<string,any>={},resourceObservations:any[]=[];let events:AssuranceEffectEvent[]=[];
      for(const resource of check.resources)before[resource.scope]=json(await fn(await load(resource.adapter),'snapshot')(clone(resource.targets),dependencies));
      const start=performance.now();
      const row=await invoke(c,async(r,state)=>{
       // Keep the correlated operation window open after the immediate result.
       const remaining=check.window.durationMs-(performance.now()-start);if(remaining>0)await delay(Math.ceil(remaining));
       for(const resource of check.resources){after[resource.scope]=json(await fn(await load(resource.adapter),'snapshot')(clone(resource.targets),dependencies));resourceObservations.push({scope:resource.scope,adapter:resource.adapter,adapterHash:o.inputHashes[resource.adapter]!,targets:clone(resource.targets),callIds:r.receipts.map(v=>v.callId),elapsedMs:Math.ceil(performance.now()-start),settledBy:check.window.settledBy,settled:true});}
       events=clone(state.events);
      });return {...row,before,after,effects:events,resourceObservations};
     }));return {...base,method:'effects',scope:clone(check.scope),window:clone(check.window),samples,comparisonCount:samples.filter(s=>s.actual!==undefined).length};
    }
    if(check.method==='property'){
     const predicate=await load(check.predicate),samples:Extract<AssuranceObservation,{method:'property'}>['samples']=[],counterexamples:AssuranceCounterexample[]=[];
     for(const trial of prepared as any[]){
      if(trial.discarded||trial.error){samples.push({...trial,inputHash:hash(trial.input),expected:true,calls:0,receipts:[]});continue;}
      const row=await withContext(trial.input,()=>invoke({...trial,expected:true},async r=>{
       if(r.actual!==undefined&&!r.error)try{const satisfied=await fn(predicate,'test')(clone(trial.input),clone(r.actual));if(typeof satisfied!=='boolean')throw Error('Property predicate must return boolean');r.actual=satisfied;}catch(e){delete r.actual;r.error=`Predicate: ${err(e)}`;}
      }));samples.push({...row,index:trial.index,discarded:false,classes:clone(trial.classes)});
      if(row.actual===false)counterexamples.push({sampleId:row.id,seed:check.seed,originalInput:clone(row.input),replay:`seed=${check.seed};sample=${row.id}`});
     }
     if(check.shrinker&&counterexamples.length){
      const shrinker=await load(check.shrinker);
      for(const counterexample of counterexamples){
       const candidates=json(await fn(shrinker,'shrink')(clone(counterexample.originalInput)));
       if(!Array.isArray(candidates)||candidates.length>10000)throw Error('Shrinker must return a bounded JSON array');
       const smaller=candidates.map(input=>samples.find(s=>!s.discarded&&s.actual===false&&canonicalJson(s.input)===canonicalJson(input)&&canonicalJson(s.input)!==canonicalJson(counterexample.originalInput))).find(Boolean);
       if(smaller)Object.assign(counterexample,{shrunkInput:clone(smaller.input),shrunkSampleId:smaller.id});
      }
     }
     return {...base,method:'property',domain:clone(check.domain),seed:check.seed,runs:samples.length,valid:samples.filter(s=>!s.discarded).length,discarded:samples.filter(s=>s.discarded).length,samples,comparisonCount:samples.filter(s=>s.actual!==undefined).length,counterexamples};
    }
    if(check.method==='sequence'){
     const projection=await load(check.projection),traces=[];
     for(const trace of prepared as any[])traces.push(await withContext(trace.initial,async()=>{
      const initialActual=json(await fn(projection,'project')(json(await fn(implementation,'observe')(dependencies)))),steps=[];
      for(const step of trace.steps){const row=await invoke(step,async r=>{if(r.actual!==undefined&&!r.error)try{r.actual=json(await fn(projection,'project')(clone(r.actual)));}catch(e){delete r.actual;r.error=`Projection: ${err(e)}`;}});steps.push({...row,index:step.index,action:step.action,modelBefore:clone(step.modelBefore),modelAfter:clone(step.modelAfter)});}
      return {id:trace.id,initialModel:clone(trace.initialModel),initialExpected:clone(trace.initialExpected),initialActual,steps};
     }));return {...base,method:'sequence',seed:check.seed,maxSteps:check.maxSteps,traces,comparisonCount:traces.flatMap(t=>t.steps).filter(s=>s.actual!==undefined).length};
    }
    const steps:Extract<AssuranceObservation,{method:'journey'}>['steps']=[];
    await withContext(null,async()=>{for(const step of check.steps){let layers:Extract<AssuranceObservation,{method:'journey'}>['steps'][number]['layers']=[];
     const row=await invoke(step,async(_,state)=>{layers=[...state.layers].sort(([a],[b])=>a.localeCompare(b)).map(([id,observations])=>({id,sourceRef:check.layerBindings.find(b=>b.id===id)!.adapter,observations:clone(observations)}));});
     steps.push({...row,action:step.action,layers});
    }});
    return {...base,method:'journey',entrypoint:check.entrypoint,environment:clone(check.environment),mockBoundaries:clone(check.mockBoundaries),steps,media,comparisonCount:steps.filter(s=>s.actual!==undefined).length};
   };
   checks.push(await collect());
   for(const fault of definition.conditions.flatMap(c=>c.requiredFaults).filter(f=>f.checkId===check.id)){
    const observation=await collect(fault);faults.push({faultId:fault.id,checkId:check.id,implementationHash:o.inputHashes[fault.implementation]!,observation});
   }
  }
  reports.push({schemaVersion:1,contractId:contract.id,revisionHash:contract.revisionHash,subject:clone(o.subject),inputHashes:clone(o.inputHashes),checks,faults});
 }
 for(const [path,digest] of Object.entries(o.inputHashes))if(hashBytes(await safeRead(o.root,path))!==digest)throw Error(`Source input identity changed during observation: ${path}`);
 if(snapshot?.state.tainted)throw freshProcess();
 return AssuranceBundleSchema.parse({schemaVersion:1,reports});
 }catch(error){if(snapshot)snapshot.state.tainted=true;throw error;}
}
