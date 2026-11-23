import {gitSubject} from '../../packages/adapter-reports/src/index.js';
import {localNativeAuthority,runner} from '../fixtures/native-vitest.js';
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const scratch:string[]=[];
afterEach(async()=>{await Promise.all(scratch.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(profile='basic',rules:Record<string,{severity:string}>={testResult:{severity:'off'},changeImpact:{severity:'error'}}){
 const root=await mkdtemp(join(tmpdir(),'behavproof-impact-')),host=await mkdtemp(join(tmpdir(),'behavproof-impact-host-'));scratch.push(root,host);
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Impact fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 await writeFile(join(root,'package.json'),JSON.stringify({name:'impact-fixture',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
 await mkdir(join(root,'src'));await writeFile(join(root,'src/auth.ts'),'export function authorize(){return true;}\n');
 const config={schemaVersion:2,profile,rules,reports:{vitest:'.behavproof/vitest.json'}};await writeFile(join(root,'behavproof.config.json'),JSON.stringify(config));git('init','-q','-b','main');git('add','.');git('commit','-qm','baseline');const base=git('rev-parse','HEAD');
 const trustPath=join(host,'root.json');await writeFile(trustPath,JSON.stringify({schemaVersion:2,policy:{schemaVersion:1,profileVersion:'2',rules},config,sourceCommit:base,specifications:[],runner:{...runner,manifestRef:'.behavproof/manifest.json'},inputs:['package.json','behavproof.config.json','src/**/*.ts'],configPaths:[],manifests:[]}));
 const change=async(source:string)=>{await writeFile(join(root,'src/auth.ts'),source);git('add','.');git('commit','-qm','change');};
 const check=async(selectedBase=base)=>{
  const trust=JSON.parse(await readFile(trustPath,'utf8'));
  const paths=git('ls-files').split('\n').filter(path=>path==='package.json'||path==='behavproof.config.json'||path.startsWith('src/')||path.endsWith('.qnt'));
  const subject=await gitSubject(root,paths,git('rev-parse','HEAD'),selectedBase);
  const authority=await localNativeAuthority(root,subject);
  await writeFile(trustPath,JSON.stringify({...trust,runner:authority.runner,manifests:authority.manifests}));
  const result=spawnSync(process.execPath,[resolve('packages/cli/dist/index.js'),'check','--mode','gate','--base',selectedBase,'--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8'});expect(result.stderr).toBe('');return {exit:result.status,report:JSON.parse(result.stdout)};};
 return {root,trustPath,change,check,git};
}
test('a configured impact gate passes a resolved change and blocks an unresolved production call',async()=>{
 const f=await fixture();await f.change('export function authorize(){return false;}\n');const known=await f.check();expect(known.exit,JSON.stringify(known.report)).toBe(0);expect(known.report.impact.affectedFiles).toContain('src/auth.ts');
 await f.change('export function authorize(){return globalThis.handler();}\n');const unknown=await f.check();expect(unknown.exit).toBe(1);expect(unknown.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:'error',status:'unknown'}));expect(unknown.report.impact.unknown.join(' ')).toContain('src/auth.ts');
});
test('unresolved impact is mandatory for critical risk and remains a warning for standard risk',async()=>{
 for(const profile of ['standard','critical']){const f=await fixture(profile,{});await f.change('export function authorize(){return globalThis.handler();}\n');const result=await f.check();expect(result.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:profile==='critical'?'error':'warn',status:'unknown',remediation:expect.any(String)}));}
});
test('a protected critical path cannot lower unresolved impact to off',async()=>{
 const f=await fixture('basic',{testResult:{severity:'off'},changeImpact:{severity:'off'}});
 // The protected profile remains critical independently of candidate rules.
 const {readFile}=await import('node:fs/promises');const trust=JSON.parse(await readFile(f.trustPath,'utf8'));trust.config.riskOverrides=[{selector:{kind:'path',value:'src/auth.ts'},profile:'critical'}];await writeFile(f.trustPath,JSON.stringify(trust));
 await f.change('export function authorize(){return globalThis.handler();}\n');const result=await f.check();expect(result.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:'error',status:'unknown',scope:['path','src/auth.ts']}));
});
test('impact candidates retain the specification mapping to a production target',async()=>{
 const f=await fixture();
 await writeFile(join(f.root,'order.qnt'),'module order { val safe = true }');
 const config=JSON.parse(await readFile(join(f.root,'behavproof.config.json'),'utf8'));
 config.formal={models:[{id:'ORDER',model:'order.qnt',module:'order',invariants:['safe'],implementation:'src/auth.ts',
  checks:['parse','typecheck','run'],maxSteps:1,seed:'42',report:'.behavproof/model.json',
  quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'}}]};
 await writeFile(join(f.root,'behavproof.config.json'),JSON.stringify(config));
 const trust=JSON.parse(await readFile(f.trustPath,'utf8'));trust.inputs.push('order.qnt');await writeFile(f.trustPath,JSON.stringify(trust));
 f.git('add','order.qnt','behavproof.config.json');f.git('commit','-qm','configure model and production mapping');
 const base=f.git('rev-parse','HEAD');await f.change('export function authorize(){return false;}');
 expect((await f.check(base)).report.impact.modelIds).toContain('ORDER');
});
test('a host-bound policy origin and normalized authority snapshots remain in the report',async()=>{
 const f=await fixture(),{readFile}=await import('node:fs/promises'),{hash}=await import('../../packages/core/src/index.js');const trust=JSON.parse(await readFile(f.trustPath,'utf8')),source={repository:'acme/shop',commitSha:f.git('rev-parse','HEAD'),ref:'policy.json',fileHash:'a'.repeat(64),policyHash:hash(trust.policy)};trust.policySource=source;await writeFile(f.trustPath,JSON.stringify(trust));await f.change('export function authorize(){return false;}');const result=await f.check();expect(result.exit).toBe(0);expect(result.report.policySource).toEqual(source);expect(result.report.protectedPolicySha).toBe(source.commitSha);expect(result.report.authoritySnapshots.trustRootHash).toMatch(/^[a-f0-9]{64}$/);expect(result.report.authoritySnapshots.approvals).toEqual([]);
 trust.policySource.policyHash='b'.repeat(64);await writeFile(f.trustPath,JSON.stringify(trust));const invalid=spawnSync(process.execPath,[resolve('packages/cli/dist/index.js'),'check','--mode','gate','--trust-root',f.trustPath,'--format','json'],{cwd:f.root,encoding:'utf8'});expect(invalid.status).toBe(2);expect(invalid.stderr).toContain('policy');
});
