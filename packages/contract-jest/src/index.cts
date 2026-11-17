import {test, expect} from '@jest/globals';
import {hash, canonicalJson, ContractSchema, type Contract} from '@behavproof/core';
import {withTargetCalls, type TargetCall} from './probe.cjs';
export type ContractDefinition<I=unknown,E=unknown>={
  id:string; kind?:Contract['kind']; formal?:Contract['formal']; assurance?:Contract['assurance'];
  intent:string; risk:'basic'|'standard'|'critical';
  cases:readonly {id:string;input:I;expected:E;negative?:boolean}[];
};
export function defineContract<const T extends ContractDefinition>(value:T):T {
  if(!value.id||!value.intent||!value.cases.length||new Set(value.cases.map(c=>c.id)).size!==value.cases.length)throw Error('Invalid contract or duplicate case IDs');
  hash(value);
  ContractSchema.parse({id:value.id,kind:value.kind??'examples',intentIds:[`${value.id}:intent`],revisionHash:revisionHash(value),sourceRef:'runtime',risk:value.risk,cases:value.cases,caseIds:value.cases.map(c=>c.id),...(value.formal!==undefined?{formal:value.formal}:{}),...(value.assurance!==undefined?{assurance:value.assurance}:{})});
  return value;
}
function revisionHash(value:ContractDefinition):string {
  return hash({id:value.id,intent:value.intent,risk:value.risk,cases:value.cases,...(value.kind!==undefined?{kind:value.kind}:{}),...(value.formal!==undefined?{formal:value.formal}:{}),...(value.assurance!==undefined?{assurance:value.assurance}:{})});
}
type CaseOf<T extends ContractDefinition>=T['cases'][number];
function cloneJson<T>(value:T):T {
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(entry=>cloneJson(entry)) as T;
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,cloneJson(entry)])) as T;
}
export const contractTest={
  each<T extends ContractDefinition>(contract:T,callback:(entry:CaseOf<T>)=>unknown):void {
    // Validate before cloning; retain JSON number semantics (including -0) in this VM.
    canonicalJson(contract);
    const captured=cloneJson(contract);
    defineContract(captured);
    const capturedRevisionHash=revisionHash(captured);
    const bindingHash=hash({scope:'runtime-function-string-v1',function:callback.toString()});
    for(const entry of captured.cases){
      const identity={contractId:captured.id,caseId:entry.id,revisionHash:capturedRevisionHash,bindingHash,bindingScope:'runtime-function-string-v1',comparisonCount:0,targetCalls:[] as TargetCall[],status:'unknown'};
      const fn=async()=>{
        identity.comparisonCount=0;identity.status='unknown';identity.targetCalls=[];
        const actual=await withTargetCalls(()=>callback(cloneJson(entry) as CaseOf<T>),calls=>{identity.targetCalls=calls;});
        identity.comparisonCount++;
        try{expect(actual).toEqual(entry.expected);identity.status='pass';}
        catch(error){identity.status='fail';throw error;}
      };
      Object.defineProperty(fn,'__behavproofContractV1',{value:identity,enumerable:true});
      test(`${captured.id}: ${entry.id}`,fn);
    }
  },
};
