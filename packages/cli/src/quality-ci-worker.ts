import {spawn} from 'node:child_process';
import {cp, lstat, mkdir, readdir, symlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash, parseConfig, safeRead, safeReadJson} from '@behavproof/core';
import {QualityPolicy} from './quality.js';
import {observeQuality} from './quality-observe.js';

const project = '/tmp/behavproof-project';
const configRef = '.behavproof/quality-worker-config.json';
const observationRef = '.behavproof/quality-worker-observation.json';
const contractRef = '.behavproof/input/contracts.json';
const reportLimit = 10 * 1024 * 1024;

async function request() {
  const value = await safeReadJson('/', 'request.json');
  if (!value || typeof value !== 'object' || !('config' in value) || !('policy' in value)) {
    throw Error('Invalid protected quality worker request');
  }
  return {config: parseConfig(value.config), policy: QualityPolicy.parse(value.policy)};
}

async function exists(ref: string) {
  try {
    await lstat(join(project, ref));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function observe() {
  const {policy} = await request();
  const result = await observeQuality(project, policy, configRef);
  const boundObservation = {...result, policyHash: hash(policy)};
  await writeFile(join(project, observationRef), JSON.stringify(boundObservation) + '\n', {flag: 'wx', mode: 0o600});
}

async function runObservation() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--observe'], {
      cwd: project,
      stdio: 'ignore',
      shell: false,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(Error(`Quality observation worker failed with ${code ?? signal}`));
    });
  });
}

/** Check the complete tracked snapshot against the immutable source mount. */
export async function requireUnchangedQualitySource(source: string, working: string) {
  let entries = 0;
  const compare = async (ref: string, depth: number) => {
    if (depth > 64) throw Error('Protected quality source depth exceeds its limit');
    const directory = await lstat(join(working, ref));
    if (!directory.isDirectory()) throw Error('Protected quality directory is unsafe');
    for (const entry of await readdir(join(source, ref), {withFileTypes: true})) {
      if (++entries > 50000) throw Error('Protected quality source inventory exceeds its limit');
      const path = ref ? ref + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        await compare(path, depth + 1);
      } else {
        const target = await lstat(join(working, path));
        if (!entry.isFile() || !target.isFile() || target.nlink !== 1) throw Error('Unsafe protected quality source file');
        const [trusted, actual] = await Promise.all([safeRead(source, path), safeRead(working, path)]);
        if (!trusted.equals(actual)) throw Error('Protected quality file content differs');
      }
    }
  };
  try {
    await compare('', 0);
  } catch (error) {
    throw Error('Protected quality source changed or is unsafe', {cause: error});
  }
}

// Candidate-tool output stays in the container. The parent process emits a bounded,
// fixed inventory after the observation subprocess has finished.
async function collectReports() {
  const {config, policy} = await request();
  const nativeRef = `.behavproof/input/${policy.runner}.json`;
  if (config.reports[policy.runner] !== undefined && config.reports[policy.runner] !== nativeRef) {
    throw Error('Quality worker requires the fixed native report path');
  }
  await cp('/source', project, {recursive: true, force: false, errorOnExist: true});
  await requireUnchangedQualitySource('/source', project);
  await symlink('/dependencies/node_modules', join(project, 'node_modules'));
  await mkdir(join(project, '.behavproof'), {mode: 0o700});
  await writeFile(join(project, configRef), JSON.stringify(config) + '\n', {flag: 'wx', mode: 0o600});
  const coverageRef = config.reports.coverage;
  const canCaptureCoverage = coverageRef !== undefined && ![nativeRef, contractRef, configRef, observationRef].includes(coverageRef) &&
    !coverageRef.startsWith('node_modules/') && !await exists(coverageRef);
  await runObservation();
  await requireUnchangedQualitySource('/source', project);

  const requested = [
    ['quality.json', observationRef],
    ['native.json', nativeRef],
    ['contracts.json', contractRef],
  ] as const;
  const reports: Record<string, string> = {};
  let remaining = reportLimit;
  const save = async (name: string, ref: string) => {
    const bytes = await safeRead(project, ref, remaining);
    remaining -= bytes.length;
    reports[name] = bytes.toString('base64');
  };
  for (const [name, ref] of requested) await save(name, ref);
  if (canCaptureCoverage && await exists(coverageRef)) await save('coverage.lcov', coverageRef);
  process.stdout.write(JSON.stringify(reports) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--observe') await observe();
    else if (process.argv.length === 2) await collectReports();
    else throw Error('Invalid protected quality worker arguments');
  } catch {
    process.exitCode = 1;
  }
}
