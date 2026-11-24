import { test, expect } from 'vitest';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('packages/cli/dist/index.js');
test('a protected CI proposal is deterministic and applies only after every destination is checked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'behavproof-ci-plan-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli,'ci',...args], {cwd:root,encoding:'utf8'});
  const options = ['--repository','demo/shop','--branch','release/v1','--workflow-branch','automation','--sdk-sha','d'.repeat(40),'--app-id','12345','--runner','vitest'];
  const producer = '.github/workflows/behavproof-producer.yml';
  const publisher = '.github/workflows/behavproof-publisher.yml';
  try {
    spawnSync('git',['init','-q'],{cwd:root});
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
    const preview = run('plan',...options);
    expect(preview.status,preview.stderr).toBe(0);
    expect(run('plan',...options).stdout).toBe(preview.stdout);
    const proposal = JSON.parse(preview.stdout);
    expect(proposal.deployment).toMatchObject({repository:'demo/shop',protectedBranch:'release/v1',workflowBranch:'automation',appId:12345});
    expect(proposal.unresolved).toEqual(['sources','workflowSha']);
    const noRunner = run('plan',...options.slice(0,-2));
    expect(noRunner.status,noRunner.stderr).toBe(0);
    expect(JSON.parse(noRunner.stdout).unresolved).toEqual(['runner','sources','workflowSha']);
    expect(proposal.files.map((file: {path:string}) => file.path)).toContain(producer);
    await writeFile(join(root,'proposal.json'),preview.stdout);
    expect(run('apply','--plan','proposal.json','--dry-run').status).toBe(0);
    await expect(readFile(join(root,producer))).rejects.toThrow();
    await mkdir(join(root,'.github/workflows'),{recursive:true});
    await writeFile(join(root,publisher),'keep this');
    expect(run('apply','--plan','proposal.json').status).toBe(1);
    await expect(readFile(join(root,producer))).rejects.toThrow();
    expect(await readFile(join(root,publisher),'utf8')).toBe('keep this');
    await rm(join(root,publisher));
    const applied = run('apply','--plan','proposal.json');
    expect(applied.status,applied.stderr).toBe(0);
    const rerun = run('apply','--plan','proposal.json');
    expect(rerun.status,rerun.stderr).toBe(0);
    expect(JSON.parse(rerun.stdout).files.every((file:{action:string}) => file.action==='preserve')).toBe(true);
    expect(run('plan',...options.slice(0,-2),'--runner','vitest','--repository','bad/../target').status).toBe(2);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('ci apply rejects symlinked and hardlinked destinations before writing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'behavproof-ci-plan-links-'));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli,'ci',...args], {cwd:root,encoding:'utf8'});
  const options = ['--repository','demo/shop','--branch','release/v1','--workflow-branch','automation','--sdk-sha','d'.repeat(40),'--app-id','12345','--runner','vitest'];
  const producer = '.github/workflows/behavproof-producer.yml';
  const publisher = '.github/workflows/behavproof-publisher.yml';
  try {
    spawnSync('git',['init','-q'],{cwd:root});
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
    const preview = run('plan',...options);
    expect(preview.status,preview.stderr).toBe(0);
    await writeFile(join(root,'proposal.json'),preview.stdout);
    await mkdir(join(root,'.github/workflows'),{recursive:true});
    await writeFile(join(root,'target.txt'),'keep this');
    await symlink(join(root,'target.txt'),join(root,publisher));
    const linked = run('apply','--plan','proposal.json');
    expect(linked.status).toBe(1);
    expect(JSON.parse(linked.stdout).status).toBe('conflict');
    await expect(readFile(join(root,producer))).rejects.toThrow();
    expect(await readFile(join(root,'target.txt'),'utf8')).toBe('keep this');
    await rm(join(root,publisher));
    await writeFile(join(root,publisher),'keep this');
    await link(join(root,publisher),join(root,'other.txt'));
    const hardlinked = run('apply','--plan','proposal.json');
    expect(hardlinked.status).toBe(1);
    expect(JSON.parse(hardlinked.stdout).status).toBe('conflict');
    await expect(readFile(join(root,producer))).rejects.toThrow();
    expect(await readFile(join(root,publisher),'utf8')).toBe('keep this');
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('generated workflows are valid YAML and only call runtime commands present in the distribution', async () => {
  const {Deployment, packageFiles} = await import('../../packages/cli/src/ci-plan.js');
  const {parseGitHubWorkflow} = await import('@behavproof/adapter-github');
  const deployment = Deployment.parse({repository:'demo/shop',protectedBranch:'release/v1',workflowBranch:'automation',
    sdkSha:'d'.repeat(40),appId:12345,checkName:'BehavProof protected gate',environment:'behavproof-publisher',
    producerPath:'.github/workflows/behavproof-producer.yml',publisherPath:'.github/workflows/behavproof-publisher.yml',
    policyPath:'.github/behavproof/quality-policy.json',configPath:'behavproof.config.json'});
  const policy = {schemaVersion:1,id:'quality-baseline-v1',lint:{tool:'eslint',rules:['no-debugger']},types:'strict',runner:'vitest',sources:['src/index.ts']};
  const files = Object.fromEntries(packageFiles(deployment,policy).map(file => [file.path,file.content]));
  const producer = parseGitHubWorkflow(files['.github/workflows/behavproof-producer.yml']) as Record<string,any>;
  const publisher = parseGitHubWorkflow(files['.github/workflows/behavproof-publisher.yml']) as Record<string,any>;
  expect(Object.keys(producer.jobs)).toEqual(['collect']);
  expect(Object.keys(publisher.jobs)).toEqual(['gate']);
  expect(producer.on.workflow_dispatch.inputs.pr.required).toBe(true);
  expect(publisher.on.workflow_dispatch.inputs.producer_run.required).toBe(true);
  const sdkPaths = [
    'package.json', 'package-lock.json', 'scripts/build-commonjs.mjs', 'scripts/build-artifacts.mjs',
    'scripts/quality-ci.mjs', 'scripts/quality-ci-protocol.mjs', 'scripts/quality-ci-sandbox-entry.mjs', 'scripts/quality-ci-sandbox.mjs',
    'scripts/prepare-sandbox-sdk.mjs', 'scripts/protected-checkout.mjs', 'scripts/protected-container-image.mjs', 'scripts/staged-sdk.mjs',
    'packages/cli/src/api.ts', 'packages/cli/src/quality-ci-worker.ts', 'packages/cli/src/quality-observe.ts',
  ];
  for (const path of sdkPaths) {
    const dist = path.replace(/^packages\/([^/]+)\/src\//, 'packages/$1/dist/').replace(/\.ts$/, '.js');
    await expect(readFile(resolve(dist))).resolves.toBeDefined();
  }
  const runs = [...Object.values(files)].flatMap(content => content.split('\n').filter(line => /^\s*(- )?run: /.test(line)).map(line => line.replace(/^\s*(- )?run: /, '').trim()));
  expect(runs).toEqual(['npm ci --ignore-scripts','npm run build','node scripts/quality-ci.mjs produce','npm ci --ignore-scripts','npm run build','node scripts/quality-ci.mjs publish']);
  for (const command of runs.filter(run => run.startsWith('node '))) {
    await expect(readFile(resolve(command.split(' ')[1]!))).resolves.toBeDefined();
  }
});

test('ci plan resolves a policy runner and rejects a contrary configured runner', async () => {
  const {planCI}=await import('../../packages/cli/src/ci-plan.js');
  const root=await mkdtemp(join(tmpdir(),'behavproof-plan-runners-'));
  const options={repository:'demo/shop',branch:'main','sdk-sha':'d'.repeat(40),'app-id':'12345','quality-policy':'quality.json'};
  try {
    await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0',jest:'30.5.2'}}));
    await writeFile(join(root,'quality.json'),JSON.stringify({schemaVersion:1,id:'reviewed',lint:{tool:'eslint',rules:['no-debugger']},types:'strict',runner:'vitest',sources:['src/**/*']}));
    expect((await planCI(root,options)).unresolved).not.toContain('runner');
    await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:2,testRunner:'jest'}));
    await expect(planCI(root,{...options,runner:'vitest'})).rejects.toThrow(/runner/i);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
