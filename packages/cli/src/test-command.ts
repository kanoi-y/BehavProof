import {spawn,execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {dirname,join,relative} from 'node:path';
import {mkdir,lstat,mkdtemp,readFile,rm,unlink,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {RelativePathSchema,safeRead,safeReadJson} from '@behavproof/core';
import {captureTestEvidence} from '@behavproof/adapter-reports';
import {config,writeScoped} from './project.js';
const exec=promisify(execFile);
export type TestRunner='vitest'|'jest';
export type TestExecutionOptions={runnerConfig?:string;coverage?:boolean;qualityRun?:boolean};
/** Declared package data only; no scripts/configuration are executed here. */
export async function declaredTestRunners(root:string):Promise<TestRunner[]>{
 const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')) as Record<string,unknown>;
 const dependencies=[pkg.dependencies,pkg.devDependencies,pkg.optionalDependencies].filter(v=>v&&typeof v==='object') as Record<string,unknown>[];
 return (['vitest','jest'] as const).filter(name=>dependencies.some(d=>typeof d[name]==='string'&&(d[name] as string).length>0));
}
/** Explicit execution only. check/doctor/discovery remain data readers. */
export async function runTests(root:string,configPath?:string,requested?:string,options:TestExecutionOptions={}):Promise<number>{
 const cfg=await config(root,configPath),choices=await declaredTestRunners(root),selected=requested??cfg.testRunner??(choices.length===1?choices[0]:undefined);
 if(!selected||!['vitest','jest'].includes(selected)||!choices.includes(selected as TestRunner))throw Error('Select a declared installed test runner with --runner jest|vitest or testRunner in config');
 const runner=selected as TestRunner,native=cfg.reports[runner]??`.behavproof/input/${runner}.json`;
 RelativePathSchema.parse(native);
 const receiptPath=RelativePathSchema.parse(native+'.receipt.json');
 const output=native.toLowerCase(),selectedConfig=(configPath??'behavproof.config.json').toLowerCase();
 if([output,receiptPath.toLowerCase()].includes(selectedConfig))throw Error('Test report conflicts with the selected configuration');
 if(!native.startsWith('.behavproof/'))throw Error('Test reports must be inside .behavproof/');
 const require=createRequire(join(root,'package.json'));let entry:string,metadata:string,version:string;
 try{metadata=require.resolve(`${runner}/package.json`);const installed=JSON.parse(await readFile(metadata,'utf8'));if(!(runner==='vitest'?installed.version==='5.1.0':['29.7.0','30.5.2'].includes(installed.version)))throw Error('Unsupported version');version=installed.version;entry=join(dirname(metadata),runner==='vitest'?'vitest.mjs':'bin/jest.js');}
 catch{throw Error(`behavproof test requires project-installed ${runner==='vitest'?'Vitest 5.1.0':'Jest 29.7.0 or 30.5.2'}; no packages are downloaded`);}
 const paths=[native,receiptPath];
 for(const path of paths){let current=root;for(const part of path.split('/').slice(0,-1)){current=join(current,part);try{await mkdir(current);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Unsafe test report directory');}}
 // Validate all managed reports before removing any.
 const old:string[]=[];for(const path of paths){try{const info=await lstat(join(root,path));if(!info.isFile()||info.isSymbolicLink()||info.nlink>1)throw Error('Unsafe existing test report');old.push(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 const runnerConfig=options.runnerConfig===undefined?[]:['--config',join(root,RelativePathSchema.parse(options.runnerConfig))];
 const runEnv=options.qualityRun?{...process.env,CI:'true'}:process.env;
 const temporary=await mkdtemp(join(root,'.behavproof/native-run-'));
 const nativeOutput=join(temporary,'native.json');
 const relativeOutput=relative(root,nativeOutput).replaceAll('\\','/');
 const inventoryOutput=join(temporary,'inventory.json');
 try{
  let args:string[];
  if(runner==='jest'){
   if(process.env.JEST_JASMINE==='1')throw Error('BehavProof Jest requires jest-circus; Jasmine is unsupported');
   const circus=await realpath(createRequire(metadata).resolve('jest-circus/runner'));
   const reporter=createRequire(import.meta.url).resolve('@behavproof/adapter-reports/jest-inventory-reporter');
   const shown=await exec(process.execPath,[entry,'--showConfig',...runnerConfig],{cwd:root,env:runEnv,timeout:30000,maxBuffer:10*1024*1024,encoding:'utf8'});
   const selected=JSON.parse(shown.stdout) as {configs?:{testRunner?:string}[]};
   if(!Array.isArray(selected.configs)||selected.configs.length!==1||!selected.configs[0]?.testRunner||
     circus!==await realpath(selected.configs[0].testRunner)){
    throw Error('BehavProof Jest supports one configured jest-circus project; incompatible custom test runners are not overwritten');
   }
   args=[entry,'--ci','--runInBand','--watchman=false','--watch=false','--watchAll=false','--passWithNoTests=false',
    '--json','--outputFile',nativeOutput,'--reporters','default','--reporters',reporter,'--testRunner',circus,
    ...runnerConfig,...(options.coverage?['--coverage']:[])];
  }else{
   const reporter=fileURLToPath(import.meta.resolve('@behavproof/adapter-reports/vitest-inventory-reporter'));
   args=[entry,'run','--reporter=default','--reporter=json','--reporter='+reporter,'--outputFile',nativeOutput,
    ...runnerConfig,...(options.qualityRun?['--allowOnly=false','--passWithNoTests=false']:[])];
  }
  for(const path of old)await unlink(join(root,path));
  const invocation=process.env.BEHAVPROOF_EXECUTION_ID||randomUUID();
  const exitCode=await new Promise<number>((resolve,reject)=>{
   const child=spawn(process.execPath,args,{cwd:root,env:{...runEnv,
    BEHAVPROOF_TEST_INVENTORY:inventoryOutput},stdio:'inherit',shell:false});
   const interrupt=()=>{child.kill('SIGINT');},terminate=()=>{child.kill('SIGTERM');};
   process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
   const cleanup=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
   child.once('error',error=>{cleanup();reject(error);});
   child.once('close',(code,signal)=>{cleanup();resolve(code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:2));});
  });
  try{
   const nativeBytes=await safeRead(root,relativeOutput);
   await writeScoped(root,native,nativeBytes.toString('utf8'),true);
   const inventory=await safeReadJson(root,relative(root,inventoryOutput).replaceAll('\\','/'));
   const receipt=captureTestEvidence(nativeBytes,inventory,{invocation,runner:{kind:runner,version}});
   await writeScoped(root,receiptPath,JSON.stringify(receipt)+'\n',true);
  }catch(error){
   if(exitCode===0||(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  }
  return exitCode;
 }finally{
  await rm(temporary,{recursive:true,force:true});
 }
}
