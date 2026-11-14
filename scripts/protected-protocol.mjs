// Protected host orchestration. These functions validate structure/bytes, not CI
// or human authority. The live verifier authenticates the archive before calling.
import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {z} from 'zod';
import {hash,hashBytes,safeRead,mergeProtectedPolicy,ManifestExpectedSchema,CiIdentitySchema,HashSchema,RelativePathSchema,ExecutionManifestSchema} from '@behavproof/core';import {gitSubject} from '@behavproof/adapter-reports';import {readArtifactArchive} from '@behavproof/adapter-github';
import {selectedProjectConfig,hostConfig,hostWrite,jsonBytes} from './github-control.mjs';
const configRef='.behavproof/host-config.json',producer={tool:'behavproof-probe-collector',version:'0.1.0',collectorVersion:'0.1.0'};
const execution=ci=>`run${ci.runId}-${ci.runAttempt}-${ci.jobId}`;
const artifactsFor=(project,id)=>[['vitest.json','test'],['contracts.json','contract_report'],['claims.json','claims'],['probe-diagnostics.json','diagnostic']].map(([name,kind])=>({ref:`.behavproof/collected/${id}/${name}`,kind,scope:project.baseline.contracts.map(c=>c.id)}));
const contextSchema=z.strictObject({schemaVersion:z.literal(1),pr:z.number().int().positive(),headSha:z.string(),baseSha:z.string(),registrationDigest:HashSchema,inputs:z.array(RelativePathSchema).min(1),configPaths:z.array(RelativePathSchema),expected:ManifestExpectedSchema,manifestHash:HashSchema,ci:CiIdentitySchema});
const equal=(a,b)=>hash(a)===hash(b);
function matchManifest(manifest,expected,ci){
 if(manifest.executionId!==expected.executionId||!equal(manifest.subject,expected.subject)||manifest.commandHash!==expected.commandHash||!equal(manifest.configHashes,expected.configHashes)||!equal(manifest.ci,ci)||!equal(manifest.producer,producer)||manifest.dependencyLockHash!==expected.dependencyLockHash)throw Error('Captured manifest differs from host selection');
 const selected=manifest.artifacts.map(({sha256,...row})=>row);
 if(manifest.exitCode===0?!equal(selected,expected.artifacts):manifest.artifacts.length!==0)throw Error('Captured artifact inventory differs from host selection');
}
export async function captureProtectedProbe({source,state,ci:inputCi,pr,control,output,run}){
 const ci=CiIdentitySchema.parse(inputCi),id=execution(ci),root=source.root,inputs=[...source.inputs],configPaths=[configRef];HashSchema.parse(state.digest);
 await mkdir(join(root,'.behavproof/collected'),{recursive:true});const config=hostConfig(state.project,pr.base.sha,id,await selectedProjectConfig(root,state.registration)),configBytes=jsonBytes(config);await hostWrite(root,configRef,configBytes);
 const subject=await gitSubject(root,inputs,pr.head.sha,pr.base.sha);if(subject.dirty)throw Error('Clean selected source required');
 const scope=state.project.claimScopes[0];if(!scope||state.project.claimScopes.length!==1)throw Error('Exactly one protected probe target required');
 const effective=mergeProtectedPolicy({schemaVersion:1,profileVersion:'1',rules:config.rules},state.project.policy),requestPath=join(control,'request.json'),request={schemaVersion:1,root,tests:[...new Set(state.project.baseline.contracts.map(c=>c.sourceRef))],contracts:state.project.baseline.contracts,targetRef:scope.targetRef,expectedSourceHash:hashBytes(await safeRead(root,scope.targetRef.split('#')[0])),subject,effectivePolicyHash:hash(effective),inputs};
 await writeFile(requestPath,jsonBytes(request),{flag:'wx',mode:0o600});const artifacts=artifactsFor(state.project,id),collect={root,executionId:id,inputPaths:inputs,configPaths,outputRoot:'.behavproof/collected',artifacts:artifacts.map(row=>({...row,ref:row.ref.split('/').at(-1)})),producer,ci,prHead:pr.head.sha,base:pr.base.sha,timeoutMs:360000};
 // run must return only after OS sandbox cleanup has completed. The callback is
 // host-selected; no request/candidate JSON can select it or grant authority.
 const captured=await run({requestPath,collect}),manifest=ExecutionManifestSchema.parse(captured.manifest),expected=ManifestExpectedSchema.parse({executionId:id,subject,commandHash:hash({command:captured.command,args:captured.args}),configHashes:{[configRef]:hashBytes(configBytes)},artifacts});matchManifest(manifest,expected,ci);
 const reports=[];for(const row of manifest.artifacts){const bytes=await safeRead(root,row.ref);if(hashBytes(bytes)!==row.sha256)throw Error('Captured report changed before sealing');reports.push({path:'reports/'+row.ref.split('/').at(-1),bytes});}
 const context=contextSchema.parse({schemaVersion:1,pr:pr.number,headSha:pr.head.sha,baseSha:pr.base.sha,registrationDigest:state.digest,inputs,configPaths,expected,manifestHash:hash(manifest),ci});
 await mkdir(output,{mode:0o700});await hostWrite(output,'manifest.json',jsonBytes(manifest));for(const row of reports)await hostWrite(output,row.path,row.bytes);await hostWrite(output,'context.json',jsonBytes(context));return {manifest,expected,context};
}
export async function restoreProtectedProbe({archive,archiveDigest,state,ci:inputCi,pr,source}){
 if(hashBytes(archive)!==HashSchema.parse(archiveDigest))throw Error('Archive digest mismatch');const ci=CiIdentitySchema.parse(inputCi),decoded=readArtifactArchive(archive);if(decoded.status!=='pass')throw Error('Unsafe producer archive');
 const read=name=>{const bytes=decoded.entries.get(name);if(!bytes)throw Error('Required archive entry missing');return bytes;},parse=name=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read(name))),context=contextSchema.parse(parse('context.json'));
 if(context.pr!==pr.number||context.headSha!==pr.head.sha||context.baseSha!==pr.base.sha||context.registrationDigest!==state.digest||!equal(context.ci,ci))throw Error('Producer context differs from current protected selection');
 const manifest=ExecutionManifestSchema.parse(parse('manifest.json'));if(hash(manifest)!==context.manifestHash||manifest.exitCode!==0)throw Error('Producer manifest mismatch or unsuccessful execution');
 const root=source.root,id=execution(ci),artifacts=artifactsFor(state.project,id),reports=artifacts.map(row=>({row,name:'reports/'+row.ref.split('/').at(-1),bytes:read('reports/'+row.ref.split('/').at(-1))}));
 const config=hostConfig(state.project,pr.base.sha,id,await selectedProjectConfig(root,state.registration)),configBytes=jsonBytes(config),subject=await gitSubject(root,source.inputs,pr.head.sha,pr.base.sha),expected=ManifestExpectedSchema.parse({executionId:id,subject,commandHash:context.expected.commandHash,configHashes:{[configRef]:hashBytes(configBytes)},artifacts});
 if(subject.dirty||!equal(source.inputs,context.inputs)||!equal(context.configPaths,[configRef])||!equal(expected,context.expected))throw Error('Protected inputs/configuration/obligations differ from producer execution');matchManifest(manifest,expected,ci);
 for(const report of reports)if(hashBytes(report.bytes)!==manifest.artifacts.find(row=>row.ref===report.row.ref)?.sha256)throw Error('Report bytes differ from captured manifest');
 const manifestRef=`.behavproof/collected/${id}/manifest.json`,archiveRef='.behavproof/producer.zip',archiveEntries={[manifestRef]:'manifest.json'};
 await hostWrite(root,configRef,configBytes);await hostWrite(root,manifestRef,read('manifest.json'));await hostWrite(root,archiveRef,archive);for(const report of reports){archiveEntries[report.row.ref]=report.name;await hostWrite(root,report.row.ref,report.bytes);}
 return {root,config,inputs:[...source.inputs],configPaths:[configRef],subject,expected,manifest,manifestRef,archiveRef,archiveEntries,artifactRefs:artifacts.map(row=>row.ref)};
}
