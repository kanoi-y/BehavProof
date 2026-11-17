import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {hashBytes} from '../../packages/core/src/index.js';
import {collect,gitSubject} from '../../packages/adapter-reports/src/index.js';
import {discover,snapshot,evaluateScopedClaims} from '../../packages/contract-registry/src/index.js';
import {instrumentFunction,evaluateProbeRuns} from '../../packages/contract-registry/src/probe.js';
const require=createRequire(import.meta.url),project=process.cwd(),targetRef='src/orders.ts#readOrder';
const method='protected-case-observer-and-jest-canary-v1';
const source=await readFile(join(project,'examples/node-api/src/orders.ts'),'utf8');
const tests=(await readFile(join(project,'examples/node-api/tests/orders.test.ts'),'utf8')).replace('@behavproof/vitest','@behavproof/jest').replace('../src/orders.js','../src/orders.ts');
const active=snapshot(discover({'tests/orders.test.ts':tests},'@behavproof/jest'),'a'.repeat(40),['tests/**/*.ts']).contracts[0]!;
async function fixture(version:string){
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-jest-protected-')),root=join(scratch,'candidate'),host=join(scratch,'host');
 await mkdir(root);await mkdir(host);await mkdir(join(root,'node_modules'));await mkdir(join(root,'src'));await mkdir(join(root,'tests'));await mkdir(join(root,'.behavproof/collected'),{recursive:true});
 await symlink(dirname(require.resolve(`${version}/package.json`)),join(root,'node_modules/jest'),'dir');
 await symlink(join(project,'node_modules/@behavproof'),join(root,'node_modules/@behavproof'),'dir');
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Probe fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const inputs=['.gitignore','package.json','src/orders.ts','tests/orders.test.ts'];
 await writeFile(join(root,'.gitignore'),'node_modules/\n.behavproof/\n');await writeFile(join(root,'package.json'),JSON.stringify({type:'commonjs'}));
 git('init','-q','-b','main');
 return {root,async close(){await rm(scratch,{recursive:true,force:true})},async run(id:string,options:{source?:string;tests?:string;expectedSourceHash?:string;targetRef?:string;inputs?:string[]}={}){
  await writeFile(join(root,'src/orders.ts'),options.source??source);
  await writeFile(join(root,'tests/orders.test.ts'),`if(process.env.BEHAVPROOF_HOST_ONLY_SECRET||process.env.NODE_OPTIONS)throw Error('Host credentials/preload leaked');\n`+(options.tests??tests));
  git('add','.');git('commit','--allow-empty','-qm',id);const protectedInputs=options.inputs??inputs,head=git('rev-parse','HEAD'),subject=await gitSubject(root,protectedInputs,head,head),requestPath=join(host,id+'.json');
  await writeFile(requestPath,JSON.stringify({schemaVersion:1,runner:'jest',root,tests:['tests/orders.test.ts'],contracts:[active],targetRef:options.targetRef??targetRef,expectedSourceHash:options.expectedSourceHash??hashBytes(Buffer.from(options.source??source)),subject,effectivePolicyHash:'b'.repeat(64),inputs:protectedInputs}));
  const manifest=await collect({root,executionId:id,command:process.execPath,args:[join(project,'scripts/protected-probe-worker.mjs'),'--request',requestPath],inputPaths:protectedInputs,configPaths:['package.json'],outputRoot:'.behavproof/collected',artifacts:[{ref:'jest.json',kind:'test',scope:[active.id]},{ref:'contracts.json',kind:'contract_report',scope:[active.id]},{ref:'claims.json',kind:'claims',scope:[active.id]},{ref:'probe-diagnostics.json',kind:'diagnostic',scope:[active.id]}],producer:{tool:'behavproof-probe-collector',version:'0.1.0',collectorVersion:'0.1.0'},prHead:head,base:head,timeoutMs:60000});
  const output=join(root,'.behavproof/collected',id);const json=async(name:string)=>{try{return JSON.parse(await readFile(join(output,name),'utf8'))}catch{return undefined}};
  return {manifest,claims:await json('claims.json'),diagnostics:await json('probe-diagnostics.json'),ordinary:await json('contracts.json'),native:await json('jest.json'),output};
 }};
}
for(const version of ['jest29','jest']){
 for(const omitted of ['src/orders.ts','tests/orders.test.ts'])it(`${version} protects selected target and tests by rejecting omitted ${omitted}`,async()=>{
  const f=await fixture(version);try{
   const r=await f.run('omitted',{inputs:['.gitignore','package.json','src/orders.ts','tests/orders.test.ts'].filter(file=>file!==omitted)});
   expect(r.manifest.exitCode).not.toBe(0);expect(r.manifest.artifacts).toEqual([]);expect(r.claims).toBeUndefined();
  }finally{await f.close()}
 },60000);
 it(`${version} protected Collector observes actual selected source and same-callback fault comparisons`,async()=>{
  const f=await fixture(version);const secret=process.env.BEHAVPROOF_HOST_ONLY_SECRET;process.env.BEHAVPROOF_HOST_ONLY_SECRET='fixture-not-credential';
  try{
   const r=await f.run('correct');expect(r.manifest.exitCode,JSON.stringify(r)).toBe(0);
   expect(r.manifest.artifacts).toHaveLength(4);expect(r.native.success).toBe(true);
   expect(r.ordinary.runner).toEqual({kind:'jest',version:version==='jest'?'30.5.2':'29.7.0'});
   expect(r.claims).toHaveLength(4);expect(r.claims.every((c:any)=>c.payload.method===method&&c.payload.status==='pass')).toBe(true);
   expect(r.diagnostics.method).toBe(method);expect(r.diagnostics.main.exitCode).toBe(0);expect(r.diagnostics.canary.exitCode).toBe(1);
   expect(r.diagnostics.main.executionId).not.toBe(r.diagnostics.canary.executionId);
   for(const [phase,mode] of [[r.diagnostics.main,'main'],[r.diagnostics.canary,'canary']] as const){
    expect(phase.transformation).toMatchObject({mode,targetRef,originalSha256:hashBytes(Buffer.from(source))});
    expect(phase.transformation.executedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(phase.transformation.compiledSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(phase.report.contracts.every((row:any)=>row.comparisonCount===1&&row.targetCalls.length===1&&row.targetCalls[0].targetRef===targetRef&&row.targetCalls[0].count===1)).toBe(true);
   }
   expect(r.diagnostics.main.transformation.executedSha256).toBe(r.diagnostics.observedProgramSha256);
   expect(r.diagnostics.canary.transformation.executedSha256).toBe(r.diagnostics.fault.mutatedSha256);
   expect(r.ordinary.contracts.every((row:any)=>row.status==='pass'&&row.testState==='passed')).toBe(true);
   expect(r.diagnostics.canary.report.contracts.every((row:any)=>row.status==='fail'&&row.testState==='failed')).toBe(true);
   const protocol={runner:r.ordinary.runner,contract:active,targetRef,expectedSourceHash:r.diagnostics.fault.originalSha256,main:r.diagnostics.main,canary:r.diagnostics.canary,fault:r.diagnostics.fault};
   for(const phase of ['main','canary'] as const)for(const marker of [undefined,{kind:'vitest',version:'5.1.0'},{kind:'jest',version:version==='jest'?'29.7.0':'30.5.2'}]){
    const p=structuredClone(protocol);p[phase].report.runner=marker;
    const result=evaluateProbeRuns(p,()=>true);
    expect(result.canaries.every(row=>row.status==='unknown')).toBe(true);
    if(phase==='main')expect(result.observations.every(row=>row.status==='unknown')).toBe(true);
   }
   const result=evaluateProbeRuns(protocol,()=>true),scope={contractId:active.id,caseIds:active.caseIds!,targetRef,method};
   expect(evaluateScopedClaims(active,scope,result.observations,result.canaries,[],{},()=>true).production_target_observed).toBe('pass');
   expect(evaluateScopedClaims(active,{...scope,method:'protected-case-observer-and-vitest-canary-v1'},result.observations,result.canaries,[],{},()=>true).production_target_observed).toBe('unknown');
   const {runner:_runner,...unselected}=structuredClone(protocol);
   expect(evaluateProbeRuns(unselected,()=>true).observations.every(row=>row.status==='unknown'&&row.method!==method)).toBe(true);
  }finally{if(secret===undefined)delete process.env.BEHAVPROOF_HOST_ONLY_SECRET;else process.env.BEHAVPROOF_HOST_ONLY_SECRET=secret;await f.close()}
 },60000);
 it(`${version} protected producer blocks fake, ordinary failure, skip, removed cases and unrelated hook crashes`,async()=>{
  const f=await fixture(version);
  try{
   const fake=await f.run('fake',{tests:tests.replace('({input})=>readOrder(input.userId,input.order)','({expected})=>expected')});
   expect(fake.manifest.exitCode).toBe(0);expect(fake.claims.every((c:any)=>c.payload.status!=='pass')).toBe(true);
   const wrong=await f.run('wrong',{source:source.replace('userId===order.ownerId?order:null','true?order:null')});expect(wrong.manifest.exitCode).not.toBe(0);expect(wrong.manifest.artifacts).toEqual([]);
   const skipped=await f.run('skip',{tests:tests.replace('contractTest.each(ownership,',"describe.skip('required',()=>contractTest.each(ownership,").replace('input.order));','input.order)));')});expect(skipped.manifest.exitCode).not.toBe(0);expect(skipped.manifest.artifacts).toEqual([]);
   const removed=await f.run('removed',{tests:tests.replace("{id:'non-owner',negative:true,input:{userId:'bob',order:{id:'order-1',ownerId:'alice',total:120}},expected:null},",'')});expect(removed.manifest.exitCode===0?removed.claims.every((c:any)=>c.payload.status!=='pass'):removed.manifest.artifacts.length===0).toBe(true);
   const crashed=await f.run('crash',{tests:tests.replace('({input})=>readOrder(input.userId,input.order)',"({input})=>{const actual=readOrder(input.userId,input.order);if(actual&&'__behavproof_fault' in actual)throw Error('callback crash');return actual}")});
   expect(crashed.manifest.exitCode).toBe(0);expect(crashed.claims.filter((c:any)=>c.kind==='canary').every((c:any)=>c.payload.status!=='pass')).toBe(true);
   expect(crashed.diagnostics.canary.report.contracts.every((row:any)=>row.status==='unknown'&&row.comparisonCount===0)).toBe(true);
   const hook=await f.run('hook',{tests:tests.replace('({input})=>readOrder(input.userId,input.order)','({input,expected})=>{readOrder(input.userId,input.order);return expected}')+`\nafterEach(()=>{if(process.env.HOME.includes('/canary/'))throw Error('unrelated canary hook crash')});`});
   expect(hook.manifest.exitCode).toBe(0);expect(hook.claims.filter((c:any)=>c.kind==='canary').every((c:any)=>c.payload.status!=='pass')).toBe(true);
  }finally{await f.close()}
 },60000);
}
it('Jest instrumentation imports the selected observer and rejects source or target mismatches',()=>{
 const input={source,targetRef,expectedSourceHash:hashBytes(Buffer.from(source)),faultValue:{fault:'host'},runner:'jest' as const};
 const result=instrumentFunction(input);expect(result.status).toBe('supported');if(result.status!=='supported')return;
 expect(result.observedSource).toContain('@behavproof/jest/probe');expect(result.observedSource).not.toContain('@behavproof/vitest/probe');
 expect(instrumentFunction({...input,expectedSourceHash:'0'.repeat(64)}).status).toBe('unknown');expect(instrumentFunction({...input,targetRef:'src/orders.ts#absent'}).status).toBe('unknown');
});
it('the actual protected Jest worker rejects selected source hash and unsupported target',async()=>{
 const f=await fixture('jest');try{for(const [id,options] of [['hash',{expectedSourceHash:'0'.repeat(64)}],['unsupported',{targetRef:'src/orders.ts#absent'}]] as const){const r=await f.run(id,options);expect(r.manifest.exitCode).not.toBe(0);expect(r.manifest.artifacts).toEqual([])}}finally{await f.close()}
},60000);
