import {expect, it} from 'vitest';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {captureTestEvidence, collect} from '../../packages/adapter-reports/src/index.js';
import {hash} from '../../packages/core/src/index.js';

it('uses a receipt only from the host-selected native execution, without a Contract report', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'behavproof-receipt-'));
  const root = join(scratch, 'project');
  const trustPath = join(scratch, 'trust.json');
  const nativeRef = '.behavproof/input/jest.json';
  const runner = {kind: 'jest', version: '30.5.2'} as const;
  const config = {schemaVersion: 2, profile: 'basic', git: {base: 'HEAD'},
    testRunner: 'jest', reports: {jest: nativeRef}, rules: {testResult: {severity: 'error'}}};
  const policyHash=hash({rule:'fixture'});
  const finding={status:'pass',message:'Quality observation reports success'};
  const producer = {tool: 'fixture', version: '1', collectorVersion: '1'};
  const inputs = ['.gitignore','package.json','behavproof.config.json','produce.mjs'];
  const native = Buffer.from(JSON.stringify({
    success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: 1,
    numPassedTestSuites: 1, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{name: 'sample.test.cjs', status: 'passed', assertionResults: [
      {title: 'example', fullName: 'example', ancestorTitles: [], status: 'passed'},
    ]}],
  }));
  const inventory = {complete: true, suiteCount: 1, testCount: 1,
    files: ['sample.test.cjs'], suiteIds: ['suite'], testIds: ['test']};
  try {
    await mkdir(join(root, '.behavproof/input'), {recursive: true});
    await writeFile(join(root, '.gitignore'), '.behavproof/\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'normal-tests', scripts: {test: 'jest'}, devDependencies: {jest: runner.version},
    }));
    await writeFile(join(root, 'behavproof.config.json'), JSON.stringify(config));
    await writeFile(join(root, 'produce.mjs'), `import {copyFile} from 'node:fs/promises';
if (process.env.BEHAVPROOF_EXECUTION_ID !== 'current-run') throw Error('Collector did not select the test invocation');
for (const name of ['jest.json','receipt.json','quality.json']) await copyFile('.behavproof/input/'+name, process.env.BEHAVPROOF_OUTPUT_DIR+'/'+name);`);
    const git = (...args: string[]) => execFileSync('git', [
      '-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', ...args,
    ], {cwd: root, encoding: 'utf8'}).trim();
    git('init', '-qb', 'main');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const head = git('rev-parse', 'HEAD');
    await writeFile(join(root, nativeRef), native);
    await writeFile(join(root,'.behavproof/input/quality.json'),JSON.stringify({schemaVersion:1,policyHash,
      lint:finding,types:finding,configuration:finding,tests:finding}));
    for (const invocation of ['current-run', 'other-run', 'not-collected']) {
      const executionId = 'current-run';
      const receipt = captureTestEvidence(native, inventory, {invocation, runner});
      await writeFile(join(root, '.behavproof/input/receipt.json'), JSON.stringify(receipt));
      const artifacts = [{ref: 'jest.json', kind: 'test', scope: []},
        {ref:'quality.json',kind:'quality_observation',scope:[]},
        ...(invocation==='not-collected'?[]:[{ref:'receipt.json',kind:'test_receipt',scope:[]}])];
      const manifest = await collect({root, executionId, command: process.execPath,
        args: ['produce.mjs'], inputPaths: inputs, configPaths: ['behavproof.config.json'],
        outputRoot: '.behavproof', producer, artifacts, prHead: head, base: head});
      expect(manifest.exitCode).toBe(0);
      const ref = '.behavproof/current-run/manifest.json';
      await writeFile(join(root, ref), JSON.stringify(manifest));
      await writeFile(trustPath, JSON.stringify({
        schemaVersion: 2, config: {...config, reports: {jest: '.behavproof/current-run/jest.json'}},
        policy: {schemaVersion: 1, profileVersion: '2', rules: config.rules},
        sourceCommit: head, specifications: [],
        quality:{policyHash,reportRef:'.behavproof/current-run/quality.json'},
        inputs, configPaths: ['behavproof.config.json'], runner: {...runner, manifestRef: ref},
        manifests: [{ref, manifestHash: hash(manifest),
          expected: {executionId, commandHash: manifest.commandHash, subject: manifest.subject,
            configHashes: manifest.configHashes,
            artifacts: artifacts.map(row => ({...row, ref: '.behavproof/current-run/' + row.ref}))},
          authority: {kind: 'local', producer, executionId, commandHash: manifest.commandHash}}],
      }));
      const result = spawnSync(process.execPath, [resolve('packages/cli/dist/index.js'),
        'check', '--mode', 'gate', '--trust-root', trustPath, '--format', 'json'],
      {cwd: root, encoding: 'utf8', timeout: 10000});
      expect(result.stdout, result.stderr).toBeTruthy();
      const evaluated = JSON.parse(result.stdout).evaluations;
      const expected = invocation === executionId ? 'pass' : 'unknown';
      expect.soft(result.status, result.stdout + result.stderr).toBe(expected === 'pass' ? 0 : 1);
      expect.soft(evaluated.find((row: {ruleId: string}) => row.ruleId === 'testResult').status).toBe(expected);
      expect.soft(evaluated.find((row: {ruleId: string}) => row.ruleId === 'testRunnerProtection').status).toBe(expected);
      await rm(join(root, '.behavproof/current-run'), {recursive: true});
    }
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
});
