import {embeddedEvidenceFiles} from './evidence-files.js';
import {assuranceEvidenceInventory} from './assurance-artifacts.js';
import {assuranceEvaluations} from './assurance-evaluation.js';
import {testReportSelection} from './test-selection.js';
import {specificationReview} from './formal-registry.js';
import {exceptionEvaluations} from './exceptions.js';
import {formalEvidenceInventory} from './formal-artifacts.js';
import {formalEvaluations} from './formal-evaluation.js';
import { scopedEvaluations } from './scopes.js';
import {currentImpact,impactSeverity,impactRemediation} from './impact.js';
import {remediationFor,type PolicyDiff} from './report.js';
import { pipelineEvaluation } from './pipeline.js';
import { safeRead, safeReadJson, parseConfig, hashBytes, mergeProtectedPolicy, evaluateGate, hash, resolveRisk, type Evaluation, type EvidenceStatus, type Approval, type Config, type SpecificationReviewDomain } from '@behavproof/core';
import { detectProject, gitDiff, gitSubject, normalizeVitest, normalizeJest, evaluateTestEvidence, normalizeLcov, normalizeStryker, evaluateCoverage, evaluateMutation, lineMapping, verifyMergeSubject } from '@behavproof/adapter-reports';
import { buildAssuranceMap } from '@behavproof/spec-registry';
import { GitHubAuthority } from '@behavproof/adapter-github';
import { config, fileList, select, ref, exists } from './project.js';
import { authenticate, selectedRunner, loadTrust } from './trust.js';
export type CheckOptions={config?:string;profile?:string;mode?:string;base?:string;head?:string;'trust-root'?:string};
export async function check(root:string,options:CheckOptions){
 const configPath=options.config??'behavproof.config.json',configBytes=await exists(root,configPath)?await safeRead(root,configPath):undefined;
 const rawConfig=configBytes?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes)):{schemaVersion:2};
 const cfg=parseConfig({...rawConfig,...(options.profile?{profile:options.profile}:{})}),mode=options.mode??cfg.mode;
 if(mode!=='gate'&&mode!=='audit')throw Error('Invalid mode');
 if(mode==='gate'&&!options['trust-root'])throw Error('Gate mode requires --trust-root outside project authority');
 const trust=options['trust-root']?await loadTrust(root,options['trust-root']):undefined;
 const policy=trust?mergeProtectedPolicy({schemaVersion:1,profileVersion:'2',rules:cfg.rules},trust.policy):{schemaVersion:1 as const,profileVersion:'2' as const,rules:cfg.rules};
 const nativeSelection=testReportSelection(cfg,trust?.config,trust?.runner);
 const files=await fileList(root);let detection=await detectProject(root,cfg.testRunner?{runner:cfg.testRunner}:undefined);
 const diff=await gitDiff(root,ref(options.base??cfg.git.base),ref(options.head??'HEAD'));
 const inputPaths=trust?select(files,trust.inputs):files.filter(p=>!p.startsWith('.behavproof/')&&!Object.values(cfg.reports).includes(p));
 if(!inputPaths.length)throw Error('No source inputs in evaluation scope');
 const subject=await gitSubject(root,inputPaths,diff.headSha,diff.baseSha);
 const testedRelationship=await verifyMergeSubject(root,subject);
 for(const path of select(files,cfg.executionManifests)) (await import('@behavproof/core')).ExecutionManifestSchema.parse(await safeReadJson(root,path));
 const auth=await authenticate(root,trust,subject);
 const runner=selectedRunner(trust,auth,nativeSelection.reportRef,inputPaths);if(runner)detection=await detectProject(root,runner);
 const requiresProtectedRunner=!!trust;
 const runnerAuthenticated=!requiresProtectedRunner||!!runner;
 const readArtifact=async(path:string)=>auth.artifactBytes.get(path)??await safeRead(root,path);
 const readArtifactJson=async(path:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readArtifact(path)));
 const approvalObservations:{target:Approval['target'];observation:import('@behavproof/adapter-github').Observation}[]=[];
 const states=new Map<string,{status:EvidenceStatus;message:string;evidenceIds:string[];remediation?:string}>();
 const set=(id:string,status:EvidenceStatus,message:string,evidenceIds:string[]=[])=>states.set(id,{status,message,evidenceIds});
 const impact=await currentImpact(root,inputPaths,files,diff.files.flatMap(file=>[file.path,...(file.previousPath?[file.previousPath]:[])]),
  diff.status==='known'&&testedRelationship==='known'&&subject.testedCommitSha===diff.headSha,cfg.formal?.models);
 states.set('changeImpact',{status:impact.status,message:impact.message,evidenceIds:[],remediation:impactRemediation});
 const trusted=(path:string|undefined)=>!!path&&auth.verified.has(path)&&auth.failures.length===0&&detection.support==='single-package';
 // Parse configured artifacts even when unauthenticated so malformed input is exit2, not unknown.
 const nativePath=nativeSelection.reportRef;
 const runnerManifest=trust?.manifests.find(spec=>spec.ref===trust.runner?.manifestRef);
 const receiptRefs=runnerManifest?.expected.artifacts.filter(artifact=>artifact.kind==='test_receipt').map(artifact=>artifact.ref)??[];
 let nativeRunnerEvidence=false;
 if(nativePath&&await exists(root,nativePath)){
  const result=(nativeSelection.kind==='jest'?normalizeJest:normalizeVitest)(await readArtifactJson(nativePath));
  let testStatus=result.status;
  if(receiptRefs.length){
   const receiptRef=receiptRefs.length===1?receiptRefs[0]:undefined;
   const matched=receiptRef&&runnerManifest&&runner&&trusted(nativePath)&&trusted(receiptRef)
    ? evaluateTestEvidence(await readArtifact(nativePath),await readArtifactJson(receiptRef),{
       invocation:runnerManifest.expected.executionId,runner:{kind:runner.runner,version:runner.version},authenticated:true,
      })
    : undefined;
   nativeRunnerEvidence=matched?.payload!==undefined;
   testStatus=matched?.status??'unknown';
  }
  const verified=trusted(nativePath)&&runnerAuthenticated&&nativeRunnerEvidence;
  set('testResult',result.status==='fail'?'fail':verified?testStatus:'unknown',`${nativeSelection.kind==='jest'?'Jest':'Vitest'} ${JSON.stringify(result.payload)}; ${verified?'verified current producer':'producer/subject/runner unverified'}`,[nativePath,...receiptRefs]);
 }
 if(trust?.quality){
  const path=trust.quality.reportRef;
  const spec=trust.manifests.find(row=>row.ref===trust.runner?.manifestRef&&row.expected.artifacts.some(artifact=>artifact.ref===path&&artifact.kind==='quality_observation'));
  if(spec&&trusted(path)){
   const {qualityEvidence}=await import('./quality-evidence.js');
   const evidence=qualityEvidence(await readArtifactJson(path),trust.quality.policyHash);
   for(const [id,observation] of Object.entries(evidence))set(id,observation.status,observation.message,[path]);
  }
 }
 const qualityPaths=trust?.qualitySources?select(files,trust.qualitySources):undefined;
 if(qualityPaths&&(!qualityPaths.length||qualityPaths.some(path=>!inputPaths.includes(path))))throw Error('Protected quality sources must be present within the hashed input scope');
 const qualityFiles=diff.files.filter(f=>!qualityPaths||qualityPaths.includes(f.path));
 const qualityScope={patterns:trust?.qualitySources??null,excludedPaths:diff.files.filter(f=>/\.[cm]?[jt]sx?$/.test(f.path)&&qualityPaths&&!qualityPaths.includes(f.path)).map(f=>f.path).sort()};
 const scope=Object.fromEntries(qualityFiles.filter(f=>!f.kind.startsWith('D')&&/\.[cm]?[jt]sx?$/.test(f.path)).map(f=>[f.path,f.lines]));
 const mapping=diff.status==='known'&&!diff.files.some(f=>f.ambiguous)&&await lineMapping(root,diff.headSha,subject.testedCommitSha,Object.keys(scope))==='known';
 let normalizedCoverage:ReturnType<typeof normalizeLcov>|undefined,normalizedMutation:ReturnType<typeof normalizeStryker>|undefined;const mutationSources:Record<string,string>={};
 const coveragePath=cfg.reports.coverage??trust?.config.reports.coverage;
 if(coveragePath&&await exists(root,coveragePath)){
  const report=normalizeLcov((await readArtifact(coveragePath)).toString('utf8'));
  normalizedCoverage=report;
  const result=evaluateCoverage(report,scope,policy.rules.changedLineCoverage?.min??80,{},mapping);
  set('changedLineCoverage',trusted(coveragePath)?result.status:'unknown',`Changed executable line counts ${JSON.stringify(result.payload)}; score ${result.score??'unknown'}`,[coveragePath]);
 }
 const mutationPath=cfg.reports.mutation??trust?.config.reports.mutation;
 if(mutationPath&&await exists(root,mutationPath)){
  const report=normalizeStryker(await readArtifactJson(mutationPath)),sources:Record<string,string>={};for(const path of Object.keys(scope))sources[path]=(await safeRead(root,path)).toString('utf8');
  normalizedMutation=report;Object.assign(mutationSources,sources);
  const rule=policy.rules.mutationScore,result=evaluateMutation(report,scope,rule?.min??70,rule?.minMutants??10,sources,mapping);
  set('mutationScore',trusted(mutationPath)?result.status:'unknown',`Mutant counts ${JSON.stringify(result.payload)}; score ${result.score??'unknown'}`,[mutationPath]);
 }
 const assuranceRef=trust?.assuranceEvidenceRef;
 const assuranceIds=cfg.assurance?.definitions?.map(row=>row.id).sort()??[];
 const selectedAssurance=trust?.manifests.find(item=>item.ref===trust.runner?.manifestRef&&
  item.expected.artifacts.some(artifact=>artifact.ref===assuranceRef&&artifact.kind==='assurance_bundle'&&
   hash([...artifact.scope].sort())===hash(assuranceIds)));
 const assuranceBytes=assuranceRef&&selectedAssurance&&trusted(assuranceRef)?auth.artifactBytes.get(assuranceRef):undefined;
 const conditionAssurance=await assuranceEvaluations({root,config:cfg,configRef:trust?.assuranceConfigPath??configPath,...(trust?{trust}:{}),testedCommitSha:subject.testedCommitSha,files,inputs:inputPaths,trusted,readJson:readArtifactJson,readBytes:readArtifact,
  ...(assuranceRef?{hosted:{ref:assuranceRef,files:assuranceBytes?embeddedEvidenceFiles(assuranceBytes,assuranceEvidenceInventory(cfg)):new Map()}}:{})});
 const github=trust?.github;
 const scopedReview=(domain?:SpecificationReviewDomain)=>github?{head:diff.headSha,repository:github.repository,verify:specificationReview({
  root,...(domain?{domain}:{}),configPath:trust?.specificationConfigPath??configPath,head:diff.headSha,repository:github.repository,async authorize(target){
   const provider=new GitHubAuthority({repository:github.repository,...(process.env.GITHUB_TOKEN?{token:process.env.GITHUB_TOKEN}:{})});
   const observation=await provider.approval(github.pr,target,{headSha:diff.headSha,baseSha:diff.baseSha,
    reviewers:github.reviewers,requiredChecks:github.requiredChecks});
   approvalObservations.push({target,observation});
   return observation.status==='pass'&&observation.approval?.subjectCommitSha===diff.headSha?observation.approval.target:undefined;
  },
 })}:undefined;
 const formalRef=trust?.formalEvidenceRef;
 const expectedFormalIds=(cfg.formal?.models??[]).map(model=>model.id).sort();
 const selectedFormal=trust?.manifests.find(item=>item.ref===trust.runner?.manifestRef&&
  item.expected.artifacts.some(artifact=>artifact.ref===formalRef&&artifact.kind==='formal_bundle'&&
    hash([...artifact.scope].sort())===hash(expectedFormalIds)));
 const bundleBytes=formalRef&&selectedFormal&&trusted(formalRef)?auth.artifactBytes.get(formalRef):undefined;
 const formalFiles=bundleBytes?embeddedEvidenceFiles(bundleBytes,formalEvidenceInventory(cfg)):new Map<string,Uint8Array>();
 const readFormalBytes=async(path:string)=>{
  if(!formalRef)return readArtifact(path);
  const bytes=formalFiles.get(path);
  if(!bytes)throw Error('Missing authenticated hosted formal evidence: '+path);
  return bytes;
 };
 const formal=await formalEvaluations({root,config:cfg,specificationReview:scopedReview(),scopeReview:scopedReview('requiredSpecification'),...(trust?{protectedConfig:trust.config,specifications:trust.specifications,dependencyLockPath:trust.dependencyLockPath}:{}),policy,files,inputs:inputPaths,
  trusted:path=>formalRef?!!path&&formalFiles.has(path):trusted(path),
  present:path=>formalRef?Promise.resolve(formalFiles.has(path)):exists(root,path),
  readJson:async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFormalBytes(path))),
  readBytes:readFormalBytes});
 if(formal.enabled)for(const [id,state]of formal.states)states.set(id,state);
 const exceptions=await exceptionEvaluations({root,config:cfg,protectedConfig:trust?.config,
  files,inputs:inputPaths,formal:formal.evaluations,review:scopedReview('scopedException')});
 let policyDiff:PolicyDiff|null=null;
 if(trust){
  const weakened=nativeSelection.policyChanged||formal.policyChanged||conditionAssurance.policyChanged||Object.entries(trust.policy.rules).some(([id,r])=>{const local=cfg.rules[id],levels={off:0,warn:1,error:2};return !local||levels[local.severity]<levels[r.severity]||(r.min!==undefined&&(local.min??-1)<r.min)||(r.minMutants!==undefined&&(local.minMutants??-1)<r.minMutants);});
  set('policyProtection',weakened?'fail':'pass',weakened?'Project policy weakens protected obligations; effective evaluation retains protected thresholds':'Policy supplied outside project authority');
  const configuration:PolicyDiff['configuration']=[];
  if(hash(trust.config.riskOverrides)!==hash(cfg.riskOverrides))configuration.push({field:'riskOverrides',
   protected:trust.config.riskOverrides,project:cfg.riskOverrides,
   effective:{protectedFloors:trust.config.riskOverrides,projectRequests:cfg.riskOverrides}});
  if(formal.policyChanged)configuration.push({field:'formal',protected:trust.config.formal??null,project:cfg.formal??null,effective:formal.models.map(m=>m.modelId)});
  if(nativeSelection.policyChanged)configuration.push({field:'testRunner',protected:trust.runner?.kind??trust.config.testRunner??null,project:cfg.testRunner??null,effective:nativeSelection.kind});
  policyDiff={weakened,configuration,rules:[...new Set([...Object.keys(trust.policy.rules),...Object.keys(cfg.rules)])].sort().filter(id=>hash(trust.policy.rules[id]??null)!==hash(cfg.rules[id]??null)).map(ruleId=>({ruleId,protected:trust.policy.rules[ruleId]??null,project:cfg.rules[ruleId]??null,effective:policy.rules[ruleId]??null}))};
 }
 const pipelineObservation=trust?.pipeline?await pipelineEvaluation(root,trust,auth):undefined;
 if(pipelineObservation)set('pipelineIntegrity',pipelineObservation.status,'Workflow health, authenticated artifacts, upstream outcomes and issuer-bound external protection evaluated separately');
 if(auth.failures.length)set('evidenceIntegrity','fail',auth.failures.join('; '));
 const evaluations:Evaluation[]=Object.entries(policy.rules).map(([ruleId,rule])=>{
  const exemption=trust?.notApplicable.find(n=>n.ruleId===ruleId&&states.get(ruleId)?.status!=='fail'&&rule.allowNotApplicable?.includes(n.reason)&&trusted(n.evidenceRef));
  if(exemption)return {ruleId,severity:rule.severity,status:'not_applicable',scope:[],evidenceIds:[exemption.evidenceRef],message:exemption.reason,notApplicable:{reason:exemption.reason,allowedReasons:rule.allowNotApplicable!,evidenceIds:[exemption.evidenceRef]}};
  return {ruleId,severity:rule.severity,status:states.get(ruleId)?.status??'unknown',scope:[],evidenceIds:states.get(ruleId)?.evidenceIds??[],message:states.get(ruleId)?.message??'Required evidence unavailable; collect and authenticate current evidence',...(states.get(ruleId)?.remediation?{remediation:states.get(ruleId)!.remediation}:{} )};
 });
 const impactRisk=resolveRisk({profile:cfg.profile,riskOverrides:[]},{path:'package.json'},trust?.config.profile),impactRow=evaluations.find(e=>e.ruleId==='changeImpact');
 if(impactRow)impactRow.severity=impactSeverity(impactRisk,policy.rules.changeImpact);else evaluations.push({ruleId:'changeImpact',severity:impactSeverity(impactRisk),status:impact.status,scope:[],evidenceIds:[],message:impact.message,remediation:impactRemediation});
 evaluations.push(...scopedEvaluations({config:cfg,...(trust?{protectedConfig:trust.config}:{}),policy,files:inputPaths,states,...(normalizedCoverage?{coverage:normalizedCoverage}:{}),...(normalizedMutation?{mutation:normalizedMutation}:{}),coverageTrusted:trusted(coveragePath),mutationTrusted:trusted(mutationPath),mapping,changed:scope,sources:mutationSources}));
 for(const evaluation of evaluations){const allowed=policy.rules[evaluation.ruleId]?.allowNotApplicable;const exemption=trust?.notApplicable.find(n=>n.ruleId===evaluation.ruleId&&allowed?.includes(n.reason)&&trusted(n.evidenceRef));if(exemption&&evaluation.status==='unknown'){evaluation.status='not_applicable';evaluation.evidenceIds=[exemption.evidenceRef];evaluation.message=exemption.reason;evaluation.notApplicable={reason:exemption.reason,allowedReasons:allowed!,evidenceIds:[exemption.evidenceRef]};}}
 evaluations.push(...formal.evaluations,...exceptions.evaluations,...conditionAssurance.evaluations);
 if(requiresProtectedRunner||cfg.testRunner||nativeSelection.ambiguous)evaluations.push({ruleId:'testRunnerProtection',severity:'error',status:nativeSelection.policyChanged?'fail':nativeSelection.ambiguous||!runnerAuthenticated||!nativeRunnerEvidence?'unknown':'pass',scope:['runner',nativeSelection.kind],evidenceIds:nativePath?[nativePath]:[],message:nativeSelection.policyChanged?'Candidate runner selection differs from retained protected semantics':nativeSelection.ambiguous?'Both native report formats are present; select one runner explicitly':!runnerAuthenticated?'Protected runner kind, supported version and selected authenticated invocation are required':!nativeRunnerEvidence?'Selected invocation requires matching authenticated runner evidence':'Native report kind and protected invocation selection retained'});
 if(auth.failures.length)evaluations.push({ruleId:'evidenceIntegrity',severity:'error',status:'fail',scope:[],evidenceIds:[],message:auth.failures.join('; ')});
 if(testedRelationship!=='known')evaluations.push({ruleId:'testedCommitRelationship',severity:'error',status:'unknown',scope:[],evidenceIds:[],message:'Tested commit is neither PR head nor a verified base/head synthetic merge'});
 if(detection.support!=='single-package'||subject.dirty)evaluations.push({ruleId:'evaluationEnvironment',severity:'error',status:'unknown',scope:[],evidenceIds:[],message:subject.dirty?'Source inputs contain uncommitted or untracked changes':detection.reasons.join('; ')});
 const finalFiles=await fileList(root),finalPaths=trust?select(finalFiles,trust.inputs):finalFiles.filter(p=>!p.startsWith('.behavproof/')&&!Object.values(cfg.reports).includes(p));
 const finalSubject=await gitSubject(root,finalPaths,diff.headSha,diff.baseSha);
 let configsChanged=false;for(const [path,digest] of Object.entries(auth.configHashes))if(hashBytes(await safeRead(root,path))!==digest)configsChanged=true;
 if(trust?.dependencyLockPath&&hashBytes(await safeRead(root,trust.dependencyLockPath))!==auth.dependencyLockHash)configsChanged=true;
 const finalConfig=await exists(root,configPath)?await safeRead(root,configPath):undefined;
 const qualityChanged=!!qualityPaths&&hash(select(finalFiles,trust!.qualitySources!))!==hash(qualityPaths);
 if(qualityChanged||configsChanged||hash(finalSubject)!==hash(subject)||(configBytes?hashBytes(configBytes):null)!==(finalConfig?hashBytes(finalConfig):null))evaluations.push({ruleId:'evaluationSnapshot',severity:'error',status:'fail',scope:[],evidenceIds:[],message:'Source, configuration or HEAD changed during evaluation'});
 for(const e of evaluations)if(e.status==='fail'||e.status==='unknown')e.remediation=remediationFor(e);
 const stable=!evaluations.some(e=>e.ruleId==='evaluationSnapshot'||e.ruleId==='testedCommitRelationship')&&!subject.dirty;
 const assuranceHashes=stable?conditionAssurance.results.map(row=>hash(row)):[];
 const assuranceMap=buildAssuranceMap(conditionAssurance.targets,conditionAssurance.results,row=>assuranceHashes.includes(hash(row)));
 return {...evaluateGate(evaluations,mode),...(conditionAssurance.enabled?{assuranceMap}:{}),
  subject,diff,impact,policyDiff,policySource:trust?.policySource??null,
  ...(trust?.policySource?{protectedPolicySha:trust.policySource.commitSha}:{}),
  authoritySnapshots:{trustRootHash:trust?hash(trust):null,policyHash:trust?hash(trust.policy):null,
   specificationRegistryHash:trust?.specifications?hash(trust.specifications):null,approvals:approvalObservations,
   producers:auth.observations,pipeline:pipelineObservation?.observations??{}},
  qualityScope,detection,effectivePolicyHash:hash(policy),pipelineObservation:pipelineObservation??null,
  provenance:{manifests:auth.manifests,reasons:auth.unknowns},
  ...(formal.enabled?{formal:{models:formal.models,policyChanged:formal.policyChanged}}:{}),
  assurance:{model_conformance_observed:formal.conformanceObserved}};
}
