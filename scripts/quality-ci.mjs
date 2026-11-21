// This entry point is executed by workflow files from a registered branch.
// The publisher uses only Git object readers, authenticated archives and the SDK.
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {
  GitHubAuthority, GitHubCheckPublisher, GitHubTransport, prepareCheckPublication, prepareFailedCheck,
} from '@behavproof/adapter-github';
import {CheckReportSchema, hash, hashBytes, safeRead} from '@behavproof/core';
import {check, registeredCI} from '../packages/cli/dist/api.js';
import {protectedGit, materializeProject, sha} from './protected-checkout.mjs';
import {prepareQuality, captureQuality, restoreQuality} from './quality-ci-protocol.mjs';
import {validateStagedSdk} from './staged-sdk.mjs';

const {positionals}=parseArgs({strict:true,allowPositionals:true,options:{}});
const [action]=positionals;
if (positionals.length!==1 || !['produce','publish'].includes(action)) throw Error('Expected produce or publish');
const env=process.env, sdk=resolve(fileURLToPath(new URL('..', import.meta.url)));
const registrationDigest=env.BEHAVPROOF_REGISTRATION_DIGEST;
const registration=registeredCI(JSON.parse(env.BEHAVPROOF_REGISTRATION_JSON??''),registrationDigest);
const {deployment,repositoryId,workflowSha}=registration;
const workflowPath=action==='produce'?deployment.producerPath:deployment.publisherPath;
const workflowRef=`${deployment.repository}/${workflowPath}@refs/heads/${deployment.workflowBranch}`;
if (env.GITHUB_REPOSITORY!==deployment.repository || String(env.GITHUB_REPOSITORY_ID)!==repositoryId ||
    env.GITHUB_REF!==`refs/heads/${deployment.workflowBranch}` || env.GITHUB_EVENT_NAME!=='workflow_dispatch' ||
    env.GITHUB_WORKFLOW_REF!==workflowRef || env.BEHAVPROOF_WORKFLOW_SHA!==workflowSha ||
    env.BEHAVPROOF_CURRENT_WORKFLOW_SHA!==workflowSha || env.BEHAVPROOF_SDK_SHA!==deployment.sdkSha ||
    protectedGit(sdk,['rev-parse','HEAD']).trim()!==deployment.sdkSha) throw Error('Workflow source/SDK does not match the independent registration');
if (!env.GITHUB_TOKEN) throw Error('Protected host requires a GitHub token');
const options={repository:deployment.repository,token:env.GITHUB_TOKEN};
const http=new GitHubTransport(options), authority=new GitHubAuthority(options);
const number=value=>{
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw Error('Invalid GitHub identity');
  return Number(value);
};
const prNumber=number(env.BEHAVPROOF_PR), runId=number(env.GITHUB_RUN_ID), attempt=number(env.GITHUB_RUN_ATTEMPT);
const runPath=id=>`${http.prefix}/actions/runs/${id}`;
const commitPath=workflow=>`${deployment.repository}/${workflow}@${workflowSha}`;

async function currentPR() {
  const pr=await http.request(`${http.prefix}/pulls/${prNumber}`);
  if (pr.number!==prNumber || pr.state!=='open' || pr.base?.ref!==deployment.protectedBranch ||
      pr.base.repo?.full_name!==deployment.repository || String(pr.base.repo?.id)!==repositoryId) throw Error('PR does not target the registered protected branch');
  sha(pr.head.sha); sha(pr.base.sha);
  return pr;
}

async function candidate(dir, pr) {
  await mkdir(dir,{mode:0o700});
  protectedGit(dir,['init','-q','-b','candidate']);
  const origin=`https://github.com/${deployment.repository}.git`;
  // Pass this host-only credential as ephemeral Git configuration. It is neither
  // persisted in .git nor copied to the worker or sent to redirects.
  execFileSync('git',['-c','core.hooksPath='+join(dir,'.git','disabled-hooks'),
    '-c','http.followRedirects=false','fetch','--no-tags','--',origin,sha(pr.head.sha),sha(pr.base.sha)],{
    cwd:dir,timeout:120000,stdio:['ignore','ignore','pipe'],
    env:{PATH:env.PATH??'',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
      GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0:'AUTHORIZATION: basic '+Buffer.from('x-access-token:'+env.GITHUB_TOKEN).toString('base64')},
  });
  protectedGit(dir,['update-ref','refs/heads/candidate',pr.head.sha]);
  protectedGit(dir,['read-tree',pr.head.sha]);
  await writeFile(join(dir,'.git/info/exclude'),'.behavproof/\nnode_modules/\n');
  return materializeProject({root:dir,projectPath:'.',headSha:pr.head.sha});
}
const makeCI=(id, runAttempt, jobId)=>({repositoryId,workflowRef:commitPath(deployment.producerPath),
  runId:String(id),runAttempt,jobId:String(jobId),eventName:'workflow_dispatch'});
const artifactName=ci=>`behavproof-${ci.runId}-${ci.runAttempt}-${ci.jobId}`;
const execution=ci=>`quality-${ci.runId}-${ci.runAttempt}-${ci.jobId}`;

async function download(id) {
  const path=`${http.prefix}/actions/artifacts/${number(id)}/zip`;
  const signal=AbortSignal.timeout(30000);
  let response=await fetch('https://api.github.com'+path,{
    headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2022-11-28'},redirect:'manual',signal,
  });
  if (response.status===302) {
    const url=new URL(response.headers.get('location')??'');
    if (url.protocol!=='https:' || url.username || url.password || url.port ||
        !['.blob.core.windows.net','.actions.githubusercontent.com'].some(suffix=>url.hostname.endsWith(suffix))) throw Error('Unsupported artifact download host');
    await response.body?.cancel();
    response=await fetch(url,{redirect:'error',signal});
  }
  if (response.status!==200 || !response.body) throw Error('Producer archive unavailable');
  const reader=response.body.getReader(), chunks=[];
  let size=0;
  try {
    for (;;) {
      const row=await reader.read();
      if (row.done) break;
      if ((size+=row.value.byteLength)>10*1024*1024) throw Error('Producer archive exceeds download limit');
      chunks.push(row.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(()=>{});
  }
}
async function produce(pr, work) {
  const jobs=await http.pages(`${runPath(runId)}/attempts/${attempt}/jobs`,'jobs');
  const matches=jobs.filter(job=>job.name==='collect' && job.status==='in_progress' && Number(job.run_id)===runId && job.run_attempt===attempt);
  if (matches.length!==1 || env.GITHUB_JOB!=='collect') throw Error('Producer job identity unavailable');
  const ci=makeCI(runId,attempt,number(matches[0].id));
  const source=await candidate(join(work,'candidate'),pr), clean=join(work,'sources');
  for (const path of source.inputs) {
    const dest=join(clean,path);
    await mkdir(resolve(dest,'..'),{recursive:true});
    await writeFile(dest,await safeRead(source.root,path),{flag:'wx',mode:0o644});
  }
  const plan=await prepareQuality(source,registration,pr);
  const stagedSdk=join(work,'sdk'),requestPath=join(work,'request.json');
  execFileSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--built','--output',stagedSdk],{cwd:sdk,stdio:'inherit',timeout:120000,
    env:{PATH:env.PATH??'',GIT_OPTIONAL_LOCKS:'0'}});
  await validateStagedSdk(stagedSdk,{referenceRoot:sdk});
  // The sandbox launcher receives only paths to the clean snapshot, staged SDK
  // and pinned worker request. The core Collector hashes the actual wrapper.
  await writeFile(requestPath,JSON.stringify({policy:plan.policy,config:plan.rawConfig}),{flag:'wx',mode:0o600});
  env.BEHAVPROOF_QUALITY_SANDBOX_MODULE=new URL('./quality-ci-sandbox-entry.mjs',import.meta.url).href;
  env.BEHAVPROOF_QUALITY_REQUEST=JSON.stringify({sourceRoot:clean,stagedSdk,requestPath,executionId:execution(ci)});
  const artifact=await mkdtemp(join(tmpdir(),'behavproof-quality-artifact-'));
  try {
    await captureQuality(plan,execution(ci),ci,artifact);
    await writeFile(env.GITHUB_OUTPUT,`artifact_name=${artifactName(ci)}\nartifact_path=${artifact}\n`,{flag:'a'});
  } catch (error) {
    await rm(artifact,{force:true,recursive:true});
    throw error;
  }
}

async function publish(pr, work) {
  const identity={repository:deployment.repository, repositoryId,pr:prNumber,headSha:pr.head.sha,baseSha:pr.base.sha,
    protectedBranch:deployment.protectedBranch,appId:deployment.appId,checkName:deployment.checkName};
  let decision=prepareFailedCheck({...identity,failureRef:`https://github.com/${deployment.repository}/actions/runs/${runId}`});
  try {
    if (env.GITHUB_JOB!=='gate') throw Error('Publisher job identity mismatch');
    const producerRun=number(env.BEHAVPROOF_PRODUCER_RUN);
    const run=await http.request(runPath(producerRun)), runAttempt=number(run.run_attempt);
    const jobs=await http.pages(`${runPath(producerRun)}/attempts/${runAttempt}/jobs`,'jobs');
    const collect=jobs.filter(job=>job.name==='collect');
    if (collect.length!==1) throw Error('Producer job is missing or ambiguous');
    const ci=makeCI(producerRun,runAttempt,number(collect[0].id));
    const archives=await http.pages(`${runPath(producerRun)}/artifacts`,'artifacts');
    const matches=archives.filter(archive=>archive.name===artifactName(ci) && archive.expired===false);
    if (matches.length!==1) throw Error('Current producer archive unavailable');
    const archive=await download(matches[0].id);
    const github={repository:deployment.repository,pr:prNumber,workflowPath:deployment.producerPath,workflowSha,jobName:'collect',artifactName:artifactName(ci)};
    const observation=await authority.producer(ci,{...github,ci,artifactDigest:hashBytes(archive)});
    if (observation.status!=='pass') throw Error('Completed producer identity or archive digest cannot be verified');
    const source=await candidate(join(work,'candidate'),pr), plan=await prepareQuality(source,registration,pr);
    const trustPath=join(work,'root.json');
    const restored=await restoreQuality(plan,execution(ci),ci,archive,github,trustPath,registration);
    const result=await check(source.root,{config:restored.configRef,mode:'gate','trust-root':trustPath});
    const report=CheckReportSchema.parse(Object.fromEntries(Object.keys(CheckReportSchema.shape).map(key=>[key,result[key]])));
    for (const row of report.evaluations.filter(row=>row.status!=='pass' && row.severity!=='off')) {
      // Candidate messages may contain workflow command delimiters. JSON encoding
      // keeps the whole diagnostic on a single prefixed line.
      console.log('BehavProof finding '+JSON.stringify({rule:row.ruleId,status:row.status,message:row.message}));
    }
    const packet={schemaVersion:1,repositoryId,subject:restored.expected.subject,effectivePolicyHash:result.effectivePolicyHash,registrationDigest,ci,report,
      upstream:{jobs:{collect:'success'},artifacts:restored.artefacts}};
    const expected={...identity,subject:restored.expected.subject,effectivePolicyHash:result.effectivePolicyHash,registrationDigest,ci,
      requiredEvaluations:report.evaluations.map(({ruleId,scope,severity})=>({ruleId,scope,severity})),
      requiredJobs:['collect'],requiredArtifacts:restored.expected.artifacts.map(artifact=>artifact.ref)};
    const packetHash=hash(packet);
    decision=prepareCheckPublication(packet,expected,snapshot=>hash(snapshot)===packetHash);
  } catch (error) {
    console.log('BehavProof evidence unavailable '+JSON.stringify(String(error?.message??error)));
  }
  const result=await new GitHubCheckPublisher(options).publish(decision);
  console.log(JSON.stringify(result));
  if (result.conclusion!=='success') process.exitCode=1;
}

const work=await mkdtemp(join(tmpdir(),'behavproof-quality-control-'));
try {
  const pr=await currentPR();
  if (action==='produce') await produce(pr,work);
  else await publish(pr,work);
} finally {
  await rm(work,{recursive:true,force:true});
}
