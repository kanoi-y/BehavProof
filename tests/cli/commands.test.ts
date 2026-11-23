import {nativeArtifacts,runner} from '../fixtures/native-vitest.js';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir,rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const binary=resolve('packages/cli/dist/index.js');let root:string;
const run=(args:string[])=>spawnSync(process.execPath,[binary,...args],{cwd:root,encoding:'utf8'});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof CLI '));await writeFile(join(root,'package.json'),JSON.stringify({name:'test',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));spawnSync('git',['init','-q','-b','main'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','add','.'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','initial'],{cwd:root});});
afterEach(()=>rm(root,{recursive:true,force:true}));
test('init dry-run writes nothing and init is non-destructive/idempotent',async()=>{
 const dry=run(['init','--dry-run']);expect(dry.status).toBe(0);expect(dry.stdout).toContain('behavproof.config.json');
 await expect(readFile(join(root,'behavproof.config.json'))).rejects.toThrow();
 expect(run(['init']).status).toBe(0);const original=await readFile(join(root,'behavproof.config.json'),'utf8');
 expect(run(['init']).status).toBe(0);expect(await readFile(join(root,'behavproof.config.json'),'utf8')).toBe(original);
});
test('audit reports unknown evidence with exit0; gate needs an external root',()=>{
 const audit=run(['check','--base','HEAD','--format','json']);expect(audit.status).toBe(0);const report=JSON.parse(audit.stdout);expect(report.status).toBe('incomplete');expect(report.evaluations.find((x:any)=>x.ruleId==='testResult').status).toBe('unknown');
 const gate=run(['check','--mode','gate','--base','HEAD']);expect(gate.status).toBe(2);expect(gate.stderr).toContain('trust-root');
});
test('strict option, config and malformed report errors exit2',async()=>{
 expect(run(['check','--wat']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":999}');expect(run(['check']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":2,"reports":{"vitest":"bad.json"}}');await writeFile(join(root,'bad.json'),'not JSON');expect(run(['check','--base','HEAD']).status).toBe(2);
});
test('critical profile keeps native quality and change impact mandatory',()=>{
 const result=run(['check','--profile','critical','--base','HEAD','--format','json']);expect(result.status).toBe(0);const report=JSON.parse(result.stdout);expect(report.mandatoryCount).toBeGreaterThanOrEqual(6);expect(report.status).toBe('incomplete');
});
test('renders deterministic JSON/markdown/console and safely writes an output',async()=>{
 const args=['check','--base','HEAD','--format','json'];expect(run(args).stdout).toBe(run(args).stdout);
 expect(run(['check','--base','HEAD','--format','markdown']).stdout).toContain('| Rule |');
 expect(run(['check','--base','HEAD','--output','out/report.json','--format','json']).status).toBe(0);expect(JSON.parse(await readFile(join(root,'out/report.json'),'utf8')).schemaVersion).toBe(2);
 expect(run(['check','--base','HEAD','--output','../escape']).status).toBe(2);
});
test('doctor and explain disclose support and claim limits',()=>{
 expect(run(['doctor']).status).toBe(0);expect(run(['doctor']).stdout).toContain('single-package');
 expect(run(['explain','changed-line-coverage']).stdout).toContain('unknown');expect(run(['formal','check']).status).toBe(2);
 expect(run(['explain','change-impact']).stdout).toContain('dependency');
});
test('generated documents use no imported project code and detect stale content',async()=>{
 await writeFile(join(root,'source.ts'),"throw Error('must never execute');");
 expect(run(['docs','generate']).status).toBe(0);expect(run(['docs','check']).status).toBe(0);
 const path=join(root,'.behavproof/generated/behavior.md');
 expect(await readFile(path,'utf8')).toContain('Behavior specifications');
 await writeFile(path,'edited');expect(run(['docs','--check']).status).toBe(1);
});
test.each([['contracts','discover'],['contracts','list'],['contracts','validate'],['intent','diff'],['baseline','create']])('retired command %s %s is rejected',(...args)=>{
 const result=run(args);expect(result.status).toBe(2);expect(result.stderr).toContain('Unknown command');
});
test('impact finds a model through a transitive Quint source without running the model',async()=>{
 await mkdir(join(root,'specs'));
 await writeFile(join(root,'specs/order.qnt'),'module order { import limits.* from "./limits" }');
 await writeFile(join(root,'specs/limits.qnt'),'module limits { import values.* from "./values" }');
 const values=join(root,'specs/values.qnt');
 await writeFile(values,'module values { pure val limit = 1 }');
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,formal:{models:[{
  id:'ORDER',model:'specs/order.qnt',module:'order',invariants:['safe'],report:'.behavproof/model.json',
  checks:['parse','typecheck','verify'],maxSteps:8,seed:'42',
  quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'},
 }]}}));
 const git=(...args:string[])=>{
  const result=spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);
  return result.stdout.trim();
 };
 git('add','.');git('commit','-qm','register model');const base=git('rev-parse','HEAD');
 await writeFile(values,'module values { pure val limit = 2 }');git('add','.');git('commit','-qm','change dependency');
 const changed=run(['impact','--base',base]);
 expect(changed.status,changed.stderr).toBe(0);
 expect(JSON.parse(changed.stdout)).toMatchObject({status:'pass',modelIds:['ORDER']});
 const docs=run(['docs','generate']);expect(docs.status,docs.stderr).toBe(0);
 const generated=JSON.parse(await readFile(join(root,'.behavproof/generated/behavior.json'),'utf8'));
 expect(generated.specifications).toEqual([expect.objectContaining({id:'ORDER',invariants:['safe']})]);
 expect(generated.evaluations).toContainEqual(expect.objectContaining({ruleId:'formalBinding',status:'unknown'}));
 expect(run(['docs','check']).status).toBe(0);
 await rm(values);git('add','.');git('commit','-qm','delete dependency');
 const unresolved=run(['impact','--base',base]);
 expect(unresolved.status,unresolved.stderr).toBe(0);
 expect(JSON.parse(unresolved.stdout)).toMatchObject({status:'unknown',unknown:[expect.stringContaining('ORDER')]});
});
test('project-contained trust root and symlink output escape are refused',async()=>{
 await writeFile(join(root,'root.json'),'{}');expect(run(['check','--mode','gate','--trust-root','root.json','--base','HEAD']).status).toBe(2);
});
test('an explicit external local authority gates current bytes, rejects stale/tampered evidence and preserves protected thresholds',async()=>{
 const {hash,hashBytes,parseConfig}=await import('../../packages/core/src/index.js');
 const {gitSubject}=await import('../../packages/adapter-reports/src/index.js');
 const cfg={schemaVersion:2,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/input/vitest.json'}};
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'src.ts'),'export const n=1;\n');
 spawnSync('git',['add','.'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','configure'],{cwd:root});
 await mkdir(join(root,'.behavproof/input'),{recursive:true});
 const reportPath=cfg.reports.vitest,artifacts=await nativeArtifacts(root,reportPath,'run1');
 const reportBytes=await readFile(join(root,reportPath));
 const inputs=['package.json','behavproof.config.json','src.ts'];const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 const subject=await gitSubject(root,inputs,head,head),commandHash=hash({command:'trusted-runner'}),producer={tool:'vitest',version:'5.1.0',collectorVersion:'0.1.0'},configHashes={'behavproof.config.json':hashBytes(await readFile(join(root,'behavproof.config.json')))};
 const expected={executionId:'run1',subject,commandHash,configHashes,artifacts:artifacts.map(({sha256:_digest,...artifact})=>artifact)};
 const manifest={schemaVersion:1,...expected,producer,environment:{nodeVersion:process.version,platform:process.platform},startedAt:'2026-11-13T01:00:00Z',completedAt:'2026-11-13T01:00:01Z',exitCode:0,artifacts};
 const manifestPath='.behavproof/input/manifest.json';await writeFile(join(root,manifestPath),JSON.stringify(manifest));
 const control=await mkdtemp(join(tmpdir(),'behavproof-host-'));const rootFile=join(control,'trust.json');
 const trust={schemaVersion:2,policy:{schemaVersion:1,profileVersion:'2',rules:{testResult:{severity:'error'}}},config:cfg,sourceCommit:head,specifications:[],runner:{...runner,manifestRef:manifestPath},inputs,configPaths:['behavproof.config.json'],manifests:[{ref:manifestPath,manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:'run1',commandHash}}]};
 try {
  await writeFile(rootFile,JSON.stringify(trust));const args=['check','--mode','gate','--trust-root',rootFile,'--format','json'];
  const valid=run(args);expect(valid.status,valid.stderr+valid.stdout).toBe(0);expect(JSON.parse(valid.stdout).evaluations.find((e:any)=>e.ruleId==='testResult').status).toBe('pass');
  for(const format of ['console','markdown']){const text=run([...args.slice(0,-2),'--format',format]).stdout;expect(text).toContain(reportPath);expect(text).toContain(head);}
  await writeFile(join(root,reportPath),JSON.stringify({...JSON.parse(reportBytes.toString('utf8')),success:false}));expect(run(args).status).toBe(1);
  await writeFile(join(root,reportPath),reportBytes);await writeFile(join(root,manifestPath),JSON.stringify({...manifest,executionId:'old'}));expect(run(args).status).toBe(1);
  await writeFile(join(root,manifestPath),JSON.stringify(manifest));trust.policy.rules={testResult:{severity:'error'},changedLineCoverage:{severity:'error',min:95}} as any;await writeFile(rootFile,JSON.stringify(trust));
  const protectedResult=run(args);expect(protectedResult.status).toBe(1);expect(JSON.parse(protectedResult.stdout).evaluations.find((e:any)=>e.ruleId==='changedLineCoverage').severity).toBe('error');
 }finally{await rm(control,{recursive:true,force:true});}
});
test('oversized input and output symlinks are rejected before processing',async()=>{
 const {symlink}=await import('node:fs/promises');
 await writeFile(join(root,'large.json'),' '.repeat(10*1024*1024+1));
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,reports:{vitest:'large.json'}}));expect(run(['check','--base','HEAD']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":2}');
 const other=await mkdtemp(join(tmpdir(),'behavproof-output-'));try{await symlink(other,join(root,'linked'));expect(run(['check','--base','HEAD','--output','linked/report.json']).status).toBe(2);}finally{await rm(other,{recursive:true,force:true});}
});
test('normal audit violations preserve exit0 while reporting test failure',async()=>{
 const report={numTotalTests:1,numPassedTests:0,numFailedTests:1,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:0,numFailedTestSuites:1,numPendingTestSuites:0,success:false,testResults:[{name:'test.ts',status:'failed',assertionResults:[{status:'failed',ancestorTitles:[]}]}]};
 await writeFile(join(root,'failed.json'),JSON.stringify(report));await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,reports:{vitest:'failed.json'}}));
 const result=run(['check','--base','HEAD','--format','json']);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).status).toBe('fail');
});
test('risk overrides add scoped critical obligations without disabling global rules',async()=>{
 await mkdir(join(root,'src'));await writeFile(join(root,'src/auth.ts'),'export const authorize=(ok:boolean)=>ok;\n');
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,profile:'basic',riskOverrides:[{selector:{kind:'path',value:'src/auth.ts'},profile:'critical'}]}));
 const result=run(['check','--base','HEAD','--format','json']);expect(result.status,result.stderr).toBe(0);const report=JSON.parse(result.stdout);
 expect(report.evaluations.some((e:any)=>e.ruleId==='changedLineCoverage'&&e.severity==='error'&&e.scope.includes('src/auth.ts')&&e.status==='unknown')).toBe(true);
 expect(report.evaluations.some((e:any)=>e.ruleId==='testResult'&&e.scope.length===0)).toBe(true);
});
test('nested impact uses both rename paths relative to the selected project',async()=>{
 const nested=join(root,'apps/api');await mkdir(join(nested,'tests'),{recursive:true});await writeFile(join(nested,'package.json'),JSON.stringify({name:'nested',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));await writeFile(join(nested,'tests/a.ts'),'export const moved=1;');
 const git=(...args:string[])=>spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'});git('add','.');git('commit','-qm','nested baseline');const base=git('rev-parse','HEAD').stdout.trim();await rename(join(nested,'tests/a.ts'),join(nested,'tests/b.ts'));git('add','.');git('commit','-qm','move test source');
 const result=spawnSync(process.execPath,[binary,'impact','--base',base,'--head','HEAD'],{cwd:nested,encoding:'utf8'});expect(result.status,result.stderr).toBe(0);const impact=JSON.parse(result.stdout);expect(impact.affectedFiles).toEqual(['tests/a.ts','tests/b.ts']);
});
test('console and Markdown failures identify scoped targets and a concrete action',async()=>{
 await mkdir(join(root,'src'));await writeFile(join(root,'src/auth.ts'),'export function authorize(){return true;}');await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,profile:'basic',riskOverrides:[{selector:{kind:'path',value:'src/auth.ts'},profile:'critical'}]}));
 for(const format of ['console','markdown']){const result=run(['check','--base','HEAD','--format',format]);expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('src/auth.ts');expect(result.stdout).toMatch(/Action|Remediation/);}
});
