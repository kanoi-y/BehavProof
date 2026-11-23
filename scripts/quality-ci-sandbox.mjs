import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeRead} from '@behavproof/core';
import {IMAGE} from './protected-container-image.mjs';
import {validateStagedSdk} from './staged-sdk.mjs';
import {formalEvidenceArtifact,assuranceEvidenceArtifact} from '../packages/cli/dist/api.js';

const sdkRoot = fileURLToPath(new URL('..', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const packageName = '(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*';
const namePattern = new RegExp(`^${packageName}$`);
const installedPattern = new RegExp(`^node_modules/${packageName}(?:/node_modules/${packageName})*$`);
const rangePattern = /^(?:[A-Za-z][A-Za-z0-9._-]*|[0-9xX*~^<>=][A-Za-z0-9.*+~^<>=| -]*)$/;
const aliasPattern = new RegExp(`^npm:(${packageName})(?:@(.+))?$`);
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const dependencyKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const requiredReports = ['quality.json', 'native.json', 'test-receipt.json'];
const reportLimit = 10 * 1024 * 1024;
const reportFrameLimit = 14 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateDependencies(manifest) {
  for (const key of dependencyKeys) {
    if (!Object.hasOwn(manifest, key)) continue;
    const dependencies = manifest[key];
    if (!object(dependencies)) throw Error('Invalid protected npm dependency map');
    for (const [name, spec] of Object.entries(dependencies)) {
      const alias = typeof spec === 'string' && aliasPattern.exec(spec);
      if (!namePattern.test(name) || typeof spec !== 'string' || spec.length > 500 ||
          !(rangePattern.test(spec.trim()) || alias && (!alias[2] || rangePattern.test(alias[2].trim())))) {
        throw Error('Protected npm install requires public registry package dependencies');
      }
    }
  }
}

/** Restrict npm's network-enabled install to a single public package lock. */
export function validateQualityInstall(manifest, lock) {
  if (!object(manifest) || !object(lock) || lock.lockfileVersion !== 3 ||
      !object(lock.packages) || !object(lock.packages['']) || Object.keys(lock.packages).length > 10000 ||
      Object.hasOwn(lock, 'dependencies')) {
    throw Error('Protected npm install requires a bounded npm lockfileVersion 3 package-lock.json');
  }
  if ([manifest, lock.packages['']].some(root => ['workspaces', 'overrides'].some(key => Object.hasOwn(root, key)))) {
    throw Error('Protected npm install supports a single package without dependency overrides');
  }
  validateDependencies(manifest);
  validateDependencies(lock.packages['']);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!installedPattern.test(path) || !object(entry) || entry.link || entry.inBundle) {
      throw Error('Protected npm lock contains a non-registry package path or link');
    }
    const name = entry.name ?? path.split(/(?:^|\/)node_modules\//).at(-1);
    const {version, resolved, integrity} = entry;
    if (typeof name !== 'string' || !namePattern.test(name) ||
        typeof version !== 'string' || !versionPattern.test(version) ||
        resolved !== `${registry}${name}/-/${name.split('/').at(-1)}-${version}.tgz` ||
        typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity) ||
        Buffer.from(integrity.slice(7), 'base64').toString('base64') !== integrity.slice(7)) {
      throw Error('Protected npm lock requires public registry tarballs with SHA-512 integrity');
    }
    validateDependencies(entry);
  }
}

function bind(source, target, writable = false) {
  if (/[,"\r\n]/.test(source)) throw Error('Unsupported Docker bind mount path');
  return `type=bind,src=${source},dst=${target},bind-recursive=disabled${writable ? '' : ',readonly'}`;
}

function containerArgs(name, network, uid, gid, tmpSize, executableTmp=false) {
  return [
    'run', '--rm', '--name', name, '--platform', 'linux/amd64', '--network', network,
    '--read-only', '--init', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '256', '--memory', '2g', '--memory-swap', '2g', '--cpus', '2',
    '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=1',
    '--user', `${uid}:${gid}`, '--tmpfs', `/tmp:rw,nosuid,nodev,${executableTmp?'exec,':''}size=${tmpSize},nr_inodes=150000,mode=0700,uid=${uid},gid=${gid}`,
    '--env', 'HOME=/tmp', '--env', 'CI=true',
  ];
}

function dockerCommand(configDir) {
  const daemon = process.env.DOCKER_HOST;
  if (daemon && !/^unix:\/\/\/[^\r\n]+$/.test(daemon)) throw Error('Protected quality requires a local Unix Docker daemon');
  const env = {PATH: process.env.PATH, ...(daemon ? {DOCKER_HOST: daemon} : {})};
  // The default Docker configuration can automatically inject container proxy credentials.
  return (args, options) => spawnSync('docker', ['--config', configDir, ...args], {...options, cwd: sdkRoot, env});
}

function runContainer(docker, args, name, timeout) {
  try {
    const result = docker(args, {timeout, maxBuffer: reportFrameLimit, stdio: ['ignore', 'pipe', 'pipe']});
    if (result.error || result.status === null) throw Error('Protected quality Docker run failed or exceeded its limits');
    return result;
  } finally {
    docker(['rm', '-f', name], {timeout: 10000, stdio: 'ignore'});
    const remaining = docker(['container', 'inspect', name], {timeout: 10000, maxBuffer: 1024 * 1024});
    if (remaining.status !== 1 || !/No such (?:object|container):/.test(String(remaining.stderr))) {
      throw Error('Protected quality container cleanup unconfirmed');
    }
  }
}

function reportFiles(stdout, formalEnabled,assuranceEnabled) {
  if (!Buffer.isBuffer(stdout) || stdout.length > reportFrameLimit) throw Error('Invalid protected quality report frame');
  const frame = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(stdout));
  const required=[...requiredReports,...(formalEnabled?[formalEvidenceArtifact]:[]),...(assuranceEnabled?[assuranceEvidenceArtifact]:[])];
  const allowedReports=new Set([...required,'coverage.lcov']);
  if (!object(frame) || !required.every(file => Object.hasOwn(frame, file)) ||
      !Object.keys(frame).every(file => allowedReports.has(file))) {
    throw Error('Invalid protected quality report inventory');
  }
  let bytes = 0;
  return Object.entries(frame).map(([file, encoded]) => {
    if (typeof encoded !== 'string') throw Error('Invalid protected quality report encoding');
    const data = Buffer.from(encoded, 'base64');
    if (data.toString('base64') !== encoded || !data.length || (bytes += data.length) > reportLimit) {
      throw Error('Protected quality reports exceed their encoding or size limits');
    }
    return [file, data];
  });
}

const installScript = [
  'mkdir -m 700 /tmp/install',
  'cp -- /inputs/package.json /inputs/package-lock.json /tmp/install/',
  'cd /tmp/install',
  '/usr/local/bin/npm ci --ignore-scripts --no-audit --no-fund --no-update-notifier --strict-ssl=true ' +
    '--include=dev --include=optional --include=peer --workspaces=false --registry=https://registry.npmjs.org/ ' +
    '--userconfig=/tmp/install/empty-user-npmrc --globalconfig=/tmp/install/empty-global-npmrc ' +
    '--cache=/tmp/npm-cache --fetch-retries=1 --fetch-timeout=30000',
  'mkdir -p node_modules',
  'cp -a -- node_modules/. /dependencies/node_modules/',
].join('\n');

async function rejectPrivateSource(root) {
  const reserved = ['.npmrc', 'npm-shrinkwrap.json', '.git', '.behavproof', 'node_modules'];
  for (const entry of reserved) {
    const exists = await lstat(join(root, entry)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (exists) throw Error(`Protected quality source cannot contain ${entry}`);
  }
}

/** Execute no candidate tools on the host and copy only a bounded report envelope back. */
export async function runQualitySandbox({sourceRoot, stagedSdk, outputDir, requestPath, executionId, formalToolchain}, {docker} = {}) {
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw Error('Protected quality Docker requires a non-root POSIX host');
  }
  if (typeof executionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(executionId)) {
    throw Error('Invalid protected quality execution ID');
  }
  const source = await realpath(sourceRoot), output = await realpath(outputDir);
  await rejectPrivateSource(source);
  if ((await readdir(output)).length) throw Error('Protected quality report directory must be empty');
  const [packageBytes, lockBytes, requestBytes] = await Promise.all([
    safeRead(source, 'package.json'), safeRead(source, 'package-lock.json'),
    safeRead(dirname(requestPath), basename(requestPath)),
  ]);
  const workerRequest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(requestBytes));
  if (!object(workerRequest) || typeof workerRequest.runnerVersion !== 'string' || !versionPattern.test(workerRequest.runnerVersion)) {
    throw Error('Invalid protected quality worker request');
  }
  const formalEnabled=workerRequest.formalEnabled===true;
  const requiresToolchain=formalEnabled&&workerRequest.config?.formal?.models?.length>0;
  const formalArgs=[];
  if(requiresToolchain){
    if(!formalToolchain)throw Error('The protected formal toolchain was not prepared');
    for(const [key,target] of [['javaHome','/formal/java'],['quintHome','/formal/cache'],['quintRoot','/formal/quint']]){
      const source=await realpath(formalToolchain[key]);
      if(!(await lstat(source)).isDirectory())throw Error('Invalid protected formal toolchain path');
      formalArgs.push('--mount',bind(source,target));
    }
    formalArgs.push('--env','JAVA_HOME=/formal/java','--env','QUINT_HOME=/formal/cache',
      '--env','TMPDIR=/tmp','--env','JVM_ARGS=-Xmx768m',
      '--env','PATH=/formal/java/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
  }
  validateQualityInstall(JSON.parse(packageBytes.toString('utf8')), JSON.parse(lockBytes.toString('utf8')));
  const sdk = await validateStagedSdk(stagedSdk, {referenceRoot: sdkRoot});
  if (!sdk.inventory.built || sdk.inventory.platform !== 'linux' || sdk.inventory.arch !== 'x64') {
    throw Error('A built Linux x64 SDK is required for protected quality');
  }
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'behavproof-quality-sandbox-')));
  try {
    const inputs = join(scratch, 'inputs'), dependencies = join(scratch, 'node_modules');
    const dockerConfig = join(scratch, 'docker-config'), request = join(scratch, 'request.json');
    await Promise.all([inputs, dependencies, dockerConfig].map(path => mkdir(path, {mode: 0o700})));
    await Promise.all([
      writeFile(join(inputs, 'package.json'), packageBytes, {flag: 'wx', mode: 0o600}),
      writeFile(join(inputs, 'package-lock.json'), lockBytes, {flag: 'wx', mode: 0o600}),
      writeFile(request, JSON.stringify({...workerRequest, executionId}), {flag: 'wx', mode: 0o600}),
    ]);
    const execute = docker ?? dockerCommand(dockerConfig);
    const name = `behavproof-quality-${executionId.slice(0, 30)}-${randomUUID()}`;
    const installName = name + '-install';
    const install = runContainer(execute, [
      ...containerArgs(installName, 'bridge', uid, gid, '1g'),
      '--mount', bind(inputs, '/inputs'),
      '--mount', bind(dependencies, '/dependencies/node_modules', true),
      '--entrypoint', '/bin/sh', IMAGE, '-eu', '-c', installScript,
    ], installName, 180000);
    if (install.status !== 0) throw Error(`Protected npm install failed with exit code ${install.status}`);
    const result = runContainer(execute, [
      ...containerArgs(name, 'none', uid, gid, requiresToolchain?'1g':'512m', requiresToolchain),
      '--mount', bind(source, '/source'),
      '--mount', bind(sdk.path, '/sdk'),
      '--mount', bind(dependencies, '/dependencies/node_modules'),
      '--mount', bind(request, '/request.json'),
      ...formalArgs,
      '--entrypoint', '/usr/local/bin/node', IMAGE, '/sdk/packages/cli/dist/quality-ci-worker.js',
    ], name, requiresToolchain?600000:180000);
    if (result.status !== 0) return result.status;
    const reports = reportFiles(result.stdout,formalEnabled,!!workerRequest.config?.assurance?.definitions);
    for (const [file, data] of reports) await writeFile(join(output, file), data, {flag: 'wx', mode: 0o600});
    return 0;
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}
