import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { join, resolve, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
const flags=process.argv.slice(2);if(flags.some(arg=>!['--online','--offline','--formal','--jest'].includes(arg))||flags.includes('--online')&&flags.includes('--offline'))throw Error('Expected --online or --offline, optionally --formal and --jest');
const offline=flags.includes('--offline'),formal=flags.includes('--formal'),nativeJest=flags.includes('--jest');
const project=fileURLToPath(new URL('..',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'behavproof-pack-')),tar=join(scratch,'tar'),consumer=join(scratch,'consumer');
await mkdir(tar);await mkdir(consumer);const packages=['core','adapter-reports','spec-registry','adapter-github','cli',...(formal?['adapter-quint','adapter-model-test']:[])];
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
 const schema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/config.schema.json'),'utf8'));if(schema.properties?.schemaVersion?.const!==2)throw Error('Native project configuration schema missing');
 const ciSchema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/ci-registration.schema.json'),'utf8'));if(ciSchema.properties?.schemaVersion?.const!==2)throw Error('Protected CI registration schema missing');
 for(const path of ['@behavproof/jest','@behavproof/vitest','@behavproof/contract-registry','@behavproof/cli/schemas/registration.schema.json','@behavproof/cli/schemas/registry.schema.json']){
  try{await access(join(consumer,'node_modules',path));throw Error('Retired Contract artifact is installed: '+path);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 await writeFile(join(consumer,'probe.mjs'),`import {hash} from '@behavproof/core';import {evaluateTestEvidence} from '@behavproof/adapter-reports';import {GitHubAuthority,GitHubCheckPublisher,prepareCheckPublication,prepareFailedCheck,readArtifactArchive} from '@behavproof/adapter-github';import {CIRegistration,registeredCI} from '@behavproof/cli';if(hash({}).length!==64||!CIRegistration||[evaluateTestEvidence,registeredCI,prepareCheckPublication,prepareFailedCheck,readArtifactArchive].some(f=>typeof f!=='function')||!new GitHubAuthority({repository:'acme/shop'})||!new GitHubCheckPublisher({repository:'acme/shop'}))throw Error('Public exports failed');`);
 run(process.execPath,['probe.mjs'],consumer);
 await writeFile(join(consumer,'assurance-probe.mjs'),`import{AssuranceBundleSchema,evaluateAssuranceConditions}from'@behavproof/core';import{runAssurance,buildAssuranceMap,inspectArchitecture,reconcileSpecification,SpecificationRegistrySchema}from'@behavproof/spec-registry';import{assuranceCriterionPaths}from'@behavproof/cli';if(!AssuranceBundleSchema||!SpecificationRegistrySchema||[reconcileSpecification,evaluateAssuranceConditions,runAssurance,buildAssuranceMap,inspectArchitecture,assuranceCriterionPaths].some(f=>typeof f!=='function'))throw Error('Assurance public exports missing');`);
 run(process.execPath,['assurance-probe.mjs'],consumer);
 const assuranceSchema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/assurance.schema.json'),'utf8'));if(!assuranceSchema.$schema)throw Error('Assurance schema missing');
 if(formal){
  await writeFile(join(consumer,'formal-probe.mjs'),`import {normalizeQuint} from '@behavproof/adapter-quint';import {readITF,replayTraces} from '@behavproof/adapter-model-test';if(typeof normalizeQuint!=='function'||typeof readITF!=='function'||typeof replayTraces!=='function')throw Error('Optional public exports missing');`);
  run(process.execPath,['formal-probe.mjs'],consumer);
 }else for(const name of ['adapter-quint','adapter-model-test']){try{await access(join(consumer,'node_modules/@behavproof',name));throw Error('Unexpected mandatory formal adapter');}catch(error){if(error.code!=='ENOENT')throw error;}}
 for(const path of ['@informalsystems/quint','@firfi/quint-connect']){try{await access(join(consumer,'node_modules',path));throw Error('Unexpected mandatory external formal tool');}catch(error){if(error.code!=='ENOENT')throw error;}}
 await writeFile(join(consumer,'behavproof.config.json'),JSON.stringify({schemaVersion:2}));
 const inventory=JSON.parse(run(process.execPath,[binary,'formal','discover','--format','json'],consumer));if(inventory.models.length!==0)throw Error('Unexpected adopted formal models');
 if(formal){
  await writeFile(join(consumer,'model.qnt'),'module model { val ok = true }\n');
  await writeFile(join(consumer,'behavproof.config.json'),JSON.stringify({schemaVersion:2,formal:{models:[{id:'PACKED',module:'model',model:'model.qnt',quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'},invariants:['ok'],checks:['parse','typecheck'],maxSteps:1,seed:'42',report:'.behavproof/model.json'}]}}));
  let output;try{run(process.execPath,[binary,'formal','check','--model','PACKED'],consumer);throw Error('Missing Quint unexpectedly passed');}catch(error){if(error.status!==2)throw error;if(!error.stdout?.length)throw Error('Packed formal command failed before report: '+error.stderr);output=JSON.parse(error.stdout.toString());}
  if(output.models?.[0]?.stages?.[0]?.status!=='unknown')throw Error('Packed formal CLI did not load optional adapters or diagnose missing tool');
 }
 // Installing and importing the ordinary runtime must not pull in native Jest.
 try{await access(join(consumer,'node_modules/jest'));throw Error('Unexpected mandatory Jest runtime');}catch(error){if(error.code!=='ENOENT')throw error;}
 const jestConsumers=[];
 if(nativeJest){
  await writeFile(join(consumer,'behavproof.config.json'),JSON.stringify({schemaVersion:2,testRunner:'jest'}));
  await writeFile(join(consumer,'packed.test.cjs'),`test('adds two numbers',()=>expect(1+2).toBe(3));`);
  await writeFile(join(consumer,'jest.config.cjs'),`module.exports={rootDir:__dirname,watchman:false,transform:{},testMatch:['**/packed.test.cjs']};`);
  const assertion=`
   import {readFile} from 'node:fs/promises';
   import {evaluateTestEvidence} from '@behavproof/adapter-reports';
   const version=process.argv[2], ref='.behavproof/input/jest.json';
   const native=await readFile(ref), receipt=JSON.parse(await readFile(ref+'.receipt.json','utf8'));
   if(JSON.parse(native).numPassedTests!==1||receipt.runner.version!==version||
      evaluateTestEvidence(native,receipt,{runner:{kind:'jest',version},invocation:receipt.invocation,authenticated:true}).status!=='pass'){
     throw Error('Missing matching native evidence for Jest '+version);
   }`;
  await writeFile(join(consumer,'jest-evidence.mjs'),assertion);
  for(const version of ['29.7.0','30.5.2']){
   npm(['install',...(offline?['--offline']:[]),'--ignore-scripts','--cache',join(project,'.npm-cache'),'jest@'+version],consumer);
   run(process.execPath,[binary,'test'],consumer);
   run(process.execPath,['jest-evidence.mjs',version],consumer);
   jestConsumers.push({version,nativeJson:'pass',testReceipt:'pass'});
  }
 }
 const result={schemaVersion:1,command:'node scripts/package-smoke.mjs',node:process.version,packages,consumerInstall:'pass',installationMode:offline?'offline':'online',...(offline?{offlineConsumerInstall:'pass'}:{}),publicExports:'pass',cliHelp:'pass',packagedSchemas:'pass',ordinaryRuntimeJest:'absent',...(nativeJest?{jestConsumers}:{}),published:false};
 await writeFile(join(project,nativeJest?'docs/evidence/jest-package-smoke.json':formal?'docs/evidence/formal-package-smoke.json':offline?'docs/evidence/package-smoke.json':'docs/evidence/package-smoke-online.json'),JSON.stringify({...result,formalAdapters:formal?'explicitly installed':'absent',externalFormalTools:'absent'},null,2)+'\n');console.log(`${packages.length} packed packages installed in an external consumer; public exports, CLI, schemas and optional-tool isolation passed.${nativeJest?' Native installed Jest 29.7.0 / 30.5.2 reports and receipts passed.':''}`);
}finally{await rm(scratch,{recursive:true,force:true});}
