import {hash,hashBytes,resolveRisk,AssuranceBundleSchema,evaluateAssuranceConditions,type Config,type Evaluation,type AssuranceBundle,type AssuranceEvaluation,type AssuranceStatus,type AssuranceTarget}from'@behavproof/core';
import {type AssuranceMapResult}from'@behavproof/spec-registry';
import {assuranceIdentity,assuranceCriterionPaths}from'./assurance-inputs.js';import{exists}from'./project.js';import type{TrustRoot}from'./trust.js';
import {assuranceDefinitions}from'./assurance-definitions.js';
import {hostedAssuranceReport}from'./assurance-artifacts.js';
type Options={root:string;config:Config;configRef:string;trust?:TrustRoot;testedCommitSha:string;files:readonly string[];inputs:readonly string[];trusted:(ref:string|undefined)=>boolean;readJson:(ref:string)=>Promise<unknown>;readBytes:(ref:string)=>Promise<Uint8Array>;hosted?:{ref:string;files:ReadonlyMap<string,Uint8Array>}};
const aggregate=(s:AssuranceStatus[]):AssuranceStatus=>s.includes('fail')?'fail':s.length&&s.every(v=>v==='pass')?'pass':'unknown';
export async function assuranceEvaluations(o:Options){
 const projectTargets=assuranceDefinitions(o.config.assurance,o.configRef),registeredTargets=assuranceDefinitions(o.trust?.config.assurance,o.configRef);
 const selected:AssuranceTarget[]=[...(registeredTargets??[]),...(projectTargets??[])];
 const targets=[...new Map(selected.filter(c=>c.assurance).map(c=>[hash([c.id,c.revisionHash]),c])).values()];
 const enabled=!!o.config.assurance||!!o.trust?.config.assurance||targets.length>0;
 const evaluations:Evaluation[]=[],results:AssuranceMapResult[]=[];
 if(!enabled)return {enabled,targets,results,evaluations,policyChanged:false};
 const protectedConfig=o.trust?.config.assurance,configuration=protectedConfig??o.config.assurance;
 const policyChanged=!!o.trust&&hash(protectedConfig??null)!==hash(o.config.assurance??null);
 evaluations.push({ruleId:'assuranceConfiguration',severity:'error',status:!o.trust?'unknown':!configuration?'unknown':policyChanged?'fail':'pass',scope:['assurance'],evidenceIds:[],message:policyChanged?'Assurance driver/source/output/bounds configuration changed; protected registration must be updated independently':!o.trust?'Assurance configuration requires an external protected root':'Protected assurance configuration retained'});
 evaluations.push({ruleId:'assuranceDeclarationProtection',severity:'error',status:!o.trust?'unknown':policyChanged?'fail':'pass',scope:['assurance'],evidenceIds:[],message:policyChanged?'Unapproved assurance declaration transition; registered and candidate conditions retained':'Assurance declaration transitions require protected content-bound approval'});
 const candidates:{ref:string;bundle:AssuranceBundle;authenticated:boolean;scope:readonly string[]}[]=[],seen=new Set<string>(),mediaCandidates=new Map<string,{digest:string;count:number}>();
 if(o.hosted){
  const report=o.hosted.files.get(hostedAssuranceReport);
  if(report)candidates.push({ref:o.hosted.ref,bundle:AssuranceBundleSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(report))),authenticated:true,scope:projectTargets?.map(target=>target.id)??[]});
  for(const [ref,bytes] of o.hosted.files)if(ref!==hostedAssuranceReport)mediaCandidates.set(ref,{digest:hashBytes(bytes),count:1});
 }
 for(const manifest of o.hosted?[]:o.trust?.manifests??[])for(const artifact of manifest.expected.artifacts){
  if(artifact.kind==='assurance_report'&&!seen.has(artifact.ref)&&await exists(o.root,artifact.ref)){
   seen.add(artifact.ref);candidates.push({ref:artifact.ref,bundle:AssuranceBundleSchema.parse(await o.readJson(artifact.ref)),authenticated:o.trusted(artifact.ref),scope:artifact.scope});
  }
  if(artifact.kind==='assurance_media'&&o.trusted(artifact.ref)&&artifact.scope.length===1){
   const logical=artifact.scope[0]!;const digest=hashBytes(await o.readBytes(artifact.ref)),previous=mediaCandidates.get(logical);mediaCandidates.set(logical,{digest,count:(previous?.count??0)+1});
  }
 }
 if(!o.hosted)for(const ref of new Set([o.config.assurance?.report,protectedConfig?.report].filter((x):x is string=>!!x)))if(!seen.has(ref)&&await exists(o.root,ref)){seen.add(ref);candidates.push({ref,bundle:AssuranceBundleSchema.parse(await o.readJson(ref)),authenticated:false,scope:[]});}
 if(!targets.length)evaluations.push({ruleId:'assuranceInventory',severity:'error',status:'unknown',scope:['assurance'],evidenceIds:[],message:'Assurance is configured but no condition inventory is present'});
 for(const definition of targets){
  let identity:Awaited<ReturnType<typeof assuranceIdentity>>|undefined,problem:string|undefined;
  if(configuration){try{identity=await assuranceIdentity(o.root,configuration,targets,o.files,o.configRef);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;problem='Assurance source input missing';}}else problem='Assurance execution configuration missing';
  if(identity&&o.trust&&configuration&&assuranceCriterionPaths(configuration,targets,o.files).some(p=>!o.trust!.assuranceSources?.[p]||o.trust!.assuranceSources[p]!==identity!.inputHashes[p]))problem='Verification criterion source changed or lacks independently approved source binding';
  if(identity&&o.trust&&identity.paths.some(p=>!o.inputs.includes(p)))problem='Protected input scope omits assurance driver/oracle/implementation/adapter/fault/config sources';
  if(identity&&configuration){
   const criteria=assuranceCriterionPaths(configuration,targets,o.files),missing=criteria.some(p=>!o.trust?.assuranceSources?.[p]),changed=criteria.some(p=>!!o.trust?.assuranceSources?.[p]&&o.trust.assuranceSources[p]!==identity!.inputHashes[p]);
   evaluations.push({ruleId:'assuranceCriterionBinding',severity:'error',status:changed?'fail':missing?'unknown':'pass',scope:['definition',definition.id,'revision',definition.revisionHash],evidenceIds:[],message:changed?'Verification criterion source differs from the independently approved source snapshot':missing?'Independent criterion source binding is incomplete':'Generator/oracle/driver/adapter/fault sources match approved semantics'});
  }
  const affectedPaths=[definition.sourceRef,...definition.assurance!.checks.map(check=>check.targetRef.split('#')[0]!)];
  const critical=affectedPaths.some(path=>{
   const target={path,module:path.replace(/\.[cm]?[jt]sx?$/,'')};
   return resolveRisk(o.config,target,o.trust?resolveRisk(o.trust.config,target):undefined)==='critical';
  });
  const missingFaults=critical?definition.assurance!.conditions.flatMap(c=>c.checks.filter(checkId=>!c.requiredFaults.some(f=>f.checkId===checkId)).map(checkId=>({conditionId:c.id,checkId}))):[];
  if(critical)evaluations.push({ruleId:'assuranceSensitivityRequirements',severity:'error',status:missingFaults.length?'unknown':'pass',scope:['definition',definition.id,'revision',definition.revisionHash],evidenceIds:[],message:'Every adopted critical condition check requires at least one declared relevant fault; additional domain fault types require explicit review'});
  const forDefinition=candidates.flatMap(c=>c.bundle.reports.filter(r=>r.definitionId===definition.id).map(report=>({...c,report}))),matching=forDefinition.filter(c=>c.report.revisionHash===definition.revisionHash),selected=(matching.length?matching:forDefinition);
  // Only protected artifact paths/scopes may establish membership. A local report
  // alongside a protected capture must not shadow it or manufacture duplicates.
  const authoritative=selected.filter(c=>c.authenticated&&c.scope.includes(definition.id));
  const chosen=authoritative.length?authoritative:selected.filter(c=>!c.authenticated);
  const inputHashes=identity?.inputHashes??{},observedSubject=identity?.subject??{testedCommitSha:o.testedCommitSha,sourceTreeHash:hash({})};
  let evaluation=evaluateAssuranceConditions(definition.assurance!,chosen.map(c=>c.report),{definitionId:definition.id,revisionHash:definition.revisionHash,subject:observedSubject,inputHashes,implementationSources:configuration?.implementationSources??[],checkHashes:Object.fromEntries(definition.assurance!.checks.map(c=>[c.id,hash(c)])),authenticatedReportHashes:problem?[]:authoritative.map(c=>hash(c.report)),authenticatedMedia:Object.fromEntries([...mediaCandidates].filter(([,m])=>m.count===1).map(([ref,m])=>[ref,m.digest]))});
  if(missingFaults.length)evaluation=withMissingFaults(evaluation,missingFaults);
  const approved=o.trust?.schemaVersion===2&&!policyChanged&&!!registeredTargets?.some(c=>c.id===definition.id&&c.revisionHash===definition.revisionHash);
  if(problem||!approved)evaluation=withUnknownAuthority(evaluation,problem??'Current assurance definition requires independent registration');
  const evidenceRefs=authoritative.map(c=>c.ref);
  for(const condition of evaluation.conditions)evaluations.push({ruleId:'assuranceCondition',severity:'error',status:condition.status,scope:['definition',definition.id,'revision',definition.revisionHash,'condition',condition.conditionId],evidenceIds:evidenceRefs,message:`${condition.statement}; ${condition.reasons.join('; ')||'Current condition/check/fault evidence satisfied within declared scope'}`,remediation:'Collect current condition-scoped observations with the protected producer; preserve declared inputs, adapters, bounds and required fault comparisons; approve changed meaning separately.'});
  evaluations.push({ruleId:'assuranceBinding',severity:'error',status:approved?'pass':'unknown',scope:['definition',definition.id,'revision',definition.revisionHash],evidenceIds:[],message:'Assurance conditions require the independently registered revision'});
  results.push({definitionId:definition.id,revisionHash:definition.revisionHash,evaluation,evidenceRefs});
 }
 return {enabled,targets,results,evaluations,policyChanged};
}
function withUnknownAuthority(e:AssuranceEvaluation,reason:string):AssuranceEvaluation{
 const checks=e.checks.map(c=>({...c,status:c.status==='pass'?'unknown' as const:c.status,reasons:[...c.reasons,reason]}));
 const conditions=e.conditions.map(c=>{const faults=c.faults.map(f=>({...f,status:f.status==='pass'?'unknown' as const:f.status,reasons:[...f.reasons,reason]}));return {...c,faults,status:aggregate([...checks.filter(k=>c.checkIds.includes(k.checkId)).map(k=>k.status),...faults.map(f=>f.status)]),reasons:[...c.reasons,reason]};});
 return {...e,checks,conditions,status:aggregate(conditions.map(c=>c.status)),reasons:[...e.reasons,reason]};
}

function withMissingFaults(e:AssuranceEvaluation,missing:readonly {conditionId:string;checkId:string}[]):AssuranceEvaluation{
 const obligations=missing.map(m=>({...m,reason:`Critical fault coverage missing for condition ${m.conditionId}, check ${m.checkId}: declare at least one relevant fault`}));
 const checks=e.checks.map(c=>{const reasons=obligations.filter(m=>m.checkId===c.checkId).map(m=>m.reason);return reasons.length?{...c,status:c.status==='pass'?'unknown' as const:c.status,reasons:[...c.reasons,...reasons]}:c;});
 const conditions=e.conditions.map(c=>({...c,status:aggregate([...checks.filter(k=>c.checkIds.includes(k.checkId)).map(k=>k.status),...c.faults.map(f=>f.status)]),reasons:[...c.reasons,...obligations.filter(m=>c.checkIds.includes(m.checkId)).map(m=>m.reason)]}));
 return {...e,checks,conditions,status:aggregate(conditions.map(c=>c.status)),reasons:[...e.reasons,...obligations.map(m=>m.reason)]};
}
