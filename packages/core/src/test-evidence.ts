import { z } from 'zod';
import { HashSchema } from './schemas.js';

const identity = z.string().min(1);
const inventoryIds = z.array(identity).refine(
  ids => new Set(ids).size === ids.length,
  'Duplicate inventory identities',
);

export const TestEvidenceReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  invocation: identity,
  runner: z.strictObject({kind: z.enum(['jest', 'vitest']), version: identity}),
  nativeHash: HashSchema,
  inventory: z.strictObject({
    complete: z.boolean(),
    suiteCount: z.number().int().nonnegative(),
    testCount: z.number().int().nonnegative(),
    files: inventoryIds,
    suiteIds: inventoryIds,
    testIds: inventoryIds,
  }).refine(
    inventory => inventory.suiteCount === inventory.suiteIds.length &&
      inventory.testCount === inventory.testIds.length && inventory.files.length <= inventory.suiteCount,
    'Inventory counts must match observed identities',
  ),
});

export type TestEvidenceReceipt = z.infer<typeof TestEvidenceReceiptSchema>;
