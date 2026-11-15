import { canonicalJson, FormalInputIdentitySchema, ModelConformanceReportSchema, type FormalInputIdentity, type ModelConformanceReport, type ReplayStep, type ReplayTrace } from '@behavproof/core';
import { decodeFormalParameters, toFormalJson, type ReplayInputTrace } from './itf.js';
export type Implementation=Record<string,unknown>;
export type ReplayDriver={dispatch:(action:string,parameters:unknown)=>unknown|Promise<unknown>;observe?:()=>unknown|Promise<unknown>;dispose?:()=>unknown|Promise<unknown>};
export type ReplayOptions={modelId:string;identity:FormalInputIdentity;traces:readonly ReplayInputTrace[];implementation:Implementation;createDriver:(implementation:Implementation)=>ReplayDriver|Promise<ReplayDriver>;canary?:{faultId:string;implementationHash:string;implementation:Implementation}};
async function execute(options:ReplayOptions,implementation:Implementation){
 const traces:ReplayTrace[]=[],diagnostics:string[]=[];let complete=true;
 if(options.traces.length>10000)throw Error('Replay trace count exceeds limit');
 if(new Set(options.traces.map(t=>t.id)).size!==options.traces.length)throw Error('Duplicate replay trace IDs');
 for(const input of options.traces){
  if(input.steps.length>10001||input.steps.some((s,i)=>s.index!==i))throw Error('Invalid replay step indices/count');
  let calls=0;const wrapped:Implementation=Object.create(null);
  // ESM exports can be live getter bindings (e.g. under a TS/Vitest loader).
  // Loading module exports is part of this explicit executable replay API.
  for(const name of Object.keys(implementation)){const fn=Reflect.get(implementation,name);if(typeof fn==='function')wrapped[name]=(...args:unknown[])=>{calls++;return Reflect.apply(fn,implementation,args);};}
  const trace:ReplayTrace={id:input.id,complete:input.steps.length>0,steps:[]};traces.push(trace);
  let driver:ReplayDriver|undefined;
  try{
   driver=await options.createDriver(wrapped);
   if(!driver||typeof driver.dispatch!=='function')throw Error('Driver dispatch unavailable');
   for(const step of input.steps){
    calls=0;const row:ReplayStep={index:step.index,action:step.action,parameters:structuredClone(step.parameters),expected:structuredClone(step.expected),status:'unknown',comparisonCount:0,implementationCalls:0};
    trace.steps.push(row);
    try{
     await driver.dispatch(step.action,decodeFormalParameters(step.parameters));
     if(typeof driver.observe!=='function'){row.diagnostic='Driver state comparison unavailable';trace.complete=false;continue;}
     row.actual=toFormalJson(await driver.observe());row.comparisonCount=1;
     row.status=canonicalJson(row.expected)===canonicalJson(row.actual)?'pass':'fail';
    }catch(error){
     row.diagnostic=(error instanceof Error?error.message:'Driver execution error').slice(0,2000);trace.complete=false;
     if(calls>0){row.actual={error:row.diagnostic};row.comparisonCount=1;row.status='fail';}
    }finally{row.implementationCalls=calls;}
   }
  }catch(error){trace.complete=false;diagnostics.push((error instanceof Error?error.message:'Driver creation failed').slice(0,2000));}
  finally{try{await driver?.dispose?.();}catch(error){trace.complete=false;diagnostics.push((error instanceof Error?error.message:'Driver cleanup failed').slice(0,2000));}}
  if(!trace.complete)complete=false;
 }
 return {traces,complete,diagnostics};
}
/** The adapter owns comparisons and observed calls. Drivers only receive
 * action/pick values and wrapped module exports, not expected state or a pass
 * setter. This is scoped runtime observation under the selected producer. */
export async function replayTraces(options:ReplayOptions):Promise<ModelConformanceReport>{
 const identity=FormalInputIdentitySchema.parse(options.identity);
 if(!identity.driverHash||!identity.implementationHash||!identity.traceHash)throw Error('Replay requires explicit current Driver/implementation/trace identity');
 const normal=await execute(options,options.implementation);
 const report:ModelConformanceReport={schemaVersion:1,modelId:options.modelId,identity,runner:'@behavproof/adapter-model-test/1',observation:'module-functions',...normal};
 if(options.canary){
  const faulty=await execute(options,options.canary.implementation);let observedCalls=0,comparedSteps=0,detectedMismatches=0,failure:NonNullable<ModelConformanceReport['canary']>['failure'];
  for(const trace of faulty.traces)for(const step of trace.steps){
   observedCalls+=step.implementationCalls;comparedSteps+=step.comparisonCount;
   if(step.comparisonCount&&step.actual!==undefined&&canonicalJson(step.actual)!==canonicalJson(step.expected)){
    detectedMismatches++;failure??={traceId:trace.id,index:step.index,action:step.action,implementationCalls:step.implementationCalls,expected:step.expected,actual:step.actual};
   }
  }
  report.canary={faultId:options.canary.faultId,implementationHash:options.canary.implementationHash,originalImplementationHash:identity.implementationHash,driverHash:identity.driverHash,traceHash:identity.traceHash,observedCalls,comparedSteps,detectedMismatches,...(failure?{failure}:{})};
 }
 return ModelConformanceReportSchema.parse(report);
}
