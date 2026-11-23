// Trusted host. The producer and publisher derive the same expectation from
// the external registration and current immutable Git objects.
import {mkdir, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {
  canonicalJson, DEFAULT_FORMAL_BACKEND_VERSION, ExecutionManifestSchema, hash, hashBytes, parseConfig,
  safeRead, safeReadJson, validateManifest,
} from '@behavproof/core';
import {gitSubject, collect} from '@behavproof/adapter-reports';
import {readArtifactArchive} from '@behavproof/adapter-github';
import {formalEvidenceArtifact,formalEvidenceInventory,assuranceEvidenceArtifact,assuranceEvidenceInventory} from '../packages/cli/dist/api.js';

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
const tooling = {entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'};
const governed = ({formal:_formal,exceptions:_exceptions,...rest}) => rest;

async function write(root,path,content) {
  const dest = join(root,path);
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,content,{flag:'wx',mode:0o600});
}

export async function prepareQuality({root,inputs}, registration, pr) {
  const {deployment,policy,config,files} = registration;
  const registeredConfig=parseConfig(config);
  const active = new Set(inputs);
  if (!active.has('package.json') || !active.has(lockfile)) throw Error('The selected project must commit package.json and package-lock.json');
  const configured=active.has(deployment.configPath);
  const candidateConfig=configured?parseConfig(await safeReadJson(root,deployment.configPath)):registeredConfig;
  for (const [path,digest] of Object.entries(files)) {
    if(path===deployment.configPath&&configured&&equal(governed(candidateConfig),governed(registeredConfig)))continue;
    if (!active.has(path) || hashBytes(await safeRead(root,path)) !== digest) {
      throw Error(`Protected integration file changed: ${path}. Enroll a reviewed deployment update.`);
    }
  }
  for (const path of registration.requiredTests??[]) {
    if (!active.has(path)) throw Error(`Protected test source removed: ${path}. Enroll a reviewed deployment update.`);
  }
  if (configured && !Object.hasOwn(files,deployment.configPath) &&
      (!(candidateConfig.formal||candidateConfig.exceptions)||!equal(governed(candidateConfig),governed(registeredConfig)))) {
    throw Error('Protected project configuration was added without enrollment');
  }
  const formalModels=candidateConfig.formal?.models??[];
  for(const model of formalModels){
    if(model.quint.entry!==tooling.entry||model.quint.version!==tooling.version||
        (model.quint.apalacheVersion??DEFAULT_FORMAL_BACKEND_VERSION)!==DEFAULT_FORMAL_BACKEND_VERSION){
      throw Error('Protected formal models require the enrolled Quint and Apalache toolchain');
    }
  }
  formalEvidenceInventory(candidateConfig);
  const assuranceEnabled=!!candidateConfig.assurance?.definitions;
  if(assuranceEnabled){
    if(!configured||!equal(candidateConfig.assurance,registeredConfig.assurance)||!registration.assuranceSources){
      throw Error('Assurance verification criteria require independent enrollment');
    }
    assuranceEvidenceInventory(candidateConfig);
  }
  const formalEnabled=formalModels.length>0||(registeredConfig.formal?.models.length??0)>0;
  const runner=policy.runner;
  const locked=await safeReadJson(root,lockfile);
  const version=locked?.packages?.[`node_modules/${runner}`]?.version;
  const auxiliary = Object.entries({coverage:'coverage.lcov',mutation:'mutation.json'})
    .filter(([kind])=>config.reports?.[kind]!==undefined);
  for (const [kind] of auxiliary) {
    if (active.has(config.reports[kind])) throw Error('A protected report path must refer to freshly generated, untracked evidence');
  }
  if (runner==='vitest' ? version!=='5.1.0' : !['29.7.0','30.5.2'].includes(version)) throw Error('Unsupported runner version in package-lock.json');
  const subject=await gitSubject(root,inputs,pr.head.sha,pr.base.sha);
  if (subject.dirty || subject.testedCommitSha!==pr.head.sha) throw Error('Clean current PR head required');
  const rawConfig = parseConfig({
    ...candidateConfig,
    mode:'gate',
    git:{base:pr.base.sha},
    testRunner:runner,
    reports:{[runner]:`.behavproof/input/${runner}.json`,...Object.fromEntries(auxiliary.map(([kind])=>[kind,config.reports[kind]]))},
    executionManifests:[],
    rules:{...config.rules, testResult:{severity:'error'}, qualityConfiguration:{severity:'error'}, lintResult:{severity:'error'}, typecheckResult:{severity:'error'}},
  });
  const content=json(rawConfig);
  const configPaths=[...new Set([configRef,wrapperRef,'package.json',...Object.keys(files),
    ...(configured?[deployment.configPath]:[])])].sort();
  const configHashes=Object.fromEntries(await Promise.all(configPaths.map(async path=>[
    path,hashBytes(path===configRef?Buffer.from(content):path===wrapperRef?Buffer.from(wrapper):await safeRead(root,path)),
  ])));
  const dependencyLockHash=hashBytes(await safeRead(root,lockfile));
  function expectation(executionId, observedOptional = auxiliary.map(([,name])=>name)) {
    const artifacts=[
      ['quality.json','quality_observation'], ['native.json','test'], ['test-receipt.json','test_receipt'],
      ...auxiliary.filter(([,name])=>observedOptional.includes(name)).map(([kind,name])=>[name,kind]),
    ].map(([name, kind])=>({ref:`${outputRoot}/${executionId}/${name}`,kind,scope:[]}));
    if(formalEnabled)artifacts.push({ref:`${outputRoot}/${executionId}/${formalEvidenceArtifact}`,kind:'formal_bundle',
      scope:formalModels.map(model=>model.id).sort()});
    if(assuranceEnabled)artifacts.push({ref:`${outputRoot}/${executionId}/${assuranceEvidenceArtifact}`,kind:'assurance_bundle',
      scope:candidateConfig.assurance.definitions.map(row=>row.id).sort()});
    return {executionId,subject,commandHash:hash({command,args}),configHashes,dependencyLockHash,artifacts};
  }
  return {root,inputs,version,runner,policy,content,configPaths,rawConfig,auxiliary,expectation,formalEnabled,
    ...(assuranceEnabled?{assurance:{configRef:deployment.configPath,commit:subject.testedCommitSha}}:{})};
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
    dependencyLockPath:lockfile,timeoutMs:11*60*1000,stderr:'inherit'});
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
  const protectedConfig={...governed(publishedConfig),
    ...(registration.config.formal?{formal:registration.config.formal}:{}),
    ...(registration.config.exceptions?{exceptions:registration.config.exceptions}:{}),
  };
  const trust={
    schemaVersion:2, policy:{schemaVersion:1,profileVersion:'2',rules:plan.rawConfig.rules}, config:protectedConfig,
    sourceCommit:registration.sourceCommit,
    inputs:plan.inputs, configPaths:plan.configPaths, dependencyLockPath:lockfile,
    specifications:registration.specifications,
    ...(plan.formalEnabled?{formalEvidenceRef:reportOf('formal_bundle')}:{}),
    ...(plan.assurance?{assuranceEvidenceRef:reportOf('assurance_bundle'),assuranceConfigPath:plan.assurance.configRef,
      assuranceSources:registration.assuranceSources}:{}),
    ...((plan.formalEnabled||plan.rawConfig.exceptions||registration.config.exceptions)?{specificationConfigPath:deployment.configPath}:{}),
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
