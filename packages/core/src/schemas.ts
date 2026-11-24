import { z } from 'zod';
import { AssuranceConfigSchema, AssuranceReportSchema } from './assurance.js';
import { getProfilePolicy } from './profiles.js';
import { FormalConfigSchema, FormalModelReportSchema, ModelConformanceReportSchema, FormalTraceReceiptSchema } from './formal.js';
export const EvidenceStatusSchema=z.enum(['pass','fail','unknown','not_applicable']);
export const SeveritySchema=z.enum(['off','warn','error']);
export const RiskSchema=z.enum(['basic','standard','critical']);
export const ModeSchema=z.enum(['audit','gate']);
const text=z.string().min(1);
export const HashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const CountSchema=z.number().int().nonnegative().safe();
export const RelativePathSchema=text.refine(p=>!p.includes('\0')&&!p.includes('\\')&&!p.startsWith('/')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(part=>part==='..'||part==='.'||part===''), 'Expected a scoped relative POSIX path');
const strings=z.array(text);
export const RulePolicySchema=z.strictObject({severity:SeveritySchema,min:z.number().min(0).max(100).optional(),minMutants:CountSchema.optional(),allowNotApplicable:strings.optional()});
export const RuleIdSchema=text.refine(id=>id!=='prototype'&&!Object.hasOwn(Object.prototype,id),'Reserved rule ID');
// Check the original keys before Zod's record parser can discard __proto__.
export const RulesSchema=z.unknown().superRefine((value,ctx)=>{
  if(value!==null&&typeof value==='object'){
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)ctx.addIssue({code:'custom',message:'Expected a plain rule map'});
    for(const id of Object.keys(value))if(!RuleIdSchema.safeParse(id).success)ctx.addIssue({code:'custom',message:'Reserved rule ID',path:[id]});
  }
}).pipe(z.record(RuleIdSchema,RulePolicySchema));
export const PolicySchema=z.strictObject({schemaVersion:z.literal(1),profileVersion:z.literal('2'),rules:RulesSchema});
export const RiskOverrideSchema=z.strictObject({selector:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('path'),value:RelativePathSchema}),z.strictObject({kind:z.literal('module'),value:text})]),profile:RiskSchema});
const exceptionPaths=z.array(RelativePathSchema).max(1000).refine(paths=>new Set(paths).size===paths.length,'Duplicate exception paths');
export const ScopedExceptionSchema=z.strictObject({
 id:text,defaultRule:RuleIdSchema,
 target:z.strictObject({module:RelativePathSchema,exportName:text}),
 allowedCallers:exceptionPaths,
 sources:exceptionPaths.refine(paths=>paths.length>0,'Expected protected exception source scope'),
 condition:z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('static'),rule:z.literal('direct-call-scope')}),
  z.strictObject({kind:z.literal('quint'),modelId:text,witness:text}),
 ]),
 rationaleRef:z.string().regex(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+\/(?:issues|pull)\/[1-9]\d*$/),
});
export type ScopedException=z.infer<typeof ScopedExceptionSchema>;
export const ScopedExceptionsSchema=z.array(ScopedExceptionSchema).max(100).refine(
 rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Duplicate exception IDs',
);
export const ConfigSchema=z.strictObject({schemaVersion:z.literal(2),testRunner:z.enum(['vitest','jest']).optional(),assurance:AssuranceConfigSchema.optional(),formal:FormalConfigSchema.optional(),exceptions:ScopedExceptionsSchema.optional(),mode:ModeSchema.default('audit'),profile:RiskSchema.default('standard'),profileVersion:z.literal('2').default('2'),riskOverrides:z.array(RiskOverrideSchema).default([]),git:z.strictObject({base:text.default('origin/main')}).default({base:'origin/main'}),reports:z.strictObject({vitest:RelativePathSchema.optional(),jest:RelativePathSchema.optional(),coverage:RelativePathSchema.optional(),mutation:RelativePathSchema.optional()}).default({}),executionManifests:z.array(RelativePathSchema).default([]),rules:RulesSchema.default({}),documents:z.strictObject({output:RelativePathSchema}).optional()}).transform(config=>{
  const preset=getProfilePolicy(config.profile,config.profileVersion);
  const rules:Record<string,RulePolicy>={...preset.rules};
  for(const [id,rule] of Object.entries(config.rules))rules[id]={...preset.rules[id],...rule};
  // Selecting critical keeps its obligations mandatory, even if collection is disabled.
  if(config.profile==='critical')for(const id of Object.keys(preset.rules))rules[id]={...rules[id]!,severity:'error'};
  return {...config,rules};
});
export const EvidenceSubjectSchema=z.strictObject({repositoryId:text.optional(),prHeadSha:text.optional(),testedCommitSha:text,testedCommitParents:strings.optional(),sourceTreeHash:HashSchema,dirty:z.boolean(),baseSha:text.optional(),diffBaseSha:text.optional()});
export const ProducerSchema=z.strictObject({tool:text,version:text,collectorVersion:text});
export const CiIdentitySchema=z.strictObject({repositoryId:text,workflowRef:text,runId:text,runAttempt:CountSchema.min(1),jobId:text,eventName:text});
export const ExecutionManifestSchema=z.strictObject({schemaVersion:z.literal(1),executionId:text,subject:EvidenceSubjectSchema,producer:ProducerSchema,commandHash:HashSchema,configHashes:z.record(RelativePathSchema,HashSchema),dependencyLockHash:HashSchema.optional(),environment:z.strictObject({nodeVersion:text,platform:text}),startedAt:z.iso.datetime(),completedAt:z.iso.datetime(),exitCode:z.number().int(),artifacts:z.array(z.strictObject({ref:RelativePathSchema,sha256:HashSchema,kind:text,scope:strings})),ci:CiIdentitySchema.optional(),attestationRef:text.optional()}).superRefine((m,ctx)=>{
  if(Date.parse(m.completedAt)<Date.parse(m.startedAt))ctx.addIssue({code:'custom',message:'Manifest completed before starting'});
  if(new Set(m.artifacts.map(a=>a.ref)).size!==m.artifacts.length)ctx.addIssue({code:'custom',message:'Conflicting artifact references'});
});
export const ApprovalSchema=z.strictObject({schemaVersion:z.literal(2),id:text,target:z.strictObject({kind:z.enum(['policy','specification','exception']),id:text,contentHash:HashSchema}),status:EvidenceStatusSchema,source:z.strictObject({provider:text,ref:text}),approvedBy:strings,subjectCommitSha:text.optional(),reasons:strings});
export const EvaluationSchema=z.strictObject({ruleId:RuleIdSchema,severity:SeveritySchema,status:EvidenceStatusSchema,evidenceIds:strings,scope:strings,message:text,remediation:text.optional(),notApplicable:z.strictObject({reason:text,allowedReasons:strings,evidenceIds:strings}).optional()});
export const ProvenanceSchema=z.strictObject({artifactIntegrity:EvidenceStatusSchema,producerTrust:EvidenceStatusSchema,subjectMatch:EvidenceStatusSchema,reasons:strings});
const evidenceBase={schemaVersion:z.literal(2),id:text,source:z.strictObject({tool:text,version:text.optional(),artifactRef:text}),context:z.strictObject({subject:EvidenceSubjectSchema.optional(),manifestRef:text.optional(),protectedPolicySha:text.optional(),effectivePolicyHash:HashSchema,generatedAt:z.iso.datetime().optional(),collectedAt:z.iso.datetime()}),provenance:ProvenanceSchema,subjectRefs:strings};
const testPayload=z.strictObject({total:CountSchema,passed:CountSchema,failed:CountSchema,skipped:CountSchema}).refine(p=>p.passed+p.failed+p.skipped<=p.total,'Test counts exceed total');
const coveragePayload=z.strictObject({covered:CountSchema,total:CountSchema,excluded:CountSchema,unobserved:CountSchema}).refine(p=>p.covered<=p.total,'Covered exceeds total');
const mutationPayload=z.strictObject({killed:CountSchema,survived:CountSchema,noCoverage:CountSchema,timeout:CountSchema,excluded:CountSchema,unobserved:CountSchema});
const unsupportedPayload=z.strictObject({status:z.literal('unknown'),reason:text});
export const EvidenceSchema=z.discriminatedUnion('kind',[
  z.strictObject({...evidenceBase,kind:z.literal('test'),payload:testPayload}),
  z.strictObject({...evidenceBase,kind:z.literal('coverage'),payload:coveragePayload}),
  z.strictObject({...evidenceBase,kind:z.literal('mutation'),payload:mutationPayload}),
  z.strictObject({...evidenceBase,kind:z.literal('pipeline'),payload:z.strictObject({status:EvidenceStatusSchema,checks:z.array(z.strictObject({id:text,status:EvidenceStatusSchema}))})}),
  z.strictObject({...evidenceBase,kind:z.literal('approval'),payload:ApprovalSchema}),
  z.strictObject({...evidenceBase,kind:z.literal('execution_manifest'),payload:ExecutionManifestSchema}),
  z.strictObject({...evidenceBase,kind:z.literal('assurance'),payload:z.union([AssuranceReportSchema,unsupportedPayload])}),
  z.strictObject({...evidenceBase,kind:z.literal('formal_model'),payload:z.union([FormalModelReportSchema,unsupportedPayload])}),
  z.strictObject({...evidenceBase,kind:z.literal('model_conformance'),payload:z.union([ModelConformanceReportSchema,unsupportedPayload])}),
  z.strictObject({...evidenceBase,kind:z.literal('trace'),payload:z.union([FormalTraceReceiptSchema,unsupportedPayload])})
]);
export const CheckReportSchema=z.strictObject({schemaVersion:z.literal(2),mode:ModeSchema,status:z.enum(['pass','fail','incomplete']),exitCode:z.union([z.literal(0),z.literal(1),z.literal(2)]),mandatoryCount:CountSchema,evaluations:z.array(EvaluationSchema),reasons:strings});
export type EvidenceStatus=z.infer<typeof EvidenceStatusSchema>;
export type Severity=z.infer<typeof SeveritySchema>;
export type Risk=z.infer<typeof RiskSchema>;
export type Mode=z.infer<typeof ModeSchema>;
export type RulePolicy=z.infer<typeof RulePolicySchema>;
export type Policy=z.infer<typeof PolicySchema>;
export type Config=z.infer<typeof ConfigSchema>;
export type EvidenceSubject=z.infer<typeof EvidenceSubjectSchema>;
export type ExecutionManifest=z.infer<typeof ExecutionManifestSchema>;
export type Approval=z.infer<typeof ApprovalSchema>;
export type Evaluation=z.infer<typeof EvaluationSchema>;
export type Provenance=z.infer<typeof ProvenanceSchema>;
export type Evidence=z.infer<typeof EvidenceSchema>;
export type CheckReport=z.infer<typeof CheckReportSchema>;
export function parseConfig(value:unknown):Config{return ConfigSchema.parse(value);}
export function parseEvidence(value:unknown):Evidence{return EvidenceSchema.parse(value);}
