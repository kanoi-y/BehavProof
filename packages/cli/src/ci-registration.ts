import {readFile, realpath, lstat, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {z} from 'zod';
import {ApprovalSchema, ConfigSchema, HashSchema, RegistrySnapshotSchema, RelativePathSchema, canonicalJson, hash, hashBytes, parseConfig} from '@behavproof/core';
import {GitHubAuthority, GitHubTransport, type GitHubOptions} from '@behavproof/adapter-github';
import {Deployment, commitSha, deploymentPath, packageFiles} from './ci-plan.js';
import {QualityPolicy} from './quality.js';
import {defaultTest} from './quality-static.js';
import {git, registryAtGit} from './project.js';
import {readPinnedFiles} from './ci-verify.js';

export const CIRegistration = z.strictObject({
  schemaVersion:z.literal(1),
  deployment:Deployment,
  repositoryId:z.string().regex(/^[1-9][0-9]*$/),
  workflowSha:commitSha,
  files:z.record(RelativePathSchema,HashSchema),
  reviewers:z.array(z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/)).min(1).max(6),
  requiredTests:z.array(RelativePathSchema).max(1000),
  approval:ApprovalSchema,
  baseline:RegistrySnapshotSchema,
  policy:QualityPolicy,
  config:ConfigSchema,
});
export type CIRegistration = z.infer<typeof CIRegistration>;
const json = (value:unknown) => canonicalJson(value)+'\n';

export function registrationTarget(r: Pick<CIRegistration,'deployment'|'workflowSha'|'files'|'reviewers'|'policy'|'config'|'baseline'|'requiredTests'>) {
  const {deployment,workflowSha,files,reviewers,policy,config,baseline,requiredTests}=r;
  return {kind:'policy' as const,id:'quality-ci-deployment-v1',
    contentHash:hash({deployment,workflowSha,files,reviewers,policy,config,baseline,requiredTests})};
}

export function registeredCI(input: unknown, digest: string): CIRegistration {
  const r = CIRegistration.parse(input);
  if (hash(r)!==HashSchema.parse(digest)) throw Error('External CI registration digest mismatch');
  const {deployment,approval,baseline} = r;
  const workflows = packageFiles(deployment,r.policy);
  if (approval.status!=='pass' || approval.source.provider!=='github' ||
      !approval.source.ref.startsWith(`https://github.com/${deployment.repository}/pull/`) ||
      approval.subjectCommitSha!==baseline.commitSha || hash(approval.target)!==hash(registrationTarget(r)) ||
      !approval.approvedBy.length || !approval.approvedBy.every(user => r.reviewers.some(reviewer => reviewer.toLowerCase()===user.toLowerCase())) ||
      baseline.discoveryDiagnostics?.length!==0 || !baseline.extractorVersion ||
      workflows.some(file => r.files[file.path]!==file.sha256)) throw Error('Incomplete or inconsistent protected CI registration');
  return r;
}

async function externalFile(root:string, path:string) {
  const top = await realpath((await git(root,['rev-parse','--show-toplevel'])).trim());
  if (!isAbsolute(path)) throw Error('An absolute external registration path is required');
  const parent = await realpath(dirname(resolve(path)));
  const external = relative(top,parent);
  if (external==='' || !isAbsolute(external) && external!=='..' && !external.startsWith('..'+sep)) throw Error('Registration must be outside the entire worktree');
  const info = await lstat(parent);
  if (process.platform!=='win32' && (info.mode&0o077 || info.uid!==process.getuid?.())) throw Error('Use a private registration directory owned by the current user');
  return join(parent,basename(path));
}

export async function readCIRegistration(root:string,path:string,digest:string) {
  const external=await externalFile(root,path);
  const info=await lstat(external);
  if (!info.isFile() || info.nlink!==1 || info.size>48*1024) throw Error('Unsafe external registration file');
  return registeredCI(JSON.parse(await readFile(external,'utf8')),digest);
}

export async function enrollCI(root:string, options:{
  pr:number;workflowSha:string;reviewers:string[];registration:string;token?:string;fetcher?:GitHubOptions['fetcher'];
}) {
  const head = commitSha.parse((await git(root,['rev-parse','HEAD'])).trim());
  const workflowSha=commitSha.parse(options.workflowSha);
  const reviewers=[...new Set(options.reviewers.map(value => value.toLowerCase()))].sort();
  if (!reviewers.length || reviewers.length>6 || reviewers.some(value => !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value))) throw Error('Supply one to six authorized reviewer logins');
  if (!Number.isSafeInteger(options.pr) || options.pr<1) throw Error('A positive approval PR number is required');
  const output=await externalFile(root,options.registration);
  const at=async(path:string) => {
    RelativePathSchema.parse(path);
    const line=await git(root,['ls-tree',head,'--',`:(literal)${path}`]);
    if (!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(line)) throw Error(`Expected a regular committed file: ${path}`);
    return git(root,['show',`${head}:./${path}`]);
  };
  const descriptor=z.strictObject({schemaVersion:z.literal(1),...Deployment.shape}).parse(JSON.parse(await at(deploymentPath)));
  const {schemaVersion:_schema,...deployment}=descriptor;
  const policy=QualityPolicy.parse(JSON.parse(await at(deployment.policyPath)));
  const cfgExists=(await git(root,['ls-tree',head,'--',`:(literal)${deployment.configPath}`])).length>0;
  const config=parseConfig(cfgExists?JSON.parse(await at(deployment.configPath)):{schemaVersion:1});
  if (config.testRunner && config.testRunner!==policy.runner) throw Error('Reviewed test runner differs from the quality policy');
  const baseline=await registryAtGit(root,config,head);
  const files:Record<string,string>={};
  for (const file of packageFiles(deployment,policy)) {
    files[file.path]=hashBytes(Buffer.from(await at(file.path)));
    if (files[file.path]!==file.sha256) throw Error(`Reviewed integration differs from generated assets: ${file.path}`);
  }
  if (cfgExists) files[deployment.configPath]=hashBytes(Buffer.from(await at(deployment.configPath)));
  const ghOptions={repository:deployment.repository,...(options.token?{token:options.token}:{}),...(options.fetcher?{fetcher:options.fetcher}:{})};
  const http=new GitHubTransport(ghOptions), authority=new GitHubAuthority(ghOptions), prefix=http.prefix;
  const repo=z.object({id:z.number().int().positive(),full_name:z.literal(deployment.repository)}).parse(await http.request(prefix));
  const workflow=z.object({commit:z.object({sha:commitSha})}).parse(await http.request(`${prefix}/branches/${encodeURIComponent(deployment.workflowBranch)}`));
  if (workflow.commit.sha!==workflowSha) throw Error('The trusted workflow branch does not point at the selected workflow commit');
  await readPinnedFiles(http,{workflowSha,files,configPath:deployment.configPath});
  const pr=z.object({base:z.object({ref:z.literal(deployment.protectedBranch),sha:commitSha})}).parse(await http.request(`${prefix}/pulls/${options.pr}`));
  const requiredChecks=[{context:deployment.checkName,appId:deployment.appId}];
  if ((await authority.protection(deployment.protectedBranch,requiredChecks)).status!=='pass') throw Error('Required issuer-bound branch protection is unavailable');
  const requiredTests=(await git(root,['ls-tree','-r','--name-only','-z',head])).split('\0').filter(path=>defaultTest(path,policy.runner)).sort();
  const selection={deployment,workflowSha,files,reviewers,policy,config,baseline,requiredTests};
  const approval=await authority.approval(options.pr,registrationTarget(selection),{headSha:head,baseSha:pr.base.sha,reviewers,requiredChecks});
  if (!approval.approval) throw Error(`Independent human approval unavailable: ${approval.reasons.join('; ')}`);
  const registration=CIRegistration.parse({schemaVersion:1,...selection,repositoryId:String(repo.id),approval:approval.approval});
  const digest=hash(registration);
  registeredCI(registration,digest);
  const content=json(registration);
  if (Buffer.byteLength(content)>48*1024) throw Error('Registration exceeds the GitHub variable size limit');
  await writeFile(output,content,{flag:'wx',mode:0o600});
  return {registration:output,digest,workflowSha,repository:deployment.repository,protection:'verify-required'};
}
