import { hashBytes, TestEvidenceReceiptSchema, type EvidenceStatus, type TestEvidenceReceipt } from '@behavproof/core';
import { normalizeJest, normalizeVitest } from './reports.js';

type TestInvocation = Pick<TestEvidenceReceipt, 'invocation' | 'runner'>;

export function captureTestEvidence(
  native: Uint8Array,
  inventory: unknown,
  {invocation, runner}: TestInvocation,
): TestEvidenceReceipt {
  return TestEvidenceReceiptSchema.parse({
    schemaVersion: 1,
    invocation,
    runner,
    nativeHash: hashBytes(native),
    inventory,
  });
}

export function evaluateTestEvidence(
  native: Uint8Array,
  value: unknown,
  {invocation, runner, authenticated}: TestInvocation & {authenticated: boolean},
): {status: EvidenceStatus; payload?: ReturnType<typeof normalizeJest>['payload']} {
  const receipt = TestEvidenceReceiptSchema.safeParse(value);
  if (!authenticated || !receipt.success) return {status: 'unknown' as const};
  const observed = receipt.data;
  if (observed.invocation !== invocation || observed.runner.kind !== runner.kind ||
      observed.runner.version !== runner.version || observed.nativeHash !== hashBytes(native)) {
    return {status: 'unknown' as const};
  }

  const report: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(native));
  const normalize = runner.kind === 'jest' ? normalizeJest : normalizeVitest;
  const result = normalize(report, observed.inventory);
  return result.status === 'pass' && !observed.inventory.complete
    ? {...result, status: 'unknown' as const}
    : result;
}
