import {createRequire} from 'node:module';
import {join} from 'node:path';
import {hash} from '@behavproof/core';
import type {TargetCall} from './probe.cjs';
export type ReportBinding={testId:string;contractId:string;caseId:string;revisionHash:string;bindingHash:string;bindingScope:string;comparisonCount:number;status:'pass'|'fail'|'unknown'};
export type ProbeRow=ReportBinding&{testState:'passed'|'failed'|'skipped'|'pending'|'todo';targetCalls:TargetCall[]};
type Meta=Omit<ProbeRow,'testId'|'testState'>;
type Block={name:string;parent?:Block|null};
type Fn=(()=>unknown)&{__behavproofContractV1?:Meta};
type Event={name:string;fn?:Fn;testName?:string;test?:{fn?:Fn}};
type State={currentDescribeBlock:Block;unhandledErrors?:unknown[]};
type Environment={handleTestEvent?:(event:Event,state:State)=>unknown};
type Assertion={title:string;ancestorTitles:string[];status:string;invocations?:number};
export type Receipt={schemaVersion:1;version:string;file:string;complete:boolean;suiteIds:string[];testIds:string[];registrations:ReportBinding[];contracts:ProbeRow[]};
export const receiptKey='__behavproofJestReceiptV1';
function plain<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
function contexts(block:Block):string[]{const names:string[]=[];for(let b:Block|undefined|null=block;b?.parent;b=b.parent)names.unshift(b.name);return names;}
function metadata(fn:Fn|undefined):Meta|undefined {
  const value=fn?.__behavproofContractV1;if(!value)return;
  const row=plain(value);
  if(!row.contractId||!row.caseId||!/^([a-f0-9]{64})$/.test(row.revisionHash)||!/^([a-f0-9]{64})$/.test(row.bindingHash)||row.bindingScope!=='runtime-function-string-v1'||!Number.isSafeInteger(row.comparisonCount)||row.comparisonCount<0||!['pass','fail','unknown'].includes(row.status)||!Array.isArray(row.targetCalls))throw Error('Invalid BehavProof Jest metadata');
  hash(row);return row;
}
/** Adapts the environment already selected and constructed by native Jest. */
export default async function runner(globalConfig:unknown,projectConfig:{rootDir:string},environment:Environment,runtime:unknown,testPath:string,sendMessageToJest?:unknown):Promise<unknown>{
  if(process.env.JEST_JASMINE==='1')throw Error('BehavProof Jest requires jest-circus; Jasmine is unsupported');
  const projectRequire=createRequire(join(projectConfig.rootDir,'package.json'));
  const jestPackage=projectRequire.resolve('jest/package.json');
  const jestRequire=createRequire(jestPackage);
  const version=(jestRequire(jestPackage) as {version:string}).version;
  if(!['29.7.0','30.5.2'].includes(version))throw Error(`Unsupported BehavProof Jest version: ${version}`);
  if((jestRequire('jest-circus/package.json') as {version:string}).version!==version)throw Error('Installed Jest and Circus versions differ');
  const adapterModule=jestRequire('jest-circus/runner');
  const adapter=adapterModule.default??adapterModule;
  const original=environment.handleTestEvent;
  const originalDescriptor=Object.getOwnPropertyDescriptor(environment,'handleTestEvent');
  const records:{key:string;testId:string;fn:Fn|undefined;initial:ReportBinding|undefined}[]=[];
  // Jest counts one native suite per file; describe blocks only contribute ancestry.
  const suiteIds=[hash([testPath])],occurrences=new Map<string,number>();
  let complete=true,finished=false;
  const handler:NonNullable<Environment['handleTestEvent']>=function(event,state){
    // add_test is a synchronous circus event: capture before invoking user handlers.
    if(event.name==='add_test'){
      const names=contexts(state.currentDescribeBlock),key=JSON.stringify([...names,event.testName]);
      const occurrence=occurrences.get(key)??0;occurrences.set(key,occurrence+1);
      if(occurrence>0)complete=false;
      const testId=hash([testPath,names,event.testName,occurrence]),meta=metadata(event.fn);
      const initial=meta?{contractId:meta.contractId,caseId:meta.caseId,revisionHash:meta.revisionHash,bindingHash:meta.bindingHash,bindingScope:meta.bindingScope,comparisonCount:0,status:'unknown' as const,testId}:undefined;
      records.push({key,testId,fn:event.fn,initial});
    }
    if(event.name==='test_retry')complete=false;
    if(event.name==='run_finish'){finished=true;if(state.unhandledErrors?.length)complete=false;}
    return original?.call(environment,event,state);
  };
  // Preserve inherited/own/accessor property shape as well as the original function.
  Object.defineProperty(environment,'handleTestEvent',{value:handler,writable:true,configurable:originalDescriptor?.configurable??true,enumerable:originalDescriptor?.enumerable??true});
  try{
    const result=await adapter(globalConfig,projectConfig,environment,runtime,testPath,sendMessageToJest);
    const assertions=result.testResults as Assertion[];
    if(!finished||!records.length||result.testExecError||result.leaks||assertions.length!==records.length)complete=false;
    const contracts:ProbeRow[]=[];
    const used=new Set<number>();
    for(const record of records){
      const matches=assertions.map((a,i)=>({a,i})).filter(({a})=>JSON.stringify([...a.ancestorTitles,a.title])===record.key);
      if(matches.length!==1){complete=false;}
      const match=matches.length===1?matches[0]:undefined;
      if(match){used.add(match.i);if((match.a.invocations??1)>1)complete=false;}
      if(!record.initial)continue;
      const meta=metadata(record.fn);
      const state=match?.a.status;
      const testState:ProbeRow['testState']=state==='passed'?'passed':state==='failed'?'failed':state==='todo'?'todo':state==='pending'?'skipped':'pending';
      const trusted=meta&&match&&matches.length===1&&(match.a.invocations??1)===1&&occurrences.get(record.key)===1;
      contracts.push({...record.initial,...(trusted?{comparisonCount:meta.comparisonCount,status:meta.status}:{}),testState,targetCalls:trusted?meta.targetCalls:[]});
    }
    if(used.size!==assertions.length)complete=false;
    const receipt:Receipt={schemaVersion:1,version,file:testPath,complete,suiteIds,testIds:records.map(r=>r.testId),registrations:records.flatMap(r=>r.initial?[r.initial]:[]),contracts};
    Object.defineProperty(result,receiptKey,{value:plain(receipt),enumerable:true,configurable:true});
    return result;
  }finally{
    if(originalDescriptor)Object.defineProperty(environment,'handleTestEvent',originalDescriptor);else delete environment.handleTestEvent;
  }
}
