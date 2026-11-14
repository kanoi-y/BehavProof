// Explicit host enrollment from an actual reviewed immutable GitHub revision.
// No repository mutation, review submission, merge or credential publication.
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {homedir} from 'node:os';import {fileURLToPath} from 'node:url';
import {hash,hashBytes,getProfilePolicy,parseConfig} from '@behavproof/core';
import {discover,snapshot} from '@behavproof/contract-registry';
import {GitHubAuthority} from '@behavproof/adapter-github';
import {createRegistration,persistRegistration,loadRegistration} from '../packages/cli/dist/api.js';
const root=fileURLToPath(new URL('..',import.meta.url)),repository='kanoi-y/pdd-ts',prNumber=7;
const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,stdio:['ignore','pipe','ignore']}));
const repo=api(`repos/${repository}`),pr=api(`repos/${repository}/pulls/${prNumber}`);
if(pr.state!=='open'||pr.head.ref!=='codex/behavproof-m2-validation'||pr.head.sha!=='5cb1133e45d3fe73974401d8c666ad1eab6fff78')throw Error('Enrollment requires the exact selected reviewed head');
const project='validation/behavproof-m2/examples/node-api',policyRef='validation/behavproof-m2/packages/core/src/profiles.ts',contractRef=`${project}/tests/orders.test.ts`,configRef=`${project}/behavproof.config.json`;
const refs=[policyRef,contractRef,configRef,`${project}/src/orders.ts`,`${project}/package.json`,'validation/behavproof-m2/package-lock.json'],files={},fileHashes={};
for(const ref of refs){const file=api(`repos/${repository}/contents/${ref}?ref=${pr.head.sha}`);const bytes=Buffer.from(file.content.replace(/\s/g,''),'base64');files[ref]=new TextDecoder('utf-8',{fatal:true}).decode(bytes);fileHashes[ref]=hashBytes(bytes);}
if(fileHashes[policyRef]!==hashBytes(await readFile(join(root,'packages/core/src/profiles.ts'))))throw Error('Installed profile source differs from the reviewed policy source');
const policy=getProfilePolicy('critical'),config=parseConfig(JSON.parse(files[configRef])),baseline=snapshot(discover({[contractRef]:files[contractRef]}),pr.head.sha,[contractRef]);baseline.repositoryId=String(repo.id);
const token=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore']}).trim(),provider=new GitHubAuthority({repository,token});
const targets=[{kind:'policy',id:'critical-v1',contentHash:hash(policy)},...baseline.intents.map(i=>({kind:'intent',id:i.id,contentHash:i.contentHash})),...baseline.contracts.map(c=>({kind:'contract',id:c.id,contentHash:c.revisionHash}))];
const expected={headSha:pr.head.sha,baseSha:pr.base.sha,reviewers:['kanoi-y'],requiredChecks:[{context:'PDD protected gate',appId:5653976},{context:'Build, proof and tests',appId:15368}]},approvals=[],verifiedApprovals=new Set();
for(const target of targets){const result=await provider.approval(prNumber,target,expected);if(result.status!=='pass'||!result.approval)throw Error(`External ${target.kind} approval unavailable: ${result.reasons.join('; ')}`);approvals.push(result.approval);verifiedApprovals.add(hash(result.approval));}
const data={schemaVersion:1,repository:{id:String(repo.id),fullName:repository},source:{commitSha:pr.head.sha,prNumber,projectPath:project,policyRef,fileHashes},policyId:'critical-v1',policy,config,baseline,inputs:[`${project}/src/**/*.ts`,`${project}/tests/**/*.ts`,`${project}/package.json`,configRef],configPaths:[configRef],claimScopes:baseline.contracts.map(c=>({contractId:c.id,caseIds:c.caseIds,targetRef:`${project}/src/orders.ts#readOrder`,method:'protected-case-observer-and-vitest-canary-v1'})),approvals};
const sourceDigest=hash({...data,approvals:[]}),verified=createRegistration(data,{verifySource:r=>hash({...r,approvals:[]})===sourceDigest,verifyApproval:a=>verifiedApprovals.has(hash(a))});
const host=join(homedir(),'.local/share/behavproof/registrations/kanoi-y-pdd-ts');await mkdir(host,{recursive:true,mode:0o700});const stored=await persistRegistration(root,host,verified);await loadRegistration(root,stored.path,stored.digest);
const evidence={schemaVersion:1,repository,sourceCommitSha:pr.head.sha,pr:prNumber,url:pr.html_url,registrationDigest:stored.digest,registrationFile:`registration-${stored.digest}.json`,storage:'Private host state outside the Git checkout',sourceFileHashes:fileHashes,policyHash:hash(policy),registryHash:hash(baseline),approvals,limits:['This enrolls a protected baseline; it does not assert a quality pass.','No CI producer or external required check is registered by this operation.','The observation/canary method is a required protocol selector; its evidence must still be collected and verified.','No main merge, branch-protection edit or npm publication.']};
await writeFile(join(root,'docs/evidence/registered-baseline.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({registrationDigest:stored.digest,path:stored.path,approvals:approvals.map(a=>({kind:a.target.kind,status:a.status,approvedBy:a.approvedBy}))}));
