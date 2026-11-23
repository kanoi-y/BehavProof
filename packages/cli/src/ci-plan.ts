import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {canonicalJson, hash, hashBytes, RelativePathSchema, safeRead, safeReadJson} from '@behavproof/core';
import {config, writeScoped} from './project.js';
import {diagnoseQuality, QualityPolicy} from './quality.js';

export const deploymentPath = '.github/behavproof/deployment.json';
export const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
const branch = z.string().max(200).regex(/^[\w-][\w./-]*$/).refine(value =>
  !value.includes('..') && value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')));
export const Deployment = z.strictObject({
  repository:z.string().regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/).refine(value => !value.includes('..')),
  protectedBranch:branch, workflowBranch:branch, sdkSha:commitSha,
  appId:z.number().int().positive().safe().refine(value => value !== 15368),
  checkName:z.literal('BehavProof protected gate'),
  environment:z.literal('behavproof-publisher'),
  producerPath:z.literal('.github/workflows/behavproof-producer.yml'),
  publisherPath:z.literal('.github/workflows/behavproof-publisher.yml'),
  policyPath:z.literal('.github/behavproof/quality-policy.json'),
  configPath:RelativePathSchema,
});
export type Deployment = z.infer<typeof Deployment>;
export type PlanOptions = {'repository'?:string; 'branch'?:string; 'workflow-branch'?:string; 'sdk-sha'?:string; 'app-id'?:string; config?:string; runner?:string; 'quality-policy'?:string};
const json = (value: unknown) => canonicalJson(value) + '\n';
const expression = (value: string) => '$' + '{{ ' + value + ' }}';

function workflow(deployment: Deployment, kind: 'producer'|'publisher') {
  const publisher = kind === 'publisher', [owner,repo] = deployment.repository.split('/');
  const guarded = expression(`github.repository == '${deployment.repository}' && github.ref == 'refs/heads/${deployment.workflowBranch}' && github.workflow_sha == vars.BEHAVPROOF_WORKFLOW_SHA`);
  const lines = [
    `name: BehavProof protected ${kind}`,
    'on:', '  workflow_dispatch:', '    inputs:', '      pr:', '        description: Open pull request number', '        required: true', '        type: string',
    ...(publisher ? ['      producer_run:', '        description: Completed producer run ID', '        required: true', '        type: string'] : []),
    'permissions:', '  contents: read', '  actions: read', '  pull-requests: read',
    'jobs:', `  ${publisher?'gate':'collect'}:`, `    if: ${guarded}`,
    '    runs-on: ubuntu-24.04', '    timeout-minutes: 20',
    ...(publisher ? [`    environment: ${deployment.environment}`] : []),
    '    steps:',
    '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    '        with:', '          repository: kanoi-y/BehavProof', `          ref: '${deployment.sdkSha}'`, '          persist-credentials: false',
    '      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    '        with:', "          node-version: '24'",
    '      - run: npm ci --ignore-scripts', '      - run: npm run build',
    ...(publisher ? [
      '      - uses: actions/create-github-app-token@fee1f7d63c2ff003460e3d139729b119787bc349', '        id: app', '        with:',
      `          app-id: '${deployment.appId}'`, `          private-key: ${expression('secrets.BEHAVPROOF_APP_PRIVATE_KEY')}`,
      `          owner: '${owner}'`, `          repositories: '${repo}'`, '          permission-checks: write',
      '          permission-contents: read', '          permission-actions: read', '          permission-pull-requests: read', '          permission-administration: read',
    ] : []),
    `      - name: ${publisher?'Verify evidence and publish the gate':'Collect evidence in isolated containers'}`,
    '        id: behavproof', '        env:',
    ...Object.entries({
      GITHUB_TOKEN:publisher?'steps.app.outputs.token':'secrets.GITHUB_TOKEN',
      BEHAVPROOF_SDK_SHA:undefined,
      BEHAVPROOF_WORKFLOW_SHA:'vars.BEHAVPROOF_WORKFLOW_SHA',
      BEHAVPROOF_CURRENT_WORKFLOW_SHA:'github.workflow_sha',
      BEHAVPROOF_REGISTRATION_JSON:'vars.BEHAVPROOF_REGISTRATION_JSON',
      BEHAVPROOF_REGISTRATION_DIGEST:'vars.BEHAVPROOF_REGISTRATION_DIGEST',
      BEHAVPROOF_PR:'inputs.pr',
      ...(publisher?{BEHAVPROOF_PRODUCER_RUN:'inputs.producer_run'}:{}),
    }).map(([name,value]) => `          ${name}: ${value?expression(value):"'" + deployment.sdkSha + "'"}`),
    `        run: node scripts/quality-ci.mjs ${publisher?'publish':'produce'}`,
    ...(!publisher ? [
      '      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
      '        with:',
      `          name: ${expression('steps.behavproof.outputs.artifact_name')}`,
      `          path: ${expression('steps.behavproof.outputs.artifact_path')}`,
      '          if-no-files-found: error', '          retention-days: 7',
    ] : []),
  ];
  return lines.join('\n') + '\n';
}
export const packageFiles = (deployment:Deployment, quality:QualityPolicy) =>
  Object.entries({
    [deploymentPath]:json({schemaVersion:1,...deployment}),
    [deployment.policyPath]:json(quality),
    [deployment.producerPath]:workflow(deployment,'producer'),
    [deployment.publisherPath]:workflow(deployment,'publisher'),
  }).map(([path,content]) => ({path,content,sha256:hashBytes(Buffer.from(content))}));

export async function planCI(root: string, options: PlanOptions) {
  const deployment = Deployment.parse({
    repository:options.repository, protectedBranch:options.branch, workflowBranch:options['workflow-branch']??'main',
    sdkSha:options['sdk-sha'], appId:Number(options['app-id']), checkName:'BehavProof protected gate',
    environment:'behavproof-publisher', producerPath:'.github/workflows/behavproof-producer.yml',
    publisherPath:'.github/workflows/behavproof-publisher.yml', policyPath:'.github/behavproof/quality-policy.json',
    configPath:options.config??'behavproof.config.json',
  });
  const cfg = await config(root,deployment.configPath);
  const runner = (options.runner??cfg.testRunner) as QualityPolicy['runner']|undefined;
  const custom = options['quality-policy'] ? QualityPolicy.parse(await safeReadJson(root,options['quality-policy'])) : undefined;
  if (runner && custom && runner !== custom.runner) throw Error('Runner does not match the selected quality policy');
  const quality = await diagnoseQuality(root,{...(runner?{runner}:{}),...(custom?{policy:custom}:{})});
  const prerequisite = [
    {id:'configuration', status:quality.status, issues:quality.findings.filter(row => row.required && ['fail','unknown'].includes(row.status))},
    {id:'lockfile', status:await pathState(root,'package-lock.json') === 'regular'?'present':'missing', action:'Commit a reviewed npm package-lock.json.'},
  ];
  return {schemaVersion:1, deployment, policy:quality.policy, files:packageFiles(deployment,quality.policy), prerequisite,
    provisioning:[
      `Review the proposed files, apply them locally and install them on the trusted workflow branch ${deployment.workflowBranch}.`,
      `Install dedicated GitHub App ${deployment.appId} with Checks write and Actions, Contents, Pull requests, Administration read. Restrict the ${deployment.environment} environment to the trusted workflow branch, require approved reviewers, disable self-review and administrator bypass, and store BEHAVPROOF_APP_PRIVATE_KEY there.`,
      `Configure strict branch protection on ${deployment.protectedBranch}, enforce it for admins, require human review with stale-review dismissal, and select ${deployment.checkName} from App ${deployment.appId}.`,
      'Enroll the reviewed PR and workflow commit from an independent host. Set BEHAVPROOF_WORKFLOW_SHA, BEHAVPROOF_REGISTRATION_JSON and BEHAVPROOF_REGISTRATION_DIGEST as protected repository variables.',
      'Protect the dedicated behavproof-registry branch, restrict its writers, and initialize it with ci init-registry. After merging a specification change, use ci advance from the protected host.',
      'Run ci verify against the external registration, then dispatch the producer for an open PR and the publisher for the completed producer run.',
    ], protection:'unverified'};
}

async function pathState(root:string, path:string) {
  RelativePathSchema.parse(path);
  const parts = path.split('/');
  let current = root;
  for (const [index,part] of parts.entries()) {
    current = join(current,part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return 'unsafe';
      if (index === parts.length-1) return info.isFile() && info.nlink===1?'regular':'unsafe';
      if (!info.isDirectory()) return 'unsafe';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code==='ENOENT') return 'missing';
      throw error;
    }
  }
  return 'unsafe';
}
export async function applyCI(root:string, ref:string, dryRun:boolean) {
  const approved = z.object({schemaVersion:z.literal(1),deployment:Deployment,policy:QualityPolicy,files:z.array(z.unknown())}).parse(await safeReadJson(root,ref));
  const files = packageFiles(approved.deployment,approved.policy);
  if (hash(files)!==hash(approved.files)) throw Error('Plan bytes differ from the generated integration; regenerate and review');
  const changes = [];
  for (const file of files) {
    const state = await pathState(root,file.path);
    const action = state === 'missing' ? (dryRun?'would-create':'create') : state === 'regular' &&
      hashBytes(await safeRead(root,file.path)) === file.sha256 ? 'preserve' : 'conflict';
    changes.push({path:file.path, action});
  }
  const conflict = changes.some(file => file.action==='conflict');
  if (!conflict && !dryRun) {
    for (const [index,file] of files.entries()) if (changes[index]!.action==='create') {
      await writeScoped(root,file.path,file.content,true);
      changes[index]!.action = 'created';
    }
  }
  return {schemaVersion:1, dryRun, files:changes, status:conflict?'conflict':'ready-for-review', protection:'unverified', exitCode:conflict?1:0};
}
