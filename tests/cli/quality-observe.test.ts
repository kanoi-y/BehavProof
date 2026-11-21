import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { observeQuality, QualityObservation } from '../../packages/cli/src/quality-observe.js';
import type { QualityPolicy } from '../../packages/cli/src/quality.js';

const policy: QualityPolicy = {
  schemaVersion: 1,
  id: 'reviewed-quality',
  lint: {tool: 'eslint', rules: ['no-debugger']},
  types: 'strict',
  runner: 'vitest',
  sources: ['src/**/*'],
};
const scripts = {lint: 'eslint src', typecheck: 'tsc --noEmit', test: 'vitest run --config check-runner.mjs'};
const pkg = {
  type: 'module',
  scripts,
  devDependencies: {eslint: '9.39.5', typescript: '7.0.2', vitest: '5.1.0', jest: '30.5.2'},
};
let root: string;
const put = (path: string, value: string | object) => writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'behavproof-observer-'));
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'spec'));
  await put('package.json', pkg);
  await put('eslint.config.mjs', "import shared from './lint-shared.mjs'; export default Array.of(shared);");
  await put('lint-shared.mjs', "export default { rules: { 'no-debugger': 'error' } };");
  await put('tsconfig.json', {extends: './strict.json', include: ['src/**/*']});
  await put('strict.json', {compilerOptions: {strict: true, allowJs: true, checkJs: true, types: []}});
  await put('src/index.js', 'export const count = 1;');
  await put('check-runner.mjs', "import test from './test-shared.mjs'; export default {test};");
  await put('test-shared.mjs', "export default {include: ['spec/**/*.test.mjs']};");
  await put('spec/count.test.mjs', "import {test, expect} from 'vitest'; import {count} from '../src/index.js'; test('count', () => expect(count).toBe(1));");
});

afterEach(() => rm(root, {recursive: true, force: true}));

test('runs real native tests using the command-selected imported configuration', async () => {
  await put('vitest.config.mjs', "throw Error('Wrong config');");
  const result = QualityObservation.parse(await observeQuality(root, policy));
  expect(result.tests).toMatchObject({status: 'pass'});
  expect(result.types).toMatchObject({status: 'pass'});
  expect(result.lint).toMatchObject({status: 'pass'});
  expect(result.configuration).toMatchObject({status: 'pass'});
  const report = JSON.parse(await readFile(join(root, '.behavproof/input/vitest.json'), 'utf8'));
  expect(report.numPassedTests).toBe(1);
});

test('detects strict checking disabled by an inherited setting', async () => {
  await put('strict.json', {compilerOptions: {strict: true, strictNullChecks: false, allowJs: true, checkJs: true, types: []}});
  const result = await observeQuality(root, policy);
  expect(result.types).toMatchObject({status: 'fail', message: expect.stringMatching(/strict/i)});
  expect(result.configuration).toMatchObject({status: 'fail'});
});

test('fails when type checking a covered source reports an error', async () => {
  await put('src/index.js', '/** @type {number} */ export const count = "1";');
  const result = await observeQuality(root, policy);
  expect(result.types).toMatchObject({status: 'fail', message: expect.stringMatching(/src\/index\.js/)});
});

test('fails when imported runner config omits a conventional test file', async () => {
  await put('spec/omitted.test.js', "import {test} from 'vitest'; test('omitted', () => {});");
  await put('test-shared.mjs', "export default {include: ['spec/count.test.mjs']};");
  const result = await observeQuality(root, policy);
  expect(result.configuration).toMatchObject({status: 'fail', message: expect.stringMatching(/omitted\.test\.js/)});
});

test('reports failure when an actual assertion fails', async () => {
  await put('spec/count.test.mjs', "import {test, expect} from 'vitest'; test('count', () => expect(1).toBe(2));");
  expect((await observeQuality(root, policy)).tests).toMatchObject({status: 'fail'});
});

test('does not run lint scripts with shell expressions', async () => {
  await put('package.json', {...pkg, scripts: {...scripts, lint: 'node -e "process.exit(0)" || true'}});
  expect((await observeQuality(root, policy)).lint).toMatchObject({status: 'fail'});
});

test('rejects weakened severity in an imported ESLint configuration', async () => {
  await put('lint-shared.mjs', "export default { rules: { 'no-debugger': 'warn' } };");
  const result = await observeQuality(root, policy);
  expect(result.configuration).toMatchObject({status: 'fail', message: expect.stringMatching(/src\/index\.js \(no-debugger\)/)});
});

test('fails when the adopted lint rule reports a source violation', async () => {
  await put('src/index.js', '/* eslint-disable no-debugger */ debugger; export const count = 1;');
  const result = await observeQuality(root, policy);
  expect(result.lint).toMatchObject({status: 'fail', message: expect.stringMatching(/src\/index\.js/)});
  expect(result.configuration).toMatchObject({status: 'pass'});
});

test('fails when the adopted lint source is outside the actual command targets', async () => {
  await put('src/other.js', 'export const other = 1;');
  await put('package.json', {...pkg, scripts: {...scripts, lint: 'eslint src/index.js'}});
  const result = await observeQuality(root, policy);
  expect(result.configuration).toMatchObject({status: 'fail', message: expect.stringMatching(/src\/other\.js/)});
});

test('uses Jest discovery and confirms the adapter recorded a complete native run', async () => {
  await put('package.json', {...pkg, scripts: {...scripts, test: 'jest --config run-jest.cjs'}});
  await put('jest.config.cjs', "throw Error('Wrong config');");
  await put('run-jest.cjs', "module.exports = {testMatch: ['**/spec/*.test.mjs']};");
  await put('spec/count.test.mjs', "import {test, expect} from '@jest/globals'; test('count', () => expect(1).toBe(1));");
  const result = await observeQuality(root,{...policy,runner:'jest'});
  expect(result.tests).toMatchObject({status: 'pass'});
  const report = JSON.parse(await readFile(join(root, '.behavproof/input/jest.json'), 'utf8'));
  expect(report.numPassedTests).toBe(1);
});
