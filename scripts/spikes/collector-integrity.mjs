// M0 integration experiment using the public Collector and core validation.
// Local producer authority is chosen by this invoking process. It is not CI
// authentication, an approval, or a sandbox against a malicious runner.
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { collect, gitSubject, normalizeVitest } from '@behavproof/adapter-reports';
import { hash, hashBytes, validateManifest } from '@behavproof/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = join(root, '.superpowers/sdd/2026-11-13-behavproof-m2');
const fixture = await mkdtemp(join(scratch, 'collector-spike-'));
const execute = promisify(execFile);
const git = (...args) => execute('git', ['-c', 'core.hooksPath=.no-hooks', '-c', 'core.fsmonitor=false', ...args], { cwd: fixture, timeout: 30000 });
await mkdir(join(fixture, '.behavproof/collected'), { recursive: true });
await symlink(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir');
const implementation = `export function canViewOrder(input) { return input.actorId === input.ownerId ? 'allowed' : 'denied'; }\n`;
const files = {
  '.gitignore': 'node_modules/\n.behavproof/\n',
  'package.json': '{"name":"behavproof-m0-collector","private":true,"type":"module","devDependencies":{"vitest":"5.1.0"}}\n',
  'order-access.ts': implementation,
  'behavior.test.ts': `import {test,expect} from 'vitest'; import {canViewOrder} from './order-access'; test('owner',()=>expect(canViewOrder({actorId:'alice',ownerId:'alice'})).toBe('allowed')); test('non-owner',()=>expect(canViewOrder({actorId:'bob',ownerId:'alice'})).toBe('denied'));\n`,
  'vitest.config.mjs': `export default {test:{include:['behavior.test.ts'],maxWorkers:1}};\n`,
  'runner.mjs': `import {execFileSync} from 'node:child_process'; import {join} from 'node:path'; execFileSync(process.execPath,[${JSON.stringify(join(root, 'node_modules/vitest/vitest.mjs'))},'run','--config','vitest.config.mjs','--reporter=json','--outputFile',join(process.env.BEHAVPROOF_OUTPUT_DIR,'vitest.json')],{stdio:'inherit'});\n`,
};
for (const [path, contents] of Object.entries(files)) await writeFile(join(fixture, path), contents);
await git('init', '--initial-branch=main');
await git('config', 'core.fsmonitor', 'false');
await git('add', '.');
await git('-c', 'user.name=BehavProof fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'M0 controlled fixture');
const inputPaths = Object.keys(files);
const subject = await gitSubject(fixture, inputPaths);
if (subject.dirty) throw new Error('Fixture must begin with clean inputs');
const producer = { tool: 'vitest', version: '5.1.0', collectorVersion: '0.1.0' };
const command = process.execPath;
const args = ['runner.mjs'];
const configHashes = { 'vitest.config.mjs': hashBytes(Buffer.from(files['vitest.config.mjs'])) };
const options = { root: fixture, executionId: 'm0-valid', command, args, inputPaths, configPaths: ['vitest.config.mjs'], outputRoot: '.behavproof/collected', artifacts: [{ ref: 'vitest.json', kind: 'test', scope: ['order-access.ts'] }], producer, timeoutMs: 60000 };
const manifest = await collect(options);
const artifactRef = '.behavproof/collected/m0-valid/vitest.json';
const bytes = await readFile(join(fixture, artifactRef));
const expected = { executionId: 'm0-valid', subject, commandHash: hash({ command, args }), configHashes, artifacts: [{ ref: artifactRef, kind: 'test', scope: ['order-access.ts'] }] };
const authority = { kind: 'local', producer, executionId: 'm0-valid', commandHash: expected.commandHash };
const valid = validateManifest(manifest, expected, { [artifactRef]: bytes }, authority);
const tampered = validateManifest(manifest, expected, { [artifactRef]: Buffer.concat([bytes, Buffer.from(' ')]) }, authority);
const stale = validateManifest(manifest, { ...expected, executionId: 'm0-new-run' }, { [artifactRef]: bytes }, authority);
const unauthenticated = validateManifest(manifest, expected, { [artifactRef]: bytes }, undefined);
if (valid.artifactIntegrity !== 'pass' || valid.producerTrust !== 'pass' || valid.subjectMatch !== 'pass' || valid.executionStatus !== 'pass') throw new Error('Valid controlled execution was not verified');
if (tampered.artifactIntegrity !== 'fail' || stale.subjectMatch !== 'fail' || unauthenticated.producerTrust !== 'unknown') throw new Error('Negative provenance case was incorrectly accepted');
const failed = await collect({ ...options, executionId: 'm0-failed', args: ['-e', 'process.exit(7)'] });
if (failed.exitCode !== 7 || failed.artifacts.length !== 0) throw new Error('Failed producer sealed success artifacts');
await writeFile(join(fixture, 'runner.mjs'), files['runner.mjs'] + `import {appendFileSync} from 'node:fs'; appendFileSync('order-access.ts','// changed during execution\\n');\n`);
// The deliberate change to runner.mjs is committed before capturing this run.
await git('add', 'runner.mjs');
await git('-c', 'user.name=BehavProof fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'M0 input mutation probe');
let mutationRejected = false;
try { await collect({ ...options, executionId: 'm0-input-mutation' }); }
catch (error) { mutationRejected = /Inputs changed during collection/.test(String(error)); }
if (!mutationRejected) throw new Error('Persistent input mutation was not rejected');
const result = {
  schemaVersion: 1, command: 'node scripts/spikes/collector-integrity.mjs', nodeVersion: process.version,
  collectorApi: '@behavproof/adapter-reports collect', subject,
  vitest: normalizeVitest(JSON.parse(bytes)), valid, tampered, stale, unauthenticated,
  failedProducer: { exitCode: failed.exitCode, sealedArtifacts: failed.artifacts.length }, mutationRejected,
  limits: ['Local invoker explicitly supplied authority; no CI or human approval claim.', 'Root workspace dependencies were used by the controlled fixture.', 'Persistent input change was tested; this is not proof against transient mutation or hostile descendants.'],
};
await writeFile(join(root, 'docs/evidence/m0-collector-integrity.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write('Valid execution verified; tampered/stale/untrusted evidence rejected; failed producer sealed 0 artifacts; persistent input mutation rejected.\n');
