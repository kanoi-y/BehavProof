import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from 'vitest';
import {check} from '../../packages/cli/src/check.js';
import {specificationsAt} from '../../packages/cli/src/formal-registry.js';
import {readGitFile} from '../../packages/cli/src/project.js';
import {gitSubject} from '../../packages/adapter-reports/src/index.js';
import {formalInputIdentity} from '../../packages/cli/src/formal.js';
import {localNativeAuthority} from '../fixtures/native-vitest.js';
import {hashBytes,parseConfig,specificationTransitionTarget} from '../../packages/core/src/index.js';

test('current proof and PR-head approval authorize the exact Quint change only',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'bp-merge-review-'));
 const root=join(scratch,'repo'),trustPath=join(scratch,'trust.json');
 await mkdir(root);
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture',
  '-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 const configPath='behavproof.config.json',modelPath='access.qnt';
 const config=parseConfig({schemaVersion:2,profile:'basic',reports:{vitest:'.behavproof/vitest.json'},formal:{models:[{
  id:'ACCESS',module:'Access',model:modelPath,invariants:['safe'],checks:['parse','typecheck','run'],
  quint:{entry:'quint.mjs',version:'0.33.1'},
  maxSteps:3,seed:'42',report:'.behavproof/model.json',
 }]}});
 const previous=globalThis.fetch;
 try{
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
  await writeFile(join(root,'.gitignore'),'.behavproof/\n');
  await writeFile(join(root,'package-lock.json'),'{}');
  await writeFile(join(root,'quint.mjs'),'export {};');
  await writeFile(join(root,configPath),JSON.stringify(config));
  await writeFile(join(root,modelPath),'module Access { val safe = false }');
  git('init','-qb','main');git('add','.');git('commit','-qm','protected base');
  const base=git('rev-parse','HEAD');
  const inventory=(commit:string)=>specificationsAt(root,config,path=>readGitFile(root,commit,path));
  const specifications=await inventory(base);
  await writeFile(join(root,modelPath),'module Access { val safe = 1 < 0 }');
  git('add','.');git('commit','-qm','reviewed change');
  const head=git('rev-parse','HEAD');
  const reviewed=await inventory(head);
  expect(reviewed[0]!.revisionHash).not.toBe(specifications[0]!.revisionHash);
  await writeFile(join(root,modelPath),'module Access { val safe = true }');
  git('add','.');
  const merge=git('commit-tree',git('write-tree'),'-p',base,'-p',head,'-m','synthetic weakening');
  git('checkout','-q','--detach',merge);
  const repository='acme/shop',target=specificationTransitionTarget({id:'ACCESS',
   previous:specifications[0]!.revisionHash,revision:reviewed[0]!.revisionHash,head,repository});
  const verifier=await import('../../packages/cli/src/formal-registry.js');
  const attempted:string[]=[];
  const original=await inventory(merge);
  const authorize=verifier.specificationReview({root,configPath,head,repository,async authorize(request){
   attempted.push(request.contentHash);
   return request.contentHash===target.contentHash?request:undefined;
  }});
  expect((await authorize('ACCESS',specifications[0]!.revisionHash,reviewed[0]!.revisionHash))?.approval).toEqual(target);
  expect(await authorize('ACCESS',specifications[0]!.revisionHash,original[0]!.revisionHash)).toBeUndefined();
  expect(attempted).toEqual([target.contentHash]);
  const inputs=['package.json','package-lock.json',configPath,modelPath,'quint.mjs'];
  const github={repository,pr:3,reviewers:['alice'],requiredChecks:[{context:'gate',appId:77}]};
  const trust={schemaVersion:2,sourceCommit:base,specifications,config,
   policy:{schemaVersion:1,profileVersion:'2',rules:{}},
   runner:{kind:'vitest',version:'5.1.0',manifestRef:'.behavproof/manifest.json'},
   inputs,configPaths:[],manifests:[],github,
  };
  await writeFile(trustPath,JSON.stringify(trust));
  globalThis.fetch=async()=>{throw Error('Unexpected authorization request for the merge-only change');};
  const report=await check(root,{mode:'audit',base,head,'trust-root':trustPath});
  expect(report.subject.testedCommitSha).toBe(merge);
  expect(report.evaluations).toContainEqual(expect.objectContaining({ruleId:'formalBinding',status:'fail'}));
  expect(report.authoritySnapshots.approvals).toEqual([]);

  git('checkout','-q','--detach',head);
  const model=config.formal!.models[0]!;
  const identity=(await formalInputIdentity(root,model)).model;
  const stage=(name:string,backend:string,method:string,extra={})=>({stage:name,status:'pass',complete:true,exitCode:0,
   toolVersion:model.quint.version,backend,method,properties:[],diagnostics:[],...extra});
  const bytes=Buffer.from(JSON.stringify({schemaVersion:1,modelId:model.id,identity,stages:[
   stage('parse','quint','parse'),stage('typecheck','quint','typecheck'),
   stage('run','typescript','simulation',{properties:model.invariants,maxSteps:model.maxSteps,maxSamples:model.maxSamples,seed:model.seed}),
  ]}));
  await mkdir(join(root,'.behavproof'));
  await writeFile(join(root,model.report),bytes);
  const subject=await gitSubject(root,inputs,head,base);
  const authority=await localNativeAuthority(root,subject,[{ref:model.report,kind:'formal_model',scope:[model.id],sha256:hashBytes(bytes)}]);
  await writeFile(trustPath,JSON.stringify({...trust,runner:authority.runner,manifests:authority.manifests}));
  const routes:Record<string,unknown>={
   '/repos/acme/shop/pulls/3':{number:3,state:'open',user:{login:'bob'},head:{sha:head},base:{sha:base,ref:'main',repo:{full_name:repository}}},
   '/repos/acme/shop/branches/main/protection':{required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true},
    required_status_checks:{checks:[{context:'gate',app_id:77}]}},
   '/repos/acme/shop/pulls/3/reviews':[{id:1,user:{type:'User',login:'alice'},state:'APPROVED',commit_id:head,submitted_at:'2026-11-13T00:00:00Z'}],
   '/repos/acme/shop/collaborators/alice/permission':{permission:'write'},
  };
  globalThis.fetch=async input=>{
   const value=routes[new URL(String(input)).pathname];
   return new Response(JSON.stringify(value??{}),{status:value===undefined?404:200});
  };
  const accepted=await check(root,{mode:'gate',base,head,'trust-root':trustPath});
  expect(accepted.status,JSON.stringify(accepted.evaluations.filter(row=>row.severity==='error'))).toBe('pass');
  expect(accepted.authoritySnapshots.approvals).toContainEqual(expect.objectContaining({target,observation:expect.objectContaining({status:'pass'})}));
 }finally{
  globalThis.fetch=previous;
  await rm(scratch,{recursive:true,force:true});
 }
},30000);
