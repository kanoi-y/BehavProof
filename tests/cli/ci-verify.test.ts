import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

const sha = (value: string, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const workflowSha = 'a'.repeat(40);
const sdkSha = 'b'.repeat(40);
const treeSha = 'c'.repeat(40);
const repository = 'octocat/project';
const workflowBranch = 'trusted/workflows';
const protectedBranch = 'main';
const environment = 'behavproof-publisher';
const appId = 5300;
const checkName = 'BehavProof protected gate';
const producerPath = '.github/workflows/behavproof-producer.yml';
const publisherPath = '.github/workflows/behavproof-publisher.yml';
const sdkPaths = [
  'package.json', 'package-lock.json', 'scripts/build-commonjs.mjs', 'scripts/build-artifacts.mjs',
  'scripts/quality-ci.mjs', 'scripts/quality-ci-protocol.mjs', 'scripts/quality-ci-sandbox-entry.mjs', 'scripts/quality-ci-sandbox.mjs',
  'scripts/prepare-sandbox-sdk.mjs', 'scripts/protected-checkout.mjs', 'scripts/protected-container-image.mjs', 'scripts/staged-sdk.mjs',
  'packages/cli/src/api.ts', 'packages/cli/src/quality-ci-worker.ts', 'packages/cli/src/quality-observe.ts',
];
const deployment = {
  repository, workflowBranch, protectedBranch, producerPath, publisherPath, sdkSha, appId,
  environment, checkName, policyPath: '.github/behavproof/quality-policy.json', configPath: 'behavproof.config.json',
};

function fixture(reviewers = ['maintainer']) {
  function workflow(role: 'produce' | 'publish') {
    const publisher = role === 'publish';
    return `name: BehavProof ${role}
on:
  workflow_dispatch:
    inputs:
      pr:
        required: true
        type: string
${publisher ? '      producer_run:\n        required: true\n        type: string\n' : ''}permissions:
  contents: read
  actions: read
  pull-requests: read
jobs:
  ${publisher ? 'gate' : 'collect'}:
    if: \${{ github.repository == '${repository}' && github.ref == 'refs/heads/${workflowBranch}' && github.workflow_sha == vars.BEHAVPROOF_WORKFLOW_SHA }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
${publisher ? `    environment: ${environment}\n` : ''}    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          repository: kanoi-y/BehavProof
          ref: ${sdkSha}
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '24'
      - run: npm ci --ignore-scripts
      - run: npm run build
${publisher ? `      - uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349
        id: app
        with:
          app-id: '${appId}'
          private-key: \${{ secrets.BEHAVPROOF_APP_PRIVATE_KEY }}
          owner: octocat
          repositories: project
          permission-checks: write
          permission-contents: read
          permission-pull-requests: read
          permission-actions: read
          permission-administration: read
` : ''}      - id: behavproof
        env:
          GITHUB_TOKEN: ${publisher ? '\${{ steps.app.outputs.token }}' : '\${{ secrets.GITHUB_TOKEN }}'}
          BEHAVPROOF_SDK_SHA: '${sdkSha}'
          BEHAVPROOF_WORKFLOW_SHA: \${{ vars.BEHAVPROOF_WORKFLOW_SHA }}
          BEHAVPROOF_CURRENT_WORKFLOW_SHA: \${{ github.workflow_sha }}
          BEHAVPROOF_REGISTRATION_JSON: \${{ vars.BEHAVPROOF_REGISTRATION_JSON }}
          BEHAVPROOF_REGISTRATION_DIGEST: \${{ vars.BEHAVPROOF_REGISTRATION_DIGEST }}
          BEHAVPROOF_PR: \${{ inputs.pr }}
${publisher ? '          BEHAVPROOF_PRODUCER_RUN: ${{ inputs.producer_run }}\n' : ''}        run: node scripts/quality-ci.mjs ${role}
${publisher ? '' : `      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: \${{ steps.behavproof.outputs.artifact_name }}
          path: \${{ steps.behavproof.outputs.artifact_path }}
          if-no-files-found: error
          retention-days: 7
`}
`;
  }

  const sources = {
    [producerPath]: workflow('produce'),
    [publisherPath]: workflow('publish'),
    '.github/behavproof/deployment.json': JSON.stringify({schemaVersion: 1, ...deployment}),
    [deployment.policyPath]: '{"policy":"quality-baseline-v1"}',
    [deployment.configPath]: '{"runner":"vitest"}',
  };
  const prefix = `/repos/${repository}`;
  const sdkPrefix = '/repos/kanoi-y/BehavProof';
  const sdkTreePath = `${sdkPrefix}/git/trees/${treeSha}?recursive=1`;
  const envPrefix = `${prefix}/environments/${environment}`;
  const variablePrefix = `${prefix}/actions/variables`;
  const refPath = `${prefix}/git/ref/heads/trusted%2Fworkflows`;
  const protectionPath = `${prefix}/branches/${protectedBranch}/protection`;
  const workflowProtectionPath = `${prefix}/branches/trusted%2Fworkflows/protection`;
  const policiesPath = `${envPrefix}/deployment-branch-policies?per_page=100&page=1`;
  const repositorySecretsPath = `${prefix}/actions/secrets?per_page=100&page=1`;
  const endpoints = new Map<string, unknown>([
    [prefix, { id: 9184, full_name: repository, owner: { type: 'Organization' } }],
    [refPath, { ref: `refs/heads/${workflowBranch}`, object: { type: 'commit', sha: workflowSha } }],
    [`${prefix}/git/commits/${workflowSha}`, { sha: workflowSha, tree: { sha: treeSha } }],
    [`${sdkPrefix}/git/commits/${sdkSha}`, { sha: sdkSha, tree: { sha: treeSha } }],
    [sdkTreePath, { sha: treeSha, truncated: false, tree: sdkPaths.map(path => ({ path, mode: '100644', type: 'blob', sha: treeSha })) }],
    [protectionPath, {
      enforce_admins: { enabled: true },
      required_status_checks: { strict: true, checks: [{ context: checkName, app_id: appId }] },
      required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: 1 },
    }],
    [workflowProtectionPath, {
      enforce_admins: { enabled: true },
      required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: 1 },
      allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
    }],
    [envPrefix, {
      name: environment,
      can_admins_bypass: false,
      deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
      protection_rules: [
        { id: 401, type: 'branch_policy' },
        { id: 402, type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { login: reviewers[0] } }] },
      ],
    }],
    [policiesPath, { total_count: 1, branch_policies: [{ id: 551, name: workflowBranch, type: 'branch' }] }],
    [`${envPrefix}/secrets/BEHAVPROOF_APP_PRIVATE_KEY`, { name: 'BEHAVPROOF_APP_PRIVATE_KEY' }],
    [repositorySecretsPath, { total_count: 0, secrets: [] }],
    [`${prefix}/actions/organization-secrets?per_page=100&page=1`, { total_count: 0, secrets: [] }],
    [`${prefix}/actions/workflows/behavproof-producer.yml`, { path: producerPath, state: 'active' }],
    [`${prefix}/actions/workflows/behavproof-publisher.yml`, { path: publisherPath, state: 'active' }],
  ]);
  const variables = {
    sha: `${variablePrefix}/BEHAVPROOF_WORKFLOW_SHA`,
    digest: `${variablePrefix}/BEHAVPROOF_REGISTRATION_DIGEST`,
    json: `${variablePrefix}/BEHAVPROOF_REGISTRATION_JSON`,
  };
  const register = () => {
    const files = Object.fromEntries(Object.entries(sources).map(([path, value]) => [path, sha(value)]));
    const tree = Object.entries(sources).map(([path, value]) => {
      const blob = sha(`blob ${Buffer.byteLength(value)}\0${value}`, 'sha1');
      endpoints.set(`${prefix}/git/blobs/${blob}`, { sha: blob, size: Buffer.byteLength(value), encoding: 'base64', content: Buffer.from(value).toString('base64') });
      return { path, sha: blob, mode: '100644', type: 'blob' };
    });
    endpoints.set(`${prefix}/git/trees/${treeSha}?recursive=1`, { sha: treeSha, truncated: false, tree });
    const registration = { schemaVersion: 1, deployment, repositoryId: '9184', workflowSha, files, reviewers, approval: { status: 'pass' }, baseline: {}, policy: {}, config: {} };
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    };
    const registrationDigest = sha(canonical(registration));
    endpoints.set(variables.sha, { name: 'BEHAVPROOF_WORKFLOW_SHA', value: workflowSha });
    endpoints.set(variables.digest, { name: 'BEHAVPROOF_REGISTRATION_DIGEST', value: registrationDigest });
    endpoints.set(variables.json, { name: 'BEHAVPROOF_REGISTRATION_JSON', value: JSON.stringify(registration, null, 2) });
    return { ...deployment, repositoryId: '9184', workflowSha, files, registrationDigest, reviewers };
  };
  const fetcher = async (input: string | URL, options?: RequestInit) => {
    if (options?.method !== 'GET') throw Error('Expected a read-only GitHub request');
    const url = new URL(input);
    const value = endpoints.get(url.pathname + url.search);
    return typeof value === 'number' || value === undefined
      ? new Response(null, { status: value ?? 404 })
      : Response.json(value);
  };
  return { endpoints, environmentPath: envPrefix, policiesPath, protectionPath, workflowProtectionPath, refPath, repositorySecretsPath, sdkTreePath, variables, register, sources, fetcher };
}

async function verify(input: ReturnType<ReturnType<typeof fixture>['register']>, fetcher: ReturnType<typeof fixture>['fetcher'], root?: string) {
  const { verifyDeployment } = await import('../../packages/cli/src/ci-verify.js');
  return verifyDeployment(input, { fetcher, ...(root === undefined ? {} : { root }) });
}

test('observes deployment configuration from read-only responses while PR execution remains unobserved', async () => {
  const data = fixture();
  const report = await verify(data.register(), data.fetcher);
  expect(report.status, JSON.stringify(report.checks.filter(item => item.status !== 'pass'))).toBe('pass');
  expect(report.isolationConfigurationObserved).toBe(true);
  expect(report.pullRequestExecution).toBe('not-observed');
});

test.each([
  { checks: [{ context: checkName, app_id: appId + 1 }], strict: true, admins: true },
  { checks: [{ context: checkName }], strict: true, admins: true },
  { checks: [{ context: checkName, app_id: appId }], strict: false, admins: true },
  { checks: [{ context: checkName, app_id: appId }], strict: true, admins: false },
])('keeps mismatched App binding, strict or administrator enforcement incomplete ($checks, $strict, $admins)', async ({ checks, strict, admins }) => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.protectionPath, { enforce_admins: { enabled: admins }, required_status_checks: { strict, checks } });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'branch-protection', action: expect.any(String) })]) });
});

test('withholds a passing protection observation when GitHub denies access', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.protectionPath, 403);
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'branch-protection', status: 'unknown' })]) });
});

test('rejects a moved workflow ref even if the pinned commit is still available', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.refPath, { ref: `refs/heads/${workflowBranch}`, object: { type: 'commit', sha: 'd'.repeat(40) } });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'workflow-ref', status: 'fail' })]) });
});

test('rejects force pushes on the separately pinned workflow branch', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.workflowProtectionPath, {
    enforce_admins: { enabled: true },
    required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: 1 },
    allow_force_pushes: { enabled: true }, allow_deletions: { enabled: false },
  });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'workflow-branch-protection', status: 'fail' }), expect.objectContaining({ id: 'branch-protection', status: 'pass' })]) });
});

test('rejects a modified registration payload with the original digest variable', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.variables.json, { name: 'BEHAVPROOF_REGISTRATION_JSON', value: '{"schemaVersion":1}' });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'registration', status: 'fail' })]) });
});

test('rejects a same-name tag that can deploy to the publisher environment', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.policiesPath, { total_count: 2, branch_policies: [{ id: 1, type: 'branch', name: workflowBranch }, { id: 2, type: 'tag', name: workflowBranch }] });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'publisher-environment', status: 'fail' })]) });
});

test('withholds isolation when GitHub omits the branch versus tag policy type', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.policiesPath, { total_count: 1, branch_policies: [{ id: 1, name: workflowBranch }] });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'publisher-environment', status: 'unknown' })]) });
});

test('rejects a credential name exposed outside the publisher environment', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.repositorySecretsPath, { total_count: 1, secrets: [{ name: 'BEHAVPROOF_APP_PRIVATE_KEY' }] });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'publisher-secret-scope', status: 'fail' })]) });
});

test('keeps an incomplete environment restriction inventory unknown', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.policiesPath, { total_count: 2, branch_policies: [{ id: 1, type: 'branch', name: workflowBranch }] });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'publisher-environment', status: 'unknown' })]) });
});

test('rejects credential exposure even when the workflow source matches the enrolled hashes', async () => {
  const data = fixture();
  data.sources[producerPath] = data.sources[producerPath]!.replace('${{ secrets.GITHUB_TOKEN }}', '${{ secrets.BEHAVPROOF_APP_PRIVATE_KEY }}');
  expect(await verify(data.register(), data.fetcher)).toMatchObject({ status: 'incomplete', isolationConfigurationObserved: false, checks: expect.arrayContaining([expect.objectContaining({ id: 'workflow-isolation', status: 'fail' })]) });
});

test('rejects a pinned publisher without the trusted producer-validation runtime invocation', async () => {
  const data = fixture();
  data.sources[publisherPath] = data.sources[publisherPath]!.replace('node scripts/quality-ci.mjs publish', 'echo skipped');
  expect(await verify(data.register(), data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'required-upstream', status: 'fail' })]) });
});

test('rejects an SDK revision that predates the producer and publisher runtime', async () => {
  const data = fixture();
  const input = data.register();
  data.endpoints.set(data.sdkTreePath, { sha: treeSha, truncated: false, tree: [{ path: 'package.json', type: 'blob', mode: '100644', sha: treeSha }] });
  expect(await verify(input, data.fetcher)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'sdk-availability', status: 'fail' })]) });
});

test('accepts the actual generated workflows and descriptor at their enrolled paths', async () => {
  const { Deployment, packageFiles } = await import('../../packages/cli/src/ci-plan.js');
  const data = fixture();
  for (const file of packageFiles(Deployment.parse(deployment), {
    schemaVersion: 1, id: 'quality-baseline-v1', lint: { tool: 'eslint', rules: ['no-debugger'] },
    types: 'strict', runner: 'vitest', sources: ['src/index.ts'],
  })) {
    data.sources[file.path] = file.content;
  }
  const report = await verify(data.register(), data.fetcher);
  expect(report.status, JSON.stringify(report.checks.filter(item => item.status !== 'pass'))).toBe('pass');
});

test('detects a changed local integration file while preserving remote observations', async () => {
  const data = fixture();
  const root = await mkdtemp(join(tmpdir(), 'behavproof-verify-'));
  try {
    for (const [path, source] of Object.entries(data.sources)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    const input = data.register();
    expect((await verify(input, data.fetcher, root)).status).toBe('pass');
    await writeFile(join(root, producerPath), '# local drift\n');
    expect(await verify(input, data.fetcher, root)).toMatchObject({ status: 'incomplete', checks: expect.arrayContaining([expect.objectContaining({ id: 'local-integration', status: 'fail' }), expect.objectContaining({ id: 'pinned-source', status: 'pass' })]) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  ['bad_name'], ['-lead'], ['trail-'], ['a'.repeat(40)],
])('rejects an invalid GitHub reviewer login (%s)', async (login) => {
  const data = fixture();
  const input = {...data.register(), reviewers: [login]};
  await expect(verify(input, data.fetcher)).rejects.toThrow('Invalid registered deployment requirements');
});

test('accepts a hyphenated reviewer login and rejects it in the registration schema when it carries an underscore', async () => {
  const data = fixture(['a-b']);
  const report = await verify(data.register(), data.fetcher);
  expect(report.status, JSON.stringify(report.checks.filter(item => item.status !== 'pass'))).toBe('pass');
  const {CIRegistration} = await import('../../packages/cli/src/ci-registration.js');
  expect(() => CIRegistration.shape.reviewers.parse(['a-b'])).not.toThrow();
  expect(() => CIRegistration.shape.reviewers.parse(['bad_name'])).toThrow();
  expect(() => CIRegistration.shape.reviewers.parse(['-lead'])).toThrow();
  expect(() => CIRegistration.shape.reviewers.parse(['a'.repeat(40)])).toThrow();
});
