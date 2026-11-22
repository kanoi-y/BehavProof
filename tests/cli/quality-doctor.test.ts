import { afterEach, beforeEach, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bin = resolve('packages/cli/dist/index.js');
let root: string;
const put = (path: string, value: string | object) => writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
const lintRules = Object.fromEntries(['no-debugger', 'no-dupe-args', 'no-dupe-keys', 'no-unreachable', 'no-constant-condition'].map(id => [id, 'error']));
const doctor = (...args: string[]) => spawnSync(process.execPath, [bin, 'doctor', '--quality', '--format', 'json', ...args], {cwd: root, encoding: 'utf8'});
const findings = (result: ReturnType<typeof doctor>) => JSON.parse(result.stdout).quality.findings;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'behavproof-quality-'));
  spawnSync('git', ['init', '-q'], {cwd: root});
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'test'));
  await put('package.json', {
    type: 'module', scripts: {lint: 'npm run lint:actual', 'lint:actual': 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run'},
    devDependencies: {eslint: '9.0.0', typescript: '5.9.3', vitest: '5.1.0'},
  });
  await put('eslint.config.mjs', `export default [{files: ['**/*.ts'], rules: ${JSON.stringify(lintRules)}}];`);
  await put('tsconfig.json', {extends: './tsconfig.base.json', include: ['src/**/*.ts']});
  await put('tsconfig.base.json', {compilerOptions: {strict: true}});
  await put('src/index.ts', 'export const n: number = 1;');
  await put('test/index.test.ts', "import { test, expect } from 'vitest'; test('one', () => expect(1).toBe(1));");
});
afterEach(() => rm(root, {recursive: true, force: true}));

test('static effective configuration passes without running candidate tools', () => {
  const result = doctor();
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(findings(result)).toEqual(expect.arrayContaining([
    expect.objectContaining({id: 'lint.rules', status: 'pass'}),
    expect.objectContaining({id: 'types.scope', status: 'pass'}),
    expect.objectContaining({id: 'test.scope', status: 'pass'}),
  ]));
  expect(doctor().stdout).toBe(result.stdout);
});

test('reports a narrow compiler scope, disabled lint rule and focused test', async () => {
  await put('eslint.config.mjs', `export default [{files: ['**/*.ts'], rules: ${JSON.stringify({...lintRules, 'no-debugger': 'warn'})}}];`);
  await put('tsconfig.json', {extends: './tsconfig.base.json', include: ['test/**/*.ts']});
  await put('test/index.test.ts', "import { test as check } from 'vitest'; check.only('one', () => {});");
  const result = doctor();
  expect(result.status).toBe(1);
  for (const id of ['lint.rules', 'types.scope', 'test.focus']) {
    expect(findings(result)).toContainEqual(expect.objectContaining({id, status: 'fail'}));
  }
});

test('never evaluates dynamic configuration and detects failure swallowing and empty-test success', async () => {
  await put('eslint.config.mjs', "import {writeFileSync} from 'node:fs'; writeFileSync('executed', 'yes'); export default [];");
  await put('package.json', {scripts: {lint: 'eslint . || true', typecheck: 'tsc --noEmit', test: 'vitest run --passWithNoTests'}, devDependencies: {eslint: '9', typescript: '5', vitest: '5.1.0'}});
  const result = doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toEqual(expect.arrayContaining([
    expect.objectContaining({id: 'lint.command', status: 'fail'}),
    expect.objectContaining({id: 'lint.rules', status: 'unknown'}),
    expect.objectContaining({id: 'test.command', status: 'fail'}),
  ]));
  await expect(access(join(root, 'executed'))).rejects.toThrow();
});

test('does not treat a Biome --max-diagnostics value as a lint target', async () => {
  await put('package.json', {
    type: 'module', scripts: {lint: 'biome check --max-diagnostics none', typecheck: 'tsc --noEmit', test: 'vitest run'},
    devDependencies: {'@biomejs/biome': '2.0.0', typescript: '5.9.3', vitest: '5.1.0'},
  });
  await put('biome.json', {linter: {rules: {
    suspicious: {'noDebugger': 'error', 'noDuplicateParameters': 'error', 'noDuplicateObjectKeys': 'error'},
    correctness: {'noUnreachable': 'error', 'noConstantCondition': 'error'},
  }}});
  const result = doctor();
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'lint.scope', status: 'pass'}));
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'lint.rules', status: 'pass'}));
});

test('detects a cyclic npm script reference instead of treating it as a lint command', async () => {
  await put('package.json', {
    type: 'module', scripts: {lint: 'npm run lint', typecheck: 'tsc --noEmit', test: 'vitest run'},
    devDependencies: {eslint: '9.0.0', typescript: '5.9.3', vitest: '5.1.0'},
  });
  const result = doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'lint.command', status: 'fail', message: 'Cyclic npm script reference'}));
});

test('rejects a lint configuration path outside the project', async () => {
  await put('package.json', {
    type: 'module', scripts: {lint: 'eslint --config ../outside.json .', typecheck: 'tsc --noEmit', test: 'vitest run'},
    devDependencies: {eslint: '9.0.0', typescript: '5.9.3', vitest: '5.1.0'},
  });
  const result = doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'lint.command', status: 'fail'}));
});

test('reports a broad lint exclusion that removes every selected source', async () => {
  await put('eslint.config.mjs', `export default [{ignores: ['src/**']}, {files: ['**/*.ts'], rules: ${JSON.stringify(lintRules)}}];`);
  const result = doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'lint.scope', status: 'fail'}));
});

test('cannot pass quality when no test files are discovered', async () => {
  await rm(join(root, 'test/index.test.ts'));
  const result = doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toContainEqual(expect.objectContaining({id: 'test.scope', status: 'fail', message: 'No test files match the selected configuration'}));
});

test('doctor preserves structured unsupported diagnostics without package.json', async () => {
  await rm(join(root, 'package.json'));
  const result = doctor();
  expect(result.status, result.stderr).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({support:'unsupported',quality:{status:'incomplete'}});
});

test('Vitest defaults do not discover helper files merely under __tests__', async () => {
  await rm(join(root,'test/index.test.ts'));
  await mkdir(join(root,'__tests__'));
  await put('__tests__/helper.ts','export const helper = 1;');
  const result=doctor();
  expect(result.status).toBe(1);
  expect(findings(result)).toContainEqual(expect.objectContaining({id:'test.scope',status:'fail'}));
});
