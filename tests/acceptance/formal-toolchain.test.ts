import {mkdtemp, readdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {prepareFormalToolchain} from '../../scripts/formal-toolchain.mjs';

let parent: string;
let destination: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'behavproof-formal-toolchain-test-'));
  destination = join(parent, 'tools');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(parent, {recursive: true, force: true});
});

test('rejects altered release bytes before unpacking and removes the failed preparation', async () => {
  const fetchRelease = vi.fn(async () => new Response('altered release'));
  vi.stubGlobal('fetch', fetchRelease);

  await expect(prepareFormalToolchain(destination)).rejects.toThrow(/SHA-256 mismatch/);

  expect(fetchRelease).toHaveBeenCalled();
  expect(await readdir(parent)).toEqual([]);
});

test('rejects a release redirect outside GitHub release storage', async () => {
  const fetchRelease = vi.fn(async () => new Response(null, {
    status: 302,
    headers: {location: 'https://example.com/redirected-tool'},
  }));
  vi.stubGlobal('fetch', fetchRelease);

  await expect(prepareFormalToolchain(destination)).rejects.toThrow(/release redirect/);

  expect(fetchRelease).toHaveBeenCalledTimes(1);
  expect(await readdir(parent)).toEqual([]);
});

test('refuses an existing symlink without reading it or downloading tools', async () => {
  await symlink(parent, destination);
  const fetchRelease = vi.fn();
  vi.stubGlobal('fetch', fetchRelease);

  await expect(prepareFormalToolchain(destination)).rejects.toMatchObject({code: 'EEXIST'});

  expect(fetchRelease).not.toHaveBeenCalled();
  expect(await readdir(parent)).toEqual(['tools']);
});
