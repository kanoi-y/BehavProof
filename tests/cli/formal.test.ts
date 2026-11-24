import {beforeEach,afterEach,it,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm,readdir}from'node:fs/promises';
import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{spawnSync}from'node:child_process';
import{hash,hashBytes,parseConfig}from'../../packages/core/src/index.js';
import{captureTestEvidence,gitSubject}from'../../packages/adapter-reports/src/index.js';

const binary=resolve('packages/cli/dist/index.js');let root:string,host:string,cfg:any,specifications:any,sourceCommit:string,inputs:string[];
const run=(args:string[])=>spawnSync(process.execPath,[binary,...args],{cwd:root,encoding:'utf8',timeout:15000});
const git=(...args:string[])=>spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'});
const commit=()=>{git('add','.');const r=git('commit','-qm','test inputs');if(r.status!==0&&!r.stdout.includes('nothing to commit'))throw Error(r.stderr+r.stdout);};
const head=()=>git('rev-parse','HEAD').stdout.trim();
const model=()=>({id:'ORDER',module:'order',model:'specs/order.qnt',quint:{entry:'tools/quint.mjs',version:'0.33.1',apalacheVersion:'0.62.4'},invariants:['refundAtMostOnce'],checks:['parse','typecheck','test','run','verify'],maxSteps:8,maxSamples:20,seed:'42',timeoutMs:2000,report:'.behavproof/model.json',traceReceipt:'.behavproof/trace-receipt.json',traceDirectory:'.behavproof/traces',driver:'driver.mjs',implementation:'src/order.mjs',conformanceReport:'.behavproof/conformance.json',replayScope:{observedFields:['paid','shipped','cancelled','refunds'],rationale:'The complete order history determines the observed fields.'},requiredActions:['Pay','Refund','Cancel'],minTraces:1,minComparisons:4,requireCanary:true,canary:{faultId:'double-refund',implementation:'src/order-fault.mjs',targetRef:'src/order.mjs#cancel'}});
const rawTrace={vars:['paid','shipped','cancelled','refunds','mbt::actionTaken','mbt::nondetPicks'],'#meta':{format:'ITF',status:'ok'},states:[['init',false,'0',false],['Pay',true,'0',false],['Refund',true,'1',false],['Cancel',true,'1',true]].map(([action,paid,refunds,cancelled],index)=>({'#meta':{index},'mbt::actionTaken':action,'mbt::nondetPicks':{},paid,shipped:false,cancelled,refunds:{'#bigint':refunds}}))};
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'behavproof-formal-cli-'));host=await mkdtemp(join(tmpdir(),'behavproof-formal-host-'));
 for(const dir of ['specs','src','tools','.behavproof/traces'])await mkdir(join(root,dir),{recursive:true});
 await writeFile(join(root,'package.json'),JSON.stringify({name:'formal-cli-fixture',type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
 await writeFile(join(root,'.gitignore'),'.behavproof/\n');
 for(const path of ['specs/order.qnt','driver.mjs','src/order.mjs','src/order-fault.mjs'])await writeFile(join(root,path),await readFile(resolve('examples/formal-order',path)));
 // Process-boundary fixture only. Actual Quint/backend compatibility is run in
 // the opt-in formal flow; this fixture keeps default tests dependency-free.
 const definitions=['init','step','Pay','Refund','Cancel','refundAtMostOnce'].map((name,id)=>({
  id,name,kind:'def',qualifier:id<5?'action':'val',expr:{id:99,kind:'bool',value:true},
 }));
 const types=Object.fromEntries(definitions.map(({id})=>[id,{type:{kind:'bool'}}]));
 const effects=Object.fromEntries(definitions.map(({id})=>[id,{effect:{kind:'concrete',components:[{kind:id<5?'update':'read'}]}}]));
 const reports={parse:{stage:'parsing',modules:[{name:'order'}],errors:[]},typecheck:{stage:'typechecking',modules:[{name:'order',declarations:definitions}],types,effects,errors:[]},test:{stage:'testing',passed:['refundTest'],failed:[],ignored:[],errors:[]},run:{stage:'running',status:'ok',seed:42,trace:[{}],errors:[]},verify:{stage:'verifying',status:'ok',errors:[]}};
 await writeFile(join(root,'tools/quint.mjs'),`import{writeFileSync,mkdirSync}from'node:fs';import{dirname}from'node:path';if(process.argv.includes('--version'))console.log('0.33.1');else{const stage=process.argv[2],out=process.argv[process.argv.indexOf('--out')+1];writeFileSync(out,JSON.stringify(${JSON.stringify(reports)}[stage]));if(stage==='run'){const path=process.argv[process.argv.indexOf('--out-itf')+1].replace('{seq}','0');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,${JSON.stringify(JSON.stringify(rawTrace))});}}`);
 cfg={schemaVersion:2,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/vitest.json'},executionManifests:['.behavproof/manifest.json'],formal:{models:[model()]},rules:{formalSyntax:{severity:'error'},formalTypecheck:{severity:'error'},formalModel:{severity:'error'},implementationConformance:{severity:'error'},formalBinding:{severity:'error'},policyProtection:{severity:'error'}}};
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));git('init','-q','-b','main');commit();
 sourceCommit=head();
 const discovered=run(['formal','discover','--model','ORDER']);
 expect(discovered.status,discovered.stderr+discovered.stdout).toBe(0);
 specifications=[{id:'ORDER',revisionHash:JSON.parse(discovered.stdout).models[0].revisionHash}];
 inputs=['package.json','behavproof.config.json','specs/order.qnt','driver.mjs','src/order.mjs','src/order-fault.mjs','tools/quint.mjs'];
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});await rm(host,{recursive:true,force:true});});
async function prepareReports(){
 for(const command of ['check','replay']){const r=run(['formal',command,'--model','specs/order.qnt','--format','json']);expect(r.status,r.stderr+r.stdout).toBe(0);}
}
async function seal(excludeModel=false){
 const test={numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'test.mjs',status:'passed',assertionResults:[{title:'order',fullName:'order',status:'passed',ancestorTitles:[]}]}]};
 const runner={kind:'vitest',version:'5.1.0'} as const, native=Buffer.from(JSON.stringify(test));
 const receipt=captureTestEvidence(native,{complete:true,suiteCount:1,testCount:1,files:['test.mjs'],suiteIds:['suite'],testIds:['test']},
  {invocation:'current-formal',runner});
 await writeFile(join(root,'.behavproof/vitest.json'),native);
 await writeFile(join(root,'.behavproof/vitest.receipt.json'),JSON.stringify(receipt));
 const refs=[...(!excludeModel?[{ref:'.behavproof/model.json',kind:'formal_model'}]:[]),{ref:'.behavproof/conformance.json',kind:'model_conformance'},{ref:'.behavproof/trace-receipt.json',kind:'formal_trace'},{ref:'.behavproof/traces/trace_0.itf.json',kind:'trace'},{ref:'.behavproof/vitest.json',kind:'test'},{ref:'.behavproof/vitest.receipt.json',kind:'test_receipt'}].map(x=>({...x,scope:['ORDER']}));
 const artifacts=[];for(const a of refs)artifacts.push({...a,sha256:hashBytes(await readFile(join(root,a.ref)))});
 const commandHash=hash({command:'explicit protocol-test host'}),producer={tool:'formal-protocol-test',version:'1',collectorVersion:'0.1.0'},configHashes={'behavproof.config.json':hashBytes(await readFile(join(root,'behavproof.config.json')))};
 const subject=await gitSubject(root,inputs,head(),head()),expected={executionId:'current-formal',subject,commandHash,configHashes,artifacts:refs};
 const manifest={schemaVersion:1,...expected,producer,artifacts,environment:{nodeVersion:process.version,platform:process.platform},startedAt:'2026-11-15T00:00:00Z',completedAt:'2026-11-15T00:00:01Z',exitCode:0};await writeFile(join(root,'.behavproof/manifest.json'),JSON.stringify(manifest));
 const parsed=parseConfig(cfg),trust={schemaVersion:2,policy:{schemaVersion:1,profileVersion:'2',rules:parsed.rules},config:cfg,sourceCommit,specifications,runner:{...runner,manifestRef:'.behavproof/manifest.json'},inputs,configPaths:['behavproof.config.json'],manifests:[{ref:'.behavproof/manifest.json',manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:'current-formal',commandHash}}]};
 await writeFile(join(host,'trust.json'),JSON.stringify(trust));
}
const gate=(format='json')=>run(['check','--mode','gate','--base','HEAD','--trust-root',join(host,'trust.json'),'--format',format]);
it('discovers typechecked models without loading a Driver or writing artifacts',async()=>{
 const before=await readdir(join(root,'.behavproof'));const r=run(['formal','discover','--format','json']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout).models[0]).toMatchObject({id:'ORDER',model:'specs/order.qnt'});expect(await readdir(join(root,'.behavproof'))).toEqual(before);
});
it('runs explicit formal commands, then gates authenticated independent reports with scoped bounds',async()=>{
 await prepareReports();await seal();const r=gate();expect(r.status,r.stderr+r.stdout).toBe(0);const report=JSON.parse(r.stdout);
 expect(report.formal.models[0]).toMatchObject({modelId:'ORDER',model:{status:'pass'},conformance:{status:'pass',counts:{replayedTraces:1,comparedSteps:4,implementationCalls:4}},binding:{status:'pass'}});
 expect(report.assurance.model_conformance_observed).toBe('pass');
 for(const format of ['console','markdown']){const r=gate(format);expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('bounded_model_check');expect(r.stdout).toContain('maxSteps=8');expect(r.stdout).toContain('unbounded=false');}
});
it('does not substitute model success for missing conformance, or require a model-property report to recognize authenticated replay',async()=>{
 await prepareReports();await seal();await rm(join(root,'.behavproof/conformance.json'));expect(gate().status).toBe(1);
 await prepareReports();await seal(true);await rm(join(root,'.behavproof/model.json'));const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);const report=JSON.parse(r.stdout);expect(report.formal.models[0].model.status).toBe('unknown');expect(report.formal.models[0].conformance.status).toBe('pass');
});
it.each(['specs/order.qnt','driver.mjs','src/order.mjs'])('blocks cached formal evidence after %s changes even when a current producer reseals the old reports',async path=>{
 await prepareReports();await writeFile(join(root,path),(await readFile(join(root,path),'utf8'))+'\n// changed after collection\n');commit();await seal();const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);const value=JSON.parse(r.stdout);expect(value.formal.models[0].conformance.status).toBe('unknown');
});
it('retains protected formal obligations when the candidate removes or weakens adopted models',async()=>{
 await prepareReports();const changed=structuredClone(cfg);delete changed.formal;await writeFile(join(root,'behavproof.config.json'),JSON.stringify(changed));commit();await seal();const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);const report=JSON.parse(r.stdout);expect(report.formal.models).toHaveLength(1);expect(report.evaluations.find((e:any)=>e.ruleId==='policyProtection').status).toBe('fail');
});
it('rejects a changed model-to-implementation mapping without an independent approval',async()=>{
 await prepareReports();const changed=structuredClone(cfg);changed.formal.models[0].replayScope.rationale='A different observation decision';
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(changed));commit();await seal();
 const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);expect(JSON.parse(r.stdout).formal.models[0].binding.status).toBe('fail');
});
it('never reports a cached replay as a new success when the Driver exits before producing a report',async()=>{
 await prepareReports();const previous=await readFile(join(root,'.behavproof/conformance.json'));
 await writeFile(join(root,'driver.mjs'),(await readFile(join(root,'driver.mjs'),'utf8'))+'\nprocess.exit(0);\n');
 const r=run(['formal','replay','--model','ORDER']);expect(r.status,r.stderr+r.stdout).toBe(2);
 expect(await readFile(join(root,'.behavproof/conformance.json'))).toEqual(previous);
});
it.each(['bounds','checks','trace','canary','zero','unreached'])('rejects weakened or stale %s formal evidence',async change=>{
 await prepareReports();
 if(change==='bounds'||change==='checks'){
  const changed=structuredClone(cfg);if(change==='bounds')changed.formal.models[0].maxSteps=1;else changed.formal.models[0].checks=['parse','typecheck','run'];
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify(changed));commit();
 }else if(change==='trace')await writeFile(join(root,'.behavproof/traces/trace_0.itf.json'),JSON.stringify({...rawTrace,states:rawTrace.states.slice(0,1)}));
 else if(change==='canary')await writeFile(join(root,'src/order-fault.mjs'),(await readFile(join(root,'src/order-fault.mjs'),'utf8'))+'\n// fault changed\n');
 else {const ref=join(root,'.behavproof/conformance.json'),r=JSON.parse(await readFile(ref,'utf8'));if(change==='zero')r.traces=[];else for(const t of r.traces)for(const s of t.steps)if(s.action==='Cancel')s.action='Wait';await writeFile(ref,JSON.stringify(r));}
 await seal();const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);const report=JSON.parse(r.stdout);
 if(change==='bounds'||change==='checks')expect(report.evaluations.find((e:any)=>e.ruleId==='policyProtection').status).toBe('fail');
 else expect(report.formal.models[0].conformance.status).not.toBe('pass');
});
it('does not give stale syntax/typechecking evidence a pass after model inputs change',async()=>{
 await prepareReports();await writeFile(join(root,'specs/order.qnt'),(await readFile(join(root,'specs/order.qnt'),'utf8'))+'\n// changed\n');commit();await seal();
 const report=JSON.parse(gate().stdout);for(const id of ['formalSyntax','formalTypecheck'])expect(report.evaluations.filter((e:any)=>e.ruleId===id).every((e:any)=>e.status!=='pass')).toBe(true);
});
it('runs a model-only configuration with root-level report and default trace locations',async()=>{
 const changed=structuredClone(cfg),m=changed.formal.models[0];for(const key of ['driver','implementation','canary','conformanceReport','traceReceipt','traceDirectory'])delete m[key];m.requireCanary=false;m.report='model.json';m.checks=['parse','typecheck','test','run'];
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(changed));const r=run(['formal','check','--model','ORDER']);expect(r.status,r.stderr+r.stdout).toBe(0);expect(JSON.parse(r.stdout).models[0].stages.every((s:any)=>s.status==='pass')).toBe(true);
 const receipt=JSON.parse(await readFile(join(root,'model.json.traces.json'),'utf8'));expect(receipt.traces).toHaveLength(1);expect(receipt.traces[0].ref).not.toMatch(/^\.\//);expect(await readFile(join(root,receipt.traces[0].ref),'utf8')).toContain('mbt::actionTaken');
});
it('supports explicit replay with a canary-disabled configuration',async()=>{
 const changed=structuredClone(cfg),m=changed.formal.models[0];delete m.canary;m.requireCanary=false;m.checks=['parse','typecheck','test','run'];await writeFile(join(root,'behavproof.config.json'),JSON.stringify(changed));await prepareReports();
 const report=JSON.parse(await readFile(join(root,'.behavproof/conformance.json'),'utf8'));expect(report.complete).toBe(true);expect(report.canary).toBeUndefined();
});
it('rejects a resealed replay suffix omission even when every action and minimum count remains',async()=>{
 const extended=structuredClone(rawTrace);extended.states.push({...structuredClone(extended.states.at(-1)!),'#meta':{index:4},'mbt::actionTaken':'Wait'});
 const tool=join(root,'tools/quint.mjs');await writeFile(tool,(await readFile(tool,'utf8')).replace(JSON.stringify(JSON.stringify(rawTrace)),JSON.stringify(JSON.stringify(extended))));commit();
 await prepareReports();const ref=join(root,'.behavproof/conformance.json'),report=JSON.parse(await readFile(ref,'utf8'));expect(report.traces[0].steps).toHaveLength(5);report.traces[0].steps.pop();await writeFile(ref,JSON.stringify(report));await seal();const r=gate();expect(r.status,r.stderr+r.stdout).toBe(1);expect(JSON.parse(r.stdout).formal.models[0].conformance.reasons).toContain('Replay trace/step inventory does not match authenticated trace identity');
});
