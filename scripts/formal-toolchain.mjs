import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants, createWriteStream} from 'node:fs';
import {access, copyFile, lstat, mkdir, readFile, realpath, rm} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const exampleRoot = fileURLToPath(new URL('../examples/formal-order/', import.meta.url));
const quintVersion = '0.33.1';
const apalacheVersion = '0.62.4';
const commandEnv = {PATH: `${dirname(process.execPath)}:/usr/bin:/bin`};

// Eclipse Adoptium and Apalache publish these digests in their GitHub release asset inventories.
const java = {
  name: 'Temurin JRE 21.0.13.1+2 Linux x64',
  url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13.1%2B2/OpenJDK21U-jre_x64_linux_hotspot_21.0.13.1_2.tar.gz',
  sha256: '18f44fab9065217f3ba61d0eef8a7b5f3c3713aa7293001b0d4ac10ede3850f0',
  limit: 60 * 1024 * 1024,
};
const apalache = {
  name: `Apalache ${apalacheVersion}`,
  url: `https://github.com/apalache-mc/apalache/releases/download/v${apalacheVersion}/apalache.tgz`,
  sha256: '8ac8488422c30d552735bae11b92a2d014d8e02e8608702acc08f9a2d8a9abb2',
  limit: 200 * 1024 * 1024,
};

async function downloadVerified({name, url, sha256, limit}, path) {
  const signal = AbortSignal.timeout(180000);
  let response = await fetch(url, {redirect: 'manual', signal});
  if (response.status === 302) {
    const asset = new URL(response.headers.get('location') ?? '', url);
    await response.body?.cancel();
    if (asset.protocol !== 'https:' || asset.host !== 'release-assets.githubusercontent.com' ||
        asset.username || asset.password) throw Error(`Unsupported ${name} release redirect`);
    response = await fetch(asset, {redirect: 'error', signal});
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw Error(`${name} release download failed (HTTP ${response.status})`);
  }
  const digest = createHash('sha256');
  let size = 0;
  const verify = new Transform({transform(chunk, _, callback) {
    size += chunk.length;
    if (size > limit) return callback(Error(`${name} release exceeds its download limit`));
    digest.update(chunk);
    callback(null, chunk);
  }});
  await pipeline(response.body, verify, createWriteStream(path, {flags: 'wx', mode: 0o600}), {signal});
  if (digest.digest('hex') !== sha256) throw Error(`${name} release SHA-256 mismatch`);
}

async function installArchive(artifact, archive, home, launcher) {
  await downloadVerified(artifact, archive);
  await mkdir(home, {recursive: true, mode: 0o700});
  await run('/usr/bin/tar', ['-xzf', archive, '-C', home, '--strip-components=1',
    '--no-same-owner', '--no-same-permissions'], {env: commandEnv, timeout: 60000});
  const executable = join(home, launcher);
  if (!(await lstat(executable)).isFile() || await realpath(executable) !== executable) {
    throw Error(`${artifact.name} release launcher is missing or redirects outside its expected path`);
  }
  await access(executable, constants.X_OK);
  await rm(archive);
}

async function installQuint(quintRoot, npmCache) {
  await mkdir(quintRoot, {mode: 0o700});
  await Promise.all(['package.json', 'package-lock.json'].map(name =>
    copyFile(join(exampleRoot, name), join(quintRoot, name), constants.COPYFILE_EXCL)));
  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier',
    '--include=dev', '--omit=optional', '--workspaces=false', '--registry=https://registry.npmjs.org/',
    '--userconfig', join(quintRoot, '.npmrc'), '--globalconfig=/dev/null', '--cache', npmCache,
    '--fetch-retries=1', '--fetch-timeout=30000'], {
    cwd: quintRoot, env: {...commandEnv, HOME: quintRoot}, timeout: 120000,
  });
  const quint = join(quintRoot, 'node_modules', '@informalsystems', 'quint');
  const installed = JSON.parse(await readFile(join(quint, 'package.json'), 'utf8'));
  if (installed.name !== '@informalsystems/quint' || installed.version !== quintVersion ||
      !(await lstat(join(quint, 'dist', 'src', 'cli.js'))).isFile()) {
    throw Error('Protected formal setup requires the pinned Quint entry point');
  }
  await rm(npmCache, {recursive: true, force: true});
}

/** Prepare mount sources from SDK pins in a new directory under the producer's private scratch space. */
export async function prepareFormalToolchain(destination) {
  const path = resolve(destination);
  const root = join(await realpath(dirname(path)), basename(path));
  await mkdir(root, {mode: 0o700});
  const javaHome = join(root, 'java');
  const quintHome = join(root, 'quint-home');
  const quintRoot = join(root, 'quint');
  try {
    await installArchive(java, join(root, 'java.tar.gz'), javaHome, 'bin/java');
    await installArchive(apalache, join(root, 'apalache.tgz'),
      join(quintHome, `apalache-dist-${apalacheVersion}`, 'apalache'), 'bin/apalache-mc');
    await installQuint(quintRoot, join(root, 'npm-cache'));
    return {javaHome, quintHome, quintRoot};
  } catch (error) {
    await rm(root, {recursive: true, force: true});
    throw error;
  }
}
