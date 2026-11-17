import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { join, resolve, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
const flags=process.argv.slice(2);if(flags.some(arg=>!['--online','--offline','--formal','--jest'].includes(arg))||flags.includes('--online')&&flags.includes('--offline'))throw Error('Expected --online or --offline, optionally --formal and --jest');
const offline=flags.includes('--offline'),formal=flags.includes('--formal'),nativeJest=flags.includes('--jest');
const project=fileURLToPath(new URL('..',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'behavproof-pack-')),tar=join(scratch,'tar'),consumer=join(scratch,'consumer');
await mkdir(tar);await mkdir(consumer);const packages=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','cli',...(formal?['adapter-quint','adapter-model-test']:[])];
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:10*1024*1024});
const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
for(const dir of (process.env.PATH??'').split(delimiter)){try{const entry=await realpath(join(dir,process.platform==='win32'?'npm.cmd':'npm'));candidates.push(process.platform==='win32'?join(dirname(entry),'node_modules/npm/bin/npm-cli.js'):entry);}catch{}}
let npmCli;for(const path of candidates)if(path){try{await access(path);if(path.endsWith('npm-cli.js')){npmCli=path;break;}}catch{}}
if(!npmCli)throw Error('Installed npm CLI JavaScript entrypoint unavailable');
const npm=(args,cwd)=>run(process.execPath,[npmCli,...args],cwd);
try{
 const pack=name=>{const [meta]=JSON.parse(npm(['pack','--json','--ignore-scripts','--cache',join(project,'.npm-cache'),'--pack-destination',tar],join(project,'packages',name)));return join(tar,meta.filename);};
 const archives=packages.map(pack);
 await writeFile(join(consumer,'package.json'),'{"name":"behavproof-external-consumer","private":true,"type":"module"}\n');
 npm(['install',...(offline?['--offline']:[]),'--ignore-scripts','--cache',join(project,'.npm-cache'),...archives],consumer);
 const binary=join(consumer,'node_modules/@behavproof/cli/dist/index.js'),help=run(process.execPath,[binary,'--help'],consumer);
 if(!help.includes('Gate requires --trust-root'))throw Error('Installed CLI failed');
 const schema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/config.schema.json'),'utf8'));if(!schema.$schema)throw Error('Schema missing');
 await writeFile(join(consumer,'probe.mjs'),`import {hash,hashBytes} from '@behavproof/core';import {discover,instrumentFunction} from '@behavproof/contract-registry';import {GitHubAuthority,GitHubCheckPublisher,prepareCheckPublication,prepareFailedCheck,readArtifactArchive} from '@behavproof/adapter-github';import {observeTargetCall,withTargetCalls} from '@behavproof/vitest/probe';import {RegistrationSchema,registrationProjectData} from '@behavproof/cli';const source='export function f(){return 1}';const p=instrumentFunction({source,targetRef:'src/a.ts#f',expectedSourceHash:hashBytes(Buffer.from(source)),faultValue:0});let count=0;await withTargetCalls(()=>observeTargetCall('src/a.ts#f'),calls=>{count=calls[0]?.count??0});if(hash({}).length!==64||discover({}).contracts.length!==0||p.status!=='supported'||count!==1||typeof prepareCheckPublication!=='function'||typeof prepareFailedCheck!=='function'||typeof readArtifactArchive!=='function'||typeof registrationProjectData!=='function'||!RegistrationSchema||!new GitHubAuthority({repository:'acme/shop'})||!new GitHubCheckPublisher({repository:'acme/shop'}))throw Error('Public exports failed');`);
 run(process.execPath,['probe.mjs'],consumer);
 await writeFile(join(consumer,'assurance-probe.mjs'),`import{AssuranceBundleSchema,evaluateAssuranceConditions}from'@behavproof/core';import{runAssurance,buildAssuranceMap,inspectArchitecture}from'@behavproof/contract-registry';import{assuranceCriterionPaths}from'@behavproof/cli';if(!AssuranceBundleSchema||[evaluateAssuranceConditions,runAssurance,buildAssuranceMap,inspectArchitecture,assuranceCriterionPaths].some(f=>typeof f!=='function'))throw Error('Assurance public exports missing');`);
 run(process.execPath,['assurance-probe.mjs'],consumer);
 const assuranceSchema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/assurance.schema.json'),'utf8'));if(!assuranceSchema.$schema)throw Error('Assurance schema missing');
 if(formal){
  await writeFile(join(consumer,'formal-probe.mjs'),`import {normalizeQuint} from '@behavproof/adapter-quint';import {readITF,replayTraces} from '@behavproof/adapter-model-test';if(typeof normalizeQuint!=='function'||typeof readITF!=='function'||typeof replayTraces!=='function')throw Error('Optional public exports missing');`);
  run(process.execPath,['formal-probe.mjs'],consumer);
 }else for(const name of ['adapter-quint','adapter-model-test']){try{await access(join(consumer,'node_modules/@behavproof',name));throw Error('Unexpected mandatory formal adapter');}catch(error){if(error.code!=='ENOENT')throw error;}}
 for(const path of ['@informalsystems/quint','@firfi/quint-connect']){try{await access(join(consumer,'node_modules',path));throw Error('Unexpected mandatory external formal tool');}catch(error){if(error.code!=='ENOENT')throw error;}}
 await writeFile(join(consumer,'behavproof.config.json'),JSON.stringify({schemaVersion:1}));
 const inventory=JSON.parse(run(process.execPath,[binary,'formal','discover','--format','json'],consumer));if(inventory.models.length!==0)throw Error('Unexpected adopted formal models');
 if(formal){
  await writeFile(join(consumer,'model.qnt'),'module model { val ok = true }\n');
  await writeFile(join(consumer,'behavproof.config.json'),JSON.stringify({schemaVersion:1,formal:{models:[{id:'PACKED',contractId:'PACKED',model:'model.qnt',quint:{entry:'tools/absent-quint.mjs',version:'0.33.1'},properties:['ok'],checks:['parse'],maxSteps:1,seed:'42',report:'.behavproof/model.json'}]}}));
  let output;try{run(process.execPath,[binary,'formal','check','--model','PACKED'],consumer);throw Error('Missing Quint unexpectedly passed');}catch(error){if(error.status!==2)throw error;if(!error.stdout?.length)throw Error('Packed formal command failed before report: '+error.stderr);output=JSON.parse(error.stdout.toString());}
  if(output.models?.[0]?.stages?.[0]?.status!=='unknown')throw Error('Packed formal CLI did not load optional adapters or diagnose missing tool');
 }
 // Installing and importing the ordinary runtime must not pull in native Jest.
 try{await access(join(consumer,'node_modules/jest'));throw Error('Unexpected mandatory Jest runtime');}catch(error){if(error.code!=='ENOENT')throw error;}
 const jestConsumers=[];
 if(nativeJest){
  const archive=pack('contract-jest');packages.push('contract-jest');
  await writeFile(join(consumer,'jest-exports.cjs'),`const {hash,ConfigSchema}=require('@behavproof/core');if(hash({}).length!==64||ConfigSchema.parse({schemaVersion:1}).schemaVersion!==1)throw Error('Core native require semantics failed');for(const name of ['@behavproof/jest','@behavproof/jest/reporter','@behavproof/jest/runner','@behavproof/jest/probe'])require.resolve(name);for(const name of ['runner','reporter'])if(typeof require('@behavproof/jest/'+name).default!=='function')throw Error('Jest CJS export missing');if(typeof require('@behavproof/jest/probe').observeTargetCall!=='function')throw Error('Jest probe missing');`);
  await writeFile(join(consumer,'packed.test.cjs'),`const {defineContract,contractTest}=require('@behavproof/jest');const {observeTargetCall}=require('@behavproof/jest/probe');const {test,expect}=require('@jest/globals');let calls=0;const c=defineContract({id:'PACKED-JEST',intent:'packed native comparisons',risk:'basic',cases:[{id:'one',input:1,expected:2},{id:'two',input:2,expected:3}]});contractTest.each(c,async({input})=>{calls++;observeTargetCall('src/packed.cjs#increment');return input+1;});test('callbacks run exactly once',()=>expect(calls).toBe(2));`);
  await writeFile(join(consumer,'jest.config.cjs'),`module.exports={rootDir:__dirname,watchman:false,transform:{},testMatch:['**/packed.test.cjs'],testRunner:require.resolve('@behavproof/jest/runner'),reporters:['default',require.resolve('@behavproof/jest/reporter')]};`);
  await writeFile(join(consumer,'consumer.cts'),`import {defineContract,contractTest} from '@behavproof/jest';import runner from '@behavproof/jest/runner';import reporter from '@behavproof/jest/reporter';import {observeTargetCall,withTargetCalls} from '@behavproof/jest/probe';import core = require('@behavproof/core');const c=defineContract({id:'TYPES',intent:'packed declarations',risk:'basic',cases:[{id:'one',input:1,expected:2}]});contractTest.each(c,entry=>entry.input+1);const r:typeof runner=runner;const p:typeof reporter=reporter;void r;void p;void core.hash(c);void withTargetCalls(()=>observeTargetCall('src/packed.cjs#increment'),()=>{});`);
  await writeFile(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,types:['node'],skipLibCheck:false},files:['consumer.cts']}));
  for(const version of ['29.7.0','30.5.2']){
   npm(['install',...(offline?['--offline']:[]),'--ignore-scripts','--cache',join(project,'.npm-cache'),archive,'jest@'+version],consumer);
   run(process.execPath,['jest-exports.cjs'],consumer);
   run(process.execPath,[join(project,'node_modules/typescript/bin/tsc'),'--project',join(consumer,'tsconfig.json')],consumer);
   const report=join(consumer,'observations.json'),native=join(consumer,'native.json');
   execFileSync(process.execPath,[join(consumer,'node_modules/jest/bin/jest.js'),'--config',join(consumer,'jest.config.cjs'),'--runInBand','--json','--outputFile',native],{cwd:consumer,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:10*1024*1024,env:{...process.env,BEHAVPROOF_REPORT:report}});
   const observed=JSON.parse(await readFile(report,'utf8')),normal=JSON.parse(await readFile(native,'utf8'));
   if(!normal.success||normal.numPassedTests!==3||observed.runner?.kind!=='jest'||observed.runner?.version!==version||!observed.inventory?.complete||observed.inventory.testCount!==3||observed.registrations?.length!==2||observed.contracts?.length!==2||observed.contracts.some(row=>row.status!=='pass'||row.testState!=='passed'||row.comparisonCount!==1||row.targetCalls?.length!==1||row.targetCalls[0].targetRef!=='src/packed.cjs#increment'||row.targetCalls[0].count!==1))throw Error('Packed native Jest callback/report failed: '+version);
   jestConsumers.push({version,nativeJson:'pass',contractCallbacks:'pass',runnerReporter:'pass',declarations:'pass',cjsExports:'pass'});
  }
 }
 const result={schemaVersion:1,command:'node scripts/package-smoke.mjs',node:process.version,packages,consumerInstall:'pass',installationMode:offline?'offline':'online',...(offline?{offlineConsumerInstall:'pass'}:{}),publicExports:'pass',cliHelp:'pass',packagedSchemas:'pass',ordinaryRuntimeJest:'absent',...(nativeJest?{jestConsumers}:{}),published:false};
 await writeFile(join(project,nativeJest?'docs/evidence/jest-package-smoke.json':formal?'docs/evidence/formal-package-smoke.json':offline?'docs/evidence/package-smoke.json':'docs/evidence/package-smoke-online.json'),JSON.stringify({...result,formalAdapters:formal?'explicitly installed':'absent',externalFormalTools:'absent'},null,2)+'\n');console.log(`${packages.length} packed packages installed in an external consumer; public exports, CLI, schemas and optional-tool isolation passed.${nativeJest?' Native installed Jest 29.7.0 / 30.5.2 comparisons, reports and declarations passed.':''}`);
}finally{await rm(scratch,{recursive:true,force:true});}
