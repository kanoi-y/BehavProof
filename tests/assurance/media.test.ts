import{it,expect}from'vitest';import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{hash,hashBytes,evaluateAssuranceConditions,type Contract}from'../../packages/core/src/index.js';import{runAssurance}from'../../packages/contract-registry/src/assurance-runtime.js';
async function scenario(capture:boolean){
 const root=await mkdtemp(join(tmpdir(),'assurance-media-'));await mkdir(join(root,'.behavproof'));
 const media='.behavproof/screen.png',bytes=Buffer.from('controlled media bytes');await writeFile(join(root,media),bytes);
 const target=capture?`export async function run(input,env){const actual=await env.layer('database',input);if(input.capture)await env.captureMedia('.behavproof/screen.png');return actual;}`:`export async function run(input,env){return env.layer('database',input);}`;
 await writeFile(join(root,'target.mjs'),target);await writeFile(join(root,'boundary.mjs'),"export function read(){return 'ok';}");
 const inputHashes={'target.mjs':hashBytes(Buffer.from(target)),'boundary.mjs':hashBytes(Buffer.from("export function read(){return 'ok';}"))},subject={testedCommitSha:'a'.repeat(40),sourceTreeHash:'b'.repeat(64)};
 const check:any={id:'media',method:'journey',targetRef:'target.mjs#run',entrypoint:'open',environment:{kind:'controlled-media'},mockBoundaries:[],layers:['database'],layerBindings:[{id:'database',adapter:'boundary.mjs',targetRef:'boundary.mjs#read'}],steps:[{id:'first',action:'open',input:{capture:true},expected:'ok',layers:['database']},{id:'second',action:'next',input:{capture:false},expected:'ok',layers:['database']}],requiredMedia:[media]};
 const contract:Contract={id:'MEDIA',kind:'examples',intentIds:[],sourceRef:'contract.json',revisionHash:hash(check),assurance:{feature:{id:'media',entrypoints:['open']},checks:[check],conditions:[{id:'observed',kind:'journey',statement:'observed step media',checks:['media'],requiredFaults:[]}]}};
 try{const bundle=await runAssurance({root,contracts:[contract],subject,inputHashes,implementationSources:['target.mjs']});const report=bundle.reports[0]!;
  const evaluate=(authenticatedMedia:Record<string,string>)=>evaluateAssuranceConditions(contract.assurance!,[report],{contractId:contract.id,revisionHash:contract.revisionHash,subject,inputHashes,implementationSources:['target.mjs'],checkHashes:{media:hash(check)},authenticatedReportHashes:[hash(report)],authenticatedMedia});
  return{report,evaluate,media,digest:hashBytes(await readFile(join(root,media)))};
 }finally{await rm(root,{recursive:true,force:true});}
}
it('binds explicitly captured media to the actual active step and requires independent bytes',async()=>{
 const r=await scenario(true);expect((r.report.checks[0]as any).media).toEqual([{ref:r.media,sha256:r.digest,stepId:'first'}]);expect(r.evaluate({}).status).toBe('unknown');expect(r.evaluate({[r.media]:r.digest}).status).toBe('pass');expect(r.evaluate({[r.media]:'f'.repeat(64)}).status).toBe('unknown');
});
it('does not attach an arbitrary pre-existing file to the last step automatically',async()=>{
 const r=await scenario(false);expect((r.report.checks[0]as any).media).toEqual([]);expect(r.evaluate({[r.media]:r.digest}).status).toBe('unknown');
});
