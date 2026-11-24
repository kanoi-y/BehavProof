import {matchesGlob} from 'node:path';
import{DEFAULT_FORMAL_BACKEND_VERSION,evaluateFormalAdequacy,evaluateSpecificationMutants,formalInvariants,specificationRevision,hash,FormalModelReportSchema,ModelConformanceReportSchema,evaluateFormalModel,evaluateModelConformance,resolveRisk,type Config,type Policy,type Evaluation,type EvidenceStatus,type FormalInputIdentity}from'@behavproof/core';
import{reconcileSpecification,type SpecificationRegistry}from'@behavproof/spec-registry';
import{formalSpecificationIdentity,formalInputIdentity,formalTraceInputs,replayCommandHash,traceReceiptRef}from'./formal.js';
import type {specificationReview} from './formal-registry.js';
import {adequacyReportRef} from './formal-adequacy.js';
const worst=(s:EvidenceStatus[]):EvidenceStatus=>s.includes('fail')?'fail':s.length&&s.every(x=>x==='pass')?'pass':'unknown';
type Review={head:string;repository:string;verify:ReturnType<typeof specificationReview>};
type Options={root:string;config:Config;protectedConfig?:Config;specifications?:SpecificationRegistry|undefined;dependencyLockPath?:string|undefined;specificationReview?:Review|undefined;scopeReview?:Review|undefined;policy:Policy;files:readonly string[];inputs:readonly string[];trusted:(ref:string|undefined)=>boolean;present:(ref:string)=>Promise<boolean>;readJson:(ref:string)=>Promise<unknown>;readBytes:(ref:string)=>Promise<Uint8Array>};
export async function formalEvaluations(o:Options){
 const adopted=o.protectedConfig?.formal?.models??[],candidate=o.config.formal?.models??[];
 const models=[];
 const nativeBindings=new Map<string,{status:EvidenceStatus;revision:string|null|undefined}>();
 const registeredScopes=o.protectedConfig?.formal?.required??[],candidateScopes=o.config.formal?.required??[];
 let policyChanged=false;
 for(const model of [...adopted,...candidate.filter(m=>!adopted.some(p=>p.id===m.id))]){
  const current=candidate.find(row=>row.id===model.id);
  const previous=o.specifications?.find(row=>row.id===model.id)?.revisionHash??null;
  let revision:string|null|undefined=current?undefined:null;
  if(current){
   try{revision=specificationRevision(current,await formalSpecificationIdentity(o.root,current));}catch{}
  }
  const review=o.specificationReview;
  const reviewed=review&&revision!==previous&&revision!==undefined?
   await review.verify(model.id,previous,revision):undefined;
  const binding=reconcileSpecification({id:model.id,previous,revision,head:review?.head??'',
   repository:review?.repository??'',...reviewed});
  nativeBindings.set(model.id,{status:binding.status,revision});
  if(binding.status==='fail')policyChanged=true;
  if(binding.status==='pass'&&binding.effectiveRevision===null)continue;
  models.push(binding.status==='pass'&&current?current:model);
 }
 const evaluations:Evaluation[]=[],rows=[];
 for(const m of models){
  const paths=[m.model,...(m.implementation?[m.implementation]:[]),...m.implementationSources];
  const risks=paths.map(path=>{
   const target={path,module:m.module};
   return resolveRisk(o.config,target,o.protectedConfig?resolveRisk(o.protectedConfig,target):undefined);
  });
  const risk=risks.includes('critical')?'critical':risks.includes('standard')?'standard':'basic';
  const effective=risk==='critical'?{...m,requireCanary:true}:m;
  let identity:Awaited<ReturnType<typeof formalInputIdentity>>|undefined,problem:string|undefined;
  try{identity=await formalInputIdentity(o.root,m);}catch(error){problem=(error as Error).message;}
  const required=[m.model,...m.modelSources,...Object.keys(identity?.sources??{}),...(identity?.mutantSources??[]),...(m.driver?[m.driver,...(m.driverSources??[])]:[]),...(m.implementation?[m.implementation,...m.implementationSources]:[]),...(m.canary?[m.canary.implementation]:[])];
  if(m.quint.entry.startsWith('node_modules/')){
   if(o.protectedConfig&&!o.dependencyLockPath)problem='Protected native Quint requires an authenticated dependency lock';
  }else required.push(m.quint.entry);
  if(required.some(ref=>!o.inputs.includes(ref)))problem='Protected input scope omits formal model/Driver/implementation inputs';
  const placeholder='0'.repeat(64),expectedIdentity:FormalInputIdentity=identity?.model??{modelHash:placeholder,configHash:hash(m),commandHash:placeholder};
  const binding=nativeBindings.get(m.id)!;
  const revision=identity?specificationRevision(m,{modelHash:identity.model.modelHash,...identity}):undefined;
  const bindingStatus:EvidenceStatus=binding.status==='pass'&&(problem||binding.revision!==revision)?'unknown':binding.status;
  const bindingResult={status:bindingStatus,reasons:bindingStatus==='pass'?[]:[
   problem??'The current Quint specification must match an independently approved revision']};
  const modelReport=await o.present(m.report)?FormalModelReportSchema.parse(await o.readJson(m.report)):undefined;
  const modelResult=evaluateFormalModel(modelReport,{model:m,identity:expectedIdentity,authenticated:!problem&&o.trusted(m.report)});
  let trace:Awaited<ReturnType<typeof formalTraceInputs>>|undefined,traceProblem:string|undefined;
  if(identity&&await o.present(traceReceiptRef(m))){try{trace=await formalTraceInputs(o.root,m,o.readJson,o.readBytes);}catch(error){if(/identity mismatch|digest mismatch/.test((error as Error).message))traceProblem=(error as Error).message;else throw error;}}
  const conformanceReport=m.conformanceReport&&await o.present(m.conformanceReport)?ModelConformanceReportSchema.parse(await o.readJson(m.conformanceReport)):undefined;
  const conformanceIdentity={...expectedIdentity,commandHash:replayCommandHash(m,identity?.toolHash),...(identity?.driverHash?{driverHash:identity.driverHash}:{}),...(identity?.implementationHash?{implementationHash:identity.implementationHash}:{}),...(trace?{traceHash:trace.traceHash}:{})};
  const traceTrusted=!problem&&!traceProblem&&!!trace&&o.trusted(traceReceiptRef(m))&&trace.receipt.traces.every(a=>o.trusted(a.ref));
  const conformanceTrusted=traceTrusted&&o.trusted(m.conformanceReport);
  const conformanceResult=evaluateModelConformance(conformanceReport,{model:effective,identity:conformanceIdentity,authenticated:conformanceTrusted,...(identity?.canaryImplementationHash?{canaryImplementationHash:identity.canaryImplementationHash}:{})});
  if(problem){modelResult.reasons.push(problem);conformanceResult.reasons.push(problem);}if(traceProblem)conformanceResult.reasons.push(traceProblem);
  const currentModelReport=modelReport?.modelId===m.id&&(['modelHash','configHash','commandHash']as const).every(key=>modelReport.identity[key]===expectedIdentity[key]);
  const stageState=(stage:'parse'|'typecheck'):EvidenceStatus=>{const row=modelReport?.stages.find(s=>s.stage===stage);return !problem&&currentModelReport&&o.trusted(m.report)&&row?.complete&&row.toolVersion===m.quint.version&&row.method===stage&&(row.status==='pass'&&row.exitCode===0||row.status==='fail'&&row.exitCode===1)?row.status:'unknown';};
  const facts={formalSyntax:{status:stageState('parse'),reasons:['Syntax parsing is separate from model property checking']},formalTypecheck:{status:stageState('typecheck'),reasons:['Typechecking is separate from model property checking']},formalModel:modelResult,implementationConformance:conformanceResult,formalBinding:bindingResult};
  for(const [ruleId,fact]of Object.entries(facts)){
   const required=ruleId==='formalSyntax'||ruleId==='formalTypecheck'||ruleId==='formalBinding'||
    ruleId==='formalModel'||ruleId==='implementationConformance'&&!!m.driver;
   const selected=o.policy.rules[ruleId]?.severity;
   const severity=required?'error':selected??'warn';
   const bounds=`model=${m.id}; maxSteps=${m.maxSteps}; maxSamples=${m.maxSamples}; seed=${m.seed}; unbounded=false`;
   const method=ruleId==='formalModel'?`; recorded methods: ${modelResult.stages.map(s=>`${s.stage}/${s.backend}/${s.method}`).join(', ')}`:ruleId==='implementationConformance'?`; traces=${conformanceResult.counts.replayedTraces}; comparedStates=${conformanceResult.counts.comparedSteps}; calls=${conformanceResult.counts.implementationCalls}`:'';
   evaluations.push({ruleId,severity,status:fact.status,scope:['model',m.id],evidenceIds:[...(ruleId==='implementationConformance'&&m.conformanceReport?[m.conformanceReport,traceReceiptRef(m)]:ruleId==='formalBinding'?[m.model]:[m.report])],message:`${fact.reasons.join('; ')||`Current ${ruleId} evidence within the selected model scope`}; ${bounds}${method}`,remediation:'Collect current model, trace and observed replay reports with the protected producer; retain configured bounds and obtain model/Driver mapping approval separately.'});
  }
  const ref=adequacyReportRef(m);
  const authenticated=!problem&&o.trusted(ref);
  const evidence=authenticated?await o.readJson(ref):undefined;
  const expected={
   modelId:m.id,identity:expectedIdentity,authenticated,
   backendVersion:m.quint.apalacheVersion??DEFAULT_FORMAL_BACKEND_VERSION,toolVersion:m.quint.version,maxSteps:m.maxSteps,
  };
  const witnesses=evaluateFormalAdequacy(evidence,{...expected,names:m.witnesses??[]});
  for(const witness of witnesses){
   evaluations.push({ruleId:'formalReachability',status:witness.status,severity:'error',
    scope:['model',m.id,'witness',witness.name],evidenceIds:[ref],message:witness.message});
  }
  const mutants=(m.mutants??[]).map(({id,invariant})=>({id,invariant,modelHash:identity?.mutantHashes?.[id]??placeholder}));
  for(const mutant of evaluateSpecificationMutants(evidence,{...expected,mutants})){
   evaluations.push({ruleId:'formalMutationSensitivity',status:mutant.status,severity:'error',
    scope:['model',m.id,'mutant',mutant.id],evidenceIds:[ref],message:mutant.message});
  }
  const actions=new Map<string,number>(),observedStates=new Set<string>(),observedTransitions=new Set<string>();
  for(const run of traceTrusted?trace!.traces:[]){
   let previous:string|undefined;
   for(const step of run.steps){
    const state=hash({fields:step.expected,outcome:step.expectedOutcome??null});
    observedStates.add(state);
    if(previous!==undefined){
     actions.set(step.action,(actions.get(step.action)??0)+1);
     observedTransitions.add(hash([previous,step.action,step.parameters,state]));
    }
    previous=state;
   }
  }
  for(const action of m.requiredActions){
   const observed=actions.has(action);
   evaluations.push({ruleId:'formalActionReachability',status:observed?'pass':'unknown',severity:'error',
    scope:['model',m.id,'action',action],evidenceIds:[traceReceiptRef(m)],
    message:observed?'Action occurred in an authenticated transition trace':'No authenticated transition trace demonstrates this action'});
  }
  const reportTrusted=!problem&&currentModelReport&&o.trusted(m.report);
  const verification=reportTrusted?modelResult.stages.find(stage=>stage.stage==='verify'):undefined;
  const simulation=reportTrusted?modelResult.stages.find(stage=>stage.stage==='run'):undefined;
  const witnessNames=new Set(m.witnesses);
  const sampled=simulation?.simulationWitnesses;
  const witnessCounts=sampled&&stageState('parse')==='pass'&&stageState('typecheck')==='pass'&&
   simulation?.status==='pass'&&simulation.complete&&simulation.exitCode===0&&
   simulation.toolVersion===m.quint.version&&simulation.backend==='typescript'&&simulation.method==='simulation'&&
   simulation.seed===m.seed&&simulation.maxSamples===m.maxSamples&&simulation.maxSteps===m.maxSteps&&
   formalInvariants(m).every(name=>simulation.properties.includes(name))&&sampled.samplesExplored<=m.maxSamples&&
   sampled.counts.length===witnessNames.size&&sampled.counts.every(({name})=>witnessNames.has(name))?sampled:null;
  const coverage={simulation:{seed:m.seed,maxSamples:m.maxSamples,
   ...(witnessNames.size?{witnessObservations:witnessCounts,
    ...(witnessCounts?{}:{witnessReason:'Authenticated simulation witness counts are unavailable'})}:{}),
   observation:traceTrusted?{traces:trace!.traces.length,distinctStates:observedStates.size,
    distinctTransitions:observedTransitions.size,actions:Object.fromEntries([...actions].sort(([a],[b])=>a.localeCompare(b)))}:null,
   ...(!traceTrusted?{reason:traceProblem??'Authenticated simulation traces are unavailable'}:{})},
  bounded:{backend:'apalache',maxSteps:m.maxSteps,properties:formalInvariants(m),witnesses,verification:verification??null}};
  rows.push({modelId:m.id,...(revision?{revisionHash:revision}:{}),risk,model:modelResult,conformance:conformanceResult,binding:bindingResult,coverage});
 }
 for(const id of new Set([...registeredScopes,...candidateScopes].map(scope=>scope.id))){
  const registered=registeredScopes.find(scope=>scope.id===id),current=candidateScopes.find(scope=>scope.id===id);
  const previous=registered?hash(registered):null,revision=current?hash(current):null,review=o.scopeReview;
  const reviewed=review&&previous!==revision?await review.verify(id,previous,revision):undefined;
  const transition=reconcileSpecification({id,previous,revision,head:review?.head??'',repository:review?.repository??'',
   domain:'requiredSpecification',...reviewed});
  if(transition.status==='fail')policyChanged=true;
  if(transition.status==='pass'&&!current)continue;
  const scope=transition.status==='pass'?current!:(registered??current)!;
  const model=models.find(candidate=>candidate.id===scope.modelId);
  const mapped=model?[...(model.implementation?[model.implementation]:[]),...model.implementationSources]:[];
  const matched=o.files.filter(path=>scope.include.some(pattern=>matchesGlob(path,pattern)));
  const covered=matched.length>0&&matched.every(path=>o.inputs.includes(path)&&mapped.includes(path));
  const binding=rows.find(row=>row.modelId===scope.modelId)?.binding.status;
  const status=transition.status==='fail'?'fail':transition.status==='pass'&&covered&&binding==='pass'?'pass':'unknown';
  evaluations.push({ruleId:'formalRequiredScope',severity:'error',status,
   scope:['requiredSpecification',scope.id],evidenceIds:matched,
   message:status==='pass'?'The protected implementation scope has an approved model binding':
    status==='fail'?'The protected specification scope was changed without an independent approval':
    `No approved current model ${scope.modelId} covers the protected implementation scope`});
 }
 const states=new Map<string,{status:EvidenceStatus;message:string;evidenceIds:string[]}>();
 for(const id of new Set(evaluations.map(e=>e.ruleId))){
  const selected=evaluations.filter(e=>e.ruleId===id);states.set(id,{status:worst(selected.map(e=>e.status)),message:'Per-model formal evidence',evidenceIds:[...new Set(selected.flatMap(e=>e.evidenceIds))]});
 }
 return {enabled:evaluations.length>0,models:rows,evaluations,states,policyChanged,conformanceObserved:worst(rows.map(r=>worst([r.conformance.status,r.binding.status])))};
}
