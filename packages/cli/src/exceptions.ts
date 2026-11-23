import {hash, reconcileSpecification, safeRead,
  type Config, type Evaluation, type ScopedException} from '@behavproof/core';
import {inspectScopedException} from './exception-analysis.js';
import type {specificationReview} from './formal-registry.js';
import {config,fileList,select} from './project.js';

const sourceFile=/(?:\.[cm]?[jt]sx?$|(?:^|\/)(?:tsconfig(?:\.[^/]+)?|package)\.json$)/;

export async function exceptionEvaluations(options:{
  root:string; config:Config; protectedConfig?:Config|undefined; files:readonly string[]; inputs:readonly string[];
  formal?:readonly Evaluation[];
  review?:{head:string;repository:string;verify:ReturnType<typeof specificationReview>}|undefined;
}){
  const candidate=options.config.exceptions??[];
  const protectedRows=options.protectedConfig?.exceptions??[];
  const models=[...protectedRows,...candidate.filter(row=>!protectedRows.some(old=>old.id===row.id))];
  const results=[];
  const evaluations:Evaluation[]=[];
  const reads=new Map<string,Uint8Array>();
  if(models.length)for(const path of options.inputs.filter(path=>sourceFile.test(path))){
    try{reads.set(path,await safeRead(options.root,path));}catch{}
  }
  const snapshots=Object.fromEntries(reads);
  for(const original of models){
    const current=candidate.find(row=>row.id===original.id);
    const approved=protectedRows.find(row=>row.id===original.id);
    const previous=approved?hash(approved):null;
    const revision=current?hash(current):null;
    const review=options.review;
    const reviewed=review&&previous!==revision?await review.verify(original.id,previous,revision):undefined;
    const approval=reconcileSpecification({id:original.id,previous,revision,
      head:review?.head??'',repository:review?.repository??'',domain:'scopedException',...reviewed});
    if(approval.status==='pass'&&approval.effectiveRevision===null)continue;
    const row=approval.status==='pass'&&current?current:original;
    const files=select(options.files,row.sources);
    const scoped=files.length>0&&files.every(path=>reads.has(path))&&reads.has(row.target.module);
    const analysis=inspectScopedException(row,files,snapshots);
    const condition=row.condition;
    const formal=condition.kind==='quint'?options.formal?.find(e=>e.ruleId==='formalReachability'&&
      e.scope[1]===condition.modelId&&e.scope[3]===condition.witness):undefined;
    const binding=condition.kind==='quint'?options.formal?.find(e=>e.ruleId==='formalBinding'&&
      e.scope[1]===condition.modelId):undefined;
    const conditionStatus=condition.kind==='static'?'pass':binding?.status==='pass'?formal?.status??'unknown':'unknown';
    const status=analysis.status==='fail'||conditionStatus==='fail'?'fail':
      scoped&&analysis.status==='pass'&&conditionStatus==='pass'?'pass':'unknown';
    const scope=['exception',row.id],evidenceIds=[row.target.module,...(formal?.evidenceIds??[])];
    const diagnostics=[...analysis.diagnostics,
      ...(!scoped?['Registered exception inputs are missing or outside the protected source snapshot']:[]),
      ...(conditionStatus!=='pass'?['The registered Quint condition is not verified']:[])];
    evaluations.push({ruleId:'scopedException',status,severity:'error',scope,evidenceIds,
      message:diagnostics.join(' ')||'Direct static calls are within the registered caller scope'});
    evaluations.push({ruleId:'scopedExceptionApproval',status:approval.status,severity:'error',scope,evidenceIds:[],
      message:approval.status==='pass'?'Exception scope matches an approved revision':'The exception scope change requires independent approval'});
    results.push({...row,...analysis,status,diagnostics});
  }
  return {exceptions:results,evaluations};
}

export async function executeExceptions(root:string,action:string,configPath?:string){
  const cfg=await config(root,configPath),files=await fileList(root);
  if(action==='discover'){
    return {exitCode:0,report:{exceptions:(cfg.exceptions??[]).map((row:ScopedException)=>({
      ...row,sources:select(files,row.sources),targetPresent:files.includes(row.target.module),
    }))}};
  }
  if(action!=='check')throw Error('Expected exceptions discover|check');
  const result=await exceptionEvaluations({root,config:cfg,files,inputs:files});
  const statuses=result.exceptions.map(row=>row.status);
  return {exitCode:statuses.includes('fail')?1:statuses.includes('unknown')?2:0,report:{exceptions:result.exceptions}};
}
