import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import{spawnSync}from'node:child_process';
import {buildAssuranceMap,renderAssuranceMap,discoverSources,snapshot}from'../../packages/contract-registry/src/index.js';
import {hash}from'../../packages/core/src/index.js';
let root:string;
const binary=resolve('packages/cli/dist/index.js');
const cli=(...args:string[])=>spawnSync(process.execPath,[binary,...args],{cwd:root,encoding:'utf8',timeout:10000});
const git=(...args:string[])=>{const r=spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
let declaration:any,cfg:any;
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'assurance-cli-'));await mkdir(join(root,'src'));
 declaration={id:'DOUBLE',intent:'doubles input',risk:'basic',cases:[{id:'one',input:1,expected:2}],assurance:{feature:{id:'double',entrypoints:['double']},checks:[{id:'result',method:'example',targetRef:'src/double.mjs#run',cases:[{id:'one',input:1,expected:2}]}],conditions:[{id:'correct',kind:'postcondition',statement:'double',checks:['result'],requiredFaults:[]}]}};
 cfg={schemaVersion:1,profile:'basic',git:{base:'HEAD'},contracts:{enabled:true,sources:[{type:'manifest',include:['contract.json']}]},assurance:{driver:'driver.mjs',driverSources:['driver.mjs'],implementationSources:['src/double.mjs'],report:'.behavproof/assurance.json',timeoutMs:3000}};
 for(const [path,body]of Object.entries({'package.json':JSON.stringify({name:'consumer',type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}),'.gitignore':'.behavproof/\n','contract.json':JSON.stringify(declaration),'behavproof.config.json':JSON.stringify(cfg),'src/double.mjs':'export function run(input){return input*2;}','driver.mjs':'export function createContext(){return {};}' }))await writeFile(join(root,path),body);
 git('init','-q','-b','main');git('add','.');git('commit','-qm','baseline');
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('runs consumer exports explicitly, writes a source/commit-bound bundle and maps raw results as unknown',async()=>{
 const r=cli('assurance','run');expect(r.status,r.stderr+r.stdout).toBe(0);
 const bundle=JSON.parse(await readFile(join(root,'.behavproof/assurance.json'),'utf8'));
 expect(bundle.reports[0]).toMatchObject({contractId:'DOUBLE',subject:{testedCommitSha:git('rev-parse','HEAD')}});
 expect(bundle.reports[0].checks[0].samples[0].actual).toBe(2);
 const map=cli('assurance','map','--format','json');expect(map.status,map.stderr).toBe(0);expect(map.stdout).toContain('unknown');
});
it('never executes the configured driver during check, discovery or map',async()=>{
 await writeFile(join(root,'driver.mjs'),"import{writeFileSync}from'node:fs';writeFileSync('executed.txt','BAD');throw Error('driver executed');");git('add','.');git('commit','-qm','sentinel');
 for(const args of [['contracts','discover'],['assurance','discover'],['assurance','map','--format','json'],['check','--mode','audit','--format','json']]){const r=cli(...args);expect(r.status,r.stderr).toBe(0);}
 await expect(readFile(join(root,'executed.txt'))).rejects.toThrow();
});
it('does not replace the prior managed report after a worker exits before producing a new bundle',async()=>{
 expect(cli('assurance','run').status).toBe(0);const old=await readFile(join(root,'.behavproof/assurance.json'));
 await writeFile(join(root,'driver.mjs'),'process.exit(0);');const r=cli('assurance','run');expect(r.status,r.stderr).toBe(2);expect(await readFile(join(root,'.behavproof/assurance.json'))).toEqual(old);
});
it('rejects source-overlapping/unmanaged outputs and applies bounded worker timeout',async()=>{
 cfg.assurance.report='driver.mjs';await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));expect(cli('assurance','run').status).toBe(2);
 cfg.assurance.report='.behavproof/assurance.json';cfg.assurance.timeoutMs=100;await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'driver.mjs'),'await new Promise(()=>{});');
 const r=cli('assurance','run');expect(r.status,r.stderr).toBe(2);await expect(readFile(join(root,'.behavproof/assurance.json'))).rejects.toThrow();
});
it('adds mandatory unknown conditions to an unauthenticated audit without promoting local data',async()=>{
 expect(cli('assurance','run').status).toBe(0);const r=cli('check','--mode','audit','--format','json');expect(r.status,r.stderr).toBe(0);const report=JSON.parse(r.stdout);
 expect(report.evaluations.some((e:any)=>e.ruleId==='assuranceCondition'&&e.severity==='error'&&e.status==='unknown')).toBe(true);
 expect(report.assuranceMap).toBeDefined();
});

const declarationContent=()=>cfg.contracts.sources[0].type==='vitest-inline'?`import {defineContract} from '@behavproof/vitest';\nconst declaration=defineContract(${JSON.stringify(declaration)});`:JSON.stringify(declaration);
async function observedEvaluation(trustedSources:Record<string,string>|undefined,options:{protectedConfig?:any;sourceRef?:string}={}){
 const {assuranceEvaluations}=await import('../../packages/cli/src/assurance-evaluation.js');const {parseConfig}=await import('../../packages/core/src/index.js');const {fileList}=await import('../../packages/cli/src/project.js');
 const current=snapshot(discoverSources([{kind:cfg.contracts.sources[0].type,ref:cfg.contracts.sources[0].include[0],content:declarationContent()}]),git('rev-parse','HEAD'),cfg.contracts.sources[0].include);
 if(options.sourceRef)current.contracts[0]!.sourceRef=options.sourceRef;
 const ref=cfg.assurance.report,bundle=JSON.parse(await readFile(join(root,ref),'utf8'));
 return assuranceEvaluations({root,config:parseConfig(cfg),configRef:'behavproof.config.json',head:current,obligations:current,changes:[],approvals:[],intentStatus:new Map(current.intents.map(i=>[i.id,'pass'])),files:await fileList(root),inputs:Object.keys(bundle.reports[0].inputHashes),trusted:p=>p===ref,readJson:async p=>JSON.parse(await readFile(join(root,p),'utf8')),readBytes:p=>readFile(join(root,p)),trust:{config:parseConfig(options.protectedConfig??cfg),baseline:current,assuranceSources:trustedSources,manifests:[{expected:{artifacts:[{ref,kind:'assurance_report',scope:['DOUBLE']}]}}]}} as any);
}
it('requires independently pinned criterion sources, not merely fresh reports after oracle/driver changes',async()=>{
 expect(cli('assurance','run').status).toBe(0);let bundle=JSON.parse(await readFile(join(root,cfg.assurance.report),'utf8'));const pinned=bundle.reports[0].inputHashes;
 expect((await observedEvaluation(pinned)).results[0]?.evaluation.status).toBe('pass');
 await writeFile(join(root,'driver.mjs'),'export function createContext(){return {dependencies:{changed:true}};}');git('add','.');git('commit','-qm','change observation criteria');
 expect(cli('assurance','run').status).toBe(0);
 expect((await observedEvaluation(pinned)).results[0]?.evaluation.status).toBe('unknown');
 expect((await observedEvaluation(undefined)).results[0]?.evaluation.status).toBe('unknown');
});
it('allows a fresh passing production-only refactor under unchanged pinned criteria',async()=>{
 expect(cli('assurance','run').status).toBe(0);const bundle=JSON.parse(await readFile(join(root,cfg.assurance.report),'utf8')),pinned=bundle.reports[0].inputHashes;
 await writeFile(join(root,'src/double.mjs'),'export function run(input){return 2*input;}');git('add','.');git('commit','-qm','behavior preserving refactor');expect(cli('assurance','run').status).toBe(0);
 expect((await observedEvaluation(pinned)).results[0]?.evaluation.status).toBe('pass');
});
it('rejects output/authentication flags that could overwrite evidence or imply gate authority during execution',()=>{
 for(const args of [['--output',cfg.assurance.report],['--trust-root','outside.json'],['--mode','gate']])expect(cli('assurance','run',...args).status).toBe(2);
});
it('requires fault coverage for every adopted critical condition check',async()=>{
 expect(cli('assurance','run').status).toBe(0);const bundle=JSON.parse(await readFile(join(root,cfg.assurance.report),'utf8'));
 cfg.profile='critical';const evaluated=await observedEvaluation(bundle.reports[0].inputHashes);
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceSensitivityRequirements')).toMatchObject({severity:'error',status:'unknown'});
});

async function collectCurrent(){
 await writeFile(join(root,cfg.contracts.sources[0].include[0]),declarationContent());
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));
 git('add','.');git('commit','--allow-empty','-qm','assurance review fixture');
 const executed=cli('assurance','run');expect(executed.status,executed.stderr+executed.stdout).toBe(0);
 return JSON.parse(await readFile(join(root,cfg.assurance.report),'utf8')).reports[0].inputHashes as Record<string,string>;
}
const addFault=(checkId:string)=>({id:`triple-${checkId}`,kind:'result',checkId,implementation:'src/triple.mjs',detects:[{kind:'result',id:'one'}]});
it.each([
 ['normalized path',{kind:'path',value:'contract.json'},false,'contract.json'],
 ['module',{kind:'module',value:'src/contract'},false,'src/contract.ts'],
 ['protected-only normalized path',{kind:'path',value:'contract.json'},true,'contract.json'],
] as const)('requires mandatory faults for a critical %s selector',async(_name,selector,protectedOnly,sourceRef)=>{
 cfg.contracts.sources[0].include=[sourceRef];
 if(sourceRef.endsWith('.ts'))cfg.contracts.sources[0].type='vitest-inline';
 const override={selector,profile:'critical'};
 if(!protectedOnly)cfg.riskOverrides=[override];
 const pinned=await collectCurrent(),protectedConfig=structuredClone(cfg);
 if(protectedOnly)protectedConfig.riskOverrides=[override];
 const evaluated=await observedEvaluation(pinned,{protectedConfig,sourceRef:`${sourceRef}:12:3`});
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceSensitivityRequirements')).toMatchObject({severity:'error',status:'unknown'});
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceCondition')).toMatchObject({severity:'error',status:'unknown'});
 expect(evaluated.results[0]!.evaluation.checks[0]).toMatchObject({checkId:'result',status:'unknown'});
 expect(evaluated.results[0]!.evaluation.conditions[0]).toMatchObject({conditionId:'correct',status:'unknown'});
});
it('propagates missing critical faults into checked map results while preserving unrelated satisfied conditions',async()=>{
 cfg.profile='critical';
 declaration.assurance.checks.push({...structuredClone(declaration.assurance.checks[0]),id:'covered'});
 declaration.assurance.conditions.push({id:'covered-condition',kind:'postcondition',statement:'covered doubling',checks:['covered'],requiredFaults:[addFault('covered')]});
 await writeFile(join(root,'src/triple.mjs'),'export function run(input){return input*3;}');
 const evaluated=await observedEvaluation(await collectCurrent()),result=evaluated.results[0]!.evaluation;
 expect(result.status).toBe('unknown');
 expect(result.checks.find(c=>c.checkId==='result')).toMatchObject({status:'unknown',reasons:[expect.stringMatching(/critical.*fault.*correct.*result/i)]});
 expect(result.conditions.find(c=>c.conditionId==='correct')).toMatchObject({status:'unknown',reasons:[expect.stringMatching(/critical.*fault.*correct.*result/i)]});
 expect(result.conditions.find(c=>c.conditionId==='covered-condition')?.status).toBe('pass');
 const map=buildAssuranceMap(evaluated.contracts,evaluated.results,r=>evaluated.results.includes(r)),rendered=renderAssuranceMap(map),json=JSON.parse(rendered.json);
 expect(json.contracts[0]).toMatchObject({status:'unknown',evidenceRefs:[cfg.assurance.report]});
 expect(json.contracts[0].checks.find((c:any)=>c.checkId==='result')).toMatchObject({status:'unknown',comparisons:1});
 expect(json.contracts[0].conditions.find((c:any)=>c.conditionId==='correct').status).toBe('unknown');
 expect(json.contracts[0].conditions.find((c:any)=>c.conditionId==='covered-condition').status).toBe('pass');
 expect(rendered.html).toContain('Condition correct (postcondition): unknown');
 expect(rendered.html).toContain('Condition covered-condition (postcondition): pass');
 expect(rendered.html).toMatch(/Critical.*fault.*correct.*result/);
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceCondition'&&e.scope.includes('correct'))).toMatchObject({status:'unknown',message:expect.stringMatching(/critical.*fault/i)});
});
it('keeps a critical condition with a declared and detected fault passing in the gate and rendered map',async()=>{
 cfg.riskOverrides=[{selector:{kind:'path',value:'contract.json'},profile:'critical'}];
 declaration.assurance.conditions[0].requiredFaults=[addFault('result')];
 await writeFile(join(root,'src/triple.mjs'),'export function run(input){return input*3;}');
 const evaluated=await observedEvaluation(await collectCurrent(),{sourceRef:'contract.json:1'});
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceSensitivityRequirements')).toMatchObject({severity:'error',status:'pass'});
 expect(evaluated.evaluations.find(e=>e.ruleId==='assuranceCondition')).toMatchObject({severity:'error',status:'pass'});
 expect(evaluated.results[0]!.evaluation.status).toBe('pass');
 const rendered=renderAssuranceMap(buildAssuranceMap(evaluated.contracts,evaluated.results,r=>evaluated.results.includes(r)));
 expect(JSON.parse(rendered.json).contracts[0].conditions[0]).toMatchObject({status:'pass',faults:[{id:'triple-result',status:'pass'}]});
 expect(rendered.html).toContain('Condition correct (postcondition): pass');
});
