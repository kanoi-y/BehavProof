import { expect, it } from 'vitest';
import { captureTestEvidence, evaluateTestEvidence } from '../../packages/adapter-reports/src/index.js';

const file = '/project/nested.test.js';
const runner = (kind: 'jest' | 'vitest') => ({ kind, version: kind === 'jest' ? '30.5.2' : '5.1.0' });
const invocation = 'test-invocation';

function reports(kind: 'jest' | 'vitest') {
  const suiteCount = kind === 'jest' ? 1 : 2;
  const native = Buffer.from(JSON.stringify({
    success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: suiteCount,
    numPassedTestSuites: suiteCount, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{ name: file, status: 'passed', assertionResults: [
      { title: 'example', fullName: 'suite example', ancestorTitles: ['suite'], status: 'passed' },
    ] }],
  }));
  const inventory = {
    suiteCount, testCount: 1, files: [file], complete: true,
    suiteIds: kind === 'jest' ? ['file'] : ['file', 'suite'],
    testIds: ['test'],
  };
  return { native, inventory };
}

it.each(['jest', 'vitest'] as const)('binds %s native results and inventory to the selected invocation', (kind) => {
  const {native, inventory} = reports(kind);
  const expected = { runner: runner(kind), invocation, authenticated: true };
  const receipt = captureTestEvidence(native, inventory, expected);
  expect(evaluateTestEvidence(native, receipt, expected).status).toBe('pass');
  expect(evaluateTestEvidence(Buffer.concat([native, Buffer.from('\n')]), receipt, expected).status).toBe('unknown');
  expect(evaluateTestEvidence(native, receipt, {...expected, invocation: 'other-run'}).status).toBe('unknown');
  expect(evaluateTestEvidence(native, receipt, {...expected, runner: {...expected.runner, version: 'different'}}).status).toBe('unknown');
});

it('cannot award success to evidence with incomplete, missing, or duplicate inventory identities', () => {
  const {native, inventory} = reports('vitest');
  const expected = {runner: runner('vitest'), invocation, authenticated: true};
  const receipt = captureTestEvidence(native, inventory, expected);
  expect(evaluateTestEvidence(native, receipt, {...expected, authenticated: false}).status).toBe('unknown');
  expect(evaluateTestEvidence(native, undefined, expected).status).toBe('unknown');
  expect(evaluateTestEvidence(native, {...receipt, inventory: {...inventory, complete: false}}, expected).status).toBe('unknown');
  expect(evaluateTestEvidence(native, {...receipt, inventory: {...inventory, suiteIds: ['file', 'file']}}, expected).status).toBe('unknown');
  expect(evaluateTestEvidence(native, {...receipt, inventory: {...inventory, testIds: []}}, expected).status).toBe('unknown');
});
