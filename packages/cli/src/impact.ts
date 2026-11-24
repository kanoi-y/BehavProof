import {analyzeImpact} from '@behavproof/spec-registry';
import {safeRead,type FormalModelConfig,type Risk,type Severity,type RulePolicy} from '@behavproof/core';
import {formalSpecificationIdentity} from './formal.js';

const isCode=(path:string)=>/\.[cm]?[jt]sx?$/.test(path);
export async function specificationImpact(root:string,inputs:readonly string[],affected:readonly string[],models:readonly FormalModelConfig[]){
 const inventory=new Set(inputs),changed=new Set(affected),modelIds=new Set<string>(),unknown=new Set<string>();
 const read=(path:string)=>{
  if(!inventory.has(path))throw Error('Source is outside the impact inventory');
  return safeRead(root,path);
 };
 for(const model of models){
  const paths=new Set([model.model,model.driver,model.implementation,model.canary?.implementation,
   ...model.modelSources,...(model.driverSources??[]),...model.implementationSources,
   ...(model.mutants??[]).flatMap(mutant=>[mutant.model,...(mutant.sources??[])])]);
  if(!model.quint.entry.startsWith('node_modules/'))paths.add(model.quint.entry);
  try{
   const identity=await formalSpecificationIdentity(root,model,read);
   for(const path of [...Object.keys(identity.sources),...(identity.mutantSources??[])])paths.add(path);
  }catch{unknown.add(`${model.id}: formal specification source inventory is unresolved`);}
  if([...paths].some(path=>path!==undefined&&changed.has(path)))modelIds.add(model.id);
 }
 return {modelIds:[...modelIds].sort(),unknown:[...unknown].sort()};
}
/** Static candidates and explicit unknowns; never behavioral equivalence. */
export async function currentImpact(root:string,inputs:readonly string[],files:readonly string[],changed:readonly string[],diffKnown:boolean,models:readonly FormalModelConfig[]=[]){
 const sources:Record<string,string>={};
 for(const path of inputs.filter(isCode))sources[path]=(await safeRead(root,path)).toString('utf8');
 const result=analyzeImpact(sources,changed.filter(isCode));
 const formal=await specificationImpact(root,inputs,[...result.affectedFiles,...changed],models);
 const noSourceChange=diffKnown&&!changed.some(path=>isCode(path)||/\.qnt$/.test(path))&&!formal.modelIds.length;
 const unknown=[...formal.unknown];
 if(!noSourceChange){
  unknown.push(...result.unknown,
   ...files.filter(path=>isCode(path)&&!inputs.includes(path)).map(path=>`${path}: source is outside the hashed impact inventory`),
   ...changed.filter(path=>isCode(path)&&!Object.hasOwn(sources,path)).map(path=>`${path}: changed/deleted source is unavailable to the current graph`));
 }
 if(!diffKnown)unknown.push('Git comparison or tested-commit graph is unverified');
 unknown.sort();
 return {affectedFiles:result.affectedFiles,calls:result.calls,modelIds:formal.modelIds,status:unknown.length===0?'pass' as const:'unknown' as const,unknown,scope:inputs.filter(path=>isCode(path)||/\.qnt$/.test(path)),message:unknown.length?`Static impact is unresolved: ${unknown.join('; ')}`:noSourceChange?'No code changes in the verified Git comparison':'Static dependency candidates resolved; behavioral equivalence is not established'};
}
export function impactSeverity(risk:Risk,rule?:RulePolicy):Severity{return risk==='critical'?'error':rule?.severity??(risk==='standard'?'warn':'off');}
export const impactRemediation='Review changed files, affected specifications and unresolved dependencies. Complete the hashed source scope or supported mappings, then rerun check.';
