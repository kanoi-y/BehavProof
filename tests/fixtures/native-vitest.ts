import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {captureTestEvidence} from '../../packages/adapter-reports/src/index.js';
import {hash,hashBytes,type ExecutionManifest,type EvidenceSubject} from '../../packages/core/src/index.js';

export const runner={kind:'vitest',version:'5.1.0'} as const;
export function passingVitest(invocation:string){
 const name='sample.test.ts',title='sample';
 const native=Buffer.from(JSON.stringify({
  numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,
  numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,
  testResults:[{name,status:'passed',assertionResults:[{title,fullName:title,ancestorTitles:[],status:'passed'}]}],
 }));
 const inventory={complete:true,suiteCount:1,testCount:1,files:[name],suiteIds:['suite'],testIds:['test']};
 const receipt=Buffer.from(JSON.stringify(captureTestEvidence(native,inventory,{invocation,runner})));
 return {native,receipt};
}

export async function nativeArtifacts(root:string,reportRef:string,invocation:string){
 const {native,receipt}=passingVitest(invocation);
 await mkdir(dirname(join(root,reportRef)),{recursive:true});
 const receiptRef=reportRef+'.receipt.json';
 await writeFile(join(root,reportRef),native);
 await writeFile(join(root,receiptRef),receipt);
 return [
  {ref:reportRef,kind:'test',scope:[],sha256:hashBytes(native)},
  {ref:receiptRef,kind:'test_receipt',scope:[],sha256:hashBytes(receipt)},
 ];
}

export async function localNativeAuthority(root:string,subject:EvidenceSubject,observations:ExecutionManifest['artifacts']=[]){
 const manifestRef='.behavproof/manifest.json',reportRef='.behavproof/vitest.json',executionId='fixture-run';
 const artifacts=[...await nativeArtifacts(root,reportRef,executionId),...observations];
 const commandHash=hash({command:'fixture'}),producer={tool:'fixture',version:'1',collectorVersion:'1'};
 const expected={executionId,subject,commandHash,configHashes:{},artifacts:artifacts.map(({sha256:_digest,...artifact})=>artifact)};
 const manifest:ExecutionManifest={schemaVersion:1,...expected,producer,artifacts,exitCode:0,
  environment:{nodeVersion:process.version,platform:process.platform},
  startedAt:'2026-11-13T00:00:00Z',completedAt:'2026-11-13T00:00:01Z'};
 await writeFile(join(root,manifestRef),JSON.stringify(manifest));
 return {reportRef,runner:{...runner,manifestRef},manifests:[
  {ref:manifestRef,manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId,commandHash}},
 ]};
}
