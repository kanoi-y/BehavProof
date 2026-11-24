import { readdir, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, relative, sep, matchesGlob } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseConfig, RelativePathSchema, safeReadJson, type Config } from '@behavproof/core';
const exec=promisify(execFile);
export async function git(root:string,args:string[]){return (await exec('git',['-c','core.fsmonitor=false',...args],{cwd:root,timeout:30000,maxBuffer:10*1024*1024,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})).stdout;}
export async function readGitFile(root:string,sha:string,path:string):Promise<Buffer>{
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))throw Error('Expected immutable Git object');
 RelativePathSchema.parse(path);
 const tree=await git(root,['ls-tree',sha,'--',`:(literal)${path}`]);
 if(!/^100(?:644|755) blob [a-f0-9]{40,64}\t/.test(tree)||tree.trimEnd().includes('\n')){
  throw Error(`Expected a regular committed file: ${path}`);
 }
 return (await exec('git',['-c','core.fsmonitor=false','show',`${sha}:./${path}`],
  {cwd:root,timeout:30000,maxBuffer:10*1024*1024,encoding:'buffer',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})).stdout;
}
export async function exists(root:string,path:string){try{await lstat(join(root,RelativePathSchema.parse(path)));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
export async function config(root:string,path='behavproof.config.json',profile?:string):Promise<Config>{const raw=await exists(root,path)?await safeReadJson(root,path):{schemaVersion:2};return parseConfig({...raw as object,...(profile?{profile}:{})});}
export async function fileList(root:string){const files:string[]=[];let count=0;
 const walk=async(dir:string,depth:number)=>{if(depth>64)throw Error('Directory depth limit exceeded');for(const ent of await readdir(join(root,dir),{withFileTypes:true})){if(++count>50000)throw Error('Project file inventory exceeds limit');const path=dir?`${dir}/${ent.name}`:ent.name;if(['.git','node_modules','.npm-cache','.superpowers'].includes(ent.name)||path==='.behavproof/generated')continue;if(ent.isDirectory())await walk(path,depth+1);else files.push(path);}};
 await walk('',0);return files.sort();
}
export function select(files:readonly string[],patterns:readonly string[]){for(const pattern of patterns)RelativePathSchema.parse(pattern);return files.filter(file=>patterns.some(pattern=>file===pattern||matchesGlob(file,pattern))).sort();}
export async function writeScoped(root:string,path:string,content:string,exclusive=false){
 RelativePathSchema.parse(path);const base=await realpath(root);let current=base;
 const parts=path.split('/');for(const part of parts.slice(0,-1)){current=join(current,part);try{await mkdir(current);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe output directory');}
 const parent=await realpath(dirname(join(base,path))),rel=relative(base,parent);if(rel==='..'||rel.startsWith(`..${sep}`))throw Error('Output escapes project');
 const handle=await open(join(base,path),constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK|(exclusive?constants.O_EXCL:0),0o600);
 try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink>1)throw Error('Output is not a single regular file');if(!exclusive)await handle.truncate(0);await handle.writeFile(content,'utf8');}finally{await handle.close();}
}
export function ref(value:string){if(!value||value.startsWith('-')||value.includes('\0'))throw Error('Invalid Git ref');return value;}
