import { expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { archive } from './zip-fixture.js';
import { hash, hashBytes } from '@behavproof/core';

test('the trusted protocol rejects changed deployment files and stale manifest subjects', async () => {
  const { prepareQuality, checkQualityManifest, collectorProducer } = await import('../../scripts/quality-ci-protocol.mjs');
  const root = await mkdtemp(join(tmpdir(),'behavproof-ci-protocol-'));
  const git = (...args:string[]) => execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  try {
    await mkdir(join(root,'.github/behavproof'),{recursive:true});
    const policyFile = '.github/behavproof/quality-policy.json';
    const deploymentFile = '.github/behavproof/deployment.json';
    const bytes = '{}\n';
    const paths = ['package.json','package-lock.json',policyFile,deploymentFile];
    for(const path of paths) await writeFile(join(root,path),path==='package-lock.json'?JSON.stringify({packages:{'node_modules/vitest':{version:'5.1.0'}}}):bytes);
    git('init','-q'); git('add','.'); git('commit','-qm','candidate');
    const sha=git('rev-parse','HEAD');
    const r = {deployment:{configPath:'behavproof.config.json',policyPath:policyFile}, policy:{runner:'vitest'},
      files:{[policyFile]:hashBytes(Buffer.from(bytes)),[deploymentFile]:hashBytes(Buffer.from(bytes))},
      config:{schemaVersion:1}, baseline:{contracts:[],intents:[]}};
    const pr={number:2,head:{sha},base:{sha}};
    const plan=await prepareQuality({root,inputs:paths.sort()},r,pr);
    const expected=await plan.expectation('quality-1-1-1');
    expect(expected.subject.prHeadSha).toBe(sha);
    const ci={repositoryId:'1',workflowRef:'demo/app/.github/workflows/behavproof-producer.yml@'+'1'.repeat(40),runId:'1',runAttempt:1,jobId:'1',eventName:'workflow_dispatch'};
    const reports=Object.fromEntries(expected.artifacts.map((item:{ref:string})=>[item.ref,Buffer.from('probe')]));
    const manifest={...expected,schemaVersion:1,producer:collectorProducer,ci,
      environment:{nodeVersion:'v24.14.1',platform:'linux'},startedAt:'2026-01-01T00:00:00Z',completedAt:'2026-01-01T00:00:01Z',
      exitCode:0,artifacts:expected.artifacts.map((item:{ref:string})=>({...item,sha256:hashBytes(reports[item.ref]!)}))};
    expect(hash(checkQualityManifest(manifest,expected,ci,reports))).toBe(hash(manifest));
    expect(()=>checkQualityManifest({...manifest,subject:{...manifest.subject,prHeadSha:'2'.repeat(40)}},expected,ci,reports)).toThrow();
    await writeFile(join(root,policyFile),'{"changed":true}');
    await expect(prepareQuality({root,inputs:paths},r,pr)).rejects.toThrow(/protected/i);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('real tool runs can satisfy the gate, and low lint severity cannot',async () => {
  const {prepareQuality,captureQuality,restoreQuality} = await import('../../scripts/quality-ci-protocol.mjs');
  const {check} = await import('../../packages/cli/dist/api.js');
  const host=await mkdtemp(join(tmpdir(),'behavproof-quality-e2e-'));
  const root=join(host,'app'), output=join(host,'artifact');
  const configRef='.behavproof/host-quality-config.json';
  const runnerFile=join(host,'local-worker.mjs');
  const trustPath=join(host,'trust.json');
  const policy={schemaVersion:1,id:'reviewed-quality',lint:{tool:'eslint',rules:['no-debugger']},types:'strict',runner:'vitest',sources:['src/**/*']};
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Quality','-c','user.email=quality@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  try {
    await mkdir(join(root,'src'),{recursive:true});
    await mkdir(join(root,'test'));
    await mkdir(output);
    const files={
      'package.json':JSON.stringify({name:'bag-calculator',type:'module',scripts:{lint:'eslint src',typecheck:'tsc --noEmit',test:'vitest run'},devDependencies:{eslint:'9.39.5',typescript:'7.0.2',vitest:'5.1.0'}}),
      'package-lock.json':JSON.stringify({packages:{'node_modules/vitest':{version:'5.1.0'}}}),
      '.gitignore':'.behavproof/\nnode_modules/\n',
      'eslint.config.mjs':"export default [{rules:{'no-debugger':'error'}}];",
      'tsconfig.json':JSON.stringify({compilerOptions:{strict:true,allowJs:true,checkJs:true,types:[]},include:['src/**/*']}),
      'src/calc.js':'export const count = (/** @type {number[]} */ bags) => bags.length;',
      'test/calc.test.mjs':"import {test,expect} from 'vitest'; import {count} from '../src/calc.js'; test('count bags',()=>expect(count([1,2])).toBe(2));",
    };
    for(const [path,content] of Object.entries(files)) await writeFile(join(root,path),content);
    git('init','-q'); git('add','.'); git('commit','-qm','consumer');
    await symlink(resolve('node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    const base=git('rev-parse','HEAD');
    const registration={deployment:{configPath:'behavproof.config.json'}, policy, files:{},config:{schemaVersion:1},
      baseline:{schemaVersion:1,commitSha:base,contracts:[],intents:[],scope:[],extractorVersion:'1',discoveryDiagnostics:[]}};
    // The local verifier host selects this real worker explicitly. Production uses
    // the separate Docker launcher and independently authenticated CI attempts.
    await writeFile(runnerFile,`
      import {observeQuality} from ${JSON.stringify(pathToFileURL(resolve('packages/cli/dist/quality-observe.js')).href)};
      import {copyFile,writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      import {hash} from ${JSON.stringify(pathToFileURL(resolve('packages/core/dist/index.js')).href)};
      const policy=${JSON.stringify(policy)}, root=process.cwd(), out=process.env.BEHAVPROOF_OUTPUT_DIR;
      const report=await observeQuality(root,policy,${JSON.stringify(configRef)});
      await writeFile(join(out,'quality.json'),JSON.stringify({...report,policyHash:hash(policy)}));
      await copyFile(join(root,'.behavproof/input/vitest.json'),join(out,'native.json'));
      await copyFile(join(root,'.behavproof/input/contracts.json'),join(out,'contracts.json'));
    `);
    vi.stubEnv('BEHAVPROOF_QUALITY_SANDBOX_MODULE',pathToFileURL(runnerFile).href);
    const evaluate=async (executionId:string) => {
      const head=git('rev-parse','HEAD');
      const pr={number:1,head:{sha:head},base:{sha:base}};
      const plan=await prepareQuality({root,inputs:Object.keys(files).sort()},registration,pr);
      await captureQuality(plan,executionId,undefined,output);
      const entries=Object.fromEntries(await Promise.all((await readdir(output)).map(async name=>[name,await readFile(join(output,name))])));
      const zip=archive(entries);
      await rm(join(root,'.behavproof'),{recursive:true,force:true});
      const restored=await restoreQuality(plan,executionId,undefined,zip,undefined,trustPath,registration);
      const result=await check(root,{mode:'gate',config:restored.configRef,'trust-root':trustPath});
      await rm(join(root,'.behavproof'),{recursive:true,force:true});
      await rm(trustPath);
      for(const name of await readdir(output)) await rm(join(output,name));
      return result;
    };
    const normal=await evaluate('observed');
    expect(normal.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ruleId:'lintResult',status:'pass'}),
      expect.objectContaining({ruleId:'typecheckResult',status:'pass'}),
      expect.objectContaining({ruleId:'testResult',status:'pass'}),
    ]));
    expect(normal.exitCode,JSON.stringify(normal.evaluations.filter((row:any)=>row.status!=='pass'))).toBe(0);
    await writeFile(join(root,'eslint.config.mjs'),"export default [{rules:{'no-debugger':'warn'}}];");
    git('add','.'); git('commit','-qm','weaken lint');
    const weak=await evaluate('weakened');
    expect(weak.exitCode).toBe(1);
    expect(weak.evaluations).toContainEqual(expect.objectContaining({ruleId:'qualityConfiguration',status:'fail'}));
    await writeFile(join(root,'eslint.config.mjs'),"export default [{rules:{'no-debugger':'error'}}];");
    await writeFile(join(root,'test/calc.test.mjs'),"import {test,expect} from 'vitest'; import {count} from '../src/calc.js'; test('count bags',()=>expect(count([1,2])).toBe(3));");
    git('add','.'); git('commit','-qm','failing test');
    const failing=await evaluate('failing-test');
    expect(failing.exitCode).toBe(1);
    expect(failing.evaluations).toContainEqual(expect.objectContaining({ruleId:'testResult',status:'fail'}));
    expect(failing.evaluations).toContainEqual(expect.objectContaining({ruleId:'qualityConfiguration',status:'pass'}));
  } finally {
    vi.unstubAllEnvs();
    await rm(host,{force:true,recursive:true});
  }
},30000);
