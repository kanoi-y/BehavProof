import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdir,lstat,readFile,unlink,realpath} from 'node:fs/promises';
import {RelativePathSchema} from '@behavproof/core';
import {config} from './project.js';
const exec=promisify(execFile),contracts='.behavproof/input/contracts.json';
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
 const output=native.toLowerCase(),selectedConfig=(configPath??'behavproof.config.json').toLowerCase();
 if([output,contracts].includes(selectedConfig))throw Error('Test report conflicts with the selected configuration');
 if(!native.startsWith('.behavproof/')||output===contracts||output.startsWith(contracts+'/')||contracts.startsWith(output+'/'))throw Error('Test reports require distinct paths inside .behavproof/');
 const require=createRequire(join(root,'package.json'));let entry:string,metadata:string;
 try{metadata=require.resolve(`${runner}/package.json`);const installed=JSON.parse(await readFile(metadata,'utf8'));if(!(runner==='vitest'?installed.version==='5.1.0':['29.7.0','30.5.2'].includes(installed.version)))throw Error('Unsupported version');entry=join(dirname(metadata),runner==='vitest'?'vitest.mjs':'bin/jest.js');}
 catch{throw Error(`behavproof test requires project-installed ${runner==='vitest'?'Vitest 5.1.0':'Jest 29.7.0 or 30.5.2'}; no packages are downloaded`);}
 const paths=[native,contracts];
 for(const path of paths){let current=root;for(const part of path.split('/').slice(0,-1)){current=join(current,part);try{await mkdir(current);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Unsafe test report directory');}}
 // Validate both files before removing either. Only managed report files are removed.
 const old:string[]=[];for(const path of paths){try{const info=await lstat(join(root,path));if(!info.isFile()||info.isSymbolicLink()||info.nlink>1)throw Error('Unsafe existing test report');old.push(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 const runnerConfig=options.runnerConfig===undefined?[]:['--config',join(root,RelativePathSchema.parse(options.runnerConfig))];
 const runEnv=options.qualityRun?{...process.env,CI:'true'}:process.env;
 // Jest loads ESM test files through the VM-modules loader; without it a
 // type:module project fails before any test runs.
 const jestEnv=runner==='jest'?{...runEnv,NODE_OPTIONS:[...(runEnv.NODE_OPTIONS??'').split(/\s+/).filter(Boolean),'--experimental-vm-modules'].join(' ')}:runEnv;
 let args:string[];
 if(runner==='jest'){
  if(process.env.JEST_JASMINE==='1')throw Error('BehavProof Jest requires jest-circus; Jasmine is unsupported');
  let adapter:string,reporter:string;try{adapter=require.resolve('@behavproof/jest/runner');reporter=require.resolve('@behavproof/jest/reporter');}catch{throw Error('behavproof test requires project-installed @behavproof/jest');}
  const shown=await exec(process.execPath,[entry!,'--showConfig',...runnerConfig],{cwd:root,env:jestEnv,timeout:30000,maxBuffer:10*1024*1024,encoding:'utf8'});
  const selected=JSON.parse(shown.stdout) as {configs?:{testRunner?:string}[]};
  const expected=await realpath(createRequire(metadata!).resolve('jest-circus/runner'));
  const officialAdapter=await realpath(adapter);
  if(!Array.isArray(selected.configs)||selected.configs.length!==1||!selected.configs[0]?.testRunner||![expected,officialAdapter].includes(await realpath(selected.configs[0].testRunner)))throw Error('BehavProof Jest supports one configured jest-circus project; incompatible custom test runners are not overwritten');
  args=[entry!,'--ci','--runInBand','--watchman=false','--watch=false','--watchAll=false','--passWithNoTests=false','--json','--outputFile',join(root,native),'--reporters','default','--reporters',reporter,'--testRunner',adapter,...runnerConfig,...(options.coverage?['--coverage']:[])];
 }else args=[entry!,'run','--reporter=default','--reporter=json','--reporter=@behavproof/vitest/reporter','--outputFile',join(root,native),...runnerConfig,...(options.qualityRun?['--allowOnly=false','--passWithNoTests=false']:[])];
 for(const path of old)await unlink(join(root,path));
 return new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:root,env:{...jestEnv,BEHAVPROOF_REPORT:join(root,contracts)},stdio:'inherit',shell:false});
  const interrupt=()=>{child.kill('SIGINT');},terminate=()=>{child.kill('SIGTERM');};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  const cleanup=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
  child.once('error',error=>{cleanup();reject(error);});
  child.once('close',(code,signal)=>{cleanup();resolve(code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:2));});
 });
}
