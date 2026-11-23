import {z} from 'zod';
import {canonicalJson,hash,hashBytes,HashSchema,parseConfig,FormalConfigSchema,ScopedExceptionsSchema,SpecificationRegistrySchema} from '@behavproof/core';
import {GitHubAuthority,GitHubTransport,githubObject,registryGateReceipt,type GitHubOptions} from '@behavproof/adapter-github';
import type {CIRegistration} from './ci-registration.js';
import {commitSha} from './ci-plan.js';
import {git,readGitFile} from './project.js';
import {specificationsAt} from './formal-registry.js';

const branch='behavproof-registry', statePath='registry.json';
const positive=z.number().int().positive().safe();
const registryState=z.strictObject({schemaVersion:z.literal(1),enrollmentDigest:HashSchema,
  active:z.strictObject({pr:positive,check:positive,head:commitSha,base:commitSha,merged:commitSha,
    previousDigest:HashSchema,configDigest:HashSchema.nullable(),specifications:SpecificationRegistrySchema,
    formal:FormalConfigSchema.optional(),exceptions:ScopedExceptionsSchema.optional()}).nullable(),
});
type RegistryState=z.infer<typeof registryState>;

async function registryTip(http:GitHubTransport) {
  const response=githubObject(await http.request(`${http.prefix}/branches/${branch}`));
  if(response.name!==branch||response.protected!==true)throw Error('Specification registry branch is not protected');
  return commitSha.parse(response.commit?.sha);
}

async function requireRegistryWriteProtection(http:GitHubTransport){
  const classic=await http.request(`${http.prefix}/branches/${branch}/protection`).catch(error=>{
    if(error instanceof Error&&error.message==='GitHub HTTP 404')return undefined;
    throw error;
  });
  if(classic){
    const protection=githubObject(classic),allowed=protection.restrictions;
    if(protection.enforce_admins?.enabled===true&&protection.allow_force_pushes?.enabled===false&&
      protection.allow_deletions?.enabled===false&&allowed&&
      ['users','teams','apps'].some(key=>Array.isArray(allowed[key])&&allowed[key].length>0))return;
  }
  const rules=await http.request(`${http.prefix}/rules/branches/${branch}?per_page=100`);
  const applied=z.array(z.object({type:z.string(),ruleset_source_type:z.string(),ruleset_source:z.string(),ruleset_id:positive})).max(99).parse(rules);
  const ids=[...new Set(applied.filter(rule=>rule.ruleset_source_type==='Repository'&&rule.ruleset_source===http.repository)
    .filter(rule=>['update','deletion','non_fast_forward'].includes(rule.type)).map(rule=>rule.ruleset_id))];
  const rulesets=await Promise.all(ids.map(id=>http.request(`${http.prefix}/rulesets/${id}`).then(githubObject)));
  const coverage=new Set<string>();
  for(const item of rulesets){
    if(item.source_type!=='Repository'||item.source!==http.repository||item.enforcement!=='active'||item.target!=='branch'||
      !Array.isArray(item.bypass_actors)||!Array.isArray(item.rules))continue;
    const explicitWriters=item.bypass_actors.length>0&&item.bypass_actors.every(actor=>
      ['Integration','Team','User'].includes(actor.actor_type)&&positive.safeParse(actor.actor_id).success&&actor.bypass_mode==='always');
    for(const type of ['update','deletion','non_fast_forward']){
      if(!applied.some(rule=>rule.ruleset_id===item.id&&rule.type===type)||!item.rules.some(rule=>rule.type===type))continue;
      if(type==='update'?explicitWriters:item.bypass_actors.length===0){
        coverage.add(type);
      }
    }
  }
  if(coverage.size!==3)throw Error('Restrict registry branch writers and prohibit removal and force updates');
}

async function readState(http:GitHubTransport,tip:string):Promise<RegistryState|undefined>{
  const response=await http.request(`${http.prefix}/contents/${statePath}?ref=${tip}`).catch(error=>{
    if(error instanceof Error&&error.message==='GitHub HTTP 404')return undefined;
    throw error;
  });
  if(response===undefined)return undefined;
  const file=z.object({type:z.literal('file'),path:z.literal(statePath),encoding:z.literal('base64'),
    content:z.string().max(100000),size:z.number().int().positive().max(48*1024)}).parse(response);
  const encoded=file.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==file.size||bytes.toString('base64')!==encoded)throw Error('Invalid specification registry bytes');
  return registryState.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}

export async function loadRegistryCI(enrollment:CIRegistration,enrollmentDigest:string,http:GitHubTransport,
  {verifyWriteProtection=false}: {verifyWriteProtection?:boolean} = {}) {
  if(http.repository!==enrollment.deployment.repository)throw Error('Specification registry repository mismatch');
  if([enrollment.deployment.protectedBranch,enrollment.deployment.workflowBranch].includes(branch)){
    throw Error('The specification registry branch must be dedicated');
  }
  const tip=await registryTip(http);
  if(verifyWriteProtection)await requireRegistryWriteProtection(http);
  const state=await readState(http,tip);
  if(!state||state.enrollmentDigest!==enrollmentDigest)throw Error('Protected specification registry enrollment mismatch');
  const active=state.active;
  if(!active)return {tip,state,registration:enrollment,digest:enrollmentDigest};
  const {formal:_formal,exceptions:_exceptions,...governed}=enrollment.config;
  const config=parseConfig({...governed,...(active.formal?{formal:active.formal}:{}),...(active.exceptions?{exceptions:active.exceptions}:{})});
  const files={...enrollment.files},configPath=enrollment.deployment.configPath;
  if(active.configDigest)files[configPath]=active.configDigest;
  else delete files[configPath];
  const ids=(config.formal?.models??[]).map(model=>model.id).sort();
  if(hash(ids)!==hash(active.specifications.map(spec=>spec.id).sort())){
    throw Error('Incomplete active specification registry');
  }
  const registration={...enrollment,config,files,sourceCommit:active.merged,specifications:active.specifications};
  return {tip,state,registration,digest:hash(state)};
}

export async function verifyRegistryCI(enrollment:CIRegistration,digest:string,http:GitHubTransport){
  const snapshot=await loadRegistryCI(enrollment,digest,http,{verifyWriteProtection:true});
  return [`${branch}@${snapshot.tip}`,`Active registry SHA-256 ${snapshot.digest}`];
}

export async function requireCurrentRegistryBase(root:string,base:string,head:string,active:Awaited<ReturnType<typeof loadRegistryCI>>) {
  const {registration}=active,ref=registration.deployment.configPath;
  if(!active.state.active&&head===registration.sourceCommit)return;
  if(active.state.active)await git(root,['merge-base','--is-ancestor',registration.sourceCommit,commitSha.parse(base)]);
  const present=(await git(root,['ls-tree',base,'--',`:(literal)${ref}`])).length>0;
  const config=present?parseConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readGitFile(root,base,ref)))):parseConfig({schemaVersion:2});
  const specifications=await specificationsAt(root,config,path=>readGitFile(root,base,path));
  if(hash([config.formal??null,config.exceptions??null,specifications])!==
    hash([registration.config.formal??null,registration.config.exceptions??null,registration.specifications])){
    throw Error('The protected branch has an unpromoted specification change');
  }
}

async function replaceState(http:GitHubTransport,tip:string,state:RegistryState){
  const contents=Buffer.from(canonicalJson(registryState.parse(state))+'\n');
  if(contents.length>48*1024)throw Error('Specification registry exceeds its size limit');
  const response=githubObject(await http.request('/graphql',{
    query:'mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid parents(first:1){nodes{oid}}}}}',
    variables:{input:{branch:{repositoryNameWithOwner:http.repository,branchName:branch},expectedHeadOid:tip,
      message:{headline:state.active?`Promote BehavProof registry for PR ${state.active.pr}`:'Initialize BehavProof registry'},
      fileChanges:{additions:[{path:statePath,contents:contents.toString('base64')}]}}},
  }));
  const commit=response.data?.createCommitOnBranch?.commit;
  if(response.errors||commit?.parents?.nodes?.[0]?.oid!==tip)throw Error('Specification registry changed or update failed; recompute against the current registration');
  return commitSha.parse(commit.oid);
}

export async function initializeRegistryCI(enrollment:CIRegistration,digest:string,http:GitHubTransport){
  if(http.repository!==enrollment.deployment.repository)throw Error('Specification registry repository mismatch');
  if([enrollment.deployment.protectedBranch,enrollment.deployment.workflowBranch].includes(branch))throw Error('The specification registry branch must be dedicated');
  const tip=await registryTip(http);
  await requireRegistryWriteProtection(http);
  if(await readState(http,tip))throw Error('Specification registry is already initialized');
  return replaceState(http,tip,{schemaVersion:1,enrollmentDigest:digest,active:null});
}

export async function promoteRegistryCI(root:string,enrollment:CIRegistration,enrollmentDigest:string,
  options:GitHubOptions&{pr:number;check:number}) {
  const pr=positive.parse(options.pr),check=positive.parse(options.check);
  const http=new GitHubTransport(options),authority=new GitHubAuthority(options);
  if(http.repository!==enrollment.deployment.repository)throw Error('Specification registry repository mismatch');
  const snapshot=await loadRegistryCI(enrollment,enrollmentDigest,http,{verifyWriteProtection:true});
  const {tip,state,registration,digest}=snapshot;
  const {deployment,repositoryId}=registration;
  const pull=githubObject(await http.request(`${http.prefix}/pulls/${pr}`));
  if(pull.number!==pr||pull.state!=='closed'||pull.merged!==true||pull.base?.ref!==deployment.protectedBranch||
    pull.base.repo?.full_name!==deployment.repository||String(pull.base.repo?.id)!==repositoryId){
    throw Error('PR is not merged into the registered protected branch');
  }
  const head=commitSha.parse(pull.head?.sha),merged=commitSha.parse(pull.merge_commit_sha);
  if(state.active?.pr===pr&&state.active.check===check&&state.active.head===head&&state.active.merged===merged){
    return {status:'already-promoted' as const,tip,digest};
  }
  const [recorded,base,...otherParents]=(await git(root,['rev-list','--parents','-n','1',merged])).trim().split(' ');
  if(recorded!==merged||!commitSha.safeParse(base).success||otherParents.length>1||
    otherParents.length===1&&otherParents[0]!==head)throw Error('Merged commit does not match the reviewed PR');
  const baseSha=base!;
  const branchTip=commitSha.parse(githubObject(await http.request(`${http.prefix}/branches/${encodeURIComponent(deployment.protectedBranch)}`)).commit?.sha);
  await git(root,['merge-base','--is-ancestor',merged,branchTip]);
  await git(root,['merge-base','--is-ancestor',baseSha,head]);
  await requireCurrentRegistryBase(root,baseSha,head,snapshot);
  if((await git(root,['rev-parse',`${merged}^{tree}`])).trim()!==(await git(root,['rev-parse',`${head}^{tree}`])).trim()){
    throw Error('Merged sources differ from the sources accepted by the gate');
  }
  const row=githubObject(await http.request(`${http.prefix}/check-runs/${check}`));
  const external=registryGateReceipt({repository:deployment.repository,repositoryId,pr,headSha:head,baseSha,registrationDigest:digest});
  if(row.id!==check||row.app?.id!==deployment.appId||row.name!==deployment.checkName||row.head_sha!==head||
    row.status!=='completed'||row.conclusion!=='success'||row.external_id!==external||
    !Number.isFinite(Date.parse(row.completed_at))||!Number.isFinite(Date.parse(pull.merged_at))||
    Date.parse(row.completed_at)>Date.parse(pull.merged_at))throw Error('Missing accepted gate for the current registry and merged PR');
  if((await authority.protection(deployment.protectedBranch,[{context:deployment.checkName,appId:deployment.appId}])).status!=='pass'){
    throw Error('Issuer-bound branch protection cannot be verified');
  }
  const path=deployment.configPath;
  const bytes=(await git(root,['ls-tree',merged,'--',`:(literal)${path}`])).length?await readGitFile(root,merged,path):undefined;
  const config=bytes?parseConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))):registration.config;
  const {formal,exceptions,...governed}=config;
  const {formal:oldFormal,exceptions:oldExceptions,...oldGoverned}=registration.config;
  if(hash(governed)!==hash(oldGoverned))throw Error('Merged deployment policy differs from the enrolled policy');
  const specifications=await specificationsAt(root,config,path=>readGitFile(root,merged,path));
  if(hash({formal:formal??null,exceptions:exceptions??null,specifications})===
    hash({formal:oldFormal??null,exceptions:oldExceptions??null,specifications:registration.specifications})){
    return {status:'unchanged' as const,tip,digest};
  }
  const next:RegistryState={...state,active:{pr,check,head,base:baseSha,merged,previousDigest:digest,
    configDigest:bytes?hashBytes(bytes):null,specifications,...(formal?{formal}:{}),...(exceptions?{exceptions}:{})}};
  return {status:'promoted' as const,tip:await replaceState(http,tip,next),digest:hash(next)};
}
