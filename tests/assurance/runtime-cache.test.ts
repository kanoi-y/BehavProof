import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hash,hashBytes,type Contract} from '../../packages/core/src/index.js';
import {runAssurance,type AssuranceRunOptions} from '../../packages/contract-registry/src/assurance-runtime.js';

let root:string,inputs:Record<string,string>;
const subject={testedCommitSha:'a'.repeat(40),sourceTreeHash:'b'.repeat(64)};
const freshProcess=/fresh (?:Node(?:\.js)? )?process|assurance run/i;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'assurance-cache-'));inputs={};await mkdir(join(root,'src'));
 await put('src/helper.mjs','export const value=1;');
 await put('src/target.mjs',`import {value} from './helper.mjs';export function run(input,env){return value+(env.dependencies.extra??0);}`);
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function put(path:string,source:string){await writeFile(join(root,path),source);inputs[path]=hashBytes(Buffer.from(source));}
function options(overrides:Partial<AssuranceRunOptions>={}):AssuranceRunOptions{
 const check={id:'value',method:'example' as const,targetRef:'src/target.mjs#run',cases:[{id:'one',input:null,expected:1}]};
 const contract:Contract={id:'C',kind:'examples',intentIds:[],sourceRef:'contract.json',revisionHash:hash(check),cases:[],assurance:{feature:{id:'cache',entrypoints:['run']},checks:[check],conditions:[{id:'value',kind:'postcondition',statement:'current helper value',checks:['value'],requiredFaults:[]}]}};
 return {root,contracts:[contract],subject,inputHashes:{...inputs},implementationSources:['src/target.mjs','src/helper.mjs'],...overrides};
}
const actual=(bundle:Awaited<ReturnType<typeof runAssurance>>)=>(bundle.reports[0]!.checks[0] as {samples:{actual?:unknown}[]}).samples[0]!.actual;

it('reuses an unchanged selected snapshot and keeps driver closures usable',async()=>{
 let extra=0;const o=options({driver:{createContext:()=>({dependencies:{extra:extra++}})}});
 expect(actual(await runAssurance(o))).toBe(1);
 expect(actual(await runAssurance(o))).toBe(2);
});
it('refuses a changed selected transitive helper instead of reporting its new hash with cached code',async()=>{
 expect(actual(await runAssurance(options()))).toBe(1);
 await put('src/helper.mjs','export const value=2;');
 await expect(runAssurance(options())).rejects.toThrow(freshProcess);
});
it('recognizes a root symlink alias before allowing a changed helper snapshot',async()=>{
 await runAssurance(options());
 const alias=join(root,'alias');await symlink(root,alias,'dir');
 expect(actual(await runAssurance(options({root:alias})))).toBe(1);
 await put('src/helper.mjs','export const value=2;');
 await expect(runAssurance(options({root:alias}))).rejects.toThrow(freshProcess);
});
it('pins overlapping nested roots to the same physical source snapshot',async()=>{
 const o=options();await runAssurance(o);
 const nested=()=>{
  const c=structuredClone(o.contracts[0]!);c.assurance!.checks[0]!.targetRef='target.mjs#run';
  return options({root:join(root,'src'),contracts:[c],inputHashes:{'target.mjs':inputs['src/target.mjs']!,'helper.mjs':inputs['src/helper.mjs']!},implementationSources:['target.mjs','helper.mjs']});
 };
 expect(actual(await runAssurance(nested()))).toBe(1);
 await put('src/helper.mjs','export const value=2;');
 await expect(runAssurance(nested())).rejects.toThrow(freshProcess);
});
it.each(['remove','add'])('refuses a selected source inventory %s after executable loading',async(change)=>{
 await runAssurance(options());
 if(change==='remove')delete inputs['src/helper.mjs'];
 else await put('src/config.json','{}');
 await expect(runAssurance(options())).rejects.toThrow(freshProcess);
});
it('does not revive a poisoned helper cache after source mutation fails a run and bytes are restored',async()=>{
 await put('src/target.mjs',`import {writeFileSync,existsSync} from 'node:fs';const marker=new URL('./mutated',import.meta.url);if(!existsSync(marker)){writeFileSync(new URL('./helper.mjs',import.meta.url),'export const value=2;');writeFileSync(marker,'done');}const {value}=await import('./helper.mjs');export function run(){return value;}`);
 await expect(runAssurance(options())).rejects.toThrow(/identity changed during/);
 await put('src/helper.mjs','export const value=1;');
 await expect(runAssurance(options())).rejects.toThrow(freshProcess);
});
it('reserves the snapshot before an import completes so concurrent changed inventories are refused',async()=>{
 const key=`assurance-cache-${root}`;let started!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;}),wait=new Promise<void>(resolve=>{release=resolve;});
 const globals=globalThis as unknown as Record<string,unknown>;globals[key]={started,wait};
 await put('src/target.mjs',`import {value} from './helper.mjs';const gate=globalThis[${JSON.stringify(key)}];gate.started();await gate.wait;export function run(){return value;}`);
 const first=runAssurance(options());
 try{
  await ready;await put('src/config.json','{}');
  const unblock=setTimeout(release,100);
  try{await expect(runAssurance(options())).rejects.toThrow(freshProcess);}finally{clearTimeout(unblock);}
 }finally{release();await first;delete globals[key];}
});
it('keeps partially imported helper modules from a failed import from being relabeled on retry',async()=>{
 await put('src/target.mjs',`import {value} from './helper.mjs';throw Error('load failed');export function run(){return value;}`);
 await expect(runAssurance(options())).rejects.toThrow('load failed');
 await put('src/helper.mjs','export const value=2;');
 await expect(runAssurance(options())).rejects.toThrow(freshProcess);
});
