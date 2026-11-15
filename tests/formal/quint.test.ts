import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Adapter-owned behavior, not Quint implementation tests: absent/incompatible
// output, interrupted child, reused output and missing property cannot be pass.
const adapter:any=await import('../../packages/adapter-quint/src/index.js').catch(()=>({}));
const model={id:'ORDER',contractId:'ORDER-MODEL',model:'order.qnt',quint:{entry:'quint.mjs',version:'0.33.1',apalacheVersion:'0.62.4'},properties:['refundAtMostOnce'],checks:['parse','typecheck','test','run','verify'],maxSteps:8,maxSamples:20,seed:'42',timeoutMs:1000,report:'.behavproof/model.json'};
const modules=[{name:'order',declarations:[]}];
const raw={parse:{stage:'parsing',modules,table:{}},typecheck:{stage:'typechecking',modules,table:{},types:{},effects:{}},test:{stage:'testing',passed:['refundTest'],failed:[],ignored:[]},run:{stage:'running',status:'ok',seed:42,trace:[{kind:'app',opcode:'Rec',args:[]}]},verify:{stage:'verifying',status:'ok'}};
const normalize=(stage:string,value:unknown,extra={})=>adapter.normalizeQuint(value,{model,stage,toolVersion:'0.33.1',exitCode:0,completed:true,...extra});
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof-formal-'));await writeFile(join(root,'order.qnt'),'module order {}');await mkdir(join(root,'out'));});
afterEach(()=>rm(root,{recursive:true,force:true}));
it.each(['parse','typecheck','test','run','verify'])('normalizes %s into its distinct method and scope',stage=>{
 const result=normalize(stage,raw[stage as keyof typeof raw]);expect(result.status).toBe('pass');expect(result.stage).toBe(stage);
 if(stage==='verify')expect(result).toMatchObject({backend:'apalache',backendVersion:'0.62.4',method:'bounded_model_check',maxSteps:8});
 if(stage==='run')expect(result).toMatchObject({backend:'typescript',method:'simulation',maxSteps:8,maxSamples:20,seed:'42'});
});
it('decodes pinned real Quint CLI output fixtures',async()=>{
 for(const stage of ['parse','typecheck','test','run','verify']){
  const data=JSON.parse(await readFile(`tests/fixtures/formal/quint-${stage}.json`,'utf8'));
  expect(normalize(stage,data).status).toBe('pass');
 }
});
it('does not turn successful exit with absent, wrong-stage or ambiguous output into proof',()=>{
 for(const value of [undefined,{},[],{stage:'verifying'},{stage:'verifying',status:'something-new'},{stage:'running',status:'ok'}])expect(normalize('verify',value).status).toBe('unknown');
 expect(normalize('test',{stage:'testing',passed:[],failed:[],ignored:[]}).status).toBe('unknown');
 expect(normalize('parse',raw.parse,{toolVersion:'0.34.0'}).status).toBe('unknown');
});
it('keeps syntax/type/spec failures, counterexamples and infrastructure errors distinct',()=>{
 expect(normalize('parse',{stage:'parsing',errors:[{message:'Unexpected token'}]},{exitCode:1}).status).toBe('fail');
 expect(normalize('test',{stage:'testing',passed:[],failed:['refundTest'],ignored:[]},{exitCode:1}).status).toBe('fail');
 expect(normalize('run',{stage:'running',status:'violation',seed:42,trace:[{}]},{exitCode:1}).status).toBe('fail');
 expect(normalize('verify',{stage:'verifying',status:'violation',trace:[{}]},{exitCode:1}).status).toBe('fail');
 for(const error of [{stage:'verifying',status:'error',errors:[{message:'JDK unavailable'}]},{stage:'verifying',status:'failure',errors:[{message:'backend unavailable'}]}])expect(normalize('verify',error,{exitCode:1}).status).toBe('unknown');
 expect(normalize('verify',raw.verify,{exitCode:null,completed:false}).status).toBe('unknown');
 expect(normalize('verify',raw.verify,{exitCode:2}).status).toBe('unknown');
});
it('keeps the command seed separate from the selected trace seed and rejects empty simulation',()=>{
 expect(adapter.normalizeQuint(raw.run,{model:{...model,properties:[]},stage:'run',toolVersion:'0.33.1',exitCode:0,completed:true}).status).toBe('unknown');
 expect(normalize('run',{...raw.run,seed:74})).toMatchObject({status:'pass',seed:'42',traceSeed:'74'});
 expect(normalize('run',{...raw.run,seed:Number.MAX_SAFE_INTEGER+1}).status).toBe('unknown');
 expect(normalize('run',{...raw.run,trace:[]}).status).toBe('unknown');
});
it('passes multiple invariant names as CLI array arguments, not an expression',async()=>{
 await writeFile(join(root,'quint.mjs'),`import{writeFileSync}from'node:fs';if(process.argv.includes('--version'))console.log('0.33.1');else{const at=process.argv.indexOf('--invariants');const good=at>=0&&process.argv[at+1]==='refundAtMostOnce'&&process.argv[at+2]==='noRefundAfterShipping';writeFileSync(process.argv[process.argv.indexOf('--out')+1],JSON.stringify({stage:'running',status:good?'ok':'error',seed:42,trace:[{}]}));}`);
 const result=await adapter.runQuint({root,model:{...model,properties:['refundAtMostOnce','noRefundAfterShipping']},stage:'run',outputDirectory:'out/invariants'});
 expect(result.result.status).toBe('pass');
});
it('requires the complete declared imported-model closure before starting a tool',async()=>{
 await writeFile(join(root,'order.qnt'),'module order { import common.* from "common" }');await writeFile(join(root,'common.qnt'),'module common {}');
 await expect(adapter.readModelInputs(root,model)).rejects.toThrow(/modelSources/);
 const before=await adapter.readModelInputs(root,{...model,modelSources:['common.qnt']});
 await writeFile(join(root,'common.qnt'),'module common { val n = 1 }');
 expect((await adapter.readModelInputs(root,{...model,modelSources:['common.qnt']})).modelHash).not.toBe(before.modelHash);
 await writeFile(join(root,'order.qnt'),'module order { import secret.* from "../secret" }');
 await expect(adapter.readModelInputs(root,{...model,modelSources:['common.qnt']})).rejects.toThrow();
});
it('captures real bounded child results and never reuses an existing result directory',async()=>{
 await writeFile(join(root,'quint.mjs'),`import{writeFileSync}from'node:fs';if(process.argv.includes('--version')){console.log('0.33.1');}else{writeFileSync(process.argv[process.argv.indexOf('--out')+1],JSON.stringify(${JSON.stringify(raw.parse)}));}`);
 const first=await adapter.runQuint({root,model,stage:'parse',outputDirectory:'out/first'});expect(first.result.status).toBe('pass');expect(first.commandHash).toMatch(/^[a-f0-9]{64}$/);
 await expect(adapter.runQuint({root,model,stage:'parse',outputDirectory:'out/first'})).rejects.toThrow();
});
it('selects an isolated local checker endpoint instead of trusting an existing default server',async()=>{
 await writeFile(join(root,'quint.mjs'),`import{writeFileSync}from'node:fs';if(process.argv.includes('--version'))console.log('0.33.1');else{const p=process.argv[process.argv.indexOf('--server-endpoint')+1];const valid=/^127\\.0\\.0\\.1:[0-9]+$/.test(p)&&p!=='127.0.0.1:8822';writeFileSync(process.argv[process.argv.indexOf('--out')+1],JSON.stringify({stage:'verifying',status:valid?'ok':'error'}));}`);
 expect((await adapter.runQuint({root,model,stage:'verify',outputDirectory:'out/checker'})).result.status).toBe('pass');
});
it('fails closed on timeout, missing tool, excess output and source symlinks',async()=>{
 const absent=await adapter.runQuint({root,model,stage:'parse',outputDirectory:'out/absent'});expect(absent.result.status).toBe('unknown');
 await writeFile(join(root,'quint.mjs'),`if(process.argv.includes('--version'))console.log('0.33.1');else setInterval(()=>{},1000);`);
 const timed=await adapter.runQuint({root,model:{...model,timeoutMs:50},stage:'parse',outputDirectory:'out/timed'});expect(timed.result.status).toBe('unknown');
 await writeFile(join(root,'quint.mjs'),`process.stdout.write('x'.repeat(200000));`);
 const oversized=await adapter.runQuint({root,model,stage:'parse',outputDirectory:'out/large',maxOutputBytes:1024});expect(oversized.result.status).toBe('unknown');
 await expect(adapter.runQuint({root,model:{...model,model:'../escape.qnt'},stage:'parse',outputDirectory:'out/escape'})).rejects.toThrow();
 if(process.platform!=='win32'){await symlink(join(root,'order.qnt'),join(root,'linked.qnt'));await expect(adapter.runQuint({root,model:{...model,model:'linked.qnt'},stage:'parse',outputDirectory:'out/link'})).rejects.toThrow();}
});
it.each(['parse','typecheck','test','run','verify'])('never accepts malformed errors on %s output',stage=>{
 for(const errors of [{message:'backend failed'},'backend failed',false,null])expect(normalize(stage,{...raw[stage as keyof typeof raw],errors}).status).toBe('unknown');
});
