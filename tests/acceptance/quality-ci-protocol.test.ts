import { expect, test, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { archive } from './zip-fixture.js';
import { hash, hashBytes, parseConfig, specificationRevision } from '@behavproof/core';

test('the trusted protocol rejects changed deployment files and stale or missing producer evidence', async () => {
  const { prepareQuality, checkQualityManifest, restoreQuality, collectorProducer } = await import('../../scripts/quality-ci-protocol.mjs');
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
      config:{schemaVersion:2}, specifications:[]};
    const pr={number:2,head:{sha},base:{sha}};
    const plan=await prepareQuality({root,inputs:paths.sort()},r,pr);
    const expected=await plan.expectation('quality-1-1-1',[]);
    expect(expected.subject.prHeadSha).toBe(sha);
    const receiptRef='.behavproof/collected/quality-1-1-1/test-receipt.json';
    expect(expected.artifacts).toContainEqual({ref:receiptRef,kind:'test_receipt',scope:[]});
    const ci={repositoryId:'1',workflowRef:'demo/app/.github/workflows/behavproof-producer.yml@'+'1'.repeat(40),runId:'1',runAttempt:1,jobId:'1',eventName:'workflow_dispatch'};
    const reports=Object.fromEntries(expected.artifacts.map((item:{ref:string})=>[item.ref,Buffer.from('probe')]));
    const manifest={...expected,schemaVersion:1,producer:collectorProducer,ci,
      environment:{nodeVersion:'v24.14.1',platform:'linux'},startedAt:'2026-01-01T00:00:00Z',completedAt:'2026-01-01T00:00:01Z',
      exitCode:0,artifacts:expected.artifacts.map((item:{ref:string})=>({...item,sha256:hashBytes(reports[item.ref]!)}))};
    expect(hash(checkQualityManifest(manifest,expected,ci,reports))).toBe(hash(manifest));
    expect(()=>checkQualityManifest({...manifest,artifacts:manifest.artifacts.filter((item:{ref:string})=>item.ref!==receiptRef)},expected,ci,reports)).toThrow();
    const stale={...manifest,subject:{...manifest.subject,prHeadSha:'2'.repeat(40)}};
    expect(()=>checkQualityManifest(stale,expected,ci,reports)).toThrow();
    const named=Object.fromEntries(expected.artifacts.map((item:{ref:string})=>[item.ref.split('/').at(-1),reports[item.ref]]));
    const missing={...named}; delete missing['native.json'];
    const trustPath=join(root,'trust.json');
    await expect(restoreQuality(plan,expected.executionId,ci,archive({...missing,'manifest.json':Buffer.from(JSON.stringify(manifest))}),undefined,trustPath,r)).rejects.toThrow(/unexpected producer archive/i);
    await expect(restoreQuality(plan,expected.executionId,ci,archive({...named,'manifest.json':Buffer.from(JSON.stringify(stale))}),undefined,trustPath,r)).rejects.toThrow(/producer evidence/i);
    await writeFile(join(root,policyFile),'{"changed":true}');
    await expect(prepareQuality({root,inputs:paths},r,pr)).rejects.toThrow(/protected/i);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('the trusted protocol accepts conventional untracked report paths and rejects committed reports', async () => {
  const { prepareQuality } = await import('../../scripts/quality-ci-protocol.mjs');
  const root = await mkdtemp(join(tmpdir(),'behavproof-ci-protocol-'));
  const git = (...args:string[]) => execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  try {
    await writeFile(join(root,'package.json'),'{}');
    await writeFile(join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/vitest':{version:'5.1.0'}}}));
    git('init','-q'); git('add','.'); git('commit','-qm','candidate');
    const base=git('rev-parse','HEAD');
    const registration={deployment:{configPath:'behavproof.config.json'},policy:{runner:'vitest'},files:{},specifications:[],
      config:{schemaVersion:2,reports:{coverage:'coverage/lcov.info',mutation:'reports/mutation/mutation.json'}}};
    const inputs=['package.json','package-lock.json'];
    await expect(prepareQuality({root,inputs},registration,{head:{sha:base},base:{sha:base}})).resolves.toMatchObject({
      auxiliary:[['coverage','coverage.lcov'],['mutation','mutation.json']],
    });
    await mkdir(join(root,'coverage'));
    await writeFile(join(root,'coverage/lcov.info'),'stale coverage');
    git('add','.'); git('commit','-qm','commit stale coverage');
    const head=git('rev-parse','HEAD');
    await expect(prepareQuality({root,inputs:[...inputs,'coverage/lcov.info']},registration,{head:{sha:head},base:{sha:base}})).rejects.toThrow(/protected report path/i);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test.each([['vitest','5.1.0',false,false],['jest','30.5.2',false,false],['vitest','5.1.0',true,false],['vitest','5.1.0',false,true]] as const)(
  '%s %s quality evidence with formal mode %s and Assurance %s',async (runner,version,formal,assurance) => {
  const {prepareQuality,captureQuality,restoreQuality} = await import('../../scripts/quality-ci-protocol.mjs');
  const {check} = await import('../../packages/cli/dist/api.js');
  const stagedSdk=process.env.BEHAVPROOF_QUALITY_DOCKER_SDK;
  const host=await mkdtemp(join(tmpdir(),'behavproof-quality-e2e-'));
  const root=join(host,'app'), output=join(host,'artifact');
  const configRef='.behavproof/host-quality-config.json';
  const runnerFile=join(host,'local-worker.mjs');
  const trustPath=join(host,'trust.json');
  const policy={schemaVersion:1,id:'reviewed-quality',lint:{tool:'eslint',rules:['no-debugger']},types:'strict',runner,sources:['src/**/*']};
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Quality','-c','user.email=quality@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  try {
    await mkdir(join(root,'src'),{recursive:true});
    await mkdir(join(root,'test'));
    await mkdir(output);
    const testPath = `test/calc.test.${runner==='vitest'?'mjs':'cjs'}`;
    const files={
      'package.json':JSON.stringify({name:'bag-calculator',type:'commonjs',scripts:{lint:'eslint src',typecheck:'tsc --noEmit',test:runner==='vitest'?'vitest run':'jest'},devDependencies:{eslint:'9.39.5',typescript:'7.0.2',[runner]:version}}),
      'package-lock.json':JSON.stringify({packages:{[`node_modules/${runner}`]:{version}}}),
      '.gitignore':'.behavproof/\nnode_modules/\n',
      'eslint.config.mjs':"export default [{rules:{'no-debugger':'error'}}];",
      'tsconfig.json':JSON.stringify({compilerOptions:{strict:true,allowJs:true,checkJs:true,types:[]},include:['src/**/*']}),
      'src/calc.js':'exports.count = (/** @type {number[]} */ bags) => bags.length;',
      [testPath]: `${runner==='vitest'?"import {test,expect} from 'vitest'; import {count} from '../src/calc.js';":"const {count} = require('../src/calc.js');"} test('count bags',()=>expect(count([1,2])).toBe(2));`,
    };
    const model={id:'counter',model:'counter.qnt',module:'counter',invariants:['safe'],
      quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'},
      checks:['parse','typecheck','run',...(stagedSdk?['verify']:[])],maxSteps:4,seed:'1',report:'.behavproof/formal/model.json'};
    const assuranceConfig={driver:'driver.mjs',driverSources:['driver.mjs'],implementationSources:['src/calc.js'],report:'.behavproof/assurance.json',
      definitions:[{id:'counter',definition:{feature:{id:'inventory',entrypoints:['count']},conditions:[{
        id:'count',kind:'postcondition',statement:'Count matches the number of bags',checks:['example'],requiredFaults:[],
      }],checks:[{id:'example',method:'example',targetRef:'src/calc.js#count',cases:[{id:'count-two',input:[1,2],expected:2}]}]}}]};
    const candidate={schemaVersion:2,...(formal?{formal:{models:[model]}}:{}),...(assurance?{assurance:assuranceConfig}:{})};
    const sources:Record<string,string>={...files};
    if(formal){
      sources['counter.qnt']="module counter { var n: int action init = n' = 0 action step = n' = n + 1 val safe = n >= 0 }";
    }
    if(assurance)sources['driver.mjs']='export {};\n';
    if(formal||assurance)sources['behavproof.config.json']=JSON.stringify(candidate);
    for(const [path,content] of Object.entries(sources)) await writeFile(join(root,path),content);
    if(stagedSdk){
      await rm(join(root,'package-lock.json'));
      execFileSync('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,timeout:120000});
    }
    git('init','-q'); git('add','.'); git('commit','-qm','consumer');
    if(!stagedSdk)await symlink(resolve('node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    const base=git('rev-parse','HEAD');
    const registered=parseConfig(candidate);
    const assuranceSources=assurance?await (await import('../../packages/cli/dist/assurance-definitions.js'))
      .assuranceCriteriaAt(root,registered,'behavproof.config.json',base):undefined;
    const registration={deployment:{configPath:'behavproof.config.json'}, policy,
      files:formal||assurance?{'behavproof.config.json':hashBytes(Buffer.from(sources['behavproof.config.json']!))}:{},
      assuranceSources,
      config:registered,
      specifications:formal?[{id:model.id,revisionHash:specificationRevision(registered.formal!.models[0]!,{
        modelHash:hash({'counter.qnt':hashBytes(Buffer.from(sources['counter.qnt']!))}),
      })}]:[],
      sourceCommit:base};
    // The local verifier host selects this real worker explicitly. Production uses
    // the separate Docker launcher and independently authenticated CI attempts.
    if(!stagedSdk)await writeFile(runnerFile,`
      import {observeQuality} from ${JSON.stringify(pathToFileURL(resolve('packages/cli/dist/quality-observe.js')).href)};
      import {copyFile,writeFile} from 'node:fs/promises';
      import {join} from 'node:path';
      import {hash,parseConfig} from ${JSON.stringify(pathToFileURL(resolve('packages/core/dist/index.js')).href)};
      const policy=${JSON.stringify(policy)}, root=process.cwd(), out=process.env.BEHAVPROOF_OUTPUT_DIR;
      if(${formal}){
        const {captureQualityFormals}=await import(${JSON.stringify(pathToFileURL(resolve('packages/cli/dist/quality-formal-worker.js')).href)});
        const {readFile}=await import('node:fs/promises');
        const config=parseConfig(JSON.parse(await readFile(${JSON.stringify(configRef)},'utf8')));
        await writeFile(join(out,'formal-evidence.json'),await captureQualityFormals(root,config,
          ${JSON.stringify(configRef)},${JSON.stringify(resolve('examples/formal-order'))}));
      }
      if(${assurance}){
        const {captureQualityAssurance}=await import(${JSON.stringify(pathToFileURL(resolve('packages/cli/dist/quality-assurance-worker.js')).href)});
        const {readFile}=await import('node:fs/promises');
        const {execFileSync}=await import('node:child_process');
        const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
        const config=parseConfig(JSON.parse(await readFile('behavproof.config.json','utf8')));
        await writeFile(join(out,'assurance-evidence.json'),await captureQualityAssurance(root,config,'behavproof.config.json',commit));
      }
      const report=await observeQuality(root,policy,${JSON.stringify(configRef)}, {
        executionId:process.env.BEHAVPROOF_EXECUTION_ID,runnerVersion:${JSON.stringify(version)},
      });
      await writeFile(join(out,'quality.json'),JSON.stringify({...report,policyHash:hash(policy)}));
      await copyFile(join(root,'.behavproof/input',policy.runner+'.json'),join(out,'native.json'));
      await copyFile(join(root,'.behavproof/input',policy.runner+'.json.receipt.json'),join(out,'test-receipt.json'));
    `);
    const formalToolchain=stagedSdk&&formal?await (await import('../../scripts/formal-toolchain.mjs')).prepareFormalToolchain(join(host,'formal-tools')):undefined;
    vi.stubEnv('BEHAVPROOF_QUALITY_SANDBOX_MODULE',pathToFileURL(stagedSdk?resolve('scripts/quality-ci-sandbox-entry.mjs'):runnerFile).href);
    const evaluate=async (executionId:string) => {
      const head=git('rev-parse','HEAD');
      const pr={number:1,head:{sha:head},base:{sha:base}};
      const plan=await prepareQuality({root,inputs:Object.keys(sources).sort()},registration,pr);
      if(stagedSdk){
        const sourceRoot=await mkdtemp(join(host,'snapshot-'));
        for(const path of Object.keys(sources)){
          await mkdir(join(sourceRoot,path,'..'),{recursive:true});
          await writeFile(join(sourceRoot,path),await readFile(join(root,path)));
        }
        const requestPath=join(host,`${executionId}.json`);
        await writeFile(requestPath,JSON.stringify({config:plan.rawConfig,policy:plan.policy,runnerVersion:plan.version,formalEnabled:plan.formalEnabled,assurance:plan.assurance}));
        vi.stubEnv('BEHAVPROOF_QUALITY_REQUEST',JSON.stringify({sourceRoot,stagedSdk,requestPath,formalToolchain}));
      }
      await captureQuality(plan,executionId,undefined,output);
      const entries=Object.fromEntries(await Promise.all((await readdir(output)).map(async name=>[name,await readFile(join(output,name))])));
      expect(JSON.parse(entries['test-receipt.json']!.toString())).toMatchObject({
        invocation:executionId,runner:{kind:runner,version},nativeHash:hashBytes(entries['native.json']!),
      });
      const zip=archive(entries);
      await rm(join(root,'.behavproof'),{recursive:true,force:true});
      const incomplete = {...entries};
      delete incomplete['test-receipt.json'];
      await expect(restoreQuality(plan,executionId,undefined,archive(incomplete),undefined,trustPath,registration)).rejects.toThrow(/inventory/i);
      if(formal){
        const missing={...entries};
        delete missing['formal-evidence.json'];
        await expect(restoreQuality(plan,executionId,undefined,archive(missing),undefined,trustPath,registration)).rejects.toThrow(/inventory/i);
        const tampered={...entries,'formal-evidence.json':Buffer.from('{"schemaVersion":1,"files":[]}')};
        await expect(restoreQuality(plan,executionId,undefined,archive(tampered),undefined,trustPath,registration)).rejects.toThrow(/producer evidence/i);
      }
      if(assurance){
        const missing={...entries};delete missing['assurance-evidence.json'];
        await expect(restoreQuality(plan,executionId,undefined,archive(missing),undefined,trustPath,registration)).rejects.toThrow(/inventory/i);
      }
      const restored=await restoreQuality(plan,executionId,undefined,zip,undefined,trustPath,registration);
      const trusted=JSON.parse(await readFile(trustPath,'utf8'));
      expect(trusted).toMatchObject({schemaVersion:2,sourceCommit:base,specifications:registration.specifications});
      expect(trusted).not.toHaveProperty('baseline');
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
    if(assurance){
      expect(normal.evaluations).toContainEqual(expect.objectContaining({ruleId:'assuranceCondition',status:'pass'}));
      await writeFile(join(root,'driver.mjs'),'export {}; // changed criteria\n');
      git('add','.');git('commit','-qm','unapproved criterion change');
      const changed=await evaluate('assurance-driver-changed');
      expect(changed.exitCode).toBe(1);
      expect(changed.evaluations).toContainEqual(expect.objectContaining({ruleId:'assuranceCriterionBinding',status:'fail'}));
      await writeFile(join(root,'driver.mjs'),sources['driver.mjs']!);
    }
    if(formal){
      expect(normal.evaluations).toContainEqual(expect.objectContaining({ruleId:'formalModel',status:'pass'}));
      expect(normal.formal?.models[0]?.coverage).toMatchObject({simulation:{seed:'1',observation:{
        distinctStates:5,distinctTransitions:4,actions:{step:4},
      }},bounded:{maxSteps:4,verification:stagedSdk?expect.objectContaining({backend:'apalache',status:'pass'}):null}});
      // Ordinary configuration stays pinned while the gate evaluates the candidate model revision.
      await writeFile(join(root,'behavproof.config.json'),JSON.stringify({...candidate,
        formal:{models:[{...model,maxSteps:2}]}}));
      git('add','.');git('commit','-qm','candidate reduces model bound');
      const changed=await evaluate('formal-weakened');
      expect(changed.exitCode).toBe(1);
      expect(changed.evaluations).toContainEqual(expect.objectContaining({ruleId:'formalBinding',status:'fail'}));
      await writeFile(join(root,'behavproof.config.json'),sources['behavproof.config.json']!);
    }
    await writeFile(join(root,'eslint.config.mjs'),"export default [{rules:{'no-debugger':'warn'}}];");
    git('add','.'); git('commit','-qm','weaken lint');
    const weak=await evaluate('weakened');
    expect(weak.exitCode).toBe(1);
    expect(weak.evaluations).toContainEqual(expect.objectContaining({ruleId:'qualityConfiguration',status:'fail'}));
    if(!formal&&!assurance){
      await writeFile(join(root,'eslint.config.mjs'),files['eslint.config.mjs']);
      await writeFile(join(root,testPath),files[testPath]!.replace('.toBe(2)', '.toBe(3)'));
      git('add','.');git('commit','-qm','failing test');
      const failing=await evaluate('failing-test');
      expect(failing.exitCode).toBe(1);
      expect(failing.evaluations).toContainEqual(expect.objectContaining({ruleId:'testResult',status:'fail'}));
      expect(failing.evaluations).toContainEqual(expect.objectContaining({ruleId:'qualityConfiguration',status:'pass'}));
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(host,{force:true,recursive:true});
  }
},process.env.BEHAVPROOF_QUALITY_DOCKER_SDK?20*60*1000:30000);
