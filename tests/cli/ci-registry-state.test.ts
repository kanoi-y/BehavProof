import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {hash,parseConfig} from '../../packages/core/src/index.js';
import {GitHubTransport,registryGateReceipt,type Fetcher} from '../../packages/adapter-github/src/index.js';
import type {CIRegistration} from '../../packages/cli/src/ci-registration.js';
import {initializeRegistryCI,loadRegistryCI,promoteRegistryCI,requireCurrentRegistryBase,verifyRegistryCI} from '../../packages/cli/src/ci-registry-state.js';

it('advances only a merged, accepted tree and compares the registry tip on each atomic write',async()=>{
  const root=await mkdtemp(join(tmpdir(),'behavproof-registry-state-'));
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],
    {cwd:root,encoding:'utf8'}).trim();
  const configPath='behavproof.config.json';
  const config=parseConfig({schemaVersion:2});
  const candidate=parseConfig({schemaVersion:2,formal:{models:[{
    id:'orders',model:'orders.qnt',module:'orders',invariants:['safe'],checks:['parse','typecheck','run'],
    maxSteps:4,seed:'12',report:'.behavproof/model.json',
    quint:{entry:'node_modules/@informalsystems/quint/dist/src/cli.js',version:'0.33.1'},
  }]}});
  try {
    git('init','-qb','main');await writeFile(join(root,configPath),JSON.stringify(config));
    git('add','.');git('commit','-qm','initial enrollment');
    const base=git('rev-parse','HEAD');git('checkout','-qb','candidate');
    await writeFile(join(root,configPath),JSON.stringify(candidate));
    await writeFile(join(root,'orders.qnt'),'module orders { val safe = true }');
    git('add','.');git('commit','-qm','reviewed model');const head=git('rev-parse','HEAD');
    git('checkout','-q','main');git('-c','commit.gpgsign=false','merge','--no-ff','-qm','merge reviewed model','candidate');
    const merged=git('rev-parse','HEAD');
    const differentTree=git('rev-parse',`${base}^{tree}`);
    const differentMerge=git('-c','commit.gpgsign=false','commit-tree',differentTree,'-p',base,'-p',head,'-m','different merge');
    const enrollment={schemaVersion:2,sourceCommit:base,repositoryId:'42',config,files:{},specifications:[],deployment:{
      repository:'acme/shop',configPath,protectedBranch:'main',workflowBranch:'trusted',appId:77,checkName:'BehavProof protected gate',
    }} as unknown as CIRegistration;
    const digest=hash(enrollment),check=33,pr=17;
    let tip='a'.repeat(40),writeCount=0,forceConflict=false,isMerged=false,issuer=77,useRulesets=false,allowDeleteBypass=false;
    let reportedMerge=merged;
    const state=new Map<string,Buffer>();
    const external=registryGateReceipt({repository:'acme/shop',repositoryId:'42',pr,headSha:head,baseSha:base,registrationDigest:digest});
    const fetcher:Fetcher=async(url,options)=>{
      const path=new URL(url);
      switch(path.pathname){
        case '/repos/acme/shop/branches/behavproof-registry':
          return Response.json({name:'behavproof-registry',protected:true,commit:{sha:tip}});
        case '/repos/acme/shop/branches/behavproof-registry/protection':
          if(useRulesets)return Response.json({},{status:404});
          return Response.json({enforce_admins:{enabled:true},allow_deletions:{enabled:false},allow_force_pushes:{enabled:false},
            restrictions:{users:[{login:'trusted'}],teams:[],apps:[]}});
        case '/repos/acme/shop/rules/branches/behavproof-registry':
          return Response.json(['update','deletion','non_fast_forward'].map((type,index)=>({type,
            ruleset_source_type:'Repository',ruleset_source:'acme/shop',ruleset_id:index===0?71:72})));
        case '/repos/acme/shop/rulesets/71':
        case '/repos/acme/shop/rulesets/72':{
          const update=path.pathname.endsWith('/71');
          return Response.json({id:update?71:72,target:'branch',source_type:'Repository',source:'acme/shop',enforcement:'active',
            rules:(update?['update']:['deletion','non_fast_forward']).map(type=>({type})),
            bypass_actors:update||allowDeleteBypass?[{actor_id:123,actor_type:'Integration',bypass_mode:'always'}]:[]});
        }
        case '/repos/acme/shop/contents/registry.json':{
          const item=state.get(path.searchParams.get('ref')!);
          return item?Response.json({path:'registry.json',type:'file',encoding:'base64',size:item.length,content:item.toString('base64')}):
            Response.json({},{status:404});
        }
        case '/repos/acme/shop/branches/main':return Response.json({commit:{sha:reportedMerge}});
        case '/repos/acme/shop/pulls/17':return Response.json({number:pr,state:isMerged?'closed':'open',merged:isMerged,
          base:{ref:'main',repo:{id:42,full_name:'acme/shop'}},head:{sha:head},merge_commit_sha:reportedMerge,merged_at:'2026-11-23T02:02:03Z'});
        case '/repos/acme/shop/check-runs/33':return Response.json({id:check,name:'BehavProof protected gate',app:{id:issuer},
          head_sha:head,status:'completed',conclusion:'success',external_id:external,completed_at:'2026-11-23T02:02:02Z'});
        case '/repos/acme/shop/branches/main/protection':return Response.json({enforce_admins:{enabled:true},
          required_status_checks:{strict:true,checks:[{context:'BehavProof protected gate',app_id:77}]}});
        case '/graphql':{
          const request=JSON.parse(String(options?.body)).variables.input;
          expect(request.branch).toEqual({repositoryNameWithOwner:'acme/shop',branchName:'behavproof-registry'});
          if(forceConflict){
            state.set('f'.repeat(40),state.get(tip)!);tip='f'.repeat(40);forceConflict=false;
          }
          if(tip!==request.expectedHeadOid)return Response.json({errors:[{message:'HEAD changed'}]});
          const parent=tip;tip=String(++writeCount).repeat(40);
          const [file]=request.fileChanges.additions;expect(file.path).toBe('registry.json');
          state.set(tip,Buffer.from(file.contents,'base64'));
          return Response.json({data:{createCommitOnBranch:{commit:{oid:tip,parents:{nodes:[{oid:parent}]}}}}});
        }
        default:return Response.json({},{status:404});
      }
    };
    const options={repository:'acme/shop',fetcher,pr,check};
    const http=new GitHubTransport(options);
    await expect(loadRegistryCI(enrollment,digest,http)).rejects.toThrow(/enrollment/);
    await initializeRegistryCI(enrollment,digest,http);
    await expect(initializeRegistryCI(enrollment,digest,http)).rejects.toThrow(/already initialized/);
    await expect(promoteRegistryCI(root,enrollment,digest,options)).rejects.toThrow(/not merged/);
    isMerged=true;issuer=78;
    await expect(promoteRegistryCI(root,enrollment,digest,options)).rejects.toThrow(/accepted gate/);
    issuer=77;reportedMerge=differentMerge;
    await expect(promoteRegistryCI(root,enrollment,digest,options)).rejects.toThrow(/Merged sources differ/);
    reportedMerge=merged;
    issuer=77;forceConflict=true;
    await expect(promoteRegistryCI(root,enrollment,digest,options)).rejects.toThrow(/recompute/);
    expect((await loadRegistryCI(enrollment,digest,http)).registration.specifications).toEqual([]);
    expect(writeCount).toBe(1);
    useRulesets=true;allowDeleteBypass=true;
    await expect(verifyRegistryCI(enrollment,digest,http)).rejects.toThrow(/prohibit removal/);
    await expect(loadRegistryCI(enrollment,digest,http,{verifyWriteProtection:true})).rejects.toThrow(/prohibit removal/);
    allowDeleteBypass=false;
    const result=await promoteRegistryCI(root,enrollment,digest,options);
    const snapshot=await loadRegistryCI(enrollment,digest,http);
    expect(result).toMatchObject({status:'promoted',tip:snapshot.tip,digest:snapshot.digest});
    expect(snapshot.registration).toMatchObject({sourceCommit:merged,config:{formal:candidate.formal},
      specifications:[{id:'orders',revisionHash:expect.stringMatching(/^[a-f0-9]{64}$/)}]});
    expect(snapshot.state.active).toMatchObject({head,base,merged,previousDigest:digest});
    await expect(requireCurrentRegistryBase(root,merged,head,snapshot)).resolves.toBeUndefined();
    await writeFile(join(root,'orders.qnt'),'module orders { val safe = false }');
    git('add','.');git('commit','-qm','unpromoted model');
    await expect(requireCurrentRegistryBase(root,git('rev-parse','HEAD'),head,snapshot)).rejects.toThrow(/unpromoted/);
    await expect(promoteRegistryCI(root,enrollment,digest,options)).resolves.toMatchObject({status:'already-promoted'});
    await expect(promoteRegistryCI(root,enrollment,digest,{...options,check:34})).rejects.toThrow();
    expect(writeCount).toBe(2);
  }finally{await rm(root,{recursive:true,force:true});}
});
