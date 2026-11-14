// M0 throwaway check of the pinned Vitest API. Metadata is a declaration,
// not proof of production reach or even comparison execution.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = join(root, '.superpowers/sdd/2026-11-13-behavproof-m2/metadata-spike');
await mkdir(work, { recursive: true });
await writeFile(join(work, 'vitest.config.ts'), `export default {test:{root:${JSON.stringify(work)},include:['metadata.test.ts'],maxWorkers:1}};`);
await writeFile(join(work, 'metadata.test.ts'), `import {test,expect} from 'vitest';
const metadata = caseId => ({behavproof:{contractId:'ORDER-001',caseId,revisionHash:'${'a'.repeat(64)}'}});
test('an unrelated display label', {meta:metadata('owner')}, () => expect('allowed').toEqual('allowed'));
test.skip('a second unrelated display label', {meta:metadata('non-owner')}, () => expect('allowed').toEqual('denied'));
`);
const output = join(work, 'vitest.json');
await promisify(execFile)(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', join(work, 'vitest.config.ts'), '--reporter=json', '--outputFile', output], { cwd: root, timeout: 60000, env: { PATH: process.env.PATH } });
const report = JSON.parse(await readFile(output, 'utf8'));
const cases = report.testResults.flatMap(file => file.assertionResults.map(c => ({ title: c.title, status: c.status, declaredIdentity: c.meta?.behavproof })));
if (cases.length !== 2 || cases[0].declaredIdentity?.caseId !== 'owner' || cases[1].declaredIdentity?.caseId !== 'non-owner' || cases[1].status !== 'skipped') throw new Error('Pinned Vitest metadata assumption does not hold');
const result = { schemaVersion: 1, command: 'node scripts/spikes/metadata-binding.mjs', vitestVersion: '5.1.0', exitCode: 0, cases, conclusion: 'Registration metadata survives JSON reporting for executed and skipped cases independently of their display labels.', limits: ['Metadata alone is a declaration. Runtime comparisons and binding hashes are separate evidence.', 'The public BehavProof helper and reporter are not implemented by this spike.'] };
await writeFile(join(root, 'docs/evidence/m0-metadata-binding.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(cases, null, 2) + '\n');
