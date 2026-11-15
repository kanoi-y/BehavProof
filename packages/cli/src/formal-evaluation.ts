import{hash,FormalModelReportSchema,ModelConformanceReportSchema,evaluateFormalModel,evaluateModelConformance,resolveRisk,type Config,type RegistrySnapshot,type Approval,type Policy,type Evaluation,type EvidenceStatus,type FormalModelConfig,type FormalInputIdentity}from'@behavproof/core';
import{formalAdapters,formalInputIdentity,formalTraceInputs,replayCommandHash,traceReceiptRef}from'./formal.js';
import{exists}from'./project.js';
const worst=(s:EvidenceStatus[]):EvidenceStatus=>s.includes('fail')?'fail':s.length&&s.every(x=>x==='pass')?'pass':'unknown';
type Options={root:string;config:Config;protectedConfig?:Config;baseline?:RegistrySnapshot;registry:RegistrySnapshot;obligations:RegistrySnapshot;approvals:Approval[];intentStatus:ReadonlyMap<string,string>;policy:Policy;inputs:readonly string[];trusted:(ref:string|undefined)=>boolean;readJson:(ref:string)=>Promise<unknown>;readBytes:(ref:string)=>Promise<Uint8Array>};
export async function formalEvaluations(o:Options){
 const adopted=o.protectedConfig?.formal?.models??[],candidate=o.config.formal?.models??[];
 const models=[...adopted,...candidate.filter(m=>!adopted.some(p=>p.id===m.id))];
 const policyChanged=adopted.some(m=>!candidate.some(c=>c.id===m.id&&hash(c)===hash(m)));
 const evaluations:Evaluation[]=[],rows=[];
 for(const model of models){
  const m=FormalModelConfigCopy(model),contract=o.registry.contracts.find(c=>c.id===m.contractId),target={path:m.model,...(contract?{contractKind:contract.kind}:{}),...(contract?.risk?{declaredRisk:contract.risk}:{})};
  const risk=resolveRisk(o.config,target,o.protectedConfig?resolveRisk(o.protectedConfig,target):undefined);
  const effective=risk==='critical'?{...m,requireCanary:true}:m;
  let identity:Awaited<ReturnType<typeof formalInputIdentity>>|undefined,problem:string|undefined;
  try{await formalAdapters();identity=await formalInputIdentity(o.root,m);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error as Error).message.startsWith('Optional formal adapters unavailable'))throw error;problem=(error as Error).message;}
  const required=[m.model,...m.modelSources,...(m.driver?[m.driver,...(m.driverSources??[])]:[]),...(m.implementation?[m.implementation,...m.implementationSources]:[]),...(m.canary?[m.canary.implementation]:[])];
  if(required.some(ref=>!o.inputs.includes(ref)))problem='Protected input scope omits formal model/Driver/implementation inputs';
  const placeholder='0'.repeat(64),expectedIdentity:FormalInputIdentity=identity?.model??{modelHash:placeholder,configHash:hash(m),commandHash:placeholder};
  const current=o.obligations.contracts.find(c=>c.id===m.contractId),binding=contract?.formal;
  const approval=!!contract&&(o.baseline?.contracts.some(c=>c.id===contract.id&&c.revisionHash===contract.revisionHash)||o.approvals.some(a=>a.status==='pass'&&a.target.kind==='contract'&&a.target.id===contract.id&&a.target.contentHash===contract.revisionHash));
  const bindingMatches=!!identity&&!!binding&&binding.modelId===m.id&&binding.modelHash===identity.model.modelHash&&hash([...binding.propertyIds].sort())===hash([...m.properties].sort())&&(!m.driver||binding.driverHash===identity.driverHash)&&current?.revisionHash===contract?.revisionHash;
  const bindingStatus:EvidenceStatus=bindingMatches&&approval&&contract!.intentIds.every(id=>o.intentStatus.get(id)==='pass')?'pass':'unknown';
  const bindingResult={status:bindingStatus,reasons:bindingStatus==='pass'?[]:['Model/Driver/property mapping must match an independently approved current Contract and Intent']};
  const modelReport=await exists(o.root,m.report)?FormalModelReportSchema.parse(await o.readJson(m.report)):undefined;
  const modelResult=evaluateFormalModel(modelReport,{model:m,identity:expectedIdentity,authenticated:!problem&&o.trusted(m.report)});
  let trace:Awaited<ReturnType<typeof formalTraceInputs>>|undefined,traceProblem:string|undefined;
  if(identity&&await exists(o.root,traceReceiptRef(m))){try{trace=await formalTraceInputs(o.root,m,o.readJson,o.readBytes);}catch(error){if(/identity mismatch|digest mismatch/.test((error as Error).message))traceProblem=(error as Error).message;else throw error;}}
  const conformanceReport=m.conformanceReport&&await exists(o.root,m.conformanceReport)?ModelConformanceReportSchema.parse(await o.readJson(m.conformanceReport)):undefined;
  const conformanceIdentity={...expectedIdentity,commandHash:replayCommandHash(m),...(identity?.driverHash?{driverHash:identity.driverHash}:{}),...(identity?.implementationHash?{implementationHash:identity.implementationHash}:{}),...(trace?{traceHash:trace.traceHash}:{})};
  const conformanceTrusted=!problem&&!traceProblem&&!!trace&&o.trusted(traceReceiptRef(m))&&trace.receipt.traces.every(a=>o.trusted(a.ref))&&o.trusted(m.conformanceReport);
  const conformanceResult=evaluateModelConformance(conformanceReport,{model:effective,identity:conformanceIdentity,authenticated:conformanceTrusted,...(identity?.canaryImplementationHash?{canaryImplementationHash:identity.canaryImplementationHash}:{})});
  if(problem){modelResult.reasons.push(problem);conformanceResult.reasons.push(problem);}if(traceProblem)conformanceResult.reasons.push(traceProblem);
  const currentModelReport=modelReport?.modelId===m.id&&(['modelHash','configHash','commandHash']as const).every(key=>modelReport.identity[key]===expectedIdentity[key]);
  const stageState=(stage:'parse'|'typecheck'):EvidenceStatus=>{const row=modelReport?.stages.find(s=>s.stage===stage);return !problem&&currentModelReport&&o.trusted(m.report)&&row?.complete&&row.toolVersion===m.quint.version&&row.method===stage&&(row.status==='pass'&&row.exitCode===0||row.status==='fail'&&row.exitCode===1)?row.status:'unknown';};
  const facts={formalSyntax:{status:stageState('parse'),reasons:['Syntax parsing is separate from model property checking']},formalTypecheck:{status:stageState('typecheck'),reasons:['Typechecking is separate from model property checking']},formalModel:modelResult,implementationConformance:conformanceResult,formalBinding:bindingResult};
  for(const [ruleId,fact]of Object.entries(facts)){
   const required=ruleId==='formalSyntax'||ruleId==='formalTypecheck'||ruleId==='formalBinding'||risk==='critical';
   const selected=o.policy.rules[ruleId]?.severity;
   const severity=required?'error':selected??'warn';
   const bounds=`model=${m.id}; maxSteps=${m.maxSteps}; maxSamples=${m.maxSamples}; seed=${m.seed}; unbounded=false`;
   const method=ruleId==='formalModel'?`; recorded methods: ${modelResult.stages.map(s=>`${s.stage}/${s.backend}/${s.method}`).join(', ')}`:ruleId==='implementationConformance'?`; traces=${conformanceResult.counts.replayedTraces}; comparedStates=${conformanceResult.counts.comparedSteps}; calls=${conformanceResult.counts.implementationCalls}`:'';
   evaluations.push({ruleId,severity,status:fact.status,scope:['model',m.id],evidenceIds:[...(ruleId==='implementationConformance'&&m.conformanceReport?[m.conformanceReport,traceReceiptRef(m)]:ruleId==='formalBinding'&&contract?[contract.sourceRef]:[m.report])],message:`${fact.reasons.join('; ')||`Current ${ruleId} evidence within the selected model scope`}; ${bounds}${method}`,remediation:'Collect current model, trace and observed replay reports with the protected producer; retain configured bounds and obtain model/Driver mapping approval separately.'});
  }
  rows.push({modelId:m.id,contractId:m.contractId,risk,model:modelResult,conformance:conformanceResult,binding:bindingResult});
 }
 const states=new Map<string,{status:EvidenceStatus;message:string;evidenceIds:string[]}>();
 for(const id of ['formalSyntax','formalTypecheck','formalModel','implementationConformance','formalBinding']){
  const selected=evaluations.filter(e=>e.ruleId===id);states.set(id,{status:worst(selected.map(e=>e.status)),message:'Per-model formal evidence; model properties, observed conformance and approved meaning are independent',evidenceIds:[...new Set(selected.flatMap(e=>e.evidenceIds))]});
 }
 return {enabled:models.length>0,models:rows,evaluations,states,policyChanged,conformanceObserved:worst(rows.map(r=>worst([r.conformance.status,r.binding.status])))};
}
const FormalModelConfigCopy=(m:FormalModelConfig):FormalModelConfig=>structuredClone(m);
