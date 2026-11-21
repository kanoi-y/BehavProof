// Trusted host. The producer and publisher derive the same expectation from
// the external registration and current immutable Git objects.
import {mkdir, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {
  canonicalJson, ExecutionManifestSchema, hash, hashBytes, parseConfig,
  safeRead, safeReadJson, validateManifest,
} from '@behavproof/core';
import {gitSubject, collect} from '@behavproof/adapter-reports';
import {readArtifactArchive} from '@behavproof/adapter-github';

export const configRef = '.behavproof/host-quality-config.json';
const wrapperRef = '.behavproof/run-quality-ci.mjs';
const wrapper = 'await import(process.env.BEHAVPROOF_QUALITY_SANDBOX_MODULE);\n';
const outputRoot = '.behavproof/collected';
const lockfile = 'package-lock.json';
const command = 'node';
const args = [wrapperRef];
export const collectorProducer = {tool:'behavproof-quality-collector', version:'1', collectorVersion:'0.1.0'};
const json = value => canonicalJson(value) + '\n';
const equal = (a,b) => hash(a) === hash(b);

async function write(root,path,content) {
  const dest = join(root,path);
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,content,{flag:'wx',mode:0o600});
}

export async function prepareQuality({root,inputs}, registration, pr) {
  const {deployment,policy,config,files,baseline} = registration;
  const active = new Set(inputs);
  if (!active.has('package.json') || !active.has(lockfile)) throw Error('The selected project must commit package.json and package-lock.json');
  for (const [path,digest] of Object.entries(files)) {
    if (!active.has(path) || hashBytes(await safeRead(root,path)) !== digest) {
      throw Error(`Protected integration file changed: ${path}. Enroll a reviewed deployment update.`);
    }
  }
  for (const path of registration.requiredTests??[]) {
    if (!active.has(path)) throw Error(`Protected test source removed: ${path}. Enroll a reviewed deployment update.`);
  }
  if (active.has(deployment.configPath) && !Object.hasOwn(files,deployment.configPath)) {
    throw Error('Protected project configuration was added without enrollment');
  }
  const runner=policy.runner;
  const locked=await safeReadJson(root,lockfile);
  const version=locked?.packages?.[`node_modules/${runner}`]?.version;
  const auxiliary = Object.entries({coverage:'coverage.lcov',mutation:'mutation.json'})
    .filter(([kind])=>config.reports?.[kind]!==undefined);
  for (const [kind] of auxiliary) {
    if (active.has(config.reports[kind]) || !config.reports[kind].startsWith('.behavproof/') &&
        ['package.json','package-lock.json'].includes(config.reports[kind])) throw Error('A protected report path must refer to freshly generated, untracked evidence');
  }
  if (runner==='vitest' ? version!=='5.1.0' : !['29.7.0','30.5.2'].includes(version)) throw Error('Unsupported runner version in package-lock.json');
  const subject=await gitSubject(root,inputs,pr.head.sha,pr.base.sha);
  if (subject.dirty || subject.testedCommitSha!==pr.head.sha) throw Error('Clean current PR head required');
  const rawConfig = parseConfig({
    ...config,
    mode:'gate',
    git:{base:pr.base.sha},
    testRunner:runner,
    reports:{[runner]:`.behavproof/input/${runner}.json`,...Object.fromEntries(auxiliary.map(([kind])=>[kind,config.reports[kind]]))},
    executionManifests:[],
    rules:{...config.rules, testResult:{severity:'error'}, qualityConfiguration:{severity:'error'}, lintResult:{severity:'error'}, typecheckResult:{severity:'error'},
      ...(baseline.contracts.length?{contractExecution:{severity:'error'},intentApproval:{severity:'error'}}:{})},
  });
  const content=json(rawConfig);
  const configPaths=[configRef,wrapperRef,'package.json',...Object.keys(files)].sort();
  const configHashes=Object.fromEntries(await Promise.all(configPaths.map(async path=>[
    path,hashBytes(path===configRef?Buffer.from(content):path===wrapperRef?Buffer.from(wrapper):await safeRead(root,path)),
  ])));
  const dependencyLockHash=hashBytes(await safeRead(root,lockfile));
  const scope=baseline.contracts.map(entry=>entry.id).sort();
  function expectation(executionId, observedOptional = auxiliary.map(([,name])=>name)) {
    const artifacts=[
      ['quality.json','quality_observation'], ['native.json','test'], ['contracts.json','contract_report'],
      ...auxiliary.filter(([,name])=>observedOptional.includes(name)).map(([kind,name])=>[name,kind]),
    ].map(([name, kind])=>({ref:`${outputRoot}/${executionId}/${name}`,kind,scope}));
    return {executionId,subject,commandHash:hash({command,args}),configHashes,dependencyLockHash,artifacts};
  }
  return {root,inputs,version,runner,policy,content,configPaths,rawConfig,auxiliary,expectation};
}

export function checkQualityManifest(value,expected,ci,bytes) {
  const manifest=ExecutionManifestSchema.parse(value);
  const check=validateManifest(manifest,expected,bytes,ci ? {kind:'ci', producer:collectorProducer, ci}
    : {kind:'local', producer:collectorProducer, executionId:expected.executionId, commandHash:expected.commandHash});
  if (![check.artifactIntegrity, check.producerTrust, check.subjectMatch, check.executionStatus].every(status=>status==='pass')) {
    throw Error(`Producer evidence did not satisfy the host expectation: ${check.reasons.join(', ')}`);
  }
  return manifest;
}

export async function captureQuality(plan, executionId, ci, output) {
  const {root,inputs,configPaths,content}=plan;
  const all=plan.expectation(executionId);
  await write(root,configRef,content);
  await write(root,wrapperRef,wrapper);
  await mkdir(join(root,outputRoot),{recursive:true});
  const manifest=await collect({root,executionId,inputPaths:inputs,configPaths,outputRoot,command,args,
    artifacts:all.artifacts.map(row=>({...row,ref:row.ref.split('/').at(-1),optional:['coverage','mutation'].includes(row.kind)})),
    producer:collectorProducer,ci,prHead:all.subject.prHeadSha,base:all.subject.baseSha,
    dependencyLockPath:lockfile,timeoutMs:11*60*1000});
  const reports=Object.fromEntries(await Promise.all(manifest.artifacts.map(async row=>[row.ref,await safeRead(root,row.ref)])));
  const expected=plan.expectation(executionId,manifest.artifacts.map(row=>row.ref.split('/').at(-1)));
  checkQualityManifest(manifest,expected,ci,reports);
  for (const [ref,bytes] of Object.entries(reports)) await write(output,ref.split('/').at(-1),bytes);
  await write(output,'manifest.json',json(manifest));
  return manifest;
}

export async function restoreQuality(plan, executionId, ci, archive, github, trustPath, registration) {
  const root=plan.root;
  const {status,entries}=readArtifactArchive(archive);
  const manifestBytes=entries.get('manifest.json');
  const expected=plan.expectation(executionId,[...entries.keys()]);
  if (status!=='pass' || !manifestBytes || entries.size!==expected.artifacts.length+1) throw Error('Unexpected producer archive inventory');
  const entryNames=Object.fromEntries(expected.artifacts.map(row=>[row.ref,row.ref.split('/').at(-1)]));
  const bytes=Object.fromEntries(Object.entries(entryNames).map(([ref,name])=>[ref,entries.get(name)]));
  const manifest=checkQualityManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)),expected,ci,bytes);
  const manifestRef=`${outputRoot}/${executionId}/manifest.json`, archiveRef='.behavproof/producer.zip';
  for (const [ref,data] of Object.entries(bytes)) await write(root,ref,data);
  await write(root,manifestRef,manifestBytes);
  await write(root,configRef,plan.content);
  await write(root,wrapperRef,wrapper);
  if (ci) await write(root,archiveRef,archive);
  const authority=ci ? {kind:'ci',producer:collectorProducer,ci} : {kind:'local',producer:collectorProducer,executionId,commandHash:expected.commandHash};
  const reportOf=kind=>expected.artifacts.find(row=>row.kind===kind)?.ref;
  const publishedConfig={...plan.rawConfig,reports:{[plan.runner]:reportOf('test'),...Object.fromEntries(plan.auxiliary.flatMap(([kind])=>reportOf(kind)?[[kind,reportOf(kind)]]:[]))}};
  // The transferred native reports use host-owned paths instead of candidate paths.
  const publishedConfigRef='.behavproof/quality-gate-config.json';
  await write(root,publishedConfigRef,json(publishedConfig));
  const {deployment,reviewers}=registration;
  const trust={
    schemaVersion:1, policy:{schemaVersion:1,profileVersion:'1',rules:plan.rawConfig.rules}, config:publishedConfig,
    baseline:registration.baseline, inputs:plan.inputs, configPaths:plan.configPaths, dependencyLockPath:lockfile,
    quality:{policyHash:hash(plan.policy),reportRef:reportOf('quality_observation')},
    runner:{kind:plan.runner,version:plan.version,manifestRef}, manifests:[{
      ref:manifestRef,manifestHash:hash(manifest),expected,authority,
      ...(ci?{github:{...github,archivePath:archiveRef,archiveEntries:{...entryNames,[manifestRef]:'manifest.json'}}}:{}),
    }],
    ...(ci?{github:{repository:deployment.repository,pr:github.pr,reviewers,
      requiredChecks:[{context:deployment.checkName,appId:deployment.appId}]}}:{}),
  };
  // The CLI's manifest GitHub schema intentionally has no PR number.
  if(ci) delete trust.manifests[0].github.pr;
  await writeFile(trustPath,json(trust),{flag:'wx',mode:0o600});
  return {manifest,expected,configRef:publishedConfigRef,artefacts:Object.keys(bytes).sort()};
}
