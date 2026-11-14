// M0 throwaway experiment. This characterizes callback limits; it is not
// the product helper, a production-observation provider, or an approval.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = join(root, '.superpowers/sdd/2026-11-13-behavproof-m2/binding-spike');
await mkdir(work, { recursive: true });
await writeFile(join(work, 'vitest.config.ts'), `export default { test: { root: ${JSON.stringify(work)}, include: ['behavior.test.ts'], maxWorkers: 1 } };\n`);
await writeFile(join(work, 'behavior.test.ts'), `import { test, expect } from 'vitest';
import { canViewOrder } from './order-access';
const cases = [
  { id: 'owner', input: { actorId: 'alice', ownerId: 'alice' }, expected: 'allowed' },
  { id: 'non-owner', input: { actorId: 'bob', ownerId: 'alice' }, expected: 'denied' },
];
const callback = process.env.BEHAVPROOF_SPIKE_CALLBACK === 'fake'
  ? ({ input }) => input.actorId === input.ownerId ? 'allowed' : 'denied'
  : ({ input }) => canViewOrder(input);
test.each(cases)('$id', (c) => expect(callback(c)).toEqual(c.expected));
`);

const observations = [];
for (const variant of [
  { name: 'correct-real', faulty: false, callback: 'real' },
  { name: 'fault-real', faulty: true, callback: 'real' },
  { name: 'fault-fake', faulty: true, callback: 'fake' },
]) {
  const implementation = variant.faulty
    ? `export function canViewOrder(input) { return 'allowed'; }\n`
    : `export function canViewOrder(input) { return input.actorId === input.ownerId ? 'allowed' : 'denied'; }\n`;
  await writeFile(join(work, 'order-access.ts'), implementation);
  const output = join(work, `${variant.name}.json`);
  const started = performance.now();
  let exitCode = 0;
  try {
    await run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', join(work, 'vitest.config.ts'), '--reporter=json', '--outputFile', output], {
      cwd: root, timeout: 60_000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, BEHAVPROOF_SPIKE_CALLBACK: variant.callback },
    });
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    exitCode = error.code;
  }
  const reportBytes = await readFile(output);
  const report = JSON.parse(reportBytes);
  observations.push({
    variant: variant.name, exitCode, elapsedMs: Math.round(performance.now() - started),
    implementationSha256: createHash('sha256').update(implementation).digest('hex'),
    reportSha256: createHash('sha256').update(reportBytes).digest('hex'),
    passed: report.numPassedTests, failed: report.numFailedTests,
    cases: report.testResults.flatMap(file => file.assertionResults.map(c => ({ name: c.title, status: c.status }))),
  });
}
const expected = [[0, 2, 0], [1, 1, 1], [0, 2, 0]];
for (const [index, observation] of observations.entries()) {
  if (JSON.stringify([observation.exitCode, observation.passed, observation.failed]) !== JSON.stringify(expected[index])) {
    throw new Error(`Unexpected experiment outcome: ${JSON.stringify(observation)}`);
  }
}
const evidence = {
  schemaVersion: 1, stage: 'M0-02 preliminary experiment', nodeVersion: process.version,
  vitestVersion: JSON.parse(await readFile(join(root, 'node_modules/vitest/package.json'), 'utf8')).version,
  command: 'node scripts/spikes/binding-limit.mjs', observations,
  conclusion: 'Case comparison can pass against a fake callback while production is faulty; no production-target claim follows from comparison alone.',
  limits: ['Throwaway callback harness, not yet the public BehavProof helper.', 'No hosted CI, external approval, or arbitrary malicious-code resistance claim.'],
};
await mkdir(join(root, 'docs/evidence'), { recursive: true });
await writeFile(join(root, 'docs/evidence/m0-binding-spike.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(observations.map(o => `${o.variant}: exit ${o.exitCode}, ${o.passed} passed / ${o.failed} failed`).join('\n') + '\n');
