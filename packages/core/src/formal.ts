import { z } from 'zod';
import { canonicalJson, hash } from './serialization.js';

// Core validates formal data independently of the toolchain and Driver.
const text=z.string().min(1),digest=z.string().regex(/^[a-f0-9]{64}$/);
const path=text.refine(p=>!p.includes('\0')&&!p.includes('\\')&&!p.startsWith('/')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..'||!s),'Expected scoped relative POSIX path');
const count=z.number().int().nonnegative().safe();
const unique=<T extends z.ZodType>(schema:T)=>z.array(schema).max(10000).refine(a=>new Set(a).size===a.length,'Duplicate values');
export const FormalStageSchema=z.enum(['parse','typecheck','test','run','verify']);
export const FormalModelConfigSchema=z.strictObject({
 id:text,model:path,modelSources:unique(path).default([]),
 module:text,init:text.optional(),step:text.optional(),witnesses:unique(text).optional(),
 mutants:unique(z.strictObject({id:text,model:path,invariant:text,sources:unique(path).optional()})).max(100).optional(),
 quint:z.strictObject({entry:path,version:text,apalacheVersion:text.optional()}),
 invariants:unique(text).min(1),checks:unique(FormalStageSchema).min(1),
 maxSteps:count.min(1).max(10000),maxSamples:count.min(1).max(100000).default(100),seed:text,
 timeoutMs:count.min(1).max(3600000).default(60000),report:path,
 driver:path.optional(),driverSources:unique(path).optional(),implementation:path.optional(),implementationSources:unique(path).default([]),conformanceReport:path.optional(),traceReceipt:path.optional(),traceDirectory:path.optional(),
 replayScope:z.strictObject({observedFields:unique(text).min(1).max(1000),rationale:text.max(4000)}).optional(),
 requiredActions:unique(text).default([]),minTraces:count.min(1).default(1),minComparisons:count.min(1).default(1),requireCanary:z.boolean().default(true),
 canary:z.strictObject({faultId:text,implementation:path,targetRef:text}).optional(),
}).refine(model=>model.checks.includes('parse')&&model.checks.includes('typecheck')&&
   new Set((model.mutants??[]).map(m=>m.id)).size===(model.mutants?.length??0)&&
   (model.mutants??[]).every(m=>m.model!==model.model&&model.invariants.includes(m.invariant)),
 'Choose Quint parsing and typechecking stages, and give each variant a unique ID and a selected invariant');
const requiredScope=z.strictObject({id:text,include:unique(path).min(1),modelId:text});
export const FormalConfigSchema=z.strictObject({
 models:z.array(FormalModelConfigSchema).max(100).refine(models=>new Set(models.map(m=>m.id)).size===models.length,'Duplicate model IDs'),
 required:z.array(requiredScope).max(100).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Duplicate specification scope IDs').optional(),
}).refine(formal=>formal.models.length>0||!!formal.required?.length,'Formal configuration requires models or protected scopes');
export const FormalInputIdentitySchema=z.strictObject({modelHash:digest,configHash:digest,commandHash:digest,driverHash:digest.optional(),implementationHash:digest.optional(),traceHash:digest.optional()});
export const FormalStageResultSchema=z.strictObject({
 stage:FormalStageSchema,status:z.enum(['pass','fail','unknown']),complete:z.boolean(),exitCode:z.number().int().nullable(),
 toolVersion:text,backend:z.enum(['quint','typescript','rust','apalache','tlc']),
 method:z.enum(['parse','typecheck','spec_test','simulation','bounded_model_check','finite_state_check']),
 properties:unique(text),maxSteps:count.optional(),maxSamples:count.optional(),seed:text.optional(),traceSeed:text.optional(),
 backendVersion:text.optional(),diagnostics:z.array(text).max(1000),stdoutHash:digest.optional(),stderrHash:digest.optional(),
 artifacts:z.array(z.strictObject({ref:path,sha256:digest})).max(1000).optional(),
});
export const FormalModelReportSchema=z.strictObject({schemaVersion:z.literal(1),modelId:text,identity:FormalInputIdentitySchema,stages:z.array(FormalStageResultSchema).max(5).refine(s=>new Set(s.map(x=>x.stage)).size===s.length,'Duplicate model stages')});
export const FormalTraceReceiptSchema=z.strictObject({schemaVersion:z.literal(1),modelId:text,identity:FormalInputIdentitySchema,toolVersion:text,backend:z.enum(['typescript','rust']),maxSteps:count.min(1),maxSamples:count.min(1),seed:text,traces:z.array(z.strictObject({ref:path,sha256:digest})).max(10000).refine(rows=>new Set(rows.map(r=>r.ref)).size===rows.length,'Duplicate trace artifact refs')});
export const ReplayOutcomeSchema=z.enum(['allowed','rejected']);
const replayOutcomes={expectedOutcome:ReplayOutcomeSchema.optional(),actualOutcome:ReplayOutcomeSchema.optional()};
export const ReplayStepSchema=z.strictObject({index:count,action:text,status:z.enum(['pass','fail','unknown']),parameters:z.json().optional(),expected:z.json(),actual:z.json().optional(),comparisonCount:count.max(1),implementationCalls:count,diagnostic:text.optional(),...replayOutcomes});
export const ReplayTraceSchema=z.strictObject({id:text,complete:z.boolean(),steps:z.array(ReplayStepSchema).max(10001).refine(steps=>steps.every((s,i)=>s.index===i),'Step indices must be contiguous from zero')});
export const ConformanceCanarySchema=z.strictObject({faultId:text,implementationHash:digest,originalImplementationHash:digest,driverHash:digest,traceHash:digest,observedCalls:count,comparedSteps:count,detectedMismatches:count,failure:z.strictObject({traceId:text,index:count,action:text,implementationCalls:count,expected:z.json(),actual:z.json(),...replayOutcomes}).optional()});
export const ModelConformanceReportSchema=z.strictObject({
 schemaVersion:z.literal(1),modelId:text,identity:FormalInputIdentitySchema,runner:text,
 observation:z.enum(['module-functions','unverified']),complete:z.boolean(),diagnostics:z.array(text).max(1000),
 traces:z.array(ReplayTraceSchema).max(10000).refine(traces=>new Set(traces.map(t=>t.id)).size===traces.length,'Duplicate trace IDs'),
 canary:ConformanceCanarySchema.optional(),
});
export type FormalModelConfig=z.infer<typeof FormalModelConfigSchema>;
export const formalInvariants=(model:FormalModelConfig)=>model.invariants;
export function formalSelection(model:FormalModelConfig){
 return {module:model.module,init:model.init??'init',step:model.step??'step',
  invariants:formalInvariants(model),witnesses:model.witnesses??[],requiredActions:model.requiredActions};
}
export function specificationRevision(model:FormalModelConfig,identity:{modelHash:string;driverHash?:string;toolHash?:string;
 mutantHashes?:Record<string,string>}){
 return hash({schemaVersion:1,model,modelHash:identity.modelHash,
  ...(identity.driverHash?{driverHash:identity.driverHash}:{}),...(identity.toolHash?{toolHash:identity.toolHash}:{}),
  ...(identity.mutantHashes?{mutantHashes:identity.mutantHashes}:{})});
}
export function formalMutantModel(model:FormalModelConfig,mutant:NonNullable<FormalModelConfig['mutants']>[number]):FormalModelConfig{
 const {mutants:_mutants,...base}=model;
 return {...base,model:mutant.model,modelSources:mutant.sources??[],invariants:[mutant.invariant],witnesses:[],requiredActions:[]};
}
export type FormalInputIdentity=z.infer<typeof FormalInputIdentitySchema>;
export type FormalStage=z.infer<typeof FormalStageSchema>;
export type FormalStageResult=z.infer<typeof FormalStageResultSchema>;
export type FormalModelReport=z.infer<typeof FormalModelReportSchema>;
export type ModelConformanceReport=z.infer<typeof ModelConformanceReportSchema>;
export type ReplayTrace=z.infer<typeof ReplayTraceSchema>;
export type ReplayStep=z.infer<typeof ReplayStepSchema>;
export function hasRequiredReplayObservations(expected:ReplayStep['expected'],actual:ReplayStep['actual']){
 const isRecord=(value:ReplayStep['actual']):value is Record<string,ReplayStep['expected']>=>
  value!==null&&typeof value==='object'&&!Array.isArray(value);
 return actual!==undefined&&(!isRecord(expected)||isRecord(actual)&&Object.keys(expected).every(key=>Object.hasOwn(actual,key)));
}
export type FormalExpectation={model:FormalModelConfig;identity:FormalInputIdentity;authenticated:boolean;canaryImplementationHash?:string};
const basicKeys=['modelHash','configHash','commandHash'] as const;
const conformanceKeys=[...basicKeys,'driverHash','implementationHash','traceHash'] as const;
const identityMatches=(actual:FormalInputIdentity,expected:FormalInputIdentity,keys:readonly (keyof FormalInputIdentity)[])=>keys.every(k=>expected[k]!==undefined&&actual[k]===expected[k]);
const scope=(m:FormalModelConfig)=>({modelId:m.id,model:m.model,properties:formalInvariants(m),maxSteps:m.maxSteps,maxSamples:m.maxSamples,seed:m.seed,unbounded:false as const});

/** Report status never establishes authority. The caller authenticates the
 * exact bytes and pins the current source/config/command snapshot separately. */
export function evaluateFormalModel(value:unknown,expected:FormalExpectation){
 const model=FormalModelConfigSchema.parse(expected.model),reasons:string[]=[];
 const stages:FormalStageResult[]=value===undefined?[]:FormalModelReportSchema.parse(value).stages;
 let failed=false;
 if(value===undefined)reasons.push('Model evidence unavailable');
 else {
  const report=FormalModelReportSchema.parse(value);
  if(!expected.authenticated)reasons.push('Model report producer/subject/integrity unverified');
  if(report.modelId!==model.id||!identityMatches(report.identity,expected.identity,basicKeys))reasons.push('Model input/config/command identity mismatch');
  if(reasons.length===0){
   for(const required of model.checks){
    const stage=stages.find(s=>s.stage===required);
    if(!stage){reasons.push(`Missing model stage: ${required}`);continue;}
    const method={parse:'parse',typecheck:'typecheck',test:'spec_test',run:'simulation',verify:'bounded_model_check'}[required];
    const checking=required==='run'||required==='verify';
    const methodValid=stage.method===method&&(required!=='verify'||stage.backend==='apalache'&&(!model.quint.apalacheVersion||stage.backendVersion===model.quint.apalacheVersion))&&(required!=='run'||['typescript','rust'].includes(stage.backend));
    const boundsValid=!checking||stage.maxSteps===model.maxSteps&&formalInvariants(model).every(p=>stage.properties.includes(p));
    const samplingValid=required!=='run'||stage.seed===model.seed&&stage.maxSamples===model.maxSamples;
    if(!stage.complete||stage.toolVersion!==model.quint.version||!methodValid||!boundsValid||!samplingValid||stage.exitCode!==0&&stage.exitCode!==1||stage.status==='pass'&&stage.exitCode!==0||stage.status==='fail'&&stage.exitCode!==1){reasons.push(`Incomplete or incompatible stage: ${required}`);continue;}
    if(stage.status==='fail')failed=true;
    if(stage.status==='unknown')reasons.push(`Unverified model stage: ${required}`);
   }
   if(!model.checks.some(c=>c==='run'||c==='verify'))reasons.push('No invariant/property checking scope configured');
  }
 }
 return {status:failed?'fail' as const:reasons.length?'unknown' as const:'pass' as const,reasons,scope:scope(model),stages};
}

function replayScopeProblem(model:FormalModelConfig,traces:readonly ReplayTrace[]){
 if(!model.replayScope)return 'No approved replay observation scope and determinism rationale were selected';
 const fields=[...model.replayScope.observedFields].sort(),seen=new Map<string,string>();
 for(const trace of traces){
  let prefix='';
  for(const step of trace.steps){
   const state=step.expected;
   if(!state||typeof state!=='object'||Array.isArray(state)||
      canonicalJson(Object.keys(state).sort())!==canonicalJson(fields))return 'Trace states differ from the approved observation fields';
   prefix=hash([prefix,step.action,step.parameters??null]);
   const observations=hash([state,step.expectedOutcome??null]);
   const previous=seen.get(prefix);
   if(previous&&previous!==observations)return 'The same input sequence has different expected observations';
   seen.set(prefix,observations);
  }
 }
 return undefined;
}

export function evaluateModelConformance(value:unknown,expected:FormalExpectation){
 const model=FormalModelConfigSchema.parse(expected.model),reasons:string[]=[];
 const counts={replayedTraces:0,replayedSteps:0,comparedSteps:0,implementationCalls:0,actions:Object.create(null) as Record<string,number>};
 let mismatch=false;
 if(value===undefined)reasons.push('Implementation conformance evidence unavailable');
 else {
  const report=ModelConformanceReportSchema.parse(value);
  if(!expected.authenticated)reasons.push('Conformance report producer/subject/integrity unverified');
  if(report.modelId!==model.id||!identityMatches(report.identity,expected.identity,conformanceKeys))reasons.push('Model/Driver/implementation/config/command/trace identity mismatch');
  const replayInputs=report.traces.map(trace=>({id:trace.id,steps:trace.steps.map(step=>({index:step.index,action:step.action,...(step.parameters===undefined?{}:{parameters:step.parameters}),expected:step.expected,...(step.expectedOutcome===undefined?{}:{expectedOutcome:step.expectedOutcome})}))}));
  if(hash(replayInputs)!==expected.identity.traceHash)reasons.push('Replay trace/step inventory does not match authenticated trace identity');
  if(reasons.length===0){
   const problem=replayScopeProblem(model,report.traces);
   if(problem)reasons.push(problem);
  }
  if(reasons.length===0){
   if(!report.complete||report.observation!=='module-functions')reasons.push('Replay incomplete or implementation calls unobserved');
   for(const trace of report.traces){
    if(!trace.complete||!trace.steps.length)reasons.push(`Incomplete trace: ${trace.id}`);else counts.replayedTraces++;
    for(const step of trace.steps){
     counts.replayedSteps++;counts.comparedSteps+=step.comparisonCount;counts.implementationCalls+=step.implementationCalls;
     counts.actions[step.action]=(counts.actions[step.action]??0)+1;
     const observed=step.comparisonCount>0&&step.implementationCalls>0&&step.actual!==undefined&&step.status!=='unknown';
     if(step.expectedOutcome!==undefined){
      if(!observed||step.actualOutcome===undefined||!hasRequiredReplayObservations(step.expected,step.actual))reasons.push(`No observed comparison: ${trace.id}:${step.index}`);
      else if(step.expectedOutcome!==step.actualOutcome||canonicalJson(step.expected)!==canonicalJson(step.actual))mismatch=true;
      else if(step.status==='fail')reasons.push(`Inconsistent replay status: ${trace.id}:${step.index}`);
     }else{
      if(!observed)reasons.push(`No observed comparison: ${trace.id}:${step.index}`);
      if(step.comparisonCount&&step.actual!==undefined&&canonicalJson(step.expected)!==canonicalJson(step.actual)||step.status==='fail')mismatch=true;
     }
    }
   }
   if(counts.replayedTraces<model.minTraces||counts.comparedSteps<model.minComparisons)reasons.push('Insufficient replayed traces or comparisons');
   for(const action of model.requiredActions)if(!Object.hasOwn(counts.actions,action))reasons.push(`Unreached action: ${action}`);
   if(model.requireCanary){
    const c=report.canary;
    const f=c?.failure,baseline=f?report.traces.find(t=>t.id===f.traceId)?.steps.find(s=>s.index===f.index):undefined;
    const observedMismatch=!!f&&!!baseline&&f.action===baseline.action&&f.implementationCalls>0&&canonicalJson(f.expected)===canonicalJson(baseline.expected)&&
     f.expectedOutcome===baseline.expectedOutcome&&
     (baseline.expectedOutcome===undefined?f.actualOutcome===undefined:f.actualOutcome!==undefined&&hasRequiredReplayObservations(f.expected,f.actual))&&
     (canonicalJson(f.actual)!==canonicalJson(f.expected)||f.actualOutcome!==f.expectedOutcome);
    if(!c||!observedMismatch||!expected.canaryImplementationHash||c.implementationHash!==expected.canaryImplementationHash||c.originalImplementationHash!==expected.identity.implementationHash||c.implementationHash===c.originalImplementationHash||c.driverHash!==expected.identity.driverHash||c.traceHash!==expected.identity.traceHash||c.detectedMismatches<1||c.observedCalls<1||c.comparedSteps<1||c.detectedMismatches>c.comparedSteps||model.canary&&c.faultId!==model.canary.faultId)reasons.push('Current same-Driver/trace fault canary unavailable or undetected');
   }
  }
 }
 return {status:mismatch?'fail' as const:reasons.length?'unknown' as const:'pass' as const,reasons,scope:scope(model),counts};
}
