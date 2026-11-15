import {afterEach,expect,test} from 'vitest';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
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
 const config={schemaVersion:1,profile,rules};await writeFile(join(root,'behavproof.config.json'),JSON.stringify(config));git('init','-q','-b','main');git('add','.');git('commit','-qm','baseline');const base=git('rev-parse','HEAD');
 const trustPath=join(host,'root.json');await writeFile(trustPath,JSON.stringify({schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules},config,baseline:{schemaVersion:1,commitSha:base,contracts:[],intents:[],extractorVersion:'1',discoveryDiagnostics:[],scope:[]},inputs:['package.json','behavproof.config.json','src/**/*.ts'],configPaths:[],manifests:[]}));
 const change=async(source:string)=>{await writeFile(join(root,'src/auth.ts'),source);git('add','.');git('commit','-qm','change');};
 const check=(selectedBase=base)=>{const result=spawnSync(process.execPath,[resolve('packages/cli/dist/index.js'),'check','--mode','gate','--base',selectedBase,'--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8'});expect(result.stderr).toBe('');return {exit:result.status,report:JSON.parse(result.stdout)};};
 return {root,trustPath,change,check,git};
}
test('a configured impact gate passes a resolved change and blocks an unresolved production call',async()=>{
 const f=await fixture();await f.change('export function authorize(){return false;}\n');const known=f.check();expect(known.exit,JSON.stringify(known.report)).toBe(0);expect(known.report.impact.affectedFiles).toContain('src/auth.ts');
 await f.change('export function authorize(){return globalThis.handler();}\n');const unknown=f.check();expect(unknown.exit).toBe(1);expect(unknown.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:'error',status:'unknown'}));expect(unknown.report.impact.unknown.join(' ')).toContain('src/auth.ts');
});
test('unresolved impact is mandatory for critical risk and remains a warning for standard risk',async()=>{
 for(const profile of ['standard','critical']){const f=await fixture(profile,{});await f.change('export function authorize(){return globalThis.handler();}\n');const result=f.check();expect(result.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:profile==='critical'?'error':'warn',status:'unknown',remediation:expect.any(String)}));}
});
test('a protected critical path cannot lower unresolved impact to off',async()=>{
 const f=await fixture('basic',{testResult:{severity:'off'},changeImpact:{severity:'off'}});
 // The protected profile remains critical independently of candidate rules.
 const {readFile}=await import('node:fs/promises');const trust=JSON.parse(await readFile(f.trustPath,'utf8'));trust.config.riskOverrides=[{selector:{kind:'path',value:'src/auth.ts'},profile:'critical'}];await writeFile(f.trustPath,JSON.stringify(trust));
 await f.change('export function authorize(){return globalThis.handler();}\n');const result=f.check();expect(result.report.evaluations).toContainEqual(expect.objectContaining({ruleId:'changeImpact',severity:'error',status:'unknown',scope:['path','src/auth.ts']}));
});
test('impact candidates retain the host mapping to the actual production target',async()=>{
 const f=await fixture(),{readFile}=await import('node:fs/promises');await mkdir(join(f.root,'tests'));await writeFile(join(f.root,'tests/contract.ts'),"import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'C',intent:'real target',risk:'basic',cases:[{id:'yes',input:true,expected:true}]});");
 const config=JSON.parse(await readFile(join(f.root,'behavproof.config.json'),'utf8'));config.contracts={enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]};await writeFile(join(f.root,'behavproof.config.json'),JSON.stringify(config));const trust=JSON.parse(await readFile(f.trustPath,'utf8'));trust.inputs.push('tests/**/*.ts');trust.claimScopes=[{contractId:'C',caseIds:['yes'],targetRef:'src/auth.ts#authorize',method:'protected-case-observer-and-vitest-canary-v1'}];await writeFile(f.trustPath,JSON.stringify(trust));
 f.git('add','.');f.git('commit','-qm','unchanged contract and independent mapping');const base=f.git('rev-parse','HEAD');await f.change('export function authorize(){return false;}');expect(f.check(base).report.impact.contractIds).toContain('C');
});
test('a host-bound policy origin and normalized authority snapshots remain in the report',async()=>{
 const f=await fixture(),{readFile}=await import('node:fs/promises'),{hash}=await import('../../packages/core/src/index.js');const trust=JSON.parse(await readFile(f.trustPath,'utf8')),source={repository:'acme/shop',commitSha:f.git('rev-parse','HEAD'),ref:'policy.json',fileHash:'a'.repeat(64),policyHash:hash(trust.policy)};trust.policySource=source;await writeFile(f.trustPath,JSON.stringify(trust));await f.change('export function authorize(){return false;}');const result=f.check();expect(result.exit).toBe(0);expect(result.report.policySource).toEqual(source);expect(result.report.protectedPolicySha).toBe(source.commitSha);expect(result.report.authoritySnapshots.trustRootHash).toMatch(/^[a-f0-9]{64}$/);expect(result.report.authoritySnapshots.approvals).toEqual([]);
 trust.policySource.policyHash='b'.repeat(64);await writeFile(f.trustPath,JSON.stringify(trust));const invalid=spawnSync(process.execPath,[resolve('packages/cli/dist/index.js'),'check','--mode','gate','--trust-root',f.trustPath,'--format','json'],{cwd:f.root,encoding:'utf8'});expect(invalid.status).toBe(2);expect(invalid.stderr).toContain('policy');
});
