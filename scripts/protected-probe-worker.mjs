// Credential-free reference producer using a controlled Node test configuration.
// This wrapper is not OS isolation or a security sandbox.
import {writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';import {z} from 'zod';
import {createRequire} from 'node:module';import ts from 'typescript-parser';
import {ContractSchema,EvidenceSubjectSchema,EvidenceSchema,HashSchema,RelativePathSchema,hash,hashBytes,safeRead,canonicalJson} from '@behavproof/core';
import {gitSubject,normalizeVitest,normalizeJest} from '@behavproof/adapter-reports';
import {instrumentFunction,evaluateProbeRuns,PROBE_METHOD,JEST_PROBE_METHOD} from '@behavproof/contract-registry';
const {values}=parseArgs({strict:true,allowPositionals:false,options:{request:{type:'string'}}});
if(!values.request)throw Error('--request is required');
const requestPath=resolve(values.request);
const request=z.strictObject({schemaVersion:z.literal(1),runner:z.enum(['vitest','jest']).optional(),root:z.string().min(1),tests:z.array(RelativePathSchema).min(1),contracts:z.array(ContractSchema).min(1),targetRef:z.string().min(1),expectedSourceHash:HashSchema,subject:EvidenceSubjectSchema,effectivePolicyHash:HashSchema,inputs:z.array(RelativePathSchema).min(1)}).parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await safeRead(dirname(requestPath),basename(requestPath)))));
const runnerKind=request.runner??'vitest',method=runnerKind==='jest'?JEST_PROBE_METHOD:PROBE_METHOD;
const root=await realpath(request.root),output=await realpath(process.env.BEHAVPROOF_OUTPUT_DIR??'');
const outputRef=relative(root,output).split(sep).join('/');RelativePathSchema.parse(outputRef);
const targetFile=RelativePathSchema.parse(request.targetRef.split('#')[0]);
if([targetFile,...request.tests].some(file=>!request.inputs.includes(file)))throw Error('Selected target and executed tests must be protected inputs');
if(!request.subject.prHeadSha||!request.subject.baseSha||request.subject.dirty)throw Error('A clean independently selected subject is required');
const current=()=>gitSubject(root,request.inputs,request.subject.prHeadSha,request.subject.baseSha);
if(hash(await current())!==hash(request.subject))throw Error('Requested subject differs from current inputs');
const source=new TextDecoder('utf-8',{fatal:true}).decode(await safeRead(root,targetFile));
const faultValue={__behavproof_fault:randomUUID()},instrumented=instrumentFunction({source,targetRef:request.targetRef,expectedSourceHash:request.expectedSourceHash,faultValue,runner:runnerKind});
if(instrumented.status!=='supported')throw Error(`Unsupported protected probe: ${instrumented.reason}`);
if(request.contracts.some(contract=>contract.cases?.some(entry=>canonicalJson(entry.expected)===canonicalJson(faultValue))))throw Error('Fault value equals a registered expected result');
const helper=fileURLToPath(import.meta.resolve(`@behavproof/${runnerKind}`)),probe=fileURLToPath(import.meta.resolve(`@behavproof/${runnerKind}/probe`));
const sdkRegistry=import.meta.resolve('@behavproof/contract-registry'),reporter=fileURLToPath(import.meta.resolve(`@behavproof/${runnerKind}/reporter`));
const vitest=join(dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))),'vitest.mjs');
let selectedRunner,jest,jestEnvironment,jestAdapter;
if(runnerKind==='jest'){
 const selectedRequire=createRequire(join(root,'package.json')),jestPackage=selectedRequire.resolve('jest/package.json'),jestRequire=createRequire(jestPackage);
 const version=jestRequire(jestPackage).version;
 if(!['29.7.0','30.5.2'].includes(version)||jestRequire('jest-circus/package.json').version!==version)throw Error('Unsupported or mismatched selected Jest/Circus installation');
 selectedRunner={kind:'jest',version};jest=join(dirname(jestPackage),'bin/jest.js');jestEnvironment=jestRequire.resolve('jest-environment-node');jestAdapter=fileURLToPath(import.meta.resolve('@behavproof/jest/runner'));
 if([targetFile,...request.tests].some(file=>! /\.(?:[c]?[jt]s)$/.test(file)))throw Error('Controlled Jest probe supports TypeScript/CommonJS inputs only');
}
const transpile=(source,fileName)=>ts.transpileModule(source,{fileName,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
// Only explicitly named OS variables reach the candidate. Host credentials and
// NODE_OPTIONS/preload configuration are excluded. This does not provide OS isolation.
const childEnv={CI:'1',PATH:process.env.PATH??'',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.TEMP?{TEMP:process.env.TEMP}:{}),...(process.env.TMP?{TMP:process.env.TMP}:{})};
async function phase(name){
 const started=performance.now();
 const dir=join(output,name);await mkdir(dir,{recursive:false});const home=join(dir,'.home');await mkdir(home,{mode:0o700});const config=join(dir,runnerKind==='jest'?'jest.config.cjs':'vitest.config.mjs'),json=join(dir,runnerKind+'.json'),contracts=join(dir,'contracts.json');
 const data={root,targetFile:resolve(root,targetFile),targetRef:request.targetRef,expectedSourceHash:request.expectedSourceHash,faultValue,tests:request.tests,name,json,reporter,helper,probe,cache:join(dir,'.cache'),receipt:join(dir,'transform.json')};
 let configSource=`
import {resolve} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instrumentFunction} from ${JSON.stringify(sdkRegistry)};
const d=${JSON.stringify(data)};
const sha=code=>createHash('sha256').update(code).digest('hex');
export default {
  root:d.root,cacheDir:d.cache,
  resolve:{alias:[
    {find:new RegExp('^@behavproof/vitest/probe$'),replacement:d.probe},
    {find:new RegExp('^@behavproof/vitest$'),replacement:d.helper}
  ]},
  plugins:[{name:'behavproof-protected-target-'+d.name,enforce:'pre',transform(source,id){
    if(resolve(id.split('?')[0])!==d.targetFile)return;
    const p=instrumentFunction({source,targetRef:d.targetRef,expectedSourceHash:d.expectedSourceHash,faultValue:d.faultValue});
    if(p.status!=='supported')throw Error(p.reason);
    const code=d.name==='canary'?p.mutatedSource:p.observedSource;
    const receipt=JSON.stringify({mode:d.name,targetRef:d.targetRef,originalSha256:p.originalSha256,executedSha256:sha(code)});
    try{writeFileSync(d.receipt,receipt,{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST'||readFileSync(d.receipt,'utf8')!==receipt)throw error;}
    return {code,map:null};
  }}],
  test:{fsModuleCache:false,cache:false,include:d.tests,watch:false,passWithNoTests:false,allowOnly:false,maxWorkers:1,reporters:['json',d.reporter],outputFile:d.json}
};
`;
 if(runnerKind==='jest'){
  const transform=join(dir,'transform.cjs');
  const transformSource=`
const {resolve}=require('node:path');
const {writeFileSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {instrumentFunction}=require(${JSON.stringify(fileURLToPath(sdkRegistry))});
const ts=require(${JSON.stringify(fileURLToPath(import.meta.resolve('typescript-parser')))});
const d=${JSON.stringify(data)};
const sha=code=>createHash('sha256').update(code).digest('hex');
module.exports={process(source,file){
 let code=source,p;
 if(resolve(file)===d.targetFile){
  p=instrumentFunction({source,targetRef:d.targetRef,expectedSourceHash:d.expectedSourceHash,faultValue:d.faultValue,runner:'jest'});
  if(p.status!=='supported')throw Error(p.reason);
  code=d.name==='canary'?p.mutatedSource:p.observedSource;
 }
 const compiled=ts.transpileModule(code,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
 if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Controlled Jest transform failed');
 if(p){
  const receipt=JSON.stringify({mode:d.name,targetRef:d.targetRef,originalSha256:p.originalSha256,executedSha256:sha(code),compiledSha256:sha(compiled.outputText)});
  try{writeFileSync(d.receipt,receipt,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST'||readFileSync(d.receipt,'utf8')!==receipt)throw error;}
 }
 return {code:compiled.outputText};
}};
`;
  await writeFile(transform,transformSource,{flag:'wx',mode:0o600});
  configSource='module.exports='+JSON.stringify({rootDir:root,watch:false,watchman:false,passWithNoTests:false,errorOnDeprecated:true,cache:false,cacheDirectory:data.cache,maxWorkers:1,testEnvironment:jestEnvironment,testRunner:jestAdapter,testMatch:request.tests.map(file=>'<rootDir>/'+file),reporters:[reporter],moduleNameMapper:{'^@behavproof/jest$':helper,'^@behavproof/jest/probe$':probe,'^(\\.{1,2}/.*)\\.js$':'$1'},transform:{'^.+\\.[cm]?[jt]s$':transform}})+';\n';
 }
 await writeFile(config,configSource,{flag:'wx',mode:0o600});
 const child=spawnSync(process.execPath,runnerKind==='jest'?['--max-old-space-size=1024',jest,'--config',config,'--runInBand','--no-cache','--json','--outputFile',json]:['--max-old-space-size=1024',vitest,'run','--config',config,'--configLoader','native'],{cwd:root,env:{...childEnv,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),BEHAVPROOF_REPORT:contracts},shell:false,stdio:'ignore',timeout:120000,killSignal:'SIGKILL'});
 let receipt=null;try{receipt=JSON.parse((await safeRead(dir,'transform.json')).toString('utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const expectedProgram=name==='canary'?instrumented.mutatedSource:instrumented.observedSource;
 if(receipt&&(receipt.mode!==name||receipt.targetRef!==request.targetRef||receipt.originalSha256!==instrumented.originalSha256||receipt.executedSha256!==hashBytes(Buffer.from(expectedProgram))||runnerKind==='jest'&&receipt.compiledSha256!==hashBytes(Buffer.from(transpile(expectedProgram,targetFile)))))throw Error('Selected source transformation was not observed');
 const bytes=await safeRead(dir,'contracts.json'),report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(runnerKind==='jest'&&(report.runner?.kind!=='jest'||report.runner.version!==selectedRunner.version||report.inventory?.complete!==true))throw Error('Observed report differs from selected Jest installation');
 return {executionId:`${outputRef}/${name}`,exitCode:child.status??-1,sourceHash:name==='canary'&&receipt?instrumented.fault.mutatedSha256:instrumented.originalSha256,report,durationMs:Math.round(performance.now()-started),transformation:receipt,diagnosticHash:hashBytes(bytes)};
}
const main=await phase('main');
const mainJson=await safeRead(join(output,'main'),runnerKind+'.json');
if(main.exitCode!==0||(runnerKind==='jest'?normalizeJest:normalizeVitest)(JSON.parse(mainJson.toString('utf8')),main.report.inventory).status!=='pass')throw Error('Required ordinary comparisons did not complete successfully');
const canary=await phase('canary');
if(![0,1].includes(canary.exitCode))throw Error('Canary runner did not complete');
// Capture actual selected run outputs in this controller. The outer Collector and
// independent CI/archive verifier authenticate this producer, never these flags.
const toRun=({executionId,exitCode,sourceHash,report})=>({executionId,exitCode,sourceHash,report});
const captured=new Set([main,canary].filter(run=>run.transformation!==null).map(run=>hash(toRun(run)))),claims=[];
for(const contract of request.contracts){
 const result=evaluateProbeRuns({...(selectedRunner?{runner:selectedRunner}:{}),contract,targetRef:request.targetRef,expectedSourceHash:request.expectedSourceHash,main:toRun(main),canary:toRun(canary),fault:instrumented.fault},run=>captured.has(hash(run)));
 for(const [kind,rows] of [['target_observation',result.observations],['canary',result.canaries]])for(const payload of rows){
  claims.push(EvidenceSchema.parse({schemaVersion:1,id:hash({kind,payload,subject:request.subject,policy:request.effectivePolicyHash}),kind,source:{tool:'behavproof-probe-collector',version:'0.1.0',artifactRef:`${outputRef}/claims.json`},context:{subject:request.subject,effectivePolicyHash:request.effectivePolicyHash,contractHash:contract.revisionHash,collectedAt:new Date().toISOString()},provenance:{artifactIntegrity:'unknown',producerTrust:'unknown',subjectMatch:'unknown',reasons:['Authenticate with the outer selected Collector and independent host/CI authority']},subjectRefs:[request.targetRef,...payload.caseIds],payload}));
 }
}
if(hash(await current())!==hash(request.subject))throw Error('Inputs changed during probe collection');
await writeFile(join(output,runnerKind+'.json'),mainJson,{flag:'wx'});await writeFile(join(output,'contracts.json'),await safeRead(join(output,'main'),'contracts.json'),{flag:'wx'});
await writeFile(join(output,'claims.json'),JSON.stringify(claims)+'\n',{flag:'wx'});
await writeFile(join(output,'probe-diagnostics.json'),JSON.stringify({schemaVersion:1,method,...(selectedRunner?{runner:selectedRunner}:{}),fault:instrumented.fault,observedProgramSha256:hashBytes(Buffer.from(instrumented.observedSource)),main,canary,limits:[...(runnerKind==='jest'?['Controlled host TypeScript/CommonJS transform, Node environment and SDK aliases; project Jest presets/configuration are not loaded.']:[]),'Scoped observations in the selected instrumented runner, not a proof against arbitrary hostile JavaScript.','The expected-failure canary is a diagnostic; it is not successful ordinary test evidence.','No coverage, mutation-score, human-approval or external protection claim is made by this worker.']})+'\n',{flag:'wx'});
