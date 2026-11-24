import {realpath} from 'node:fs/promises';
import {isAbsolute,relative,sep} from 'node:path';
import {DEFAULT_FORMAL_BACKEND_VERSION,PROTECTED_QUINT_ENTRY,hash, parseConfig, specificationRevision, type Approval, type Config} from '@behavproof/core';
import {specificationTransitionTarget, type SpecificationReviewDomain} from '@behavproof/spec-registry';
import {formalAdapters,formalSpecificationIdentity} from './formal.js';
import {git,readGitFile} from './project.js';

export async function specificationsAt(root:string,config:Config,read:(path:string)=>Promise<Uint8Array>){
  const rows=[];
  for(const model of config.formal?.models??[]){
    const identity=await formalSpecificationIdentity(root,model,read);
    rows.push({id:model.id,revisionHash:specificationRevision(model,identity)});
  }
  return rows;
}

export async function enrollmentSpecifications(root:string,config:Config,head:string,toolRoot?:string){
  const models=config.formal?.models??[];
  if(!models.length)return [];
  if(!toolRoot||!isAbsolute(toolRoot))throw Error('Enrollment with Quint models requires an absolute --quint-tool-root');
  const trustedRoot=await realpath(toolRoot);
  const checkout=await realpath((await git(root,['rev-parse','--show-toplevel'])).trim());
  const location=relative(checkout,trustedRoot);
  if(!location||!isAbsolute(location)&&location!=='..'&&!location.startsWith('..'+sep)){
    throw Error('The trusted Quint tool installation must be outside the candidate worktree');
  }
  const {quint}=await formalAdapters();
  const read=(path:string)=>readGitFile(root,head,path);
  const rows=[];
  for(const model of models){
    if(model.quint.entry!==PROTECTED_QUINT_ENTRY){
      throw Error(`Model ${model.id} must select the protected Quint entry ${PROTECTED_QUINT_ENTRY}`);
    }
    if((model.quint.apalacheVersion??DEFAULT_FORMAL_BACKEND_VERSION)!==DEFAULT_FORMAL_BACKEND_VERSION){
      throw Error(`Model ${model.id} must select Apalache ${DEFAULT_FORMAL_BACKEND_VERSION}`);
    }
    const inspected=await quint.inspectQuintModel(root,model,trustedRoot,read);
    if(inspected.status!=='pass'){
      throw Error(`Cannot enroll Quint model ${model.id}: ${inspected.diagnostics.join(' ')}`);
    }
    const identity=await formalSpecificationIdentity(root,model,read);
    if(inspected.modelHash!==identity.modelHash)throw Error(`Quint inputs changed during enrollment: ${model.id}`);
    rows.push({id:model.id,revisionHash:specificationRevision(model,identity)});
  }
  return rows;
}

export function specificationReview(options:{
  root:string;
  configPath:string;
  head:string;
  repository:string;
  domain?:SpecificationReviewDomain;
  authorize:(target:Approval['target'])=>Promise<Approval['target']|undefined>;
}){
  const {root,configPath,head,repository,authorize,domain}=options;
  const read=(path:string)=>readGitFile(root,head,path);
  let config:Promise<Config>|undefined;
  return async (id:string,previous:string|null,revision:string|null)=>{
    let reviewedRevision:string|null;
    try{
      config??=read(configPath).then(bytes=>parseConfig(
        JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),
      ));
      if(domain==='scopedException'){
        const exception=(await config).exceptions?.find(entry=>entry.id===id);
        reviewedRevision=exception?hash(exception):null;
      }else if(domain==='requiredSpecification'){
        const scope=(await config).formal?.required?.find(entry=>entry.id===id);
        reviewedRevision=scope?hash(scope):null;
      }else{
        const model=(await config).formal?.models.find(entry=>entry.id===id);
        reviewedRevision=model?specificationRevision(model,await formalSpecificationIdentity(root,model,read)):null;
      }
    }catch{
      return undefined;
    }
    if(reviewedRevision!==revision)return undefined;
    const approval=await authorize(specificationTransitionTarget({id,previous,revision,head,repository,...(domain?{domain}:{})}));
    return approval?{reviewedRevision,approval}:undefined;
  };
}
