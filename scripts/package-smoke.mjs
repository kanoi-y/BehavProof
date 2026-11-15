import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { join, resolve, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
const flags=process.argv.slice(2);if(flags.some(arg=>!['--online','--offline','--formal'].includes(arg))||flags.includes('--online')&&flags.includes('--offline'))throw Error('Expected --online or --offline, optionally --formal');
const offline=flags.includes('--offline'),formal=flags.includes('--formal');
const project=fileURLToPath(new URL('..',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'behavproof-pack-')),tar=join(scratch,'tar'),consumer=join(scratch,'consumer');
await mkdir(tar);await mkdir(consumer);const packages=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','cli',...(formal?['adapter-quint','adapter-model-test']:[])];
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:10*1024*1024});
const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
for(const dir of (process.env.PATH??'').split(delimiter)){try{const entry=await realpath(join(dir,process.platform==='win32'?'npm.cmd':'npm'));candidates.push(process.platform==='win32'?join(dirname(entry),'node_modules/npm/bin/npm-cli.js'):entry);}catch{}}
let npmCli;for(const path of candidates)if(path){try{await access(path);if(path.endsWith('npm-cli.js')){npmCli=path;break;}}catch{}}
if(!npmCli)throw Error('Installed npm CLI JavaScript entrypoint unavailable');
const npm=(args,cwd)=>run(process.execPath,[npmCli,...args],cwd);
try{
 const archives=[];for(const name of packages){const [meta]=JSON.parse(npm(['pack','--json','--ignore-scripts','--cache',join(project,'.npm-cache'),'--pack-destination',tar],join(project,'packages',name)));archives.push(join(tar,meta.filename));}
 await writeFile(join(consumer,'package.json'),'{"name":"behavproof-external-consumer","private":true,"type":"module"}\n');
 npm(['install',...(offline?['--offline']:[]),'--ignore-scripts','--cache',join(project,'.npm-cache'),...archives],consumer);
 const binary=join(consumer,'node_modules/@behavproof/cli/dist/index.js'),help=run(process.execPath,[binary,'--help'],consumer);
 if(!help.includes('Gate requires --trust-root'))throw Error('Installed CLI failed');
 const schema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/config.schema.json'),'utf8'));if(!schema.$schema)throw Error('Schema missing');
 await writeFile(join(consumer,'probe.mjs'),`import {hash,hashBytes} from '@behavproof/core';import {discover,instrumentFunction} from '@behavproof/contract-registry';import {GitHubAuthority,GitHubCheckPublisher,prepareCheckPublication,prepareFailedCheck,readArtifactArchive} from '@behavproof/adapter-github';import {observeTargetCall,withTargetCalls} from '@behavproof/vitest/probe';import {RegistrationSchema,registrationProjectData} from '@behavproof/cli';const source='export function f(){return 1}';const p=instrumentFunction({source,targetRef:'src/a.ts#f',expectedSourceHash:hashBytes(Buffer.from(source)),faultValue:0});let count=0;await withTargetCalls(()=>observeTargetCall('src/a.ts#f'),calls=>{count=calls[0]?.count??0});if(hash({}).length!==64||discover({}).contracts.length!==0||p.status!=='supported'||count!==1||typeof prepareCheckPublication!=='function'||typeof prepareFailedCheck!=='function'||typeof readArtifactArchive!=='function'||typeof registrationProjectData!=='function'||!RegistrationSchema||!new GitHubAuthority({repository:'acme/shop'})||!new GitHubCheckPublisher({repository:'acme/shop'}))throw Error('Public exports failed');`);
 run(process.execPath,['probe.mjs'],consumer);
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
 const result={schemaVersion:1,command:'node scripts/package-smoke.mjs',node:process.version,packages,consumerInstall:'pass',installationMode:offline?'offline':'online',...(offline?{offlineConsumerInstall:'pass'}:{}),publicExports:'pass',cliHelp:'pass',packagedSchemas:'pass',published:false};
 await writeFile(join(project,formal?'docs/evidence/formal-package-smoke.json':offline?'docs/evidence/package-smoke.json':'docs/evidence/package-smoke-online.json'),JSON.stringify({...result,formalAdapters:formal?'explicitly installed':'absent',externalFormalTools:'absent'},null,2)+'\n');console.log(`${packages.length} packed packages installed in an external consumer; public exports, CLI, schemas and optional-tool isolation passed.`);
}finally{await rm(scratch,{recursive:true,force:true});}
