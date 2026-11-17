import {expect,it} from 'vitest';
import {normalizeJest} from '../../packages/adapter-reports/src/reports.js';

const report=()=>({success:true,wasInterrupted:false,numTotalTests:2,numPassedTests:2,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,numRuntimeErrorTestSuites:0,testResults:[{name:'/app/nested.test.cjs',status:'passed',assertionResults:[{title:'one',fullName:'outer one',ancestorTitles:['outer'],status:'passed',invocations:1},{title:'two',fullName:'outer two',ancestorTitles:['outer'],status:'passed',invocations:1}]}]});
it('accepts complete native Jest file inventories with nested describe blocks',()=>{
 expect(normalizeJest(report())).toEqual({payload:{total:2,passed:2,failed:0,skipped:0},status:'pass'});
 expect(normalizeJest(report(),{suiteCount:1,testCount:2,files:['/app/nested.test.cjs'],complete:true}).status).toBe('pass');
});
it('keeps native pending/todo, interruption, retry and incomplete reporter inventory unknown',()=>{
 const skipped=report();skipped.numPassedTests=0;skipped.numPendingTests=1;skipped.numTodoTests=1;skipped.testResults[0]!.status='focused';skipped.testResults[0]!.assertionResults[0]!.status='pending';skipped.testResults[0]!.assertionResults[1]!.status='todo';
 expect(normalizeJest(skipped)).toMatchObject({payload:{total:2,passed:0,failed:0,skipped:2},status:'unknown'});
 expect(normalizeJest({...report(),wasInterrupted:true}).status).toBe('unknown');
 const retry=report();retry.testResults[0]!.assertionResults[0]!.invocations=2;expect(normalizeJest(retry).status).toBe('unknown');
 expect(normalizeJest(report(),{suiteCount:1,testCount:2,files:['/app/nested.test.cjs'],complete:false}).status).toBe('unknown');
});
it('retains comparison and suite runtime failures even when no assertions ran',()=>{
 const failed=report();failed.success=false;failed.numPassedTests=1;failed.numFailedTests=1;failed.numPassedTestSuites=0;failed.numFailedTestSuites=1;failed.testResults[0]!.status='failed';failed.testResults[0]!.assertionResults[0]!.status='failed';expect(normalizeJest(failed).status).toBe('fail');
 const runtime={...report(),success:false,numTotalTests:0,numPassedTests:0,numPassedTestSuites:0,numFailedTestSuites:1,numRuntimeErrorTestSuites:1,testResults:[{name:'/app/crash.test.cjs',status:'failed',assertionResults:[]}]};expect(normalizeJest(runtime).status).toBe('fail');
});
it('rejects invented counts and duplicate files and does not accept an empty successful run',()=>{
 expect(()=>normalizeJest({...report(),numPassedTests:99})).toThrow();
 const duplicate=report();duplicate.testResults.push(duplicate.testResults[0]!);expect(()=>normalizeJest(duplicate)).toThrow();
 const empty={...report(),numTotalTests:0,numPassedTests:0,numTotalTestSuites:0,numPassedTestSuites:0,testResults:[]};expect(normalizeJest(empty).status).toBe('unknown');
 expect(()=>normalizeJest({...report(),wasInterrupted:'false'})).toThrow();
});
