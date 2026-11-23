import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, test, vi} from 'vitest';
import {runQualitySandbox, validateQualityInstall} from '../../scripts/quality-ci-sandbox.mjs';
import {requireUnchangedQualitySource} from '../../packages/cli/src/quality-ci-worker.js';

vi.mock('../../scripts/staged-sdk.mjs', () => ({
  validateStagedSdk: async (path: string) => ({path, inventory: {built: true, platform: 'linux', arch: 'x64'}}),
}));

const registry = 'https://registry.npmjs.org/';
const manifest = {name: 'independent-project', version: '1.0.0', dependencies: {eslint: '^9.39.5'}};
const dependency = {
  version: '9.39.5',
  resolved: registry + 'eslint/-/eslint-9.39.5.tgz',
  integrity: 'sha512-' + Buffer.alloc(64, 5).toString('base64'),
};
const lock = {
  name: manifest.name,
  lockfileVersion: 3,
  packages: {'': manifest, 'node_modules/eslint': dependency},
};

test('the protected install accepts a public npm tarball with SHA-512 integrity', () => {
  expect(() => validateQualityInstall(manifest, lock)).not.toThrow();
});

test.each([
  ['unapproved URL', {...dependency, resolved: 'https://other.invalid/eslint/-/eslint-9.39.5.tgz'}],
  ['URL credentials', {...dependency, resolved: 'https://token@registry.npmjs.org/eslint/-/eslint-9.39.5.tgz'}],
  ['malformed digest', {...dependency, integrity: 'sha512-incomplete'}],
  ['local archive', {...dependency, resolved: 'file:../local.tgz'}],
  ['local link', {...dependency, link: true}],
  ['transitive git spec', {...dependency, dependencies: {rogue: 'github:owner/repo'}}],
  ['transitive URL', {...dependency, optionalDependencies: {rogue: 'https://registry.npmjs.org/rogue.tgz'}}],
])('the protected install rejects %s', (_, entry) => {
  expect(() => validateQualityInstall(manifest, {...lock, packages: {...lock.packages, 'node_modules/eslint': entry}})).toThrow();
});

test('the protected install rejects workspace and local manifest dependency resolution', () => {
  expect(() => validateQualityInstall({...manifest, workspaces: ['packages/*']}, lock)).toThrow();
  expect(() => validateQualityInstall({...manifest, dependencies: {eslint: '../rogue'}}, lock)).toThrow();
  expect(() => validateQualityInstall(manifest, {...lock, packages: {...lock.packages, 'node_modules/../rogue': dependency}})).toThrow();
});

async function fixture(body: (input: {sourceRoot: string, stagedSdk: string, outputDir: string, requestPath: string, executionId: string}) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), 'quality-sandbox-test-'));
  try {
    const sourceRoot = join(scratch, 'source'), stagedSdk = join(scratch, 'sdk');
    const outputDir = join(scratch, 'output'), requestPath = join(scratch, 'request.json');
    await Promise.all([sourceRoot, stagedSdk, outputDir].map(path => mkdir(path)));
    await Promise.all([
      writeFile(join(sourceRoot, 'package.json'), JSON.stringify(manifest)),
      writeFile(join(sourceRoot, 'package-lock.json'), JSON.stringify(lock)),
      writeFile(requestPath, JSON.stringify({runnerVersion: '5.1.0', executionId: 'untrusted-value'})),
    ]);
    await body({sourceRoot, stagedSdk, outputDir, requestPath, executionId: 'fixture-run'});
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}

function dockerDouble(payload: Record<string, string>, inspectStatus = 1) {
  const calls: string[][] = [];
  const requests: unknown[] = [];
  const docker = (args: string[]) => {
    calls.push(args);
    const requestMount = args.find(arg => arg.includes(',dst=/request.json,'));
    if (requestMount) requests.push(JSON.parse(readFileSync(requestMount.split(',')[1]!.slice('src='.length), 'utf8')));
    if (args[0] === 'run') return {
      status: 0,
      stdout: Buffer.from(args[args.indexOf('--network') + 1] === 'none' ? JSON.stringify(payload) : ''),
      stderr: Buffer.alloc(0),
    };
    if (args[0] === 'container') return {
      status: inspectStatus,
      stderr: Buffer.from(inspectStatus === 1 ? 'Error: No such container: fixture' : ''),
    };
    return {status: 0};
  };
  return {calls, requests, docker};
}

const report = Buffer.from('{}\n').toString('base64');
const payload = {'quality.json': report, 'native.json': report, 'test-receipt.json': report};

test('the worker compares original source bytes while allowing generated files', async () => {
  await fixture(async ({sourceRoot, outputDir}) => {
    await writeFile(join(sourceRoot, 'src.ts'), 'export const exact = true;');
    for (const file of ['package.json', 'package-lock.json', 'src.ts']) {
      await writeFile(join(outputDir, file), await readFile(join(sourceRoot, file)));
    }
    await writeFile(join(outputDir, 'generated.js'), 'created during observation');
    await expect(requireUnchangedQualitySource(sourceRoot, outputDir)).resolves.toBeUndefined();
    await writeFile(join(outputDir, 'src.ts'), 'export const exact = false;');
    await expect(requireUnchangedQualitySource(sourceRoot, outputDir)).rejects.toThrow(/source changed/i);
    await rm(join(outputDir, 'src.ts'));
    await expect(requireUnchangedQualitySource(sourceRoot, outputDir)).rejects.toThrow(/source changed/i);
  });
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('the offline worker receives read-only mounts and exports only bounded reports', async () => {
  await fixture(async input => {
    const {calls, requests, docker} = dockerDouble(payload);
    expect(await runQualitySandbox(input, {docker})).toBe(0);
    expect(await readFile(join(input.outputDir, 'quality.json'), 'utf8')).toBe('{}\n');
    expect(requests).toEqual([{runnerVersion: '5.1.0', executionId: 'fixture-run'}]);
    const [install, worker] = calls.filter(args => args[0] === 'run');
    expect(install).toEqual(expect.arrayContaining(['--network', 'bridge', '--read-only']));
    for(const args of [install, worker]){
      expect(args).toEqual(expect.arrayContaining(['--log-driver','local','max-size=1m','max-file=1','compress=false']));
    }
    expect(install.join(' ')).not.toContain(input.sourceRoot);
    expect(install.join(' ')).not.toContain(input.requestPath);
    expect(worker).toEqual(expect.arrayContaining(['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', `${process.getuid?.()}:${process.getgid?.()}`]));
    expect(worker.filter(arg => arg.startsWith('type=bind,')).every(arg => arg.includes(',readonly'))).toBe(true);
    expect(worker.join(' ')).not.toContain(input.outputDir);
    expect(worker.join(' ')).not.toContain('GITHUB_TOKEN');
    expect(worker.find(arg => arg.startsWith('/tmp:'))).toMatch(/size=512m/);
    expect(calls.filter(args => args[0] === 'container')).toHaveLength(2);
  });
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an npm configuration file stops the job before a container starts', async () => {
  await fixture(async input => {
    await writeFile(join(input.sourceRoot, '.npmrc'), 'registry=https://other.invalid/\n');
    const {calls, docker} = dockerDouble(payload);
    await expect(runQualitySandbox(input, {docker})).rejects.toThrow(/\.npmrc/);
    expect(calls).toEqual([]);
  });
});

test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports are refused when cleanup is unconfirmed or the frame has unapproved paths', async () => {
  await fixture(async input => {
    const uncleared = dockerDouble(payload, 0);
    await expect(runQualitySandbox(input, uncleared)).rejects.toThrow(/cleanup unconfirmed/i);
    const unexpected = dockerDouble({...payload, '../escape': report});
    await expect(runQualitySandbox(input, unexpected)).rejects.toThrow(/report/i);
    const incomplete = dockerDouble({'quality.json': report, 'native.json': report});
    await expect(runQualitySandbox(input, incomplete)).rejects.toThrow(/report/i);
    await expect(readFile(join(input.outputDir, 'quality.json'))).rejects.toHaveProperty('code', 'ENOENT');
  });
});

test.skipIf(process.platform==='win32'||process.getuid?.()===0)(
  'formal evidence is mandatory when requested, and mounted tools are read-only in the offline worker',
  async()=>{
    await fixture(async input=>{
      await writeFile(input.requestPath,JSON.stringify({runnerVersion:'5.1.0',formalEnabled:true,
        config:{formal:{models:[{id:'orders'}]}}}));
      const formalToolchain={javaHome:input.stagedSdk,quintHome:input.stagedSdk,quintRoot:input.stagedSdk};
      const missing=dockerDouble(payload);
      await expect(runQualitySandbox({...input,formalToolchain},{docker:missing.docker})).rejects.toThrow(/inventory/i);
      const present=dockerDouble({...payload,'formal-evidence.json':report});
      await expect(runQualitySandbox({...input,formalToolchain},{docker:present.docker})).resolves.toBe(0);
      const [installer,worker]=present.calls.filter(args=>args[0]==='run');
      for(const path of ['/formal/java','/formal/cache','/formal/quint']){
        expect(installer?.some(arg=>arg.includes('dst='+path+','))).toBe(false);
        expect(worker?.some(arg=>arg.includes('dst='+path+',')&&arg.endsWith(',readonly'))).toBe(true);
      }
      expect(worker?.[worker.indexOf('--network')+1]).toBe('none');
      expect(worker).toContain('JVM_ARGS=-Xmx768m');
      expect(await readFile(join(input.outputDir,'formal-evidence.json'),'utf8')).toBe('{}\n');
    });
  },
);

test.skipIf(process.platform==='win32'||process.getuid?.()===0)('requires the Assurance bundle only for an enrolled Assurance worker request',async()=>{
  await fixture(async input=>{
    const unexpected=dockerDouble({...payload,'assurance-evidence.json':report});
    await expect(runQualitySandbox(input,unexpected)).rejects.toThrow(/inventory/i);
    await writeFile(input.requestPath,JSON.stringify({runnerVersion:'5.1.0',config:{assurance:{definitions:[{id:'counter'}]}}}));
    await expect(runQualitySandbox(input,dockerDouble(payload))).rejects.toThrow(/inventory/i);
    await expect(runQualitySandbox(input,dockerDouble({...payload,'assurance-evidence.json':report}))).resolves.toBe(0);
  });
});
