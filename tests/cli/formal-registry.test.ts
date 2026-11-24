import {expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {specificationReview} from '../../packages/cli/src/formal-registry.js';
import {formalSpecificationIdentity} from '../../packages/cli/src/formal.js';
import {hash, parseConfig, specificationRevision, specificationTransitionTarget} from '../../packages/core/src/index.js';

it('authorizes an exact revision from the reviewed Git tree and ignores working-tree and merge-only changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'formal-review-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', ...args], {cwd: root, encoding: 'utf8'}).trim();
  const write = (path: string, value: string) => writeFile(join(root, path), value);
  const config = parseConfig({schemaVersion: 2, formal: {models: [{
    id: 'orders', model: 'orders.qnt', module: 'orders', invariants: ['safe'],
    checks: ['parse','typecheck','run'], maxSteps: 6, seed: '1',
    quint: {entry: 'tool.mjs', version: '0.33.1'}, report: '.behavproof/formal.json',
  }]}});
  const model = config.formal!.models[0]!;
  try {
    await write('behavproof.config.json', JSON.stringify(config));
    await write('orders.qnt', 'module orders { import State.* from "state" }');
    await write('state.qnt', 'module State { val x = 1 }');
    await write('tool.mjs', 'throw Error("Review must never execute the candidate tool");');
    git('init', '-qb', 'main'); git('add', '.'); git('commit', '-qm', 'reviewed');
    const head = git('rev-parse', 'HEAD');
    const revision = specificationRevision(model, await formalSpecificationIdentity(root, model));
    await write('state.qnt', 'module State { val x = 2 }');
    const merged = specificationRevision(model, await formalSpecificationIdentity(root, model));
    const requested: unknown[] = [];
    const review = specificationReview({root, configPath:'behavproof.config.json', repository:'acme/orders', head,
      async authorize(target) {requested.push(target); return target;}});
    expect(await review(model.id, 'd'.repeat(64), merged)).toBeUndefined();
    expect(requested).toEqual([]);
    expect(await review(model.id, 'd'.repeat(64), revision)).toMatchObject({
      reviewedRevision: revision, approval: {kind:'specification', id:'orders'},
    });
    expect(requested).toHaveLength(1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

it('binds native revisions to protected CI enrollment independently of any Contract registry entries', async () => {
  const {registeredCI, registrationTarget} = await import('../../packages/cli/src/ci-registration.js');
  const {packageFiles} = await import('../../packages/cli/src/ci-plan.js');
  const head = 'a'.repeat(40);
  const deployment = {repository:'acme/orders', protectedBranch:'main', workflowBranch:'trusted/main',
    sdkSha:'b'.repeat(40), appId:5300, checkName:'BehavProof protected gate',
    environment:'behavproof-publisher', producerPath:'.github/workflows/behavproof-producer.yml',
    publisherPath:'.github/workflows/behavproof-publisher.yml', policyPath:'.github/behavproof/quality-policy.json',
    configPath:'behavproof.config.json'} as const;
  const policy = {schemaVersion:1, id:'quality', lint:{tool:'eslint', rules:['no-debugger']},
    types:'strict', runner:'vitest', sources:['src/**/*']} as const;
  const config = parseConfig({schemaVersion:2, formal:{models:[{
    id:'orders', model:'orders.qnt', module:'orders', invariants:['safe'], checks:['parse','typecheck','run'],
    maxSteps:6, seed:'1', quint:{entry:'tool.mjs', version:'0.33.1'}, report:'.behavproof/formal.json',
  }]}});
  const selection = {deployment, policy, config, workflowSha:'c'.repeat(40), reviewers:['reviewer'],
    files:Object.fromEntries(packageFiles(deployment, {...policy, sources:[...policy.sources], lint:{...policy.lint,
      rules:[...policy.lint.rules]}}).map(row=>[row.path,row.sha256])),
    sourceCommit:head, requiredTests:[],
    specifications:[{id:'orders', revisionHash:'d'.repeat(64)}]};
  const registration = {schemaVersion:2, repositoryId:'1', ...selection, approval:{
    schemaVersion:2, id:'review', target:registrationTarget(selection), status:'pass',
    source:{provider:'github', ref:'https://github.com/acme/orders/pull/7'}, approvedBy:['reviewer'],
    subjectCommitSha:head, reasons:[],
  }};
  expect(registeredCI(registration,hash(registration)).specifications).toEqual(selection.specifications);
  const obsolete={...registration,schemaVersion:1};
  expect(()=>registeredCI(obsolete,hash(obsolete))).toThrow();

  const changed = {...registration, specifications:[{id:'orders', revisionHash:'e'.repeat(64)}]};
  expect(()=>registeredCI(changed,hash(changed))).toThrow(/registration/);
  const omitted = {...registration, specifications:[],
    approval:{...registration.approval, target:registrationTarget({...selection,specifications:[]})}};
  expect(()=>registeredCI(omitted,hash(omitted))).toThrow(/registration/);
});

it('retains a removed required scope until the exact scope deletion in Git is independently approved', async () => {
  const {formalEvaluations}=await import('../../packages/cli/src/formal-evaluation.js');
  const root=await mkdtemp(join(tmpdir(),'formal-scope-review-'));
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture',
    '-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
  const scope={id:'orders',include:['src/*.ts'],modelId:'orders'};
  const config=parseConfig({schemaVersion:2});
  const protectedConfig=parseConfig({schemaVersion:2,formal:{models:[],required:[scope]}});
  const repository='acme/orders';
  try{
    await writeFile(join(root,'behavproof.config.json'),JSON.stringify(config));
    git('init','-qb','main');git('add','.');git('commit','-qm','remove scope');
    const head=git('rev-parse','HEAD');
    const options={root,config,protectedConfig,
      policy:{schemaVersion:1 as const,profileVersion:'2' as const,rules:{}},
      files:[],inputs:[],trusted:()=>false,present:async()=>false,readJson:async()=>undefined,readBytes:async()=>new Uint8Array()};
    const unapproved=await formalEvaluations(options);
    expect(unapproved.policyChanged).toBe(true);
    expect(unapproved.evaluations).toContainEqual(expect.objectContaining({ruleId:'formalRequiredScope',status:'fail'}));
    const wrongPurpose=specificationTransitionTarget({id:scope.id,previous:hash(scope),revision:null,head,repository});
    const actual=specificationTransitionTarget({id:scope.id,previous:hash(scope),revision:null,head,repository,
      domain:'requiredSpecification'});
    expect(actual.contentHash).not.toBe(wrongPurpose.contentHash);
    const verify=specificationReview({root,configPath:'behavproof.config.json',head,repository,
      domain:'requiredSpecification',async authorize(target){return target.contentHash===actual.contentHash?target:undefined;}});
    const approved=await formalEvaluations({...options,scopeReview:{head,repository,verify}});
    expect(approved.policyChanged).toBe(false);
    expect(approved.evaluations).toEqual([]);
  }finally{await rm(root,{recursive:true,force:true});}
});

it('typechecks committed Quint selections on the protected host before enrolling or consulting GitHub', async () => {
  const {enrollCI}=await import('../../packages/cli/src/ci-registration.js');
  const {packageFiles,Deployment}=await import('../../packages/cli/src/ci-plan.js');
  const scratch=await mkdtemp(join(tmpdir(),'formal-enrollment-'));
  const root=join(scratch,'project'),toolRoot=join(scratch,'trusted'),registration=join(scratch,'registration.json');
  const entry='node_modules/@informalsystems/quint/dist/src/cli.js';
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],
    {cwd:root,encoding:'utf8'}).trim();
  const write=async (path:string,value:string)=>{
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,value);
  };
  const deployment=Deployment.parse({repository:'acme/orders',protectedBranch:'main',workflowBranch:'trusted/main',
    sdkSha:'a'.repeat(40),appId:5300,checkName:'BehavProof protected gate',environment:'behavproof-publisher',
    producerPath:'.github/workflows/behavproof-producer.yml',publisherPath:'.github/workflows/behavproof-publisher.yml',
    policyPath:'.github/behavproof/quality-policy.json',configPath:'behavproof.config.json'});
  const policy={schemaVersion:1 as const,id:'quality',lint:{tool:'eslint' as const,rules:['no-debugger']},
    types:'strict' as const,runner:'vitest' as const,sources:['src/**/*']};
  const model={id:'orders',model:'orders.qnt',module:'orders',invariants:['safe'],checks:['parse','typecheck','run'],
    maxSteps:6,seed:'1',quint:{entry,version:'0.33.1'},report:'.behavproof/formal.json'};
  const types={1:{type:{kind:'bool'}},2:{type:{kind:'bool'}},3:{type:{kind:'bool'}}};
  const effect=(kind:string)=>({effect:{kind:'concrete',components:[{kind}]}});
  const output={stage:'typechecking',modules:[{name:'orders',declarations:[
    {id:1,name:'init',kind:'def',qualifier:'action'},
    {id:2,name:'step',kind:'def',qualifier:'action'},
    {id:3,name:'safe',kind:'def',qualifier:'val',expr:{id:4,kind:'bool',value:true}},
  ]}],types,effects:{1:effect('update'),2:effect('update'),3:effect('read')}};
  let contacted=false;
  const run=(chosenRoot?:string)=>enrollCI(root,{pr:7,workflowSha:'c'.repeat(40),reviewers:['alice'],registration,
    ...(chosenRoot?{quintToolRoot:chosenRoot}:{}),async fetcher(){
      contacted=true;
      throw new Error('fixture deliberately stops at remote validation');
    }});
  try{
    for(const file of packageFiles(deployment,policy))await write(join(root,file.path),file.content);
    await write(join(root,'orders.qnt'),'module orders { import State.* from "state" }');
    await write(join(root,'state.qnt'),'reviewed dependency bytes');
    await write(join(root,'package.json'),'{"type":"module"}');
    await write(join(root,'node_modules/.keep'),'');
    await write(join(root,entry),'throw Error("Candidate executable ran");');
    await write(join(toolRoot,entry),`(async()=>{
      const fs=await import('node:fs/promises');
      if(process.argv[2]==='--version'){console.log('0.33.1');return;}
      if(await fs.readFile('state.qnt','utf8')!=='reviewed dependency bytes')throw Error('Wrong source snapshot');
      await fs.writeFile(process.argv[process.argv.indexOf('--out')+1],${JSON.stringify(JSON.stringify(output))});
    })().catch(error=>{console.error(error.message);process.exitCode=1;});`);
    const configPath=join(root,deployment.configPath);
    await write(configPath,JSON.stringify({schemaVersion:2,formal:{models:[{...model,invariants:['missing']}]}}));
    git('init','-qb','main');git('add','.');git('commit','-qm','invalid enrolled selection');
    await expect(run()).rejects.toThrow(/quint-tool-root/i);
    await expect(run(root)).rejects.toThrow(/outside/i);
    await expect(run(toolRoot)).rejects.toThrow(/orders.*missing/i);
    expect(contacted).toBe(false);
    await expect(stat(registration)).rejects.toHaveProperty('code','ENOENT');

    await write(configPath,JSON.stringify({schemaVersion:2,formal:{models:[model]}}));
    git('add',deployment.configPath);git('commit','-qm','valid enrolled selection');
    await write(join(root,'state.qnt'),'unreviewed working-tree dependency');
    await expect(run(toolRoot)).rejects.toThrow(/GitHub response/i);
    expect(contacted).toBe(true);
    await expect(stat(registration)).rejects.toHaveProperty('code','ENOENT');
  }finally{await rm(scratch,{recursive:true,force:true});}
},15000);
