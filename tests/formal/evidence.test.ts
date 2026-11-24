import { describe, expect, it } from 'vitest';
import * as core from '../../packages/core/src/index.js';

// Each test mutates a different trust/coverage boundary; expected results are
// literal and never calculated by the evaluator being tested.
const digest='a'.repeat(64), changed='b'.repeat(64);
const fixtureTraceHash=core.hash([{id:'trace-1',steps:['init','Pay','Refund'].map((action,index)=>({index,action,parameters:{},expected:{state:index}}))}]);
const identity={modelHash:digest,configHash:digest,commandHash:digest,driverHash:digest,implementationHash:digest,traceHash:fixtureTraceHash};
const model={id:'ORDER',module:'order',model:'specs/order.qnt',quint:{entry:'.tools/quint.js',version:'0.33.1'},invariants:['refundAtMostOnce'],checks:['parse','typecheck','test','run','verify'],maxSteps:8,maxSamples:20,seed:'42',report:'.behavproof/model.json',driver:'driver.mjs',implementation:'src/order.mjs',conformanceReport:'.behavproof/conformance.json',requiredActions:['init','Pay','Refund'],minTraces:1,minComparisons:3,requireCanary:true,replayScope:{observedFields:['state'],rationale:'The complete inputs determine the state.'}};
const stages=['parse','typecheck','test','run','verify'].map(stage=>({stage,status:'pass',complete:true,exitCode:0,toolVersion:'0.33.1',backend:stage==='verify'?'apalache':stage==='run'?'typescript':'quint',method:({parse:'parse',typecheck:'typecheck',test:'spec_test',run:'simulation',verify:'bounded_model_check'} as any)[stage],properties:['refundAtMostOnce'],maxSteps:8,maxSamples:20,seed:'42',diagnostics:[]}));
const modelReport=()=>({schemaVersion:1,modelId:'ORDER',identity:{modelHash:digest,configHash:digest,commandHash:digest},stages:structuredClone(stages)});
const replay=()=>({schemaVersion:1,modelId:'ORDER',identity:{...identity},runner:'behavproof-external-driver/1',observation:'module-functions',complete:true,diagnostics:[],traces:[{id:'trace-1',complete:true,steps:['init','Pay','Refund'].map((action,index)=>({index,action,parameters:{},status:'pass',expected:{state:index},actual:{state:index},comparisonCount:1,implementationCalls:1}))}],canary:{faultId:'double-refund',implementationHash:changed,originalImplementationHash:digest,driverHash:digest,traceHash:fixtureTraceHash,observedCalls:3,comparedSteps:3,detectedMismatches:1,failure:{traceId:'trace-1',index:2,action:'Refund',implementationCalls:1,expected:{state:2},actual:{state:99}}}});
const expected=()=>({model,identity:{...identity},authenticated:true,canaryImplementationHash:changed});
const evaluateModel=(value:unknown,ex:unknown=expected())=>(core as any).evaluateFormalModel(value,ex);
const evaluateReplay=(value:unknown,ex:unknown=expected())=>(core as any).evaluateModelConformance(value,ex);

describe('independent scoped formal evidence',()=>{
 it('keeps formal evidence opt-in under the versioned native configuration',()=>{
  expect(core.parseConfig({schemaVersion:2})).not.toHaveProperty('formal');
  expect(core.parseConfig({schemaVersion:2,formal:{models:[model]}}).formal.models[0].id).toBe('ORDER');
 });
 it('rejects historical Contract bindings as Quint model configuration',()=>{
  const {module,invariants,...base}=model;
  const legacy={...base,contractId:'ORDER-MODEL',properties:invariants};
  expect(core.FormalModelConfigSchema.safeParse(legacy).success).toBe(false);
  expect(core.FormalModelConfigSchema.safeParse({...model,contractId:'ORDER-MODEL'}).success).toBe(false);
 });
 it('preserves each model stage and discloses bounded and sampled scope',()=>{
  const result=evaluateModel(modelReport());expect(result.status).toBe('pass');
  expect(result.scope).toMatchObject({modelId:'ORDER',unbounded:false,maxSteps:8,seed:'42'});
  expect(result.stages.map((s:any)=>s.stage)).toEqual(['parse','typecheck','test','run','verify']);
  expect(evaluateReplay(undefined).status).toBe('unknown');
 });
 it('keeps conformance successful when the independent model report is missing',()=>{
  expect(evaluateReplay(replay()).status).toBe('pass');expect(evaluateModel(undefined).status).toBe('unknown');
 });
 it('retains model counterexamples without passing on later successful stages',()=>{
  const report=modelReport();report.stages[3]!.status='fail';report.stages[3]!.exitCode=1;
  expect(evaluateModel(report).status).toBe('fail');
 });
 it.each(['parse','typecheck','test','run','verify'])('does not accept missing or incomplete %s stage',stage=>{
  const report=modelReport();report.stages=report.stages.filter(s=>s.stage!==stage);
  expect(evaluateModel(report).status).toBe('unknown');
  const incomplete=modelReport();incomplete.stages.find(s=>s.stage===stage)!.complete=false;
  expect(evaluateModel(incomplete).status).toBe('unknown');
 });
 it('rejects missing invariants, reduced bounds, simulator substitution and mismatched versions/seeds',()=>{
  for(const edit of [(r:any)=>r.stages[4].properties=[],(r:any)=>r.stages[4].maxSteps=2,(r:any)=>r.stages[4].method='simulation',(r:any)=>r.stages[4].toolVersion='0.1.0',(r:any)=>r.stages[3].seed='17']){
   const report=modelReport();edit(report);expect(evaluateModel(report).status).toBe('unknown');
  }
  expect(()=>evaluateModel(modelReport(),{...expected(),model:{...model,invariants:[]}})).toThrow();
 });
 it('does not authenticate report bytes using their own declared success',()=>{
  expect(evaluateModel(modelReport(),{...expected(),authenticated:false}).status).toBe('unknown');
  expect(evaluateReplay(replay(),{...expected(),authenticated:false}).status).toBe('unknown');
 });
 it.each(['modelHash','configHash','commandHash'])('invalidates stale model %s',field=>{
  const report=modelReport();(report.identity as any)[field]=changed;
  expect(evaluateModel(report).status).toBe('unknown');
 });
 it.each(['modelHash','driverHash','implementationHash','configHash','commandHash','traceHash'])('invalidates stale conformance %s',field=>{
  const report=replay();(report.identity as any)[field]=changed;
  expect(evaluateReplay(report).status).toBe('unknown');
 });
 it('derives real trace/comparison/call counts and refuses zero or mock-only work',()=>{
  expect(evaluateReplay(replay()).counts).toMatchObject({replayedTraces:1,replayedSteps:3,comparedSteps:3,implementationCalls:3});
  const empty=replay();empty.traces=[];expect(evaluateReplay(empty).status).toBe('unknown');
  for(const field of ['comparisonCount','implementationCalls']){const report=replay();for(const step of report.traces[0]!.steps)(step as any)[field]=0;expect(evaluateReplay(report).status).toBe('unknown');}
 });
 it('checks actual expected/observed values even if a report labels a mismatch pass',()=>{
  const report=replay();report.traces[0]!.steps[2]!.actual={state:99};
  expect(evaluateReplay(report).status).toBe('fail');
 });
 it('requires reached actions and completed unique traces/step indices',()=>{
  const missing=replay();missing.traces[0]!.steps.pop();expect(evaluateReplay(missing).status).toBe('unknown');
  const incomplete=replay();incomplete.traces[0]!.complete=false;expect(evaluateReplay(incomplete).status).toBe('unknown');
  const duplicate=replay();duplicate.traces.push(duplicate.traces[0]!);expect(()=>evaluateReplay(duplicate)).toThrow();
  const indices=replay();indices.traces[0]!.steps[1]!.index=0;expect(()=>evaluateReplay(indices)).toThrow();
 });
 it('requires the same Driver/trace and actual mismatches in the fault canary',()=>{
  for(const edit of [(r:any)=>delete r.canary,(r:any)=>r.canary.detectedMismatches=0,(r:any)=>r.canary.observedCalls=0,(r:any)=>r.canary.driverHash=changed,(r:any)=>r.canary.traceHash=changed,(r:any)=>r.canary.implementationHash=digest]){
   const report=replay();edit(report);expect(evaluateReplay(report).status).toBe('unknown');
  }
 });
 it('rejects malformed counts and contradictory stage method/result metadata',()=>{
  const report=replay();report.traces[0]!.steps[0]!.comparisonCount=-1;expect(()=>evaluateReplay(report)).toThrow();
  const bad=modelReport();bad.stages[4]!.exitCode=2;expect(evaluateModel(bad).status).toBe('unknown');
 });
 it('requires evidence of the selected checker version',()=>{
  const ex={...expected(),model:{...model,quint:{...model.quint,apalacheVersion:'0.56.1'}}};
  expect(evaluateModel(modelReport(),ex).status).toBe('unknown');
  const report=modelReport();(report.stages[4] as any).backendVersion='0.56.1';
  expect(evaluateModel(report,ex).status).toBe('pass');
 });
 it('requires the canary mismatch to match a real baseline comparison point',()=>{
  for(const edit of [(r:any)=>delete r.canary.failure,(r:any)=>r.canary.failure.traceId='other-trace',(r:any)=>r.canary.failure.actual={state:2},(r:any)=>r.canary.failure.implementationCalls=0,(r:any)=>r.canary.failure.expected={state:98}]){
   const report=replay();edit(report);expect(evaluateReplay(report).status).toBe('unknown');
  }
  expect(evaluateReplay(replay(),{...expected(),canaryImplementationHash:digest}).status).toBe('unknown');
  const missing=expected();delete (missing as any).canaryImplementationHash;expect(evaluateReplay(replay(),missing).status).toBe('unknown');
 });
 it('accounts for action names without inheriting object prototype counts',()=>{
  const report=replay();report.traces[0]!.steps[0]!.action='constructor';
  const traceHash=core.hash(report.traces.map(t=>({id:t.id,steps:t.steps.map(s=>({index:s.index,action:s.action,parameters:s.parameters,expected:s.expected}))})));report.identity.traceHash=traceHash;report.canary.traceHash=traceHash;
  const ex={...expected(),identity:{...identity,traceHash},model:{...model,requiredActions:['constructor','Pay','Refund']}};
  expect(evaluateReplay(report,ex).counts.actions.constructor).toBe(1);
 });
 it('refuses source escapes, duplicate models and unreasonable bounds in opt-in configuration',()=>{
  for(const change of [{model:'../order.qnt'},{maxSteps:0},{driver:'/tmp/driver.mjs'},{report:'a/../out.json'}])expect(()=>core.parseConfig({schemaVersion:2,formal:{models:[{...model,...change}]}})).toThrow();
  expect(()=>core.parseConfig({schemaVersion:2,formal:{models:[model,model]}})).toThrow();
 });
});
it.each(['trace','suffix'])('rejects omitted %s inventory even above action and count floors',kind=>{
 const report=replay();report.traces[0]!.steps.push({index:3,action:'Wait',status:'pass',expected:{state:2},actual:{state:2},comparisonCount:1,implementationCalls:1});report.traces.push({...structuredClone(report.traces[0]!),id:'trace-2'});
 const projection=report.traces.map(t=>({id:t.id,steps:t.steps.map(s=>({index:s.index,action:s.action,parameters:{},expected:s.expected}))}));
 const traceHash=core.hash(projection),ex={...expected(),identity:{...identity,traceHash}};report.identity.traceHash=traceHash;report.canary.traceHash=traceHash;
 // Explicit parameters match the real ITF projection; the omitted inventory
 // leaves all original init/Pay/Refund actions and minimum counts satisfied.
 for(const t of report.traces)for(const s of t.steps)(s as any).parameters={};
 if(kind==='trace')report.traces.pop();else report.traces[0]!.steps.pop();
 expect(evaluateReplay(report,ex).status).toBe('unknown');
});
