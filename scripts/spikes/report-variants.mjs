// M0 throwaway reporter characterization; not a product runner.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = join(root, '.superpowers/sdd/2026-11-13-behavproof-m2/reporter-variants');
await mkdir(work, { recursive: true });
const run = promisify(execFile);
const variants = [
  { name: 'skipped', code: `import {test,expect} from 'vitest'; test('owner',()=>expect('allowed').toBe('allowed')); test.skip('non-owner',()=>expect('allowed').toBe('denied'));`, include: 'skipped.test.ts' },
  { name: 'zero-tests', code: '', include: 'does-not-exist.test.ts' },
];
const results = [];
await mkdir(join(root, 'tests/fixtures/reports'), { recursive: true });
for (const variant of variants) {
  await writeFile(join(work, `${variant.name}.test.ts`), variant.code);
  const config = join(work, `${variant.name}.config.ts`);
  await writeFile(config, `export default {test:{root:${JSON.stringify(work)},include:[${JSON.stringify(variant.include)}],passWithNoTests:true,maxWorkers:1}};`);
  const output = join(work, `${variant.name}.json`);
  let exitCode = 0;
  try {
    await run(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=json', '--outputFile', output], { cwd: root, timeout: 60000, env: { PATH: process.env.PATH } });
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    exitCode = error.code;
  }
  const bytes = await readFile(output, 'utf8');
  const report = JSON.parse(bytes);
  await writeFile(join(root, 'tests/fixtures/reports', `vitest-5.1.0-${variant.name}.json`), bytes.replaceAll(work, '<project-root>'));
  results.push({ variant: variant.name, exitCode, total: report.numTotalTests, passed: report.numPassedTests, skipped: report.numPendingTests, failed: report.numFailedTests, toolSuccess: report.success });
}
const evidence = { schemaVersion: 1, command: 'node scripts/spikes/report-variants.mjs', observations: results, limits: ['Tool success is not proof of required-case execution.', 'Fixtures normalize machine-specific paths only.'] };
await writeFile(join(root, 'docs/evidence/m0-report-variants.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
