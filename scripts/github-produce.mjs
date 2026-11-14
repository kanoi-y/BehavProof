// main-only trusted producer. Candidate execution occurs only inside Docker.
import {parseArgs} from 'node:util';import {mkdir,writeFile,symlink} from 'node:fs/promises';import {join} from 'node:path';

import {protectedState,assertSdkRevision,githubClient,currentPr,jobIdentity,candidateCheckout,PRODUCER} from './github-control.mjs';import {createSandboxRunner} from './protected-container.mjs';import {captureProtectedProbe} from './protected-protocol.mjs';
const {values}=parseArgs({strict:true,options:{pr:{type:'string'},'sandbox-sdk':{type:'string'},output:{type:'string'}}});
const prNumber=Number(values.pr),state=protectedState(),sdk=assertSdkRevision(),client=githubClient(),pr=await currentPr(client,prNumber);
const ci=await jobIdentity(client,PRODUCER,state.workflowSha),candidate='/tmp/behavproof-producer-candidate',control='/tmp/behavproof-producer-control';await mkdir(control,{mode:0o700});const source=await candidateCheckout(candidate,state.registration.source.projectPath,pr.head.sha,pr.base.sha),root=source.root;await symlink(join(sdk,'node_modules'),join(root,'node_modules'));
const run=await createSandboxRunner({sdk,stagedSdk:values['sandbox-sdk'],candidateRoot:candidate}),captured=await captureProtectedProbe({source,state,ci,pr,control,output:values.output,run});
await writeFile(process.env.GITHUB_OUTPUT,`artifact_name=behavproof-${ci.runId}-${ci.runAttempt}-${ci.jobId}\n`,{flag:'a'});if(captured.manifest.exitCode!==0)process.exitCode=1;
