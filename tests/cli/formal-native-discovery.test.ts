import {nativeArtifacts,runner} from '../fixtures/native-vitest.js';
import {afterEach, beforeEach, expect, it} from 'vitest';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {gitSubject} from '../../packages/adapter-reports/src/index.js';
import {hash, hashBytes, parseConfig} from '../../packages/core/src/index.js';

const cli = resolve('packages/cli/dist/index.js');
let root: string;
const model = {
  id: 'orders', model: 'specs/order.qnt', module: 'Orders', init: 'start', step: 'next',
  invariants: ['safe'], witnesses: ['refundReached'], requiredActions: ['Refund'],
  checks: ['parse', 'typecheck', 'run'], maxSteps: 8, seed: '42',
  quint: {version: '0.33.1', entry: 'tool.mjs'}, report: '.behavproof/model.json',
};
const declarations = [
  {id: 1, name: 'start', kind: 'def', qualifier: 'action'},
  {id: 2, name: 'next', kind: 'def', qualifier: 'action'},
  {id: 3, name: 'safe', kind: 'def', qualifier: 'val', expr:{id:30,kind:'bool',value:true}},
  {id: 4, name: 'refundReached', kind: 'def', qualifier: 'val'},
  {id: 5, name: 'Refund', kind: 'def', qualifier: 'action'},
];
const raw = {
  stage: 'typechecking', modules: [{name: 'Orders', declarations}],
  types: Object.fromEntries(declarations.map(d => [d.id, {type: {kind: 'bool'}}])),
  effects: Object.fromEntries(declarations.map(d => [d.id, {effect: {kind: 'concrete',
    components: [{kind: d.qualifier === 'action' ? 'update' : 'read'}]}}])),
};
async function configure(overrides: Partial<typeof model> = {}) {
  await writeFile(join(root, 'behavproof.config.json'),
    JSON.stringify({schemaVersion: 2, formal: {models: [{...model, ...overrides}]}}));
}
function discover() {
  return spawnSync(process.execPath, [cli, 'formal', 'discover', '--model', 'orders'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'behavproof-native-discovery-'));
  await mkdir(join(root, 'specs'));
  await writeFile(join(root, 'specs/order.qnt'), 'module Orders { import State.* from "state" }');
  await writeFile(join(root, 'specs/state.qnt'), 'module State { import Common.* from "common" }');
  await writeFile(join(root, 'specs/common.qnt'), 'module Common { val n = 0 }');
  await writeFile(join(root, 'tool.mjs'), `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
if (process.argv[2] === '--version') console.log('0.33.1');
else {
  const stage=process.argv[2], args=process.argv.slice(3);
  if (!existsSync('specs/common.qnt')) process.exit(2);
  const entry=readFileSync(args[0],'utf8');
  if (stage==='run' && (args[args.indexOf('--main')+1]!=='Orders' || args[args.indexOf('--init')+1]!=='start' || args[args.indexOf('--step')+1]!=='next')) process.exit(2);
  const typed=${JSON.stringify(raw)};
  const result=stage==='typecheck'?typed:stage==='parse'?{stage:'parsing',modules:typed.modules}:{stage:'running', status:'ok', seed:42, trace:[{}]};
  if (stage==='verify') {
    const invariant=args[args.indexOf('--invariant')+1];
    if (args.includes('--invariants')) process.exit(2);
    const marker=readFileSync('specs/common.qnt','utf8');
    if(marker.includes('unavailable')) process.exit(2);
    const noViolation=invariant==='safe'?!entry.includes('mutation'):
      invariant==='not(refundReached)'&&marker.includes('unreachable');
    const result=noViolation?{stage:'verifying',status:'ok'}:
      {stage:'verifying',status:'violation',trace:[{n:0},{n:1}]};
    writeFileSync(args[args.indexOf('--out')+1], JSON.stringify(result));
    process.exit(result.status==='ok'?0:1);
  }
  if(stage==='typecheck'&&entry.includes('invalid mutation'))process.exit(1);
  if(stage==='run'){
    const output=args[args.indexOf('--out-itf')+1].replace('{seq}','0');
    const states=['init','Refund'].map((action,index)=>({'#meta':{index},n:index,'mbt::actionTaken':action,'mbt::nondetPicks':{}}));
    writeFileSync(output,JSON.stringify({vars:['n','mbt::actionTaken','mbt::nondetPicks'],states}));
  }
  writeFileSync(args[args.indexOf('--out')+1], JSON.stringify(result));
}`);
  await configure();
});
afterEach(async () => rm(root, {recursive: true, force: true}));

it('discovers configured Quint roles and transitive inputs without a Contract or repository writes', async () => {
  const files = await readdir(root);
  const first = discover();
  expect(first.status, first.stderr).toBe(0);
  const row = JSON.parse(first.stdout).models[0];
  expect(row).toMatchObject({
    id: 'orders', status: 'pass', selection: {module: 'Orders', init: 'start', step: 'next',
      invariants: ['safe'], witnesses: ['refundReached'], requiredActions: ['Refund']},
    sources: {'specs/common.qnt': expect.any(String), 'specs/order.qnt': expect.any(String),
      'specs/state.qnt': expect.any(String)},
    revisionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(row).not.toHaveProperty('contractId');
  expect(await readdir(root)).toEqual(files);
  await writeFile(join(root, 'specs/common.qnt'), 'module Common { val n = 1 }');
  const second = discover();
  expect(second.status, second.stderr).toBe(0);
  expect(JSON.parse(second.stdout).models[0].revisionHash).not.toBe(row.revisionHash);
});

it('withholds the revision when a selected definition is missing', async () => {
  await configure({witnesses: ['missing']});
  const result = discover();
  expect(result.status, result.stderr).toBe(1);
  expect(JSON.parse(result.stdout).models[0]).toMatchObject({status: 'fail', diagnostics: [
    expect.stringContaining('missing'),
  ]});
});

it('gates the protected revision without a Contract and retains its obligation when removed', async () => {
  const host = await mkdtemp(join(tmpdir(), 'behavproof-native-host-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  const git = (...args: string[]) => execFileSync('git', [
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args,
  ], {cwd: root, encoding: 'utf8'}).trim();
  const configPath = 'behavproof.config.json';
  const config = parseConfig({schemaVersion: 2, profile: 'basic', git: {base: 'HEAD'},
    formal: {models: [model]}, reports:{vitest:'.behavproof/vitest.json'},rules: {
      testResult: {severity: 'off'}, formalModel: {severity: 'error'}, policyProtection: {severity: 'error'},
    }});
  const trustRef = join(host, 'trust.json');
  const manifestRef = '.behavproof/manifest.json';
  try {
    await writeFile(join(root, '.gitignore'), '.behavproof/\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name:'fixture', scripts:{test:'vitest run'}, devDependencies:{vitest:'5.1.0'},
    }));
    await writeFile(join(root, configPath), JSON.stringify(config));
    git('init', '-qb', 'main'); git('add', '.'); git('commit', '-qm', 'registered specification');
    const initial = git('rev-parse', 'HEAD');
    const inputs = ['.gitignore', 'package.json', configPath, 'specs/order.qnt',
      'specs/state.qnt', 'specs/common.qnt', 'tool.mjs'];
    const discovery = discover();
    expect(discovery.status, discovery.stderr).toBe(0);
    const revisionHash = JSON.parse(discovery.stdout).models[0].revisionHash;
    const producer = {tool: 'fixture', version: '1', collectorVersion: '1'};
    const executionId = 'native-run';
    const commandHash = hash({command: 'formal check'});
    const native=await nativeArtifacts(root,'.behavproof/vitest.json',executionId);
    const result = run('formal', 'check');
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const adequate=run('formal','adequacy');
    expect(adequate.status, adequate.stderr + adequate.stdout).toBe(0);
    const artifact=async(ref:string,kind:string)=>({
      ref,kind,sha256:hashBytes(await readFile(join(root,ref))),scope:[model.id],
    });
    const traceReceiptRef=model.report+'.traces.json';
    const traceReceipt=JSON.parse(await readFile(join(root,traceReceiptRef),'utf8'));
    const evidence=await Promise.all([artifact(model.report,'formal_model'),artifact(traceReceiptRef,'formal_trace'),
      ...traceReceipt.traces.map(({ref}:{ref:string})=>artifact(ref,'trace'))]);
    const witness=await artifact(model.report+'.adequacy.json','formal_adequacy');
    for (const scenario of ['current','missing-witness','reapproved-tool','deleted']) {
      const removed=scenario==='deleted';
      const allReports=[...native,...evidence,...(scenario==='missing-witness'?[]:[witness])];
      let approvedRevision=revisionHash;
      if(scenario==='reapproved-tool'){
        const original=await readFile(join(root,'tool.mjs'),'utf8');
        await writeFile(join(root,'tool.mjs'),original+'\n// reviewed tool update');
        git('add','.');git('commit','-qm','reviewed tool update');
        const updated=discover();
        expect(updated.status,updated.stderr).toBe(0);
        approvedRevision=JSON.parse(updated.stdout).models[0].revisionHash;
        expect(approvedRevision).not.toBe(revisionHash);
      }
      if (removed) {
        const {formal:_formal,...without}=config;
        await writeFile(join(root, configPath), JSON.stringify(without));
        git('add', '.'); git('commit', '-qm', 'unreviewed specification deletion');
      }
      const head = git('rev-parse', 'HEAD');
      const subject = await gitSubject(root, inputs, head, head);
      const configHashes = {[configPath]: hashBytes(await readFile(join(root, configPath)))};
      const timestamp = new Date().toISOString();
      const manifest = {schemaVersion: 1, executionId, subject, producer, commandHash, configHashes,
        environment: {nodeVersion: process.version, platform: process.platform},
        startedAt: timestamp, completedAt: timestamp, exitCode: 0, artifacts: allReports};
      await writeFile(join(root, manifestRef), JSON.stringify(manifest));
      await writeFile(trustRef, JSON.stringify({
        schemaVersion: 2, config, policy: {schemaVersion: 1, profileVersion: '2', rules: config.rules},
        sourceCommit:initial,runner:{...runner,manifestRef},
        specifications: [{id: model.id, revisionHash:approvedRevision}],
        inputs, configPaths: [configPath],
        manifests: [{ref: manifestRef, manifestHash: hash(manifest),
          expected: {executionId, subject, commandHash, configHashes,
            artifacts: allReports.map(({sha256:_hash,...report})=>report)},
          authority: {kind: 'local', executionId, producer, commandHash}}],
      }));
      const gate = run('check', '--mode', 'gate', '--trust-root', trustRef, '--format', 'json');
      expect(gate.stdout, gate.stderr).toBeTruthy();
      const checked = JSON.parse(gate.stdout);
      expect.soft(gate.status, gate.stdout + gate.stderr).toBe(scenario==='current'?0:1);
      expect.soft(checked.evaluations.find((row:{ruleId:string})=>row.ruleId==='formalReachability')?.status)
        .toBe(scenario==='missing-witness'||scenario==='reapproved-tool'||removed?'unknown':'pass');
      expect.soft(checked.evaluations.find((row:{ruleId:string})=>row.ruleId==='formalActionReachability')?.status)
        .toBe(scenario==='reapproved-tool'||removed?'unknown':'pass');
      expect.soft(checked.formal.models[0].binding.status).toBe(removed ? 'fail' : 'pass');
    }
  } finally {
    await rm(host, {recursive: true, force: true});
  }
},30000);

it.each([
  ['', 0, 'found'],
  ['unreachable', 1, 'not_found'],
  ['unavailable', 2, 'unknown'],
])('executes a separate bounded witness query for marker %s', async (marker, code, outcome) => {
  await writeFile(join(root,'specs/common.qnt'), 'module Common { val n = 0 } // ' + marker);
  const run=spawnSync(process.execPath,[cli,'formal','adequacy','--model','orders'],{
    cwd:root,encoding:'utf8',timeout:10000,
  });
  expect(run.status,run.stderr).toBe(code);
  const evidence=JSON.parse(await readFile(join(root,model.report+'.adequacy.json'),'utf8'));
  expect(evidence.witnesses).toEqual([expect.objectContaining({name:'refundReached',outcome,maxSteps:8})]);
  expect(evidence.witnesses[0].trace?.length??0).toBe(outcome==='found'?2:0);
});

it.each([['mutation',0,'detected'],['unchanged',1,'survived'],['invalid mutation',2,'invalid']])(
  'checks the configured model fault against the same invariant for %s',
  async (marker,code,outcome)=>{
    await writeFile(join(root,'specs/fault.qnt'),'module Orders {} // '+marker);
    await writeFile(join(root,'behavproof.config.json'),JSON.stringify({
      schemaVersion:2,formal:{models:[{...model,witnesses:[],mutants:[{
        id:'fault',model:'specs/fault.qnt',sources:['specs/common.qnt'],invariant:'safe',
      }]}]},
    }));
    const run=spawnSync(process.execPath,[cli,'formal','adequacy'],{
      cwd:root,encoding:'utf8',timeout:10000,
    });
    expect(run.status,run.stderr).toBe(code);
    expect(JSON.parse(run.stdout).mutationSummary[outcome]).toBe(1);
  },
);

it('keeps a required implementation scope incomplete when it has no registered model',async()=>{
  const host=await mkdtemp(join(tmpdir(),'behavproof-scope-'));
  const ref=join(host,'trust.json');
  const cfg={schemaVersion:2, profile:'basic', git:{base:'HEAD'}, rules:{testResult:{severity:'off'}},
    formal:{models:[],required:[{id:'fulfillment',include:['src/*.ts'],modelId:'orders'}]}};
  try{
    await mkdir(join(root,'src'));
    await writeFile(join(root,'src/order.ts'),'export const total = 1;');
    await writeFile(join(root,'package.json'),JSON.stringify({
      name:'fixture',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'},
    }));
    await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));
    const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
      ...args],{cwd:root,encoding:'utf8'}).trim();
    git('init','-qb','main');git('add','.');git('commit','-qm','missing specification');
    const head=git('rev-parse','HEAD');
    await writeFile(ref,JSON.stringify({
      schemaVersion:2,config:cfg,policy:{schemaVersion:1,profileVersion:'2',rules:{}},
      sourceCommit:head,specifications:[],runner:{...runner,manifestRef:'.behavproof/manifest.json'},
      inputs:['package.json','behavproof.config.json','src/*.ts'],configPaths:[],manifests:[],
    }));
    const run=spawnSync(process.execPath,[cli,'check','--mode','gate','--trust-root',ref,'--format','json'],{
      cwd:root,encoding:'utf8',timeout:10000,
    });
    expect(run.status,run.stderr).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({status:'incomplete',evaluations:expect.arrayContaining([
      expect.objectContaining({ruleId:'formalRequiredScope',status:'unknown'}),
    ])});
  }finally{await rm(host,{recursive:true,force:true});}
});
