import { spawn, execFile } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdir, lstat, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { FormalModelConfigSchema, FormalStageSchema, RelativePathSchema, hash, hashBytes, safeRead, safeReadJson, type FormalModelConfig, type FormalStage } from '@behavproof/core';
import { normalizeQuint, APALACHE_VERSION } from './normalize.js';
const MAX_BYTES=10*1024*1024;
export async function readModelInputs(root:string,input:FormalModelConfig){
 const m=FormalModelConfigSchema.parse(input),paths=[...new Set([m.model,...m.modelSources])].sort(),sources:Record<string,string>=Object.create(null);
 for(const path of paths){const bytes=await safeRead(root,path);sources[path]=hashBytes(bytes);
  // Dependency guard, not a Quint parser: tokenize strings/comments/words and
  // retain every literal `from` file in the explicitly selected source closure.
  const tokens=[...new TextDecoder('utf-8',{fatal:true}).decode(bytes).matchAll(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*/g)].map(x=>x[0]).filter(x=>!x.startsWith('//')&&!x.startsWith('/*'));
  for(let i=0;i<tokens.length;i++)if(tokens[i]==='from'&&tokens[i+1]?.startsWith('"')){
   const imported=JSON.parse(tokens[i+1]!) as string;
   if(imported.startsWith('/')||/^[A-Za-z]:/.test(imported)||imported.includes('\\'))throw Error('Model import escapes selected source scope');
   const target=relative(resolve(root),resolve(root,dirname(path),imported.endsWith('.qnt')?imported:imported+'.qnt')).split(sep).join('/');
   RelativePathSchema.parse(target);if(!paths.includes(target))throw Error(`Undeclared model import; add to modelSources: ${target}`);
  }
 }
 return {modelHash:hash(sources),sources};
}
export function quintCommandHash(input:FormalModelConfig){const model=FormalModelConfigSchema.parse(input);return hash({adapter:'@behavproof/adapter-quint/1',nodeMajor:24,model});}
async function checkerEndpoint(){
 const server=createServer();await new Promise<void>((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',()=>ok());});
 const port=(server.address() as AddressInfo).port;await new Promise<void>((ok,bad)=>server.close(error=>error?bad(error):ok()));
 return `127.0.0.1:${port}`;
}
async function createOutput(root:string,path:string){
 RelativePathSchema.parse(path);let current=root;const parts=path.split('/');
 for(const p of parts.slice(0,-1)){current=join(current,p);try{await mkdir(current);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const s=await lstat(current);if(s.isSymbolicLink()||!s.isDirectory())throw Error('Unsafe formal output directory');}
 await mkdir(join(root,path));
}
/** A bounded process group belongs to this explicit tool invocation only. */
export async function runBounded(command:string,args:string[],options:{cwd:string;timeoutMs:number;maxOutputBytes?:number}){
 const max=options.maxOutputBytes??MAX_BYTES;if(!Number.isSafeInteger(max)||max<1||max>MAX_BYTES||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>3600000)throw Error('Invalid process limits');
 return new Promise<{stdout:string;stderr:string;exitCode:number|null;completed:boolean;diagnostics:string[]}>((finish)=>{
  const diagnostics:string[]=[],out:Buffer[]=[],err:Buffer[]=[];let size=0,ended=false,settled=false;
  const child=spawn(command,args,{cwd:options.cwd,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
  const stop=()=>{if(!child.pid)return;if(process.platform==='win32')execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{timeout:5000},()=>{});else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
  const signal=()=>{diagnostics.push('Invocation interrupted');stop();};
  const timer=setTimeout(()=>{diagnostics.push('Tool timeout');stop();},options.timeoutMs);
  process.once('SIGINT',signal);process.once('SIGTERM',signal);
  const done=(exitCode:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);stop();finish({stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8'),exitCode,completed:ended&&diagnostics.length===0,diagnostics});};
  const capture=(chunks:Buffer[])=>(chunk:Buffer)=>{size+=chunk.length;if(size>max){if(!diagnostics.includes('Tool output exceeds limit'))diagnostics.push('Tool output exceeds limit');stop();}else chunks.push(chunk);};
  child.stdout.on('data',capture(out));child.stderr.on('data',capture(err));
  child.once('error',e=>{diagnostics.push(`Tool execution error: ${e.message}`);done(null);});
  child.once('close',code=>{ended=true;done(code);});
 });
}
export type RunQuintOptions={root:string;model:FormalModelConfig;stage:FormalStage;outputDirectory:string;maxOutputBytes?:number};
export async function runQuint(options:RunQuintOptions){
 const {root,outputDirectory}=options,m=FormalModelConfigSchema.parse(options.model),stage=FormalStageSchema.parse(options.stage);
 await createOutput(root,outputDirectory);const before=await readModelInputs(root,m),commandHash=quintCommandHash(m);
 const base={identity:{modelHash:before.modelHash,configHash:hash(m),commandHash},commandHash};
 let entryError:string|undefined;try{await safeRead(root,m.quint.entry);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;entryError='Selected Quint CLI is not installed';}
 const limit={cwd:root,timeoutMs:m.timeoutMs,...(options.maxOutputBytes?{maxOutputBytes:options.maxOutputBytes}:{})};
 const version=entryError?{stdout:'',stderr:'',exitCode:null,completed:false,diagnostics:[entryError]}:await runBounded(process.execPath,[join(root,m.quint.entry),'--version'],limit);
 const toolVersion=version.completed&&version.exitCode===0?version.stdout.trim():'unavailable';
 let command:string[]=[join(root,m.quint.entry),stage,m.model,'--out',`${outputDirectory}/quint.json`];
 if(stage==='test'||stage==='run')command.push('--backend','typescript','--seed',m.seed,'--max-samples',String(m.maxSamples));
 if(stage==='run'||stage==='verify')command.push('--invariants',...m.properties,'--max-steps',String(m.maxSteps));
 if(stage==='run')command.push('--mbt','--n-traces',String(m.minTraces),'--out-itf',`${outputDirectory}/trace_{seq}.itf.json`);
 if(stage==='verify')command.push('--backend','apalache','--apalache-version',m.quint.apalacheVersion??APALACHE_VERSION,'--server-endpoint',await checkerEndpoint(),'--out-itf',`${outputDirectory}/counterexample.itf.json`);
 const processResult=toolVersion===m.quint.version?await runBounded(process.execPath,command,limit):{...version,completed:false,diagnostics:[...version.diagnostics,'Selected CLI version is missing or mismatched']};
 await writeFile(join(root,outputDirectory,'stdout.txt'),processResult.stdout,{flag:'wx'});await writeFile(join(root,outputDirectory,'stderr.txt'),processResult.stderr,{flag:'wx'});
 let raw:unknown;try{raw=await safeReadJson(root,`${outputDirectory}/quint.json`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')processResult.diagnostics.push(`Invalid Quint JSON output: ${(e as Error).message}`);}
 const after=await readModelInputs(root,m);if(hash(before)!==hash(after))processResult.diagnostics.push('Model sources changed during execution');
 const result=normalizeQuint(raw,{model:m,stage,toolVersion,exitCode:processResult.exitCode,completed:processResult.completed&&processResult.diagnostics.length===0,diagnostics:processResult.diagnostics});
 result.stdoutHash=hashBytes(Buffer.from(processResult.stdout));result.stderrHash=hashBytes(Buffer.from(processResult.stderr));result.artifacts=[];
 for(const name of (await readdir(join(root,outputDirectory))).sort()){
  if(!['quint.json','stdout.txt','stderr.txt','counterexample.itf.json'].includes(name)&&!/^trace_\d+\.itf\.json$/.test(name))throw Error('Unexpected formal artifact');
  const ref=`${outputDirectory}/${name}`;result.artifacts.push({ref,sha256:hashBytes(await safeRead(root,ref))});
 }
 return {...base,result,raw};
}
