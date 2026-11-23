import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { captureTestEvidence, evaluateTestEvidence } from '../../packages/adapter-reports/src/test-evidence.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const vitestReporter = fileURLToPath(import.meta.resolve('@behavproof/adapter-reports/vitest-inventory-reporter'));
const jestReporter = createRequire(import.meta.url).resolve('@behavproof/adapter-reports/jest-inventory-reporter');
const run = promisify(execFile);
type Runner = 'vitest' | 'jest' | 'jest29';

async function observe(runner: Runner, sources: string[], args: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'behavproof-native-inventory-'));
  const vitest = runner === 'vitest';
  try {
    await symlink(join(workspace, 'node_modules'), join(root, 'node_modules'), 'junction');
    await writeFile(join(root, 'package.json'), '{}');
    const files = sources.map((_, index) => join(root, `fixture-${index}.test.${vitest ? 'mjs' : 'cjs'}`));
    await Promise.all(files.map((file, index) => writeFile(file, sources[index]!)));
    const inventoryPath = join(root, 'inventory.json');
    const reportPath = join(root, 'native.json');
    const entry = join(workspace, 'node_modules', runner, vitest ? 'vitest.mjs' : 'bin/jest.js');
    const flags = vitest
      ? ['run', '--maxWorkers=1', '--reporter=json', `--reporter=${vitestReporter}`, '--outputFile', reportPath]
      : ['--ci', '--runInBand', '--watchman=false', '--testMatch=**/*.test.cjs', '--json', '--outputFile', reportPath, '--reporters', jestReporter];
    const result = await run(process.execPath, [entry, ...flags, ...args], {
      cwd: root,
      env: { ...process.env, BEHAVPROOF_TEST_INVENTORY: inventoryPath },
      timeout: 10000,
    }).then(output => ({ code: 0, output }), error => ({ code: error.code, output: error }));
    const inventory = await readFile(inventoryPath, 'utf8').then(value => JSON.parse(value), () => undefined);
    expect(inventory, result.output.stdout + result.output.stderr).toBeDefined();
    const native = await readFile(reportPath).catch(() => undefined);
    return { code: result.code, native, inventory };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function evidence(kind: 'vitest' | 'jest', version: string, observation: Awaited<ReturnType<typeof observe>>) {
  const { native, inventory } = observation;
  expect(native).toBeDefined();
  const expected = { invocation: 'native-reporter-fixture', runner: { kind, version }, authenticated: true };
  const receipt = captureTestEvidence(native!, inventory, expected);
  return evaluateTestEvidence(native!, receipt, expected).status;
}

it('records Vitest file and nested suite identities from ordinary tests', async () => {
  const result = await observe('vitest', [
    `import { describe, test } from 'vitest';
     describe('group', () => {
       describe('nested', () => test('same title', () => {}));
       describe('nested', () => test('same title', () => {}));
     });`,
  ]);
  expect(result.code).toBe(0);
  expect(result.inventory).toMatchObject({ complete: true, suiteCount: 4, testCount: 2 });
  expect(result.inventory.files).toHaveLength(1);
  expect(evidence('vitest', '5.1.0', result)).toBe('pass');
});

it('marks a Vitest module that fails to load as incomplete', async () => {
  const result = await observe('vitest', ["throw Error('fixture failed to load');"]);
  expect(result.code).toBe(1);
  expect(result.inventory).toMatchObject({ complete: false, suiteCount: 1, testCount: 0 });
  expect(evidence('vitest', '5.1.0', result)).toBe('fail');
});

it.each([['jest', '30.5.2'], ['jest29', '29.7.0']] as const)(
  'records a complete %s result with one suite per test file', async (runner, version) => {
    const result = await observe(runner, [
      "describe('group', () => { describe('nested', () => test('first', () => {})); }); test('second', () => {});",
      "test('second', () => {});",
    ]);
    expect(result.code).toBe(0);
    expect(result.inventory).toMatchObject({ complete: true, suiteCount: 2, testCount: 3 });
    expect(evidence('jest', version, result)).toBe('pass');
  },
);

it('keeps an observed Jest assertion failure distinct from a runtime failure', async () => {
  const failedAssertion = await observe('jest', ["test('fails', () => expect(1).toBe(2));"]);
  expect(failedAssertion.code).toBe(1);
  expect(failedAssertion.inventory).toMatchObject({ complete: true, suiteCount: 1, testCount: 1 });
  expect(evidence('jest', '30.5.2', failedAssertion)).toBe('fail');

  const failedModule = await observe('jest', ["throw Error('fixture failed to load');"]);
  expect(failedModule.code).toBe(1);
  expect(failedModule.inventory).toMatchObject({ complete: false, suiteCount: 1, testCount: 0 });
  expect(evidence('jest', '30.5.2', failedModule)).toBe('fail');
});

it('marks duplicate Jest assertions as incomplete with distinct observed IDs', async () => {
  const result = await observe('jest', ["test('duplicate', () => {}); test('duplicate', () => {});"]);
  expect(result.code).toBe(0);
  expect(result.inventory).toMatchObject({ complete: false, suiteCount: 1, testCount: 2 });
  expect(new Set(result.inventory.testIds).size).toBe(2);
  expect(evidence('jest', '30.5.2', result)).toBe('unknown');
});

it.each([['jest', '30.5.2'], ['jest29', '29.7.0']] as const)(
  'marks successful %s retries as incomplete', async (runner, version) => {
    const result = await observe(runner, ["let attempts = 0; jest.retryTimes(1); test('intermittent', () => expect(++attempts).toBe(2));"]);
    expect(result.code).toBe(0);
    expect(result.inventory).toMatchObject({ complete: false, suiteCount: 1, testCount: 1 });
    expect(evidence('jest', version, result)).toBe('unknown');
  },
);

it('marks Jest inventory incomplete when bail prevents a file from running', async () => {
  const source = "test('fails', () => expect(1).toBe(2));";
  const result = await observe('jest', [source, source], ['--bail']);
  expect(result.code).toBe(1);
  expect(result.inventory).toMatchObject({ complete: false, suiteCount: 1, testCount: 1 });
});
