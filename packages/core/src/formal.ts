import { z } from 'zod';
import { canonicalJson } from './serialization.js';

// Tool-independent contracts only. No model parser, execution engine or Driver
// is loaded by Core. Absence of formal config preserves all v1 preset digests.
const text=z.string().min(1),digest=z.string().regex(/^[a-f0-9]{64}$/);
const path=text.refine(p=>!p.includes('\0')&&!p.includes('\\')&&!p.startsWith('/')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..'||!s),'Expected scoped relative POSIX path');
const count=z.number().int().nonnegative().safe();
const unique=<T extends z.ZodType>(schema:T)=>z.array(schema).max(10000).refine(a=>new Set(a).size===a.length,'Duplicate values');
export const FormalStageSchema=z.enum(['parse','typecheck','test','run','verify']);
export const FormalModelConfigSchema=z.strictObject({
 id:text,contractId:text,model:path,modelSources:unique(path).default([]),
 quint:z.strictObject({entry:path,version:text,apalacheVersion:text.optional()}),
 properties:unique(text),checks:unique(FormalStageSchema).min(1),
 maxSteps:count.min(1).max(10000),maxSamples:count.min(1).max(100000).default(100),seed:text,
 timeoutMs:count.min(1).max(3600000).default(60000),report:path,
 driver:path.optional(),implementation:path.optional(),implementationSources:unique(path).default([]),conformanceReport:path.optional(),
 requiredActions:unique(text).default([]),minTraces:count.min(1).default(1),minComparisons:count.min(1).default(1),requireCanary:z.boolean().default(true),
 canary:z.strictObject({faultId:text,implementation:path,targetRef:text}).optional(),
});
export const FormalConfigSchema=z.strictObject({models:z.array(FormalModelConfigSchema).min(1).max(100).refine(models=>new Set(models.map(m=>m.id)).size===models.length,'Duplicate model IDs')});
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
export const ReplayStepSchema=z.strictObject({index:count,action:text,status:z.enum(['pass','fail','unknown']),parameters:z.json().optional(),expected:z.json(),actual:z.json().optional(),comparisonCount:count.max(1),implementationCalls:count,diagnostic:text.optional()});
export const ReplayTraceSchema=z.strictObject({id:text,complete:z.boolean(),steps:z.array(ReplayStepSchema).max(10001).refine(steps=>steps.every((s,i)=>s.index===i),'Step indices must be contiguous from zero')});
export const ConformanceCanarySchema=z.strictObject({faultId:text,implementationHash:digest,originalImplementationHash:digest,driverHash:digest,traceHash:digest,observedCalls:count,comparedSteps:count,detectedMismatches:count,failure:z.strictObject({traceId:text,index:count,action:text,implementationCalls:count,expected:z.json(),actual:z.json()}).optional()});
export const ModelConformanceReportSchema=z.strictObject({
 schemaVersion:z.literal(1),modelId:text,identity:FormalInputIdentitySchema,runner:text,
 observation:z.enum(['module-functions','unverified']),complete:z.boolean(),diagnostics:z.array(text).max(1000),
 traces:z.array(ReplayTraceSchema).max(10000).refine(traces=>new Set(traces.map(t=>t.id)).size===traces.length,'Duplicate trace IDs'),
 canary:ConformanceCanarySchema.optional(),
});
export type FormalModelConfig=z.infer<typeof FormalModelConfigSchema>;
export type FormalInputIdentity=z.infer<typeof FormalInputIdentitySchema>;
export type FormalStage=z.infer<typeof FormalStageSchema>;
export type FormalStageResult=z.infer<typeof FormalStageResultSchema>;
export type FormalModelReport=z.infer<typeof FormalModelReportSchema>;
export type ModelConformanceReport=z.infer<typeof ModelConformanceReportSchema>;
export type ReplayTrace=z.infer<typeof ReplayTraceSchema>;
export type ReplayStep=z.infer<typeof ReplayStepSchema>;
export type FormalExpectation={model:FormalModelConfig;identity:FormalInputIdentity;authenticated:boolean;canaryImplementationHash?:string};
const basicKeys=['modelHash','configHash','commandHash'] as const;
const conformanceKeys=[...basicKeys,'driverHash','implementationHash','traceHash'] as const;
const identityMatches=(actual:FormalInputIdentity,expected:FormalInputIdentity,keys:readonly (keyof FormalInputIdentity)[])=>keys.every(k=>expected[k]!==undefined&&actual[k]===expected[k]);
const scope=(m:FormalModelConfig)=>({modelId:m.id,model:m.model,contractId:m.contractId,properties:m.properties,maxSteps:m.maxSteps,maxSamples:m.maxSamples,seed:m.seed,unbounded:false as const});

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
    const boundsValid=!checking||stage.maxSteps===model.maxSteps&&model.properties.length>0&&model.properties.every(p=>stage.properties.includes(p));
    const samplingValid=required!=='run'||stage.seed===model.seed&&stage.maxSamples===model.maxSamples;
    if(!stage.complete||stage.toolVersion!==model.quint.version||!methodValid||!boundsValid||!samplingValid||stage.exitCode!==0&&stage.exitCode!==1||stage.status==='pass'&&stage.exitCode!==0||stage.status==='fail'&&stage.exitCode!==1){reasons.push(`Incomplete or incompatible stage: ${required}`);continue;}
    if(stage.status==='fail')failed=true;
    if(stage.status==='unknown')reasons.push(`Unverified model stage: ${required}`);
   }
   if(!model.properties.length||!model.checks.some(c=>c==='run'||c==='verify'))reasons.push('No invariant/property checking scope configured');
  }
 }
 return {status:failed?'fail' as const:reasons.length?'unknown' as const:'pass' as const,reasons,scope:scope(model),stages};
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
  if(reasons.length===0){
   if(!report.complete||report.observation!=='module-functions')reasons.push('Replay incomplete or implementation calls unobserved');
   for(const trace of report.traces){
    if(!trace.complete||!trace.steps.length)reasons.push(`Incomplete trace: ${trace.id}`);else counts.replayedTraces++;
    for(const step of trace.steps){
     counts.replayedSteps++;counts.comparedSteps+=step.comparisonCount;counts.implementationCalls+=step.implementationCalls;
     counts.actions[step.action]=(counts.actions[step.action]??0)+1;
     if(!step.comparisonCount||!step.implementationCalls||step.actual===undefined||step.status==='unknown')reasons.push(`No observed comparison: ${trace.id}:${step.index}`);
     if(step.comparisonCount&&step.actual!==undefined&&canonicalJson(step.expected)!==canonicalJson(step.actual)||step.status==='fail')mismatch=true;
    }
   }
   if(counts.replayedTraces<model.minTraces||counts.comparedSteps<model.minComparisons)reasons.push('Insufficient replayed traces or comparisons');
   for(const action of model.requiredActions)if(!Object.hasOwn(counts.actions,action))reasons.push(`Unreached action: ${action}`);
   if(model.requireCanary){
    const c=report.canary;
    const f=c?.failure,baseline=f?report.traces.find(t=>t.id===f.traceId)?.steps.find(s=>s.index===f.index):undefined;
    const observedMismatch=!!f&&!!baseline&&f.action===baseline.action&&f.implementationCalls>0&&canonicalJson(f.expected)===canonicalJson(baseline.expected)&&canonicalJson(f.actual)!==canonicalJson(f.expected);
    if(!c||!observedMismatch||!expected.canaryImplementationHash||c.implementationHash!==expected.canaryImplementationHash||c.originalImplementationHash!==expected.identity.implementationHash||c.implementationHash===c.originalImplementationHash||c.driverHash!==expected.identity.driverHash||c.traceHash!==expected.identity.traceHash||c.detectedMismatches<1||c.observedCalls<1||c.comparedSteps<1||c.detectedMismatches>c.comparedSteps||model.canary&&c.faultId!==model.canary.faultId)reasons.push('Current same-Driver/trace fault canary unavailable or undetected');
   }
  }
 }
 return {status:mismatch?'fail' as const:reasons.length?'unknown' as const:'pass' as const,reasons,scope:scope(model),counts};
}
