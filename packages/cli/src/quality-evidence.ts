import {z} from 'zod';
import {HashSchema} from '@behavproof/core';
const observation = z.strictObject({
  status:z.enum(['pass','fail','unknown']),
  message:z.string().min(1).max(10000),
});
const fields = z.object({
  schemaVersion:z.literal(1), policyHash:HashSchema,
  lint:observation, types:observation, tests:observation, configuration:observation,
});
export function qualityEvidence(value:unknown, policyHash:string) {
  const data=fields.parse(value);
  if (data.policyHash!==policyHash) throw Error('Quality observation differs from the registered quality policy');
  return {
    lintResult:data.lint,
    typecheckResult:data.types,
    qualityConfiguration:data.tests.status==='pass'?data.configuration:data.tests,
  };
}
