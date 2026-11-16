import { describe, expect, it } from 'vitest';
import * as core from '../../packages/core/src/index.js';

const h='a'.repeat(64), other='b'.repeat(64);
const inputHashes={'driver.ts':h,'implementation.ts':h,'fault.ts':other,'generator.ts':h,'predicate.ts':h,'model.ts':h,'projection.ts':h,'adapter.ts':h};
const comparison={id:'one',input:{amount:1},inputHash:core.hash({amount:1}),expected:1,actual:1,calls:1,receipts:[{callId:'call-1',targetRef:'refund',implementation:'implementation.ts',implementationHash:h,variant:'baseline',input:{amount:1},output:1}]};
function fixture(method='example') {
 const sample=structuredClone(comparison);
 let check:any={id:'check',method,targetRef:'refund',cases:[{id:'one',input:{amount:1},expected:1}]};
 let observation:any={checkId:'check',method,complete:true,comparisonCount:1,samples:[sample]};
 if(method==='effects'){
  check={...check,scope:['orders'],resources:[{scope:'orders',adapter:'adapter.ts',targets:['order-1']}],allowedChanges:[],unchangedFields:[{scope:'orders',field:'/balance'}],effects:[{id:'write',scope:'orders',min:0,max:0}],window:{settledBy:'request completed',durationMs:10}};
  observation={...observation,scope:['orders'],window:check.window,samples:[{...sample,before:{orders:{balance:10}},after:{orders:{balance:10}},effects:[],resourceObservations:[{scope:'orders',adapter:'adapter.ts',adapterHash:h,targets:['order-1'],callIds:['call-1'],elapsedMs:10,settledBy:'request completed',settled:true}]}]};
 }
 if(method==='property'){
  check={id:'check',method,targetRef:'refund',domain:{amount:[0,1]},seed:'42',runs:1,minValid:1,maxDiscarded:0,requiredClasses:['boundary'],generator:'generator.ts',predicate:'predicate.ts'};
  observation={checkId:'check',method,complete:true,comparisonCount:1,domain:check.domain,seed:'42',runs:1,valid:1,discarded:0,samples:[{...sample,expected:true,actual:true,index:0,discarded:false,classes:['boundary']}]};
 }
 if(method==='sequence'){
  check={id:'check',method,targetRef:'refund',seed:'42',generator:'generator.ts',model:'model.ts',projection:'projection.ts',maxSteps:2,minTraces:1,requiredActions:['refund']};
  observation={checkId:'check',method,complete:true,comparisonCount:1,seed:'42',maxSteps:2,traces:[{id:'trace',initialModel:0,initialExpected:0,initialActual:0,steps:[{...sample,index:0,action:'refund',modelBefore:0,modelAfter:1}]}]};
 }
 if(method==='architecture'){
  check={id:'check',method,targetRef:'implementation.ts',files:['implementation.ts'],rules:[{id:'boundary',from:['implementation.ts'],forbidden:['database']}]};
  observation={checkId:'check',method,complete:true,comparisonCount:1,files:[{path:'implementation.ts',sha256:h,imports:[{specifier:'allowed',dynamic:false,supported:true}]}],rules:['boundary'],violations:[],unsupported:[]};
 }
 if(method==='journey'){
  check={id:'check',method,targetRef:'refund',entrypoint:'POST /refund',environment:{kind:'local'},mockBoundaries:[],layers:['http','database'],layerBindings:[{id:'http',adapter:'implementation.ts',targetRef:'http-boundary'},{id:'database',adapter:'adapter.ts',targetRef:'database-boundary'}],steps:[{id:'one',action:'refund',input:{amount:1},expected:1,layers:['http','database']}]};
  observation={checkId:'check',method,complete:true,comparisonCount:1,entrypoint:check.entrypoint,environment:check.environment,mockBoundaries:[],steps:[{...sample,action:'refund',layers:[{id:'http',sourceRef:'implementation.ts',observations:[{invocationId:'call-1',observationId:'http-1',targetRef:'http-boundary',mocked:false,input:{amount:1},actual:1}]},{id:'database',sourceRef:'adapter.ts',observations:[{invocationId:'call-1',observationId:'database-1',targetRef:'database-boundary',mocked:false,input:{amount:1},actual:1}]}]}],media:[]};
 }
 const definition:any={feature:{id:'refund',entrypoints:['POST /refund']},conditions:[{id:'condition',kind:method==='example'?'postcondition':method==='sequence'?'invariant':method==='effects'?'effect':method,statement:'refund safely',checks:['check'],requiredFaults:[]}],checks:[check]};
 observation.checkHash=core.hash(check);
 const report:any={schemaVersion:1,contractId:'contract',revisionHash:h,subject:{testedCommitSha:'commit-1',sourceTreeHash:h},inputHashes,checks:[observation],faults:[]};
 const expected=()=>({contractId:'contract',revisionHash:h,subject:{testedCommitSha:'commit-1',sourceTreeHash:h},inputHashes,checkHashes:{check:core.hash(check)},implementationSources:['implementation.ts'],authenticatedReportHashes:[core.hash(report)]});
 const evaluate=(reports:any[]=[report],overrides:any={})=>core.evaluateAssuranceConditions(definition,reports,{...expected(),...overrides});
 return {check,definition,observation,report,expected,evaluate};
}

describe('consumer assurance obligations',()=>{
 for(const method of ['example','effects','property','sequence','architecture','journey']) it(`requires actual ${method} observations`,()=>{
  const f=fixture(method);
  expect(f.evaluate().status).toBe('pass');
  f.observation.comparisonCount=0;
  expect(f.evaluate().status).toBe('unknown');
 });
 it('retains legacy config/contract defaults and hashes without opt-in',()=>{
  const config=core.ConfigSchema.parse({schemaVersion:1});
  expect(Object.hasOwn(config,'assurance')).toBe(false);
  const contract=core.ContractSchema.parse({id:'c',kind:'examples',intentIds:[],revisionHash:h,sourceRef:'contract.ts'});
  expect(Object.hasOwn(contract,'assurance')).toBe(false);
  expect(core.ConfigSchema.safeParse({schemaVersion:1,assurance:{driver:'driver.ts',driverSources:['driver.ts'],implementationSources:['implementation.ts'],report:'report.json'}}).success).toBe(true);
  expect(core.ContractSchema.safeParse({...contract,assurance:fixture().definition}).success).toBe(true);
 });
 it('never authenticates its own reports or accepts stale source/check identities',()=>{
  const f=fixture();
  expect(f.evaluate([],{}).status).toBe('unknown');
  expect(f.evaluate([f.report],{authenticatedReportHashes:[]}).status).toBe('unknown');
  expect(f.evaluate([f.report],{inputHashes:{...inputHashes,'implementation.ts':other}}).status).toBe('unknown');
  expect(f.evaluate([f.report],{checkHashes:{check:other}}).status).toBe('unknown');
  expect(f.evaluate([f.report,f.report]).status).toBe('unknown');
  expect(f.evaluate([{...f.report,checks:'malformed'}]).status).toBe('unknown');
 });
 it('rejects ambiguous IDs and missing declared checks',()=>{
  const f=fixture();
  expect(core.AssuranceDefinitionSchema.safeParse({...f.definition,conditions:[...f.definition.conditions,...f.definition.conditions]}).success).toBe(false);
  f.definition.conditions[0].checks.push('missing');
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(false);
 });
 it('distinguishes observed comparison failures from execution errors',()=>{
  const f=fixture();f.observation.samples[0]={...comparison,actual:2,receipts:[{...comparison.receipts[0],output:2}]};
  expect(f.evaluate().conditions[0].status).toBe('fail');
  f.observation.samples[0]={...comparison,error:'database offline'};
  expect(f.evaluate().status).toBe('unknown');
 });
 it('checks actual state and effect events, not returned values alone',()=>{
  const f=fixture('effects');f.observation.samples[0].after.orders.balance=9;
  expect(f.evaluate().status).toBe('fail');
  f.observation.samples[0].after.orders.balance=10;
  f.observation.samples[0].effects.push({eventId:'event-1',id:'write',scope:'orders',operation:'update',targetRef:'order-1',callId:'call-1'});
  expect(f.evaluate().status).toBe('fail');
  f.observation.scope=[];
  expect(f.evaluate().status).toBe('unknown');
 });
 it('rejects vacuous property runs and missing classifications',()=>{
  const f=fixture('property');f.observation.samples[0].classes=[];
  expect(f.evaluate().status).toBe('unknown');
  f.observation.samples=[];f.observation.runs=0;f.observation.valid=0;f.observation.comparisonCount=0;
  expect(f.evaluate().status).toBe('unknown');
 });
 it('rejects discontinuous models, unreached actions and excess sequence bounds',()=>{
  const f=fixture('sequence');f.observation.traces[0].steps[0].modelBefore=1;
  expect(f.evaluate().status).toBe('unknown');
  f.observation.traces[0].steps[0].modelBefore=0;f.observation.traces[0].steps[0].action='other';
  expect(f.evaluate().status).toBe('unknown');
 });
 it('derives import violations and exposes unsupported analysis',()=>{
  const f=fixture('architecture');f.observation.files[0].imports[0].specifier='database/client';
  // Omitting a real violation is inconsistent evidence, never a pass.
  expect(f.evaluate().status).toBe('unknown');
  f.observation.violations=[{ruleId:'boundary',file:'implementation.ts',specifier:'database/client'}];
  expect(f.evaluate().status).toBe('fail');
  f.observation.unsupported=[{file:'implementation.ts',reason:'computed import'}];
  expect(f.evaluate().status).toBe('unknown');
 });
 it('requires journey order, observed layers and authenticated required media',()=>{
  const f=fixture('journey');f.observation.steps[0].layers=[];
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('journey');g.check.requiredMedia=['screen.png'];g.observation.checkHash=core.hash(g.check);g.observation.media=[{ref:'screen.png',sha256:h,stepId:'one'}];
  expect(g.evaluate().status).toBe('unknown');
  expect(g.evaluate([g.report],{authenticatedMedia:{'screen.png':h}}).status).toBe('pass');
 });
 it('requires condition-specific faults to mismatch on the same baseline inputs',()=>{
  const f=fixture();f.definition.conditions[0].requiredFaults=[{id:'skip-auth',kind:'authorization-bypass',checkId:'check',implementation:'fault.ts',detects:[{kind:'result',id:'one'}]}];
  expect(f.evaluate().status).toBe('unknown');
  const fault=structuredClone(f.observation);fault.samples[0].actual=2;fault.samples[0].receipts[0]={...fault.samples[0].receipts[0],callId:'fault-call-1',output:2,implementation:'fault.ts',implementationHash:other,variant:'fault',faultId:'skip-auth'};
  f.report.faults=[{faultId:'skip-auth',checkId:'check',implementationHash:other,observation:fault}];
  expect(f.evaluate().status).toBe('pass');
  fault.samples[0].input={amount:2};expect(f.evaluate().status).toBe('unknown');
  fault.samples[0].input={amount:1};fault.samples[0].actual=1;fault.samples[0].receipts[0].output=1;expect(f.evaluate().status).toBe('unknown');
  fault.samples[0].error='crash';expect(f.evaluate().status).toBe('unknown');
 });
 it('requires current materialized inputs and observed target call receipts',()=>{
  const f=fixture();f.observation.samples[0]={...comparison,receipts:[]};
  expect(f.evaluate().status).toBe('unknown');
  f.observation.samples[0]={...comparison,inputHash:other};expect(f.evaluate().status).toBe('unknown');
  f.observation.samples[0]={...comparison,receipts:[{...comparison.receipts[0],targetRef:'unrelated'}]};expect(f.evaluate().status).toBe('unknown');
 });
 it('does not allow a passing condition to hide a missing independent condition',()=>{
  const f=fixture();const c={...f.check,id:'second'};f.definition.checks.push(c);f.definition.conditions.push({id:'second',kind:'invariant',statement:'independent obligation',checks:['second'],requiredFaults:[]});
  expect(f.evaluate().conditions.map((x:any)=>x.status)).toEqual(['pass','unknown']);
 });
 it('requires fault detection on its declared relevant comparison',()=>{
  const f=fixture();f.check.cases.push({id:'two',input:2,expected:2});
  f.observation.samples.push({...comparison,id:'two',input:2,inputHash:core.hash(2),expected:2,actual:2,receipts:[{...comparison.receipts[0],callId:'call-2',input:2,output:2}]});
  f.observation.comparisonCount=2;f.observation.checkHash=core.hash(f.check);
  f.definition.conditions[0].requiredFaults=[{id:'wrong-result',kind:'result',checkId:'check',implementation:'fault.ts',detects:[{kind:'result',id:'one'}]}];
  const fault=structuredClone(f.observation);
  for(const s of fault.samples)for(const r of s.receipts)Object.assign(r,{callId:`fault-${r.callId}`,variant:'fault',faultId:'wrong-result',implementation:'fault.ts',implementationHash:other});
  fault.samples[1].actual=3;fault.samples[1].receipts[0].output=3;
  f.report.faults=[{faultId:'wrong-result',checkId:'check',implementationHash:other,observation:fault}];
  expect(f.evaluate().status).toBe('unknown');
  fault.samples[0].actual=2;fault.samples[0].receipts[0].output=2;
  expect(f.evaluate().status).toBe('pass');
 });
 it('requires observed effect adapters, bounded completion and operation correlation',()=>{
  const f=fixture('effects');f.observation.samples[0].resourceObservations=[];
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('effects');g.observation.samples[0].resourceObservations[0].elapsedMs=0;
  expect(g.evaluate().status).toBe('unknown');
  const i=fixture('effects');i.observation.samples[0].effects=[{eventId:'event-1',id:'write',scope:'orders',operation:'update',targetRef:'order-1',callId:'unrelated'}];
  expect(i.evaluate().status).toBe('unknown');
 });
 it('rejects unrelated or mocked layer receipts and reused target calls',()=>{
  const f=fixture('journey');f.observation.steps[0].layers[0].observations[0].invocationId='other-step';
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('journey');g.observation.steps[0].layers[0].observations[0].mocked=true;
  expect(g.evaluate().status).toBe('unknown');
  const i=fixture();i.observation.samples[0].receipts[0].implementation='predicate.ts';
  expect(i.evaluate().status).toBe('unknown');
 });
 it('keeps missing root snapshots and non-JSON reports unknown without throwing',()=>{
  const f=fixture('effects');f.check.unchangedFields=[{scope:'orders',field:''}];f.observation.checkHash=core.hash(f.check);f.observation.samples[0].before={};f.observation.samples[0].after={};
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture();
  expect(g.evaluate([{...g.report,extra:undefined}],{authenticatedReportHashes:[]} ).status).toBe('unknown');
 });
 it('cannot re-seal old observations under a new subject with identical selected bytes',()=>{
  const f=fixture();
  expect(f.evaluate([f.report],{subject:{testedCommitSha:'commit-2',sourceTreeHash:h}}).status).toBe('unknown');
  expect(f.evaluate([f.report],{subject:{testedCommitSha:'commit-1',sourceTreeHash:other}}).status).toBe('unknown');
 });
 it('requires true property satisfaction instead of arbitrary equality',()=>{
  const f=fixture('property');f.observation.samples[0].expected=false;f.observation.samples[0].actual=false;
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('property');g.observation.samples[0].actual=false;
  expect(g.evaluate().status).toBe('fail');
 });
 it('rejects valid/discard count inflation and required coverage minima',()=>{
  const f=fixture('property');f.observation.valid=2;
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('property');g.check.classMinimums={boundary:2};g.observation.checkHash=core.hash(g.check);
  expect(g.evaluate().status).toBe('unknown');
  const i=fixture('sequence');i.check.actionMinimums={refund:2};i.observation.checkHash=core.hash(i.check);
  expect(i.evaluate().status).toBe('unknown');
 });
 it('rejects duplicated effect events and unobserved shrunk counterexamples',()=>{
  const f=fixture('effects');const event={eventId:'event-1',id:'write',scope:'orders',operation:'update',targetRef:'order-1',callId:'call-1'};
  f.observation.samples[0].effects=[event,event];
  expect(f.evaluate().status).toBe('unknown');
  const g=fixture('property');g.check.shrinker='generator.ts';g.observation.checkHash=core.hash(g.check);g.observation.samples[0].actual=false;
  g.observation.counterexamples=[{sampleId:'one',seed:'42',originalInput:{amount:1},shrunkInput:{amount:0}}];
  expect(g.evaluate().status).toBe('unknown');
 });
 it('keeps every dynamic import unknown even when its literal specifier is supported',()=>{
  const f=fixture('architecture');f.observation.files[0].imports[0].dynamic=true;
  expect(f.evaluate().status).toBe('unknown');
 });
 it('restricts architecture faults to changed observations at the substituted target',()=>{
  const f=fixture('architecture');f.check.files.push('driver.ts');f.check.rules[0].from.push('driver.ts');
  f.observation.files.push({path:'driver.ts',sha256:h,imports:[{specifier:'allowed',dynamic:false,supported:true}]});
  f.observation.comparisonCount=2;f.observation.checkHash=core.hash(f.check);
  f.definition.conditions[0].requiredFaults=[{id:'forbidden-import',kind:'boundary',checkId:'check',implementation:'fault.ts',detects:[{kind:'rule',id:'boundary'}]}];
  const faulty=structuredClone(f.observation);faulty.files[0].sha256=other;faulty.files[1].imports[0].specifier='database/client';
  faulty.violations=[{ruleId:'boundary',file:'driver.ts',specifier:'database/client'}];
  f.report.faults=[{faultId:'forbidden-import',checkId:'check',implementationHash:other,observation:faulty}];
  expect(f.evaluate().status).toBe('unknown');
  // A relevant target violation still cannot authorize changes to another file.
  faulty.files[0].imports[0].specifier='database/client';faulty.violations.push({ruleId:'boundary',file:'implementation.ts',specifier:'database/client'});
  expect(f.evaluate().status).toBe('unknown');
  faulty.files[1].imports[0].specifier='allowed';faulty.violations=faulty.violations.filter((v:any)=>v.file==='implementation.ts');
  expect(f.evaluate().status).toBe('pass');
 });
 it('rejects a journey layer observed through an unrelated source or boundary',()=>{
  const f=fixture('journey');const database=f.observation.steps[0].layers[1];
  database.sourceRef='driver.ts';
  expect(f.evaluate().status).toBe('unknown');
  database.sourceRef='adapter.ts';database.observations[0].targetRef='unrelated-http-boundary';
  expect(f.evaluate().status).toBe('unknown');
  database.observations[0].targetRef='database-boundary';
  expect(f.evaluate().status).toBe('pass');
 });
 it('requires a unique complete declaration-owned journey layer binding map',()=>{
  const f=fixture('journey');
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(true);
  const bindings=f.check.layerBindings;
  f.check.layerBindings=bindings.slice(0,1);
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(false);
  f.check.layerBindings=[bindings[0],bindings[0],bindings[1]];
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(false);
  f.check.layerBindings=[...bindings,{id:'other',adapter:'driver.ts',targetRef:'other-boundary'}];
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(false);
  delete f.check.layerBindings;
  expect(core.AssuranceDefinitionSchema.safeParse(f.definition).success).toBe(false);
 });
});
