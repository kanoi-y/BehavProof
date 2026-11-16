import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdir,lstat,readFile,unlink} from 'node:fs/promises';
import {RelativePathSchema} from '@behavproof/core';
import {config} from './project.js';
const contracts='.behavproof/input/contracts.json';
/** Explicit test execution only. check/doctor/discovery remain data readers. */
export async function runTests(root:string,configPath?:string):Promise<number>{
 const cfg=await config(root,configPath),vitest=cfg.reports.vitest??'.behavproof/input/vitest.json';
 RelativePathSchema.parse(vitest);
 const output=vitest.toLowerCase(),selectedConfig=(configPath??'behavproof.config.json').toLowerCase();
 if([output,contracts].includes(selectedConfig))throw Error('Test report conflicts with the selected configuration');
 if(!vitest.startsWith('.behavproof/')||output===contracts||output.startsWith(contracts+'/')||contracts.startsWith(output+'/'))throw Error('Test reports require distinct paths inside .behavproof/');
 const require=createRequire(join(root,'package.json'));let entry:string;
 try{const pkg=require.resolve('vitest/package.json');const metadata=JSON.parse(await readFile(pkg,'utf8'));if(metadata.version!=='5.1.0')throw Error('Unsupported version');entry=join(dirname(pkg),'vitest.mjs');}
 catch{throw Error('behavproof test requires project-installed Vitest 5.1.0; no packages are downloaded');}
 const paths=[vitest,contracts];
 for(const path of paths){let current=root;for(const part of path.split('/').slice(0,-1)){current=join(current,part);try{await mkdir(current);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Unsafe test report directory');}}
 // Validate both files before removing either, so an unsafe second report cannot
 // cause deletion of the first. Only these managed output files are removed.
 const old:string[]=[];for(const path of paths){try{const info=await lstat(join(root,path));if(!info.isFile()||info.isSymbolicLink()||info.nlink>1)throw Error('Unsafe existing test report');old.push(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 for(const path of old)await unlink(join(root,path));
 return new Promise<number>((resolve,reject)=>{
  const child=spawn(process.execPath,[entry,'run','--reporter=default','--reporter=json','--reporter=@behavproof/vitest/reporter','--outputFile',join(root,vitest)],{cwd:root,env:{...process.env,BEHAVPROOF_REPORT:join(root,contracts)},stdio:'inherit',shell:false});
  const interrupt=()=>{child.kill('SIGINT');},terminate=()=>{child.kill('SIGTERM');};
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  const cleanup=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
  child.once('error',error=>{cleanup();reject(error);});
  child.once('close',(code,signal)=>{cleanup();resolve(code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:2));});
 });
}
