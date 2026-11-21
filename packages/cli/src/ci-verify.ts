import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { GitHubAuthority, GitHubTransport, githubObject, parseGitHubWorkflow, type Fetcher } from '@behavproof/adapter-github';
import { hash, hashBytes, RelativePathSchema, safeRead } from '@behavproof/core';

export interface DeploymentVerificationInput {
  repository: string;
  repositoryId: string;
  protectedBranch: string;
  workflowBranch: string;
  workflowSha: string;
  producerPath: string;
  publisherPath: string;
  sdkSha: string;
  appId: number;
  checkName: string;
  environment: string;
  files: Record<string, string>;
  registrationDigest: string;
  reviewers: string[];
}

interface VerificationCheck {
  id: string;
  status: 'pass' | 'fail' | 'unknown';
  evidence: string[];
  action?: string;
}

export interface DeploymentVerificationReport {
  schemaVersion: 1;
  status: 'pass' | 'incomplete';
  repository: string;
  workflowSha: string;
  checks: VerificationCheck[];
  isolationConfigurationObserved: boolean;
  runtimeIsolation: 'not-observed';
  pullRequestExecution: 'not-observed';
}

const commit = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const workflowFile = /^\.github\/workflows\/[\w.-]+\.ya?ml$/;
const branch = /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/;
const sdkRepository = 'kanoi-y/BehavProof';
const appSecret = 'BEHAVPROOF_APP_PRIVATE_KEY';
const descriptorPath = '.github/behavproof/deployment.json';
const workflowVariable = 'BEHAVPROOF_WORKFLOW_SHA';
const registrationVariable = 'BEHAVPROOF_REGISTRATION_JSON';
const digestVariable = 'BEHAVPROOF_REGISTRATION_DIGEST';
const sdkRuntimePaths = [
  'package.json', 'package-lock.json', 'scripts/build-commonjs.mjs', 'scripts/build-artifacts.mjs',
  'scripts/quality-ci.mjs', 'scripts/quality-ci-protocol.mjs', 'scripts/quality-ci-sandbox-entry.mjs', 'scripts/quality-ci-sandbox.mjs',
  'scripts/prepare-sandbox-sdk.mjs', 'scripts/protected-checkout.mjs', 'scripts/protected-container-image.mjs', 'scripts/staged-sdk.mjs',
  'packages/cli/src/api.ts', 'packages/cli/src/quality-ci-worker.ts', 'packages/cli/src/quality-observe.ts',
];
const expression = (value: string) => '${{ ' + value + ' }}';
const decodeText = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

class Mismatch extends Error {}
class Unavailable extends Error {}

function requireMatch(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Mismatch(reason);
}

function requireObservation(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Unavailable(reason);
}

async function observe(id: string, action: string, operation: () => Promise<string[]>): Promise<VerificationCheck> {
  try {
    return { id, status: 'pass', evidence: await operation() };
  } catch (error) {
    const reason = error instanceof Mismatch || error instanceof Unavailable ||
      error instanceof Error && /^GitHub (HTTP \d{3}|request timed out|response (unavailable or malformed|exceeds size limit)|pagination limit exceeded)$/.test(error.message)
      ? error.message : 'Verification evidence is unavailable or malformed';
    return { id, status: error instanceof Mismatch ? 'fail' : 'unknown', evidence: [reason], action };
  }
}

function verifyInput(input: DeploymentVerificationInput) {
  const validBranch = (name: string) => branch.test(name) && !name.includes('..') &&
    name.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(input.repository) || input.repository.includes('..') ||
      !/^[1-9]\d*$/.test(input.repositoryId) || !commit.test(input.workflowSha) || !commit.test(input.sdkSha) ||
      !validBranch(input.protectedBranch) || !validBranch(input.workflowBranch) ||
      !workflowFile.test(input.producerPath) || !workflowFile.test(input.publisherPath) || input.producerPath === input.publisherPath ||
      !Number.isSafeInteger(input.appId) || input.appId < 1 || input.appId === 15368 ||
      !input.checkName.trim() || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(input.environment) || input.environment.includes('..') ||
      !digest.test(input.registrationDigest) || !input.reviewers.length ||
      input.reviewers.some(login => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) ||
      new Set(input.reviewers.map(login => login.toLowerCase())).size !== input.reviewers.length ||
      [descriptorPath, input.producerPath, input.publisherPath].some(path => !Object.hasOwn(input.files, path))) {
    throw Error('Invalid registered deployment requirements');
  }
  for (const [path, value] of Object.entries(input.files)) {
    if (!RelativePathSchema.safeParse(path).success || !digest.test(value)) throw Error('Invalid registered deployment file or digest');
  }
}

async function readPinnedTree(http: GitHubTransport, revisionSha: string) {
  const revision = githubObject(await http.request(`${http.prefix}/git/commits/${revisionSha}`));
  requireObservation(typeof revision.sha === 'string' && commit.test(revision.tree?.sha), 'GitHub omitted the pinned Git commit or tree identity');
  requireMatch(revision.sha === revisionSha, 'GitHub returned a different pinned Git commit');
  const tree = githubObject(await http.request(`${http.prefix}/git/trees/${revision.tree.sha}?recursive=1`));
  requireObservation(tree.sha === revision.tree.sha && tree.truncated === false && Array.isArray(tree.tree), 'GitHub did not return a complete pinned Git tree');
  const entries = new Map<string, ReturnType<typeof githubObject>>();
  for (const entry of tree.tree.map(githubObject)) {
    requireObservation(typeof entry.path === 'string' && !entries.has(entry.path), 'GitHub returned ambiguous pinned Git paths');
    entries.set(entry.path, entry);
  }
  return entries;
}

function regularBlob(entry: ReturnType<typeof githubObject> | undefined) {
  return entry?.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755');
}

export async function readPinnedFiles(http: GitHubTransport, input: Pick<DeploymentVerificationInput, 'workflowSha' | 'files'>) {
  const entries = await readPinnedTree(http, input.workflowSha);
  const contents = new Map<string, Buffer>();
  for (const [path, expected] of Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = entries.get(path);
    requireMatch(entry && regularBlob(entry), `Pinned Git tree lacks a regular file at ${path}`);
    requireObservation(commit.test(entry.sha), `GitHub omitted the Git blob identity for ${path}`);
    const blob = githubObject(await http.request(`${http.prefix}/git/blobs/${entry.sha}`));
    requireObservation(blob.sha === entry.sha && blob.encoding === 'base64' && typeof blob.content === 'string' && Number.isSafeInteger(blob.size), `GitHub returned invalid Git blob metadata for ${path}`);
    const base64 = blob.content.replace(/[\r\n]/g, '');
    const bytes = Buffer.from(base64, 'base64');
    const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    requireObservation(bytes.length === blob.size && bytes.toString('base64') === base64 && blobSha === entry.sha, `GitHub returned inconsistent Git blob bytes for ${path}`);
    requireMatch(hashBytes(bytes) === expected, `Pinned Git bytes differ from the enrolled hash at ${path}`);
    contents.set(path, bytes);
  }
  return contents;
}

async function verifySdk(http: GitHubTransport, sdkSha: string) {
  const entries = await readPinnedTree(http, sdkSha);
  for (const path of sdkRuntimePaths) {
    const entry = entries.get(path);
    requireMatch(entry && regularBlob(entry), `Pinned SDK lacks required runtime source ${path}`);
    requireObservation(typeof entry.sha === 'string' && commit.test(entry.sha), `GitHub omitted the SDK blob identity for ${path}`);
  }
  return [`${sdkRepository} at ${sdkSha}`, ...sdkRuntimePaths];
}

async function readRef(http: GitHubTransport, input: DeploymentVerificationInput) {
  const expected = `refs/heads/${input.workflowBranch}`;
  const ref = githubObject(await http.request(`${http.prefix}/git/ref/heads/${encodeURIComponent(input.workflowBranch)}`));
  requireObservation(typeof ref.ref === 'string' && ref.object?.type === 'commit' && commit.test(ref.object.sha), 'GitHub omitted the workflow branch or commit identity');
  requireMatch(ref.ref === expected && ref.object.sha === input.workflowSha, `Workflow branch ${input.workflowBranch} does not point to the enrolled workflow SHA`);
  return [`${expected} at ${input.workflowSha}`];
}

async function readRegistration(http: GitHubTransport, input: DeploymentVerificationInput) {
  const variable = async (name: string) => {
    const row = githubObject(await http.request(`${http.prefix}/actions/variables/${name}`));
    requireObservation(row.name === name && typeof row.value === 'string', `GitHub omitted repository variable ${name}`);
    return row.value;
  };
  const [workflowSha, registeredDigest, json] = await Promise.all([
    variable(workflowVariable), variable(digestVariable), variable(registrationVariable),
  ]);
  requireMatch(workflowSha === input.workflowSha, 'Repository workflow SHA differs from the enrolled SHA');
  requireMatch(registeredDigest === input.registrationDigest, 'Repository registration digest differs from the enrolled digest');
  let registration: ReturnType<typeof githubObject>;
  try {
    registration = githubObject(JSON.parse(json));
  } catch {
    throw new Mismatch('Repository registration payload is invalid JSON');
  }
  requireMatch(hash(registration) === input.registrationDigest, 'Repository registration payload does not match the enrolled digest');
  requireMatch(registration.schemaVersion === 1 && registration.repositoryId === input.repositoryId &&
    registration.workflowSha === input.workflowSha && hash(registration.files) === hash(input.files) &&
    Array.isArray(registration.reviewers) && hash(registration.reviewers) === hash(input.reviewers),
  'Repository registration does not bind this repository, workflow, file inventory and reviewers');
  const deployment = githubObject(registration.deployment);
  for (const key of ['repository', 'protectedBranch', 'workflowBranch', 'producerPath', 'publisherPath', 'sdkSha', 'appId', 'checkName', 'environment'] as const) {
    requireMatch(deployment[key] === input[key], `Repository registration has a different ${key}`);
  }
  requireMatch(RelativePathSchema.safeParse(deployment.configPath).success &&
    RelativePathSchema.safeParse(deployment.policyPath).success && Object.hasOwn(input.files, deployment.policyPath),
  'Repository registration omits a selected policy file or configuration path');
  return deployment;
}

function exact(value: unknown, expected: unknown) {
  return value !== undefined && hash(value) === hash(expected);
}

function stepShape(step: Record<string, unknown>, expected: Record<string, unknown>) {
  const { name, ...actual } = step;
  return (name === undefined || typeof name === 'string') && exact(actual, expected);
}

function verifyWorkflow(source: Buffer, input: DeploymentVerificationInput, role: 'producer' | 'publisher') {
  const publisher = role === 'publisher';
  const jobId = publisher ? 'gate' : 'collect';
  const path = publisher ? input.publisherPath : input.producerPath;
  let workflow: ReturnType<typeof githubObject>;
  try {
    workflow = githubObject(parseGitHubWorkflow(decodeText(source)));
  } catch {
    throw new Mismatch(`Pinned workflow ${path} is not supported YAML`);
  }
  const { name, on, permissions, jobs, ...extra } = workflow;
  const eventInputs = on?.workflow_dispatch?.inputs;
  const inputNames = publisher ? ['pr', 'producer_run'] : ['pr'];
  requireMatch(typeof name === 'string' && !Object.keys(extra).length && exact(Object.keys(on ?? {}), ['workflow_dispatch']) &&
    exact(Object.keys(on.workflow_dispatch ?? {}), ['inputs']) && exact(Object.keys(eventInputs ?? {}).sort(), inputNames) &&
    inputNames.every(key => {
      const { description, ...settings } = eventInputs[key] ?? {};
      return (description === undefined || typeof description === 'string') && exact(settings, { required: true, type: 'string' });
    }), `Workflow ${path} does not declare the isolated manual dispatch inputs`);
  requireMatch(exact(permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' }) &&
    exact(Object.keys(jobs ?? {}), [jobId]), `Workflow ${path} has unexpected permissions or jobs`);
  const { steps, 'timeout-minutes': timeout, ...job } = jobs[jobId];
  const guard = expression(`github.repository == '${input.repository}' && github.ref == 'refs/heads/${input.workflowBranch}' && github.workflow_sha == vars.${workflowVariable}`);
  requireMatch(exact(job, { if: guard, 'runs-on': 'ubuntu-24.04', ...(publisher ? { environment: input.environment } : {}) }) &&
    Number.isInteger(timeout) && timeout > 0 && timeout <= 360 && Array.isArray(steps) && steps.length === 6,
  `Workflow ${path} does not isolate the expected job, runner and dispatch authority`);
  const workflowSteps = steps.map(githubObject);
  requireMatch(stepShape(workflowSteps[0]!, {
    uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    with: { repository: sdkRepository, ref: input.sdkSha, 'persist-credentials': false },
  }) && stepShape(workflowSteps[1]!, {
    uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', with: { 'node-version': '24' },
  }) && stepShape(workflowSteps[2]!, { run: 'npm ci --ignore-scripts' }) && stepShape(workflowSteps[3]!, { run: 'npm run build' }),
  `Workflow ${path} does not use the enrolled SDK and trusted Node setup`);
  const [owner, repository] = input.repository.split('/');
  if (publisher) {
    requireMatch(stepShape(workflowSteps[4]!, {
      uses: 'actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349', id: 'app',
      with: {
        'app-id': String(input.appId), 'private-key': expression(`secrets.${appSecret}`), owner, repositories: repository,
        'permission-checks': 'write', 'permission-contents': 'read', 'permission-actions': 'read',
        'permission-pull-requests': 'read', 'permission-administration': 'read',
      },
    }), `Publisher workflow ${path} does not restrict the App credential to the enrolled repository and permissions`);
  }
  const { run, ...runtimeStep } = workflowSteps[publisher ? 5 : 4]!;
  requireMatch(stepShape(runtimeStep, {
    id: 'behavproof',
    env: {
      GITHUB_TOKEN: expression(publisher ? 'steps.app.outputs.token' : 'secrets.GITHUB_TOKEN'),
      BEHAVPROOF_SDK_SHA: input.sdkSha,
      [workflowVariable]: expression(`vars.${workflowVariable}`),
      BEHAVPROOF_CURRENT_WORKFLOW_SHA: expression('github.workflow_sha'),
      [registrationVariable]: expression(`vars.${registrationVariable}`),
      [digestVariable]: expression(`vars.${digestVariable}`),
      BEHAVPROOF_PR: expression('inputs.pr'),
      ...(publisher ? { BEHAVPROOF_PRODUCER_RUN: expression('inputs.producer_run') } : {}),
    },
  }), `Workflow ${path} does not scope credentials and enrolled inputs to the trusted SDK step`);
  if (!publisher) {
    requireMatch(stepShape(workflowSteps[5]!, {
      uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      with: {
        name: expression('steps.behavproof.outputs.artifact_name'), path: expression('steps.behavproof.outputs.artifact_path'),
        'if-no-files-found': 'error', 'retention-days': 7,
      },
    }), `Producer workflow ${path} does not upload the required evidence archive`);
  }
  return { run };
}

async function verifyEnvironment(http: GitHubTransport, input: DeploymentVerificationInput) {
  const endpoint = `${http.prefix}/environments/${encodeURIComponent(input.environment)}`;
  const current = githubObject(await http.request(endpoint));
  requireObservation(current.name === input.environment && Object.hasOwn(current, 'deployment_branch_policy') && Array.isArray(current.protection_rules) &&
    typeof current.can_admins_bypass === 'boolean', 'GitHub omitted environment branch, reviewer or administrator bypass settings');
  requireMatch(current.deployment_branch_policy?.custom_branch_policies === true && current.deployment_branch_policy?.protected_branches === false &&
    current.can_admins_bypass === false, 'Publisher environment needs custom branch restrictions and disabled administrator bypass');
  const rules = current.protection_rules.map(githubObject).filter((rule: ReturnType<typeof githubObject>) => rule.type === 'required_reviewers');
  requireMatch(rules.length === 1, 'Publisher environment lacks one required-reviewer rule');
  const rule = rules[0]!;
  requireObservation(typeof rule.prevent_self_review === 'boolean' && Array.isArray(rule.reviewers), 'GitHub omitted publisher reviewer settings');
  const reviewers = rule.reviewers.map((entry: unknown) => {
    const value = githubObject(entry);
    requireMatch(value.type === 'User', 'Publisher environment allows a reviewer outside the enrolled users');
    requireObservation(typeof value.reviewer?.login === 'string', 'GitHub omitted a publisher reviewer identity');
    return value.reviewer.login.toLowerCase();
  });
  requireMatch(rule.prevent_self_review && exact(reviewers.sort(), input.reviewers.map(login => login.toLowerCase()).sort()),
    'Publisher environment reviewers differ from enrollment or allow self-review');

  const inventory = githubObject(await http.request(`${endpoint}/deployment-branch-policies?per_page=100&page=1`));
  requireObservation(Number.isSafeInteger(inventory.total_count) && inventory.total_count >= 0 && Array.isArray(inventory.branch_policies) &&
    inventory.branch_policies.length === Math.min(inventory.total_count, 100), 'GitHub did not return a complete environment branch-rule inventory');
  const rows = inventory.branch_policies.map(githubObject);
  requireMatch(rows.length === 1 && rows[0]?.name === input.workflowBranch, 'Publisher environment must allow only the enrolled workflow branch');
  requireObservation(rows[0].type === 'branch' || rows[0].type === 'tag', 'GitHub did not identify the environment restriction as a branch or a tag');
  requireMatch(rows[0].type === 'branch', 'Publisher environment matches a tag instead of the enrolled workflow branch');
  const secret = githubObject(await http.request(`${endpoint}/secrets/${appSecret}`));
  requireObservation(secret.name === appSecret, 'GitHub omitted the publisher environment credential metadata');
  return [`${input.environment} permits only branch ${input.workflowBranch}`, 'Enrolled environment reviewers, self-review prevention, administrator enforcement and App secret metadata'];
}

async function verifySecretScope(http: GitHubTransport, ownerType: unknown) {
  requireObservation(ownerType === 'Organization' || ownerType === 'User', 'GitHub omitted the repository owner type');
  const scopes = ['secrets', ...(ownerType === 'Organization' ? ['organization-secrets'] : [])];
  for (const scope of scopes) {
    const names = new Set<string>();
    let complete = false;
    for (let page = 1; page <= http.maxPages; page++) {
      const inventory = githubObject(await http.request(`${http.prefix}/actions/${scope}?per_page=100&page=${page}`));
      requireObservation(Array.isArray(inventory.secrets) && inventory.secrets.length <= 100 &&
        Number.isSafeInteger(inventory.total_count) && inventory.total_count >= names.size,
      'GitHub returned an incomplete credential metadata inventory');
      for (const secret of inventory.secrets.map(githubObject)) {
        requireObservation(typeof secret.name === 'string' && !names.has(secret.name.toUpperCase()), 'GitHub returned ambiguous credential metadata');
        names.add(secret.name.toUpperCase());
      }
      requireMatch(!names.has(appSecret), 'Dedicated App secret name is available outside the publisher environment');
      requireObservation(names.size <= inventory.total_count, 'GitHub credential metadata changed during verification');
      if (names.size === inventory.total_count) {
        complete = true;
        break;
      }
      requireObservation(inventory.secrets.length === 100, 'GitHub returned an incomplete credential metadata inventory');
    }
    requireObservation(complete, 'GitHub credential metadata inventory exceeds the verification limit');
  }
  return ['Dedicated App secret name is absent from broader repository-visible credential metadata'];
}

function requireBranchReviews(value: ReturnType<typeof githubObject>) {
  const reviews = value.required_pull_request_reviews;
  requireObservation(reviews !== undefined, 'GitHub omitted protected branch human-review settings');
  requireMatch(Number.isSafeInteger(reviews?.required_approving_review_count) && reviews.required_approving_review_count > 0 && reviews.dismiss_stale_reviews === true,
    'Protected branch must require human approval and dismiss stale reviews');
  const bypass = reviews.bypass_pull_request_allowances;
  if (bypass !== undefined && bypass !== null) {
    const rules = githubObject(bypass);
    requireObservation(['users', 'teams', 'apps'].every(kind => Array.isArray(rules[kind])), 'GitHub omitted the branch pull-request bypass inventory');
    requireMatch(['users', 'teams', 'apps'].every(kind => rules[kind].length === 0), 'Protected branch allows pull-request review bypass');
  }
}

async function verifyBranch(authority: GitHubAuthority, input: DeploymentVerificationInput) {
  const result = await authority.protection(input.protectedBranch, [{ context: input.checkName, appId: input.appId }]);
  requireObservation(result.status === 'pass', result.reasons.join(', ') || 'GitHub branch protection observation is unavailable');
  const value = githubObject(result.value);
  const matching = value.required_status_checks.checks.filter((entry: unknown) => githubObject(entry).context === input.checkName);
  requireMatch(matching.length === 1, 'Multiple required checks use the same publisher context');
  requireBranchReviews(value);
  return value;
}

function verifyWorkflowBranch(value: ReturnType<typeof githubObject>, branchName: string) {
  const admins = value.enforce_admins?.enabled;
  const forcePushes = value.allow_force_pushes?.enabled;
  const deletions = value.allow_deletions?.enabled;
  requireObservation([admins, forcePushes, deletions].every(setting => typeof setting === 'boolean'),
    'GitHub omitted workflow branch administrator, force-push or deletion enforcement');
  requireMatch(admins === true && forcePushes === false && deletions === false,
    'Trusted workflow branch protection must apply to administrators and disable force pushes and deletion');
  requireBranchReviews(value);
  return [`${branchName} requires human review and administrator enforcement with force pushes and deletion disabled`];
}

export async function verifyDeployment(
  input: DeploymentVerificationInput,
  options: { token?: string; fetcher?: Fetcher; root?: string } = {},
): Promise<DeploymentVerificationReport> {
  verifyInput(input);
  const { root, ...transportOptions } = options;
  const github = { repository: input.repository, ...transportOptions };
  const http = new GitHubTransport(github);
  const authority = new GitHubAuthority(github);
  // The consumer's workflow token can check out the public SDK without any
  // cross-repository permission. Observe the same public visibility here.
  const sdk = new GitHubTransport({ repository: sdkRepository, ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
  const checks: VerificationCheck[] = [];

  if (root !== undefined) {
    checks.push(await observe('local-integration', 'Apply or check out the reviewed integration files.', async () => {
      for (const [path, expected] of Object.entries(input.files)) {
        let bytes: Buffer;
        try {
          bytes = await safeRead(root, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Mismatch(`Local integration file ${path} is missing`);
          throw new Unavailable(`Could not safely read local integration file ${path}`);
        }
        requireMatch(hashBytes(bytes) === expected, `Local integration file ${path} differs from the enrolled hash`);
      }
      return Object.keys(input.files).sort();
    }));
  }

  let ownerType: unknown;
  const repository = await observe('repository', 'Check the registered repository identity and token access.', async () => {
    const observed = githubObject(await http.request(http.prefix));
    requireObservation(typeof observed.full_name === 'string' && (typeof observed.id === 'string' || Number.isSafeInteger(observed.id)), 'GitHub omitted the repository identity');
    requireMatch(observed.full_name === input.repository && String(observed.id) === input.repositoryId, 'GitHub repository identity differs from enrollment');
    ownerType = observed.owner?.type;
    return [`${input.repository} (ID ${input.repositoryId})`];
  });
  checks.push(repository);

  const remote = (id: string, action: string, operation: () => Promise<string[]>) => observe(id, action, async () => {
    requireObservation(repository.status === 'pass', 'Registered repository identity could not be confirmed');
    return operation();
  });
  let files: Map<string, Buffer> | undefined;
  let registered: ReturnType<typeof githubObject> | undefined;
  let protectedBranch: ReturnType<typeof githubObject> | undefined;
  checks.push(...await Promise.all([
    observe('sdk-availability', 'Select a publicly readable BehavProof SDK revision containing the protected runtime.', () => verifySdk(sdk, input.sdkSha)),
    remote('pinned-source', 'Commit and enroll the reviewed descriptor, policy and workflow files.', async () => {
      files = await readPinnedFiles(http, input);
      return [...files.keys()].map(path => `${input.workflowSha}:${path}`);
    }),
    remote('registration', 'Set the three protected repository variables from the independent enrollment and grant Variables read access.', async () => {
      registered = await readRegistration(http, input);
      return [`Registration SHA-256 ${input.registrationDigest}`, `Workflow SHA ${input.workflowSha}`];
    }),
    remote('publisher-environment', 'Restrict the environment to the exact workflow branch, configure the enrolled reviewers, disable self-review and administrator bypass, and provision the App secret.', () => verifyEnvironment(http, input)),
    remote('publisher-secret-scope', 'Keep the App secret only in the publisher environment and grant Secrets read access to verify broader scope.', () => verifySecretScope(http, ownerType)),
    remote('branch-protection', 'Read classic branch protection with Administration read access. Require the exact App check in strict mode for administrators and require human approval with stale-review dismissal.', async () => {
      protectedBranch = await verifyBranch(authority, input);
      return [`${input.protectedBranch} requires ${input.checkName} from App ${input.appId}`, 'Strict, administrator enforcement and stale-review dismissal enabled'];
    }),
    remote('workflow-availability', 'Ensure both enrolled workflows are active in GitHub Actions and grant Actions read access.', async () => {
      for (const path of [input.producerPath, input.publisherPath]) {
        const workflow = githubObject(await http.request(`${http.prefix}/actions/workflows/${encodeURIComponent(basename(path))}`));
        requireObservation(typeof workflow.path === 'string' && typeof workflow.state === 'string', `GitHub omitted the path or state of ${path}`);
        requireMatch(workflow.path === path && workflow.state === 'active', `Workflow ${path} is not active at the enrolled path`);
      }
      return [input.producerPath, input.publisherPath];
    }),
  ]));

  checks.push(await remote('workflow-branch-protection', 'Apply classic protection to the trusted workflow branch. Require stale-review dismissal and administrator enforcement and disable force pushes and deletion.', async () => {
    const value = input.workflowBranch === input.protectedBranch && protectedBranch
      ? protectedBranch
      : githubObject(await http.request(`${http.prefix}/branches/${encodeURIComponent(input.workflowBranch)}/protection`));
    return verifyWorkflowBranch(value, input.workflowBranch);
  }));
  checks.push(await remote('workflow-ref', 'Dispatch from the enrolled workflow branch tip or review and enroll the updated workflow commit.', () => readRef(http, input)));
  checks.push(await observe('deployment-descriptor', 'Enroll a descriptor whose deployment fields match the protected registration.', async () => {
    requireObservation(files && registered, 'Pinned files and remote registration must be observable');
    let descriptor: unknown;
    try {
      descriptor = JSON.parse(decodeText(files.get(descriptorPath)!));
    } catch {
      throw new Mismatch('Pinned deployment descriptor is invalid JSON');
    }
    requireMatch(exact(descriptor, { schemaVersion: 1, ...registered }), 'Pinned deployment descriptor differs from the enrolled deployment');
    return [descriptorPath];
  }));

  let producer: ReturnType<typeof verifyWorkflow> | undefined;
  let publisher: ReturnType<typeof verifyWorkflow> | undefined;
  const workflowIsolation = await observe('workflow-isolation', 'Review and re-enroll the producer and publisher workflows with the protected template.', async () => {
    requireObservation(files, 'Pinned producer and publisher bytes could not be confirmed');
    producer = verifyWorkflow(files.get(input.producerPath)!, input, 'producer');
    publisher = verifyWorkflow(files.get(input.publisherPath)!, input, 'publisher');
    return ['Producer workflow uses a read-only host token and the enrolled SDK', `Publisher workflow scopes its App token to the trusted runtime in ${input.environment}`];
  });
  checks.push(workflowIsolation);
  const upstream = await observe('required-upstream', 'Use the pinned producer collection and publisher evidence-validation commands in the reviewed workflows.', async () => {
    requireObservation(producer && publisher, 'Protected workflow roles could not be confirmed');
    requireMatch(producer.run === 'node scripts/quality-ci.mjs produce' && publisher.run === 'node scripts/quality-ci.mjs publish',
      'The registered workflows do not call the required trusted producer and publisher runtime commands');
    return ['Publisher calls the pinned SDK to validate the required producer job and authenticated evidence'];
  });
  checks.push(upstream);

  return {
    schemaVersion: 1, repository: input.repository, workflowSha: input.workflowSha,
    status: checks.every(check => check.status === 'pass') ? 'pass' : 'incomplete', checks,
    isolationConfigurationObserved: workflowIsolation.status === 'pass' && upstream.status === 'pass' &&
      checks.filter(check => ['workflow-ref', 'workflow-branch-protection', 'sdk-availability', 'registration', 'publisher-environment', 'publisher-secret-scope'].includes(check.id)).every(check => check.status === 'pass'),
    runtimeIsolation: 'not-observed', pullRequestExecution: 'not-observed',
  };
}
