import {analyzeImpact} from '@behavproof/contract-registry';
import {safeRead,type RegistrySnapshot,type Risk,type Severity,type RulePolicy} from '@behavproof/core';

const isCode=(path:string)=>/\.[cm]?[jt]sx?$/.test(path);
/** Static candidates and explicit unknowns; never behavioral equivalence. */
export async function currentImpact(root:string,inputs:readonly string[],files:readonly string[],changed:readonly string[],registry:RegistrySnapshot,diffKnown:boolean,claimScopes:readonly {contractId:string;targetRef:string}[]=[]){
 const sources:Record<string,string>={},mappings:Record<string,string[]>={};
 for(const path of inputs.filter(isCode))sources[path]=(await safeRead(root,path)).toString('utf8');
 for(const c of registry.contracts){const path=c.sourceRef.replace(/:\d+(?::\d+)?$/,'');(mappings[path]??=[]).push(c.id);}
 for(const s of claimScopes)if(registry.contracts.some(c=>c.id===s.contractId))(mappings[s.targetRef.split('#')[0]!]??=[]).push(s.contractId);
 const result=analyzeImpact(sources,changed.filter(isCode),mappings);
 const unknown=[...result.unknown,...files.filter(path=>isCode(path)&&!inputs.includes(path)).map(path=>`${path}: source is outside the hashed impact inventory`),...changed.filter(path=>isCode(path)&&!Object.hasOwn(sources,path)).map(path=>`${path}: changed/deleted source is unavailable to the current graph`),...(!diffKnown?['Git comparison or tested-commit graph is unverified']:[])].sort();
 const noCodeChange=diffKnown&&!changed.some(isCode);
 return {...result,status:noCodeChange||unknown.length===0?'pass' as const:'unknown' as const,unknown:noCodeChange?[]:unknown,scope:inputs.filter(isCode),message:noCodeChange?'No code changes in the verified Git comparison':unknown.length?`Static impact is unresolved: ${unknown.join('; ')}`:'Static dependency candidates resolved; behavioral equivalence is not established'};
}
export function impactSeverity(risk:Risk,rule?:RulePolicy):Severity{return risk==='critical'?'error':rule?.severity??(risk==='standard'?'warn':'off');}
export const impactRemediation='Review changed files, affected contracts and unresolved dependencies; complete the hashed source scope or supported mappings, then rerun check. Passing tests alone cannot resolve unknown impact.';
