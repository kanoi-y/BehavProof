import {hash,resolveRisk,AssuranceBundleSchema,evaluateAssuranceConditions,type Config,type Contract,type RegistrySnapshot,type Approval,type Evaluation,type AssuranceBundle,type AssuranceEvaluation,type AssuranceStatus}from'@behavproof/core';
import {buildAssuranceMap,type AssuranceMapResult,type Change}from'@behavproof/contract-registry';
import {assuranceIdentity,assuranceCriterionPaths}from'./assurance-inputs.js';import{exists}from'./project.js';import type{TrustRoot}from'./trust.js';
type Options={root:string;config:Config;configRef:string;trust?:TrustRoot;head:RegistrySnapshot;obligations:RegistrySnapshot;changes:readonly Change[];approvals:readonly Approval[];intentStatus:ReadonlyMap<string,string>;files:readonly string[];inputs:readonly string[];trusted:(ref:string|undefined)=>boolean;readJson:(ref:string)=>Promise<unknown>;readBytes:(ref:string)=>Promise<Uint8Array>};
const aggregate=(s:AssuranceStatus[]):AssuranceStatus=>s.includes('fail')?'fail':s.length&&s.every(v=>v==='pass')?'pass':'unknown';
export async function assuranceEvaluations(o:Options){
 const contracts=[...new Map([...o.obligations.contracts,...o.head.contracts].filter(c=>c.assurance).map(c=>[hash([c.id,c.revisionHash]),c])).values()];
 const enabled=!!o.config.assurance||!!o.trust?.config.assurance||contracts.length>0;
 const evaluations:Evaluation[]=[],results:AssuranceMapResult[]=[];
 if(!enabled)return {enabled,contracts,results,evaluations,policyChanged:false};
 const protectedConfig=o.trust?.config.assurance,configuration=protectedConfig??o.config.assurance;
 const policyChanged=!!protectedConfig&&hash(protectedConfig)!==hash(o.config.assurance??null);
 evaluations.push({ruleId:'assuranceConfiguration',severity:'error',status:!o.trust?'unknown':!configuration?'unknown':policyChanged?'fail':'pass',scope:['assurance'],evidenceIds:[],message:policyChanged?'Assurance driver/source/output/bounds configuration changed; protected registration must be updated independently':!o.trust?'Assurance configuration requires an external protected root':'Protected assurance configuration retained'});
 const ids=new Set([...contracts,...(o.trust?.baseline.contracts??[]).filter(c=>c.assurance)].map(c=>c.id)),intentIds=new Set([...contracts,...(o.trust?.baseline.contracts??[]).filter(c=>c.assurance)].flatMap(c=>c.intentIds));
 const changes=o.changes.filter(c=>c.contractId&&ids.has(c.contractId)||c.intentId&&intentIds.has(c.intentId));
 const unresolved=changes.filter(c=>!o.approvals.some(a=>a.status==='pass'&&a.target.kind===(c.intentId?'intent':'contract')&&a.target.id===(c.intentId??c.contractId)&&a.target.contentHash===c.transitionHash));
 evaluations.push({ruleId:'assuranceDeclarationProtection',severity:'error',status:!o.trust?'unknown':unresolved.length?'fail':'pass',scope:['assurance'],evidenceIds:[],message:unresolved.length?'Unapproved assurance declaration transition; baseline and head conditions retained':'Assurance declaration transitions require protected content-bound approval'});
 const candidates:{ref:string;bundle:AssuranceBundle;authenticated:boolean;scope:readonly string[]}[]=[],seen=new Set<string>(),mediaCandidates=new Map<string,{digest:string;count:number}>();
 for(const manifest of o.trust?.manifests??[])for(const artifact of manifest.expected.artifacts){
  if(artifact.kind==='assurance_report'&&!seen.has(artifact.ref)&&await exists(o.root,artifact.ref)){
   seen.add(artifact.ref);candidates.push({ref:artifact.ref,bundle:AssuranceBundleSchema.parse(await o.readJson(artifact.ref)),authenticated:o.trusted(artifact.ref),scope:artifact.scope});
  }
  if(artifact.kind==='assurance_media'&&o.trusted(artifact.ref)&&artifact.scope.length===1){
   const logical=artifact.scope[0]!;const {hashBytes}=await import('@behavproof/core');const digest=hashBytes(await o.readBytes(artifact.ref)),previous=mediaCandidates.get(logical);mediaCandidates.set(logical,{digest,count:(previous?.count??0)+1});
  }
 }
 for(const ref of new Set([o.config.assurance?.report,protectedConfig?.report].filter((x):x is string=>!!x)))if(!seen.has(ref)&&await exists(o.root,ref)){seen.add(ref);candidates.push({ref,bundle:AssuranceBundleSchema.parse(await o.readJson(ref)),authenticated:false,scope:[]});}
 if(!contracts.length)evaluations.push({ruleId:'assuranceInventory',severity:'error',status:'unknown',scope:['assurance'],evidenceIds:[],message:'Assurance is configured but no condition inventory is present'});
 for(const contract of contracts){
  let identity:Awaited<ReturnType<typeof assuranceIdentity>>|undefined,problem:string|undefined;
  if(configuration){try{identity=await assuranceIdentity(o.root,configuration,contracts,o.files,o.configRef);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;problem='Assurance source input missing';}}else problem='Assurance execution configuration missing';
  if(identity&&o.trust&&configuration&&assuranceCriterionPaths(configuration,contracts,o.files,o.configRef).some(p=>!o.trust!.assuranceSources?.[p]||o.trust!.assuranceSources[p]!==identity!.inputHashes[p]))problem='Verification criterion source changed or lacks independently approved source binding';
  if(identity&&o.trust&&identity.paths.some(p=>!o.inputs.includes(p)))problem='Protected input scope omits assurance driver/oracle/implementation/adapter/fault/config sources';
  if(identity&&configuration){
   const criteria=assuranceCriterionPaths(configuration,contracts,o.files,o.configRef),missing=criteria.some(p=>!o.trust?.assuranceSources?.[p]),changed=criteria.some(p=>!!o.trust?.assuranceSources?.[p]&&o.trust.assuranceSources[p]!==identity!.inputHashes[p]);
   evaluations.push({ruleId:'assuranceCriterionBinding',severity:'error',status:changed?'fail':missing?'unknown':'pass',scope:['contract',contract.id,'revision',contract.revisionHash],evidenceIds:[],message:changed?'Verification criterion source differs from the independently approved source snapshot':missing?'Independent criterion source binding is incomplete':'Generator/oracle/driver/adapter/fault sources match approved semantics'});
  }
  const path=contract.sourceRef.replace(/:\d+(?::\d+)?$/,''),target={path,module:path.replace(/\.[cm]?[jt]sx?$/,''),contractKind:contract.kind,...(contract.risk?{declaredRisk:contract.risk}:{})};
  const protectedRisk=o.trust?resolveRisk(o.trust.config,target):undefined,risk=resolveRisk(o.config,target,protectedRisk);
  const missingFaults=risk==='critical'?contract.assurance!.conditions.flatMap(c=>c.checks.filter(checkId=>!c.requiredFaults.some(f=>f.checkId===checkId)).map(checkId=>({conditionId:c.id,checkId}))):[];
  if(risk==='critical')evaluations.push({ruleId:'assuranceSensitivityRequirements',severity:'error',status:missingFaults.length?'unknown':'pass',scope:['contract',contract.id,'revision',contract.revisionHash],evidenceIds:[],message:'Every adopted critical condition check requires at least one declared relevant fault; additional domain fault types require explicit review'});
  const forContract=candidates.flatMap(c=>c.bundle.reports.filter(r=>r.contractId===contract.id).map(report=>({...c,report}))),matching=forContract.filter(c=>c.report.revisionHash===contract.revisionHash),selected=(matching.length?matching:forContract);
  // Only protected artifact paths/scopes may establish membership. A local report
  // alongside a protected capture must not shadow it or manufacture duplicates.
  const authoritative=selected.filter(c=>c.authenticated&&c.scope.includes(contract.id));
  const chosen=authoritative.length?authoritative:selected.filter(c=>!c.authenticated);
  const inputHashes=identity?.inputHashes??{},observedSubject=identity?.subject??{testedCommitSha:o.head.commitSha,sourceTreeHash:hash({})};
  let evaluation=evaluateAssuranceConditions(contract.assurance!,chosen.map(c=>c.report),{contractId:contract.id,revisionHash:contract.revisionHash,subject:observedSubject,inputHashes,implementationSources:configuration?.implementationSources??[],checkHashes:Object.fromEntries(contract.assurance!.checks.map(c=>[c.id,hash(c)])),authenticatedReportHashes:problem?[]:authoritative.map(c=>hash(c.report)),authenticatedMedia:Object.fromEntries([...mediaCandidates].filter(([,m])=>m.count===1).map(([ref,m])=>[ref,m.digest]))});
  if(missingFaults.length)evaluation=withMissingFaults(evaluation,missingFaults);
  const approved=!!o.trust&&(o.trust.baseline.contracts.some(c=>c.id===contract.id&&c.revisionHash===contract.revisionHash)||o.approvals.some(a=>a.status==='pass'&&a.target.kind==='contract'&&a.target.id===contract.id&&(a.target.contentHash===contract.revisionHash||changes.some(c=>c.contractId===contract.id&&c.transitionHash===a.target.contentHash))))&&contract.intentIds.every(id=>o.intentStatus.get(id)==='pass');
  if(problem||!approved)evaluation=withUnknownAuthority(evaluation,problem??'Contract meaning/version is not independently approved');
  const evidenceRefs=authoritative.map(c=>c.ref);
  for(const condition of evaluation.conditions)evaluations.push({ruleId:'assuranceCondition',severity:'error',status:condition.status,scope:['contract',contract.id,'revision',contract.revisionHash,'condition',condition.conditionId],evidenceIds:evidenceRefs,message:`${condition.statement}; ${condition.reasons.join('; ')||'Current condition/check/fault evidence satisfied within declared scope'}`,remediation:'Collect current condition-scoped observations with the protected producer; preserve declared inputs, adapters, bounds and required fault comparisons; approve changed meaning separately.'});
  evaluations.push({ruleId:'assuranceBinding',severity:'error',status:approved?'pass':'unknown',scope:['contract',contract.id,'revision',contract.revisionHash],evidenceIds:[],message:'Assurance condition meaning requires independently approved Contract and Intent versions'});
  results.push({contractId:contract.id,revisionHash:contract.revisionHash,evaluation,evidenceRefs});
 }
 return {enabled,contracts,results,evaluations,policyChanged};
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
