import { z } from 'zod';
import { canonicalJson, hash } from './serialization.js';

// Declarative JSON only. Core never loads an implementation, generator or predicate.
const text=z.string().min(1), digest=z.string().regex(/^[a-f0-9]{64}$/), count=z.number().int().nonnegative().safe();
const path=text.refine(p=>!p.includes('\0')&&!p.includes('\\')&&!p.startsWith('/')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..'||!s),'Expected scoped relative POSIX path');
const list=<T extends z.ZodType>(s:T)=>z.array(s).max(10000);
const unique=<T extends z.ZodType>(s:T)=>list(s).refine(a=>new Set(a).size===a.length,'Duplicate values');
const json=z.json();
const caseSchema=z.strictObject({id:text,input:json,expected:json});
const base={id:text,targetRef:text};
const windowSchema=z.strictObject({settledBy:text,durationMs:count.min(1).max(3600000)});
const fieldSchema=z.strictObject({scope:text,field:z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/)});
export const AssuranceResourceSchema=z.strictObject({scope:text,adapter:path,targets:unique(text).min(1)});
export const AssuranceMethodSchema=z.enum(['example','effects','property','sequence','architecture','journey']);
export const AssuranceExampleCheckSchema=z.strictObject({...base,method:z.literal('example'),cases:list(caseSchema).min(1)});
export const AssuranceEffectsCheckSchema=z.strictObject({...base,method:z.literal('effects'),cases:list(caseSchema).min(1),scope:unique(text).min(1),resources:list(AssuranceResourceSchema).min(1),allowedChanges:list(fieldSchema),unchangedFields:list(fieldSchema),effects:list(z.strictObject({id:text,scope:text,min:count,max:count})),window:windowSchema});
export const AssurancePropertyCheckSchema=z.strictObject({...base,method:z.literal('property'),domain:json,seed:text,runs:count.min(1),minValid:count.min(1),maxDiscarded:count,maxDiscardRatio:z.number().min(0).max(1).optional(),requiredClasses:unique(text),classMinimums:z.record(text,count.min(1)).optional(),generator:path,predicate:path,shrinker:path.optional()});
export const AssuranceSequenceCheckSchema=z.strictObject({...base,method:z.literal('sequence'),seed:text,generator:path,model:path,projection:path,maxSteps:count.min(1).max(10000),minTraces:count.min(1),requiredActions:unique(text).min(1),actionMinimums:z.record(text,count.min(1)).optional()});
export const AssuranceArchitectureRuleSchema=z.strictObject({id:text,from:unique(path).min(1),forbidden:unique(text).min(1)});
export const AssuranceArchitectureCheckSchema=z.strictObject({...base,method:z.literal('architecture'),files:unique(path).min(1),rules:list(AssuranceArchitectureRuleSchema).min(1)});
export const AssuranceLayerBindingSchema=z.strictObject({id:text,adapter:path,targetRef:text});
export const AssuranceJourneyCheckSchema=z.strictObject({...base,method:z.literal('journey'),entrypoint:text,environment:json,mockBoundaries:unique(text),layers:unique(text).min(1),layerBindings:list(AssuranceLayerBindingSchema).min(1),steps:list(caseSchema.extend({action:text,layers:unique(text).min(1)})).min(1),requiredMedia:unique(path).optional()});
export const AssuranceCheckSchema=z.discriminatedUnion('method',[AssuranceExampleCheckSchema,AssuranceEffectsCheckSchema,AssurancePropertyCheckSchema,AssuranceSequenceCheckSchema,AssuranceArchitectureCheckSchema,AssuranceJourneyCheckSchema]);
export const AssuranceFaultSelectorSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('result'),id:text}),
 z.strictObject({kind:z.literal('unchanged'),id:text,scope:text,field:text}),
 z.strictObject({kind:z.literal('effect'),id:text,scope:text,effectId:text}),
 z.strictObject({kind:z.literal('rule'),id:text}),
]);
export const AssuranceFaultDefinitionSchema=z.strictObject({id:text,kind:text,checkId:text,implementation:path,detects:list(AssuranceFaultSelectorSchema).min(1)});
export const AssuranceConditionSchema=z.strictObject({id:text,kind:z.enum(['precondition','postcondition','invariant','effect','property','architecture','journey']),statement:text,checks:unique(text).min(1),requiredFaults:list(AssuranceFaultDefinitionSchema)});
export const AssuranceDefinitionSchema=z.strictObject({feature:z.strictObject({id:text,entrypoints:unique(text).min(1)}),conditions:list(AssuranceConditionSchema).min(1),checks:list(AssuranceCheckSchema).min(1)}).superRefine((d,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 const ids=(a:{id:string}[])=>new Set(a.map(x=>x.id)).size===a.length;
 if(!ids(d.conditions)||!ids(d.checks))issue('Duplicate condition/check IDs');
 const faults=d.conditions.flatMap(c=>c.requiredFaults);
 if(!ids(faults))issue('Duplicate fault IDs');
 for(const c of d.conditions){
  if(c.checks.some(id=>!d.checks.some(k=>k.id===id)))issue(`Unknown condition check: ${c.id}`);
  if(c.requiredFaults.some(f=>!c.checks.includes(f.checkId)))issue(`Fault must belong to a condition check: ${c.id}`);
 }
 for(const c of d.checks){
  if('cases' in c&&!ids(c.cases))issue(`Duplicate case IDs: ${c.id}`);
  if(c.method==='property'&&(c.minValid>c.runs||c.maxDiscarded>c.runs))issue(`Inconsistent property bounds: ${c.id}`);
  if(c.method==='effects'&&(!exactly(c.resources.map(r=>r.scope),c.scope)||[...c.unchangedFields,...c.allowedChanges].some(f=>!c.scope.includes(f.scope))||c.effects.some(e=>!c.scope.includes(e.scope)||e.min>e.max)||new Set(c.effects.map(e=>`${e.scope}:${e.id}`)).size!==c.effects.length))issue(`Inconsistent effect scope/constraints: ${c.id}`);
  if(c.method==='architecture'&&(!ids(c.rules)||!c.files.includes(c.targetRef)||c.rules.some(r=>r.from.some(f=>!c.files.includes(f)))))issue(`Inconsistent architecture rule inventory: ${c.id}`);
  if(c.method==='journey'&&(!ids(c.steps)||!exactly(c.layerBindings.map(b=>b.id),c.layers)||c.steps.some(s=>s.layers.some(l=>!c.layers.includes(l)))||c.layers.some(l=>c.mockBoundaries.includes(l))||!d.feature.entrypoints.includes(c.entrypoint)))issue(`Inconsistent journey scope: ${c.id}`);
 }
 for(const f of faults){
  const check=d.checks.find(c=>c.id===f.checkId);if(!check)continue;
  if(f.detects.some(s=>s.kind==='rule'?check.method!=='architecture'||!check.rules.some(r=>r.id===s.id):s.kind==='unchanged'?check.method!=='effects'||!check.cases.some(c=>c.id===s.id)||!check.unchangedFields.some(c=>c.scope===s.scope&&c.field===s.field):s.kind==='effect'?check.method!=='effects'||!check.cases.some(c=>c.id===s.id)||!check.effects.some(c=>c.scope===s.scope&&c.id===s.effectId):check.method==='architecture'||('cases' in check&&!check.cases.some(c=>c.id===s.id))||(check.method==='journey'&&!check.steps.some(c=>c.id===s.id))))issue(`Fault detection selector is outside check scope: ${f.id}`);
 }
});
const assuranceDefinitions=z.array(z.strictObject({id:text,definition:AssuranceDefinitionSchema})).min(1).max(100)
 .refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Duplicate assurance definition IDs');
export const AssuranceConfigSchema=z.strictObject({driver:path,driverSources:unique(path).min(1),implementationSources:unique(path).min(1),report:path,timeoutMs:count.min(1).max(3600000).optional(),definitions:assuranceDefinitions}).refine(c=>c.driverSources.includes(c.driver),'Driver must belong to driverSources');
export const AssuranceInputHashesSchema=z.record(path,digest);
export const AssuranceCallReceiptSchema=z.strictObject({callId:text,targetRef:text,implementation:path,implementationHash:digest,variant:z.enum(['baseline','fault']),faultId:text.optional(),input:json,output:json.optional(),error:text.optional()});
export const AssuranceComparisonSchema=z.strictObject({id:text,input:json,inputHash:digest,expected:json,actual:json.optional(),calls:count,receipts:list(AssuranceCallReceiptSchema),error:text.optional()});
const observed={checkId:text,checkHash:digest,complete:z.boolean(),comparisonCount:count};
export const AssuranceEffectEventSchema=z.strictObject({eventId:text,id:text,scope:text,operation:text,targetRef:text,callId:text});
export const AssuranceResourceObservationSchema=z.strictObject({scope:text,adapter:path,adapterHash:digest,targets:unique(text).min(1),callIds:unique(text).min(1),elapsedMs:count,settledBy:text,settled:z.boolean()});
export const AssuranceExampleObservationSchema=z.strictObject({...observed,method:z.literal('example'),samples:list(AssuranceComparisonSchema)});
export const AssuranceEffectsObservationSchema=z.strictObject({...observed,method:z.literal('effects'),scope:unique(text),window:windowSchema,samples:list(AssuranceComparisonSchema.extend({before:z.record(text,json),after:z.record(text,json),effects:list(AssuranceEffectEventSchema),resourceObservations:list(AssuranceResourceObservationSchema)}))});
export const AssuranceCounterexampleSchema=z.strictObject({sampleId:text,seed:text,originalInput:json,shrunkInput:json.optional(),shrunkSampleId:text.optional(),replay:text.optional()});
export const AssurancePropertyObservationSchema=z.strictObject({...observed,method:z.literal('property'),domain:json,seed:text,runs:count,valid:count,discarded:count,samples:list(AssuranceComparisonSchema.extend({index:count,discarded:z.boolean(),classes:unique(text)})),counterexamples:list(AssuranceCounterexampleSchema).optional()});
export const AssuranceSequenceObservationSchema=z.strictObject({...observed,method:z.literal('sequence'),seed:text,maxSteps:count,traces:list(z.strictObject({id:text,initialModel:json,initialExpected:json,initialActual:json,steps:list(AssuranceComparisonSchema.extend({index:count,action:text,modelBefore:json,modelAfter:json}))}))});
export const AssuranceImportObservationSchema=z.strictObject({specifier:text,resolved:path.optional(),dynamic:z.boolean(),supported:z.boolean()});
export const AssuranceArchitectureViolationSchema=z.strictObject({ruleId:text,file:path,specifier:text});
export const AssuranceArchitectureObservationSchema=z.strictObject({...observed,method:z.literal('architecture'),files:list(z.strictObject({path,sha256:digest,imports:list(AssuranceImportObservationSchema)})),rules:unique(text),violations:list(AssuranceArchitectureViolationSchema),unsupported:list(z.strictObject({file:path,reason:text}))});
export const AssuranceMediaSchema=z.strictObject({ref:path,sha256:digest,stepId:text});
export const AssuranceLayerReceiptSchema=z.strictObject({invocationId:text,observationId:text,targetRef:text,mocked:z.boolean(),input:json,actual:json});
export const AssuranceJourneyObservationSchema=z.strictObject({...observed,method:z.literal('journey'),entrypoint:text,environment:json,mockBoundaries:unique(text),steps:list(AssuranceComparisonSchema.extend({action:text,layers:list(z.strictObject({id:text,sourceRef:path,observations:list(AssuranceLayerReceiptSchema)}))})),media:list(AssuranceMediaSchema)});
export const AssuranceObservationSchema=z.discriminatedUnion('method',[AssuranceExampleObservationSchema,AssuranceEffectsObservationSchema,AssurancePropertyObservationSchema,AssuranceSequenceObservationSchema,AssuranceArchitectureObservationSchema,AssuranceJourneyObservationSchema]);
export const AssuranceFaultObservationSchema=z.strictObject({faultId:text,checkId:text,implementationHash:digest,observation:AssuranceObservationSchema});
export const AssuranceSubjectSchema=z.strictObject({testedCommitSha:text,sourceTreeHash:digest});
export const AssuranceReportSchema=z.strictObject({schemaVersion:z.literal(2),definitionId:text,revisionHash:digest,subject:AssuranceSubjectSchema,inputHashes:AssuranceInputHashesSchema,checks:list(AssuranceObservationSchema),faults:list(AssuranceFaultObservationSchema)});
export const AssuranceBundleSchema=z.strictObject({schemaVersion:z.literal(2),reports:list(AssuranceReportSchema).min(1)});

export type AssuranceMethod=z.infer<typeof AssuranceMethodSchema>;
export type AssuranceExampleCheck=z.infer<typeof AssuranceExampleCheckSchema>;
export type AssuranceEffectsCheck=z.infer<typeof AssuranceEffectsCheckSchema>;
export type AssurancePropertyCheck=z.infer<typeof AssurancePropertyCheckSchema>;
export type AssuranceSequenceCheck=z.infer<typeof AssuranceSequenceCheckSchema>;
export type AssuranceArchitectureCheck=z.infer<typeof AssuranceArchitectureCheckSchema>;
export type AssuranceArchitectureRule=z.infer<typeof AssuranceArchitectureRuleSchema>;
export type AssuranceJourneyCheck=z.infer<typeof AssuranceJourneyCheckSchema>;
export type AssuranceLayerBinding=z.infer<typeof AssuranceLayerBindingSchema>;
export type AssuranceDefinition=z.infer<typeof AssuranceDefinitionSchema>;
export type AssuranceTarget={id:string;revisionHash:string;sourceRef:string;assurance?:AssuranceDefinition|undefined};
export type AssuranceCondition=z.infer<typeof AssuranceConditionSchema>;
export type AssuranceCheck=z.infer<typeof AssuranceCheckSchema>;
export type AssuranceFaultDefinition=z.infer<typeof AssuranceFaultDefinitionSchema>;
export type AssuranceFaultSelector=z.infer<typeof AssuranceFaultSelectorSchema>;
export type AssuranceConfig=z.infer<typeof AssuranceConfigSchema>;
export type AssuranceInputHashes=z.infer<typeof AssuranceInputHashesSchema>;
export type AssuranceCallReceipt=z.infer<typeof AssuranceCallReceiptSchema>;
export type AssuranceEffectEvent=z.infer<typeof AssuranceEffectEventSchema>;
export type AssuranceResource=z.infer<typeof AssuranceResourceSchema>;
export type AssuranceResourceObservation=z.infer<typeof AssuranceResourceObservationSchema>;
export type AssuranceCounterexample=z.infer<typeof AssuranceCounterexampleSchema>;
export type AssuranceLayerReceipt=z.infer<typeof AssuranceLayerReceiptSchema>;
export type AssuranceMedia=z.infer<typeof AssuranceMediaSchema>;
export type AssuranceImportObservation=z.infer<typeof AssuranceImportObservationSchema>;
export type AssuranceArchitectureViolation=z.infer<typeof AssuranceArchitectureViolationSchema>;
export type AssuranceComparison=z.infer<typeof AssuranceComparisonSchema>;
export type AssuranceObservation=z.infer<typeof AssuranceObservationSchema>;
export type AssuranceExampleObservation=z.infer<typeof AssuranceExampleObservationSchema>;
export type AssuranceEffectsObservation=z.infer<typeof AssuranceEffectsObservationSchema>;
export type AssurancePropertyObservation=z.infer<typeof AssurancePropertyObservationSchema>;
export type AssuranceSequenceObservation=z.infer<typeof AssuranceSequenceObservationSchema>;
export type AssuranceArchitectureObservation=z.infer<typeof AssuranceArchitectureObservationSchema>;
export type AssuranceJourneyObservation=z.infer<typeof AssuranceJourneyObservationSchema>;
export type AssuranceFaultObservation=z.infer<typeof AssuranceFaultObservationSchema>;
export type AssuranceReport=z.infer<typeof AssuranceReportSchema>;
export type AssuranceBundle=z.infer<typeof AssuranceBundleSchema>;
export type AssuranceSubject=z.infer<typeof AssuranceSubjectSchema>;
export type AssuranceStatus='pass'|'fail'|'unknown';
export type AssuranceExpectation={definitionId:string;revisionHash:string;subject:AssuranceSubject;inputHashes:AssuranceInputHashes;implementationSources:readonly string[];checkHashes:Record<string,string>;authenticatedReportHashes:readonly string[];authenticatedMedia?:Record<string,string>};
export type AssuranceCheckEvaluation={checkId:string;method:AssuranceMethod;status:AssuranceStatus;reasons:string[];comparisons:number;implementationCalls:number;scope:AssuranceCheck};
export type AssuranceFaultEvaluation={faultId:string;checkId:string;status:AssuranceStatus;reasons:string[]};
export type AssuranceConditionEvaluation={conditionId:string;kind:AssuranceCondition['kind'];statement:string;status:AssuranceStatus;checkIds:string[];faults:AssuranceFaultEvaluation[];reasons:string[]};
export type AssuranceEvaluation={status:AssuranceStatus;conditions:AssuranceConditionEvaluation[];checks:AssuranceCheckEvaluation[];reasons:string[]};

const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const aggregate=(statuses:AssuranceStatus[]):AssuranceStatus=>statuses.includes('fail')?'fail':statuses.includes('unknown')?'unknown':'pass';
const exactly=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
function pointer(value:unknown,field:string):{found:boolean;value?:unknown}{
 if(value===undefined)return {found:false};
 let current:unknown=value;
 for(const key of field===''?[]:field.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'))){
  if(current===null||typeof current!=='object'||!Object.hasOwn(current,key))return {found:false};
  current=(current as Record<string,unknown>)[key];
 }
 return {found:true,value:current};
}
function comparisonRows(o:AssuranceObservation):AssuranceComparison[]{
 switch(o.method){case 'example':case 'effects':return o.samples;case 'property':return o.samples.filter(s=>!s.discarded);case 'sequence':return o.traces.flatMap(t=>t.steps);case 'journey':return o.steps;case 'architecture':return [];}
}
function changedFields(before:unknown,after:unknown,prefix=''):string[]{
 if(same(before,after))return [];
 if(before===null||after===null||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)!==Array.isArray(after))return [prefix];
 const a=before as Record<string,unknown>,b=after as Record<string,unknown>;
 return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>{
  const field=`${prefix}/${k.replace(/~/g,'~0').replace(/\//g,'~1')}`;
  return !Object.hasOwn(a,k)||!Object.hasOwn(b,k)?[field]:changedFields(a[k],b[k],field);
 });
}
function checkObservation(check:AssuranceCheck,o:AssuranceObservation,e:AssuranceExpectation,fault?:AssuranceFaultDefinition):AssuranceCheckEvaluation{
 const reasons:string[]=[];let mismatch=false,comparisons=0,implementationCalls=0;
 const issue=(reason:string)=>reasons.push(reason);
 if(o.checkId!==check.id||o.method!==check.method||o.checkHash!==hash(check)||e.checkHashes[check.id]!==hash(check))issue('Check specification identity mismatch');
 if(!o.complete)issue('Observation incomplete');
 const rows=comparisonRows(o),seenCalls=new Set<string>(),seenEffects=new Set<string>();
 if(new Set(rows.map(r=>r.id)).size!==rows.length)issue('Duplicate comparison IDs');
 for(const r of rows){
  implementationCalls+=r.receipts.length;
  if(r.error||r.actual===undefined||r.calls<1||r.calls!==r.receipts.length||r.inputHash!==hash(r.input))issue(`Unobserved comparison or execution error: ${r.id}`);
  for(const receipt of r.receipts){
   if(seenCalls.has(receipt.callId)||receipt.targetRef!==check.targetRef||!same(receipt.input,r.input)||receipt.error||receipt.output===undefined)issue(`Invalid target call receipt: ${r.id}`);
   if(receipt.implementationHash!==e.inputHashes[receipt.implementation]||(fault?receipt.variant!=='fault'||receipt.faultId!==fault.id||receipt.implementation!==fault.implementation:receipt.variant!=='baseline'||receipt.faultId!==undefined||!e.implementationSources.includes(receipt.implementation)))issue(`Target implementation/variant identity mismatch: ${r.id}`);
   seenCalls.add(receipt.callId);
  }
  if(r.actual!==undefined){comparisons++;if(!same(r.expected,r.actual))mismatch=true;}
  if(['example','effects','journey'].includes(o.method)&&r.actual!==undefined&&r.receipts.length&&r.receipts.at(-1)?.output!==undefined&&!same(r.actual,r.receipts.at(-1)!.output))issue(`Comparison differs from observed output: ${r.id}`);
 }
 if(check.method==='example'&&o.method==='example'||check.method==='effects'&&o.method==='effects'){
  if(!exactly(o.samples.map(s=>s.id),check.cases.map(c=>c.id)))issue('Case inventory mismatch');
  for(const c of check.cases){const s=o.samples.find(s=>s.id===c.id);if(!s||!same(s.input,c.input)||!same(s.expected,c.expected))issue(`Case input/expectation mismatch: ${c.id}`);}
 }
 if(check.method==='effects'&&o.method==='effects'){
  if(!exactly(o.scope,check.scope)||!same(o.window,check.window))issue('Effect scope/window mismatch');
  for(const s of o.samples){
   if(!exactly(Object.keys(s.before),check.scope)||!exactly(Object.keys(s.after),check.scope))issue(`Missing scoped state snapshots: ${s.id}`);
   if(!exactly(s.resourceObservations.map(r=>r.scope),check.scope))issue(`Missing resource adapter observations: ${s.id}`);
   for(const resource of check.resources){
    const observed=s.resourceObservations.find(r=>r.scope===resource.scope);
    if(!observed||observed.adapter!==resource.adapter||!e.inputHashes[resource.adapter]||observed.adapterHash!==e.inputHashes[resource.adapter]||!exactly(observed.targets,resource.targets)||!exactly(observed.callIds,s.receipts.map(r=>r.callId))||observed.elapsedMs<check.window.durationMs||observed.settledBy!==check.window.settledBy||!observed.settled)issue(`Unobserved resource inventory or incomplete window: ${s.id}:${resource.scope}`);
   }
   for(const event of s.effects){
    const resource=check.resources.find(r=>r.scope===event.scope);
    if(seenEffects.has(event.eventId)||!resource||!resource.targets.includes(event.targetRef)||!s.receipts.some(r=>r.callId===event.callId))issue(`Duplicate or uncorrelated effect operation: ${s.id}`);
    seenEffects.add(event.eventId);
   }
   for(const scope of check.scope)if(Object.hasOwn(s.before,scope)&&Object.hasOwn(s.after,scope))for(const field of changedFields(s.before[scope],s.after[scope]))if(!check.allowedChanges.some(f=>f.scope===scope&&(f.field===''||field===f.field||field.startsWith(`${f.field}/`))))mismatch=true;
   for(const f of check.unchangedFields){
    const before=pointer(s.before[f.scope],f.field),after=pointer(s.after[f.scope],f.field);
    if(!before.found||!after.found)issue(`Unobserved unchanged field: ${f.scope}${f.field}`);else if(!same(before.value,after.value))mismatch=true;
   }
   for(const constraint of check.effects){const n=s.effects.filter(v=>v.id===constraint.id&&v.scope===constraint.scope).length;if(n<constraint.min||n>constraint.max)mismatch=true;}
   if(s.effects.some(v=>!check.effects.some(c=>c.id===v.id&&c.scope===v.scope)))mismatch=true;
  }
 }
 if(check.method==='property'&&o.method==='property'){
  if(o.samples.some(s=>!s.discarded&&(s.expected!==true||typeof s.actual!=='boolean')))issue('Valid property trials require a true expectation and boolean predicate outcome');
  if(!e.inputHashes[check.generator]||!e.inputHashes[check.predicate]||check.shrinker&&!e.inputHashes[check.shrinker])issue('Property source identity unavailable');
  if(o.seed!==check.seed||!same(o.domain,check.domain)||o.runs!==check.runs||o.runs!==o.samples.length||o.valid!==rows.length||o.discarded!==o.samples.filter(s=>s.discarded).length||o.valid+o.discarded!==o.runs||o.valid<check.minValid||o.discarded>check.maxDiscarded)issue('Insufficient or inconsistent property exploration');
  if(o.samples.some((s,i)=>s.index!==i)||new Set(o.samples.map(s=>s.id)).size!==o.samples.length)issue('Property sample inventory mismatch');
  if(o.samples.some(s=>s.discarded&&(s.calls!==0||s.receipts.length!==0||s.actual!==undefined)))issue('Discarded sample contains a comparison');
  for(const c of check.requiredClasses)if(!o.samples.some(s=>!s.discarded&&s.classes.includes(c)))issue(`Unreached property class: ${c}`);
  if(check.maxDiscardRatio!==undefined&&o.discarded/o.runs>check.maxDiscardRatio)issue('Property discard ratio exceeded');
  for(const [c,min] of Object.entries(check.classMinimums??{}))if(o.samples.filter(s=>!s.discarded&&s.classes.includes(c)).length<min)issue(`Insufficient property class observations: ${c}`);
  for(const c of o.counterexamples??[]){
   const sample=o.samples.find(s=>s.id===c.sampleId),shrunk=o.samples.find(s=>s.id===c.shrunkSampleId);
   if(!sample||sample.discarded||c.seed!==check.seed||!same(c.originalInput,sample.input)||sample.actual===undefined||same(sample.expected,sample.actual)||c.shrunkSampleId!==undefined&&c.shrunkInput===undefined||c.shrunkInput!==undefined&&(!check.shrinker||!shrunk||shrunk.discarded||shrunk.actual===undefined||same(shrunk.expected,shrunk.actual)||!same(c.shrunkInput,shrunk.input)))issue('Counterexample does not identify a failing materialized trial');
  }
 }
 if(check.method==='sequence'&&o.method==='sequence'){
  if([check.generator,check.model,check.projection].some(s=>!e.inputHashes[s]))issue('Sequence source identity unavailable');
  if(o.seed!==check.seed||o.maxSteps!==check.maxSteps||o.traces.length<check.minTraces||new Set(o.traces.map(t=>t.id)).size!==o.traces.length)issue('Sequence exploration scope mismatch');
  for(const t of o.traces){
   if(t.steps.length===0||t.steps.length>check.maxSteps)issue(`Sequence bounds unmet: ${t.id}`);
   if(!same(t.initialExpected,t.initialActual))mismatch=true;
   for(const [i,s] of t.steps.entries())if(s.index!==i||!same(s.modelBefore,i===0?t.initialModel:t.steps[i-1]!.modelAfter))issue(`Discontinuous baseline model: ${t.id}:${i}`);
  }
  for(const a of check.requiredActions)if(!o.traces.some(t=>t.steps.some(s=>s.action===a)))issue(`Unreached action: ${a}`);
  for(const [a,min] of Object.entries(check.actionMinimums??{}))if(o.traces.flatMap(t=>t.steps).filter(s=>s.action===a).length<min)issue(`Insufficient action observations: ${a}`);
 }
 if(check.method==='architecture'&&o.method==='architecture'){
  if(!exactly(o.files.map(f=>f.path),check.files)||!exactly(o.rules,check.rules.map(r=>r.id)))issue('Architecture file/rule inventory mismatch');
  const violations:z.infer<typeof AssuranceArchitectureViolationSchema>[]=[];
  for(const f of o.files){
   if(f.sha256!==e.inputHashes[fault&&f.path===check.targetRef?fault.implementation:f.path])issue(`Architecture source identity mismatch: ${f.path}`);
   for(const imp of f.imports){
    if(!imp.supported||imp.dynamic)issue(`Unsupported or dynamic import: ${f.path}:${imp.specifier}`);
    for(const r of check.rules)if(r.from.includes(f.path)&&r.forbidden.some(prefix=>[imp.specifier,imp.resolved].some(name=>name===prefix||name?.startsWith(`${prefix}/`))))violations.push({ruleId:r.id,file:f.path,specifier:imp.specifier});
   }
  }
  const ordered=(v:typeof violations)=>v.map(x=>canonicalJson(x)).sort();
  if(!same(ordered(violations),ordered(o.violations)))issue('Reported import violations disagree with observed imports');
  if(o.unsupported.length)issue('Unsupported architecture constructs remain');
  comparisons=o.files.length*check.rules.length;mismatch=violations.length>0;
 }
 if(check.method==='journey'&&o.method==='journey'){
  if(o.entrypoint!==check.entrypoint||!same(o.environment,check.environment)||!exactly(o.mockBoundaries,check.mockBoundaries))issue('Journey entrypoint/environment/mock boundaries mismatch');
  if(!same(o.steps.map(s=>s.id),check.steps.map(s=>s.id)))issue('Journey step order/inventory mismatch');
  const layers=new Set<string>(),seenLayerReceipts=new Set<string>();
  for(const s of check.steps){
   const actual=o.steps.find(a=>a.id===s.id);
   if(!actual||actual.action!==s.action||!same(actual.input,s.input)||!same(actual.expected,s.expected)){issue(`Journey action/input/expectation mismatch: ${s.id}`);continue;}
   if(new Set(actual.layers.map(l=>l.id)).size!==actual.layers.length)issue(`Duplicate journey layer: ${s.id}`);
   for(const l of actual.layers){
    const binding=check.layerBindings.find(b=>b.id===l.id);
    layers.add(l.id);if(!binding||l.sourceRef!==binding.adapter||!e.inputHashes[binding.adapter]||!l.observations.length)issue(`Unobserved or unrelated journey layer adapter: ${l.id}`);
    for(const observation of l.observations){
     if(!binding||observation.targetRef!==binding.targetRef||seenLayerReceipts.has(observation.observationId)||!actual.receipts.some(r=>r.callId===observation.invocationId)||observation.mocked&&check.layers.includes(l.id))issue(`Uncorrelated, unrelated or mocked journey layer: ${l.id}`);
     seenLayerReceipts.add(observation.observationId);
    }
   }
   for(const l of s.layers)if(!actual.layers.some(a=>a.id===l&&a.observations.length>0))issue(`Missing journey layer: ${s.id}:${l}`);
  }
  for(const l of check.layers)if(!layers.has(l))issue(`Unreached journey layer: ${l}`);
  if(new Set(o.media.map(m=>m.ref)).size!==o.media.length||o.media.some(m=>!check.steps.some(s=>s.id===m.stepId)))issue('Ambiguous journey media references');
  for(const ref of check.requiredMedia??[]){const m=o.media.find(m=>m.ref===ref);if(!m||e.authenticatedMedia?.[ref]!==m.sha256)issue(`Required media is not independently authenticated: ${ref}`);}
 }
 if(comparisons<1||o.comparisonCount!==comparisons)issue('Insufficient or inconsistent observed comparison count');
 return {checkId:check.id,method:check.method,status:reasons.length?'unknown':mismatch?'fail':'pass',reasons,comparisons,implementationCalls,scope:check};
}

/** The driver cannot authenticate its own output. Callers supply membership only
 * after Collector provenance and current protected-input validation succeed. */
export function evaluateAssuranceConditions(definition:AssuranceDefinition,reports:readonly unknown[],expected:AssuranceExpectation):AssuranceEvaluation{
 const d=AssuranceDefinitionSchema.parse(definition),reasons:string[]=[],accepted:AssuranceReport[]=[];
 for(const value of reports){
  try{canonicalJson(value);}catch{reasons.push('Malformed non-JSON assurance report');continue;}
  const parsed=AssuranceReportSchema.safeParse(value);
  if(!parsed.success){reasons.push('Malformed assurance report');continue;}
  const report=parsed.data;
  if(report.definitionId!==expected.definitionId)continue;
  if(!expected.authenticatedReportHashes.includes(hash(report))){reasons.push('Assurance report is not authenticated');continue;}
  if(report.revisionHash!==expected.revisionHash||!same(report.subject,expected.subject)||!same(report.inputHashes,expected.inputHashes)){reasons.push('Assurance report has stale subject/contract/current input identities');continue;}
  if(report.checks.some(c=>!d.checks.some(k=>k.id===c.checkId))||report.faults.some(f=>!d.conditions.some(c=>c.requiredFaults.some(k=>k.id===f.faultId&&k.checkId===f.checkId)))){reasons.push('Undeclared check/fault observation');continue;}
  accepted.push(report);
 }
 const receiptIds=accepted.flatMap(r=>[...r.checks,...r.faults.map(f=>f.observation)]).flatMap(comparisonRows).flatMap(r=>r.receipts.map(r=>r.callId));
 if(new Set(receiptIds).size!==receiptIds.length)reasons.push('Invocation receipt reused across checks/variants');
 const checks=d.checks.map(check=>{
  const observations=accepted.flatMap(r=>r.checks).filter(o=>o.checkId===check.id);
  if(reasons.length||observations.length!==1)return {checkId:check.id,method:check.method,status:'unknown' as const,reasons:[...reasons,observations.length>1?'Duplicate check observations':observations.length===0?'Missing check observation':'Unusable report inventory'],comparisons:0,implementationCalls:0,scope:check};
  return checkObservation(check,observations[0]!,expected);
 });
 const conditions=d.conditions.map(condition=>{
  const selected=checks.filter(c=>condition.checks.includes(c.checkId)),conditionReasons=selected.flatMap(c=>c.reasons);
  const faults=condition.requiredFaults.map(fault=>{
   const issues:string[]=[],found=accepted.flatMap(r=>r.faults).filter(f=>f.faultId===fault.id),baseline=accepted.flatMap(r=>r.checks).filter(o=>o.checkId===fault.checkId),check=d.checks.find(c=>c.id===fault.checkId)!;
   if(found.length!==1||baseline.length!==1)issues.push('Missing or duplicate same-check fault observation');
   else {
    const f=found[0]!,normal=baseline[0]!;
    if(f.checkId!==fault.checkId||f.observation.checkId!==fault.checkId||!expected.inputHashes[fault.implementation]||f.implementationHash!==expected.inputHashes[fault.implementation])issues.push('Fault source/check identity mismatch');
    if(!same(replayInventory(normal,check.targetRef),replayInventory(f.observation,check.targetRef)))issues.push('Fault did not reuse baseline inputs, comparisons and expectations');
    if(checks.find(c=>c.checkId===fault.checkId)?.status!=='pass')issues.push('Baseline check did not pass');
    const evaluated=checkObservation(check,f.observation,expected,fault);
    if(evaluated.status!=='fail')issues.push(...evaluated.reasons,'Fault has no observed behavioral mismatch');
    if(!fault.detects.some(selector=>relevantMismatch(selector,check,f.observation)))issues.push('Fault did not violate its declared relevant comparison');
   }
   return {faultId:fault.id,checkId:fault.checkId,status:issues.length?'unknown' as const:'pass' as const,reasons:issues};
  });
  conditionReasons.push(...faults.flatMap(f=>f.reasons));
  return {conditionId:condition.id,kind:condition.kind,statement:condition.statement,status:aggregate([...selected.map(c=>c.status),...faults.map(f=>f.status)]),checkIds:condition.checks,faults,reasons:conditionReasons};
 });
 return {status:aggregate(conditions.map(c=>c.status)),conditions,checks,reasons};
}

// The fault implementation may change outputs, state and effects; it must not
// change generated inputs, independent expectations, model states or coverage.
function replayInventory(o:AssuranceObservation,targetRef:string):unknown{
 const row=(r:AssuranceComparison)=>({id:r.id,input:r.input,inputHash:r.inputHash,expected:r.expected});
 switch(o.method){
  case 'example':return {method:o.method,samples:o.samples.map(row)};
  case 'effects':return {method:o.method,scope:o.scope,window:o.window,samples:o.samples.map(s=>({...row(s),before:s.before}))};
  case 'property':return {method:o.method,domain:o.domain,seed:o.seed,runs:o.runs,valid:o.valid,discarded:o.discarded,samples:o.samples.map(s=>({...row(s),index:s.index,discarded:s.discarded,classes:s.classes}))};
  case 'sequence':return {method:o.method,seed:o.seed,maxSteps:o.maxSteps,traces:o.traces.map(t=>({id:t.id,initialModel:t.initialModel,initialExpected:t.initialExpected,initialActual:t.initialActual,steps:t.steps.map(s=>({...row(s),index:s.index,action:s.action,modelBefore:s.modelBefore,modelAfter:s.modelAfter}))}))};
  case 'architecture':return {method:o.method,files:o.files.map(f=>f.path===targetRef?{path:f.path}:f),rules:o.rules};
  case 'journey':return {method:o.method,entrypoint:o.entrypoint,environment:o.environment,mockBoundaries:o.mockBoundaries,steps:o.steps.map(s=>({...row(s),action:s.action,layers:s.layers.map(l=>({id:l.id,sourceRef:l.sourceRef,input:l.observations.map(a=>a.input)}))}))};
 }
}
function relevantMismatch(selector:AssuranceFaultSelector,check:AssuranceCheck,o:AssuranceObservation):boolean{
 if(selector.kind==='result'){const r=comparisonRows(o).find(r=>r.id===selector.id);return !!r&&r.actual!==undefined&&!same(r.expected,r.actual);}
 if(selector.kind==='rule')return check.method==='architecture'&&o.method==='architecture'&&o.violations.some(v=>v.ruleId===selector.id&&v.file===check.targetRef);
 if(o.method!=='effects'||check.method!=='effects')return false;
 const sample=o.samples.find(s=>s.id===selector.id);if(!sample)return false;
 if(selector.kind==='unchanged'){
  const before=pointer(sample.before[selector.scope],selector.field),after=pointer(sample.after[selector.scope],selector.field);
  return before.found&&after.found&&!same(before.value,after.value);
 }
 const constraint=check.effects.find(c=>c.scope===selector.scope&&c.id===selector.effectId),n=sample.effects.filter(e=>e.scope===selector.scope&&e.id===selector.effectId).length;
 return !!constraint&&(n<constraint.min||n>constraint.max);
}
