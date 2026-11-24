// Synthetic report throughput only; no test execution or human effort claim.
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { execFileSync,spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hashBytes } from '@behavproof/core';
const project=fileURLToPath(new URL('..',import.meta.url)),root=await mkdtemp(join(tmpdir(),'behavproof-throughput-'));
const git=(...args)=>execFileSync('git',['-c','user.name=Benchmark fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,stdio:'ignore'});
try{
 await mkdir(join(root,'.behavproof/input'),{recursive:true});
 await writeFile(join(root,'.gitignore'),'.behavproof/\n');
 await writeFile(join(root,'package.json'),'{"name":"benchmark","type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"5.1.0"}}');
 await writeFile(join(root,'src.ts'),'export const value=1;\n');
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/input/vitest.json'}}));
 const count=12000,assertions=Array.from({length:count},(_,i)=>({title:`throughput-${i}-${'x'.repeat(740)}`,ancestorTitles:[],status:'passed'}));
 const data=Buffer.from(JSON.stringify({numTotalTests:count,numPassedTests:count,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'synthetic.test.ts',status:'passed',assertionResults:assertions}]}));
 if(data.length<9_000_000||data.length>10*1024*1024)throw Error('Benchmark input outside intended size');
 await writeFile(join(root,'.behavproof/input/vitest.json'),data);git('init','-q','-b','main');git('add','.');git('commit','-qm','Synthetic throughput fixture');
 const samples=[];for(let i=0;i<3;i++){const started=performance.now();const result=spawnSync(process.execPath,[join(project,'packages/cli/dist/index.js'),'check','--format','json'],{cwd:root,encoding:'utf8',timeout:60000});const durationMs=Math.round(performance.now()-started);if(result.status!==0)throw Error(result.stderr);const report=JSON.parse(result.stdout);if(report.status!=='incomplete'||report.evaluations.find(e=>e.ruleId==='testResult')?.status!=='unknown')throw Error('Synthetic report acquired false authority');samples.push(durationMs);}
 const medianMs=[...samples].sort((a,b)=>a-b)[1];const evidence={schemaVersion:1,command:'node scripts/benchmark-audit.mjs',node:process.version,platform:process.platform,synthetic:true,testExecutionExcluded:true,input:{bytes:data.length,assertions:count,sha256:hashBytes(data)},samplesMs:samples,medianMs,targetMs:10000,withinInitialTarget:medianMs<=10000,limits:['Synthetic single-file Vitest-shaped JSON; not a real executed test report.','No external authority; testResult remains unknown and audit exit0.','No human effort, semantic quality, peak memory or large-repository scalability measurement.']};
 await writeFile(join(project,'docs/evidence/audit-throughput.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({bytes:data.length,samplesMs:samples,medianMs,withinInitialTarget:evidence.withinInitialTarget}));
}finally{await rm(root,{recursive:true,force:true});}
