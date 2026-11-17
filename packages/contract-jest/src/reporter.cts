import {writeFile} from 'node:fs/promises';
import {hash} from '@behavproof/core';
import {receiptKey,type Receipt} from './runner.cjs';
type Result={testFilePath:string;testResults:unknown[];testExecError?:unknown;leaks?:boolean;[receiptKey]?:Receipt};
export default class BehavProofReporter {
  private results=new Map<string,Result>();
  onRunStart():void {this.results.clear();}
  onTestResult(_test:unknown,result:Result):void {this.results.set(result.testFilePath,result);}
  async onRunComplete(_contexts:unknown,aggregated:{numTotalTests:number;numTotalTestSuites:number;wasInterrupted?:boolean;numRuntimeErrorTestSuites?:number}):Promise<void>{
    const output=process.env.BEHAVPROOF_REPORT;if(!output)return;
    const results=[...this.results.values()].sort((a,b)=>a.testFilePath.localeCompare(b.testFilePath));
    const receipts=results.flatMap(result=>result[receiptKey]?[JSON.parse(JSON.stringify(result[receiptKey])) as Receipt]:[]);
    // Normalize worker/VM realms before the shared strict JSON validator sees data.
    receipts.forEach(receipt=>hash(receipt));
    const versions=new Set(receipts.map(r=>r.version));
    const testIds=receipts.flatMap(r=>r.testIds),files=results.map(r=>r.testFilePath);
    const suiteIds=files.map(file=>hash([file]));
    const complete=results.length>0&&receipts.length===results.length&&receipts.every(r=>r.schemaVersion===1&&r.complete&&files.includes(r.file)&&r.suiteIds.length===1&&r.suiteIds[0]===hash([r.file]))&&versions.size===1&&!aggregated.wasInterrupted&&!aggregated.numRuntimeErrorTestSuites&&results.every(r=>!r.testExecError&&!r.leaks)&&results.length===aggregated.numTotalTestSuites&&testIds.length===aggregated.numTotalTests&&new Set(testIds).size===testIds.length&&new Set(suiteIds).size===suiteIds.length;
    await writeFile(output,JSON.stringify({schemaVersion:1,runner:{kind:'jest',version:versions.size===1?[...versions][0]:'unknown'},inventory:{suiteCount:suiteIds.length,testCount:testIds.length,files,suiteIds,testIds,complete},registrations:receipts.flatMap(r=>r.registrations),contracts:receipts.flatMap(r=>r.contracts)})+'\n');
  }
}
