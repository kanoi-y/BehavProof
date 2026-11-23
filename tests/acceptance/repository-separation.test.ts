import {Deployment,packageFiles} from '../../packages/cli/src/ci-plan.js';
import {test,expect} from 'vitest';import {readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const credentialPattern=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/;
const payloadFiles=async()=>{
 const tracked=execFileSync('git',['ls-files','templates','examples/enforcement-probe'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const fixture=['README.md','behavproof.config.json','package.json','src/status.ts','tests/status.test.ts'];
 return {tracked,fixture};
};
test('generic consumer payload contains only consumer workflows and a small verification fixture',async()=>{
 const {tracked,fixture}=await payloadFiles();
 expect(tracked).toContain('templates/audit.yml');
 for(const path of fixture)expect(tracked).toContain('examples/enforcement-probe/'+path);
 for(const path of tracked){
  expect(path.startsWith('templates/')||path.startsWith('examples/enforcement-probe/')).toBe(true);
  expect(path.includes('/packages/')||path.includes('validation/behavproof-m2')).toBe(false);
  const content=await readFile(path,'utf8');expect(content).not.toMatch(credentialPattern);
 }
 const deployment=Deployment.parse({repository:'acme/shop',protectedBranch:'main',workflowBranch:'automation',
  sdkSha:'a'.repeat(40),appId:23,checkName:'BehavProof protected gate',environment:'behavproof-publisher',
  producerPath:'.github/workflows/behavproof-producer.yml',publisherPath:'.github/workflows/behavproof-publisher.yml',
  policyPath:'.github/behavproof/quality-policy.json',configPath:'behavproof.config.json'});
 const workflows=packageFiles(deployment,{schemaVersion:1,id:'fixture',lint:{tool:'eslint',rules:['no-debugger']},
  types:'strict',runner:'vitest',sources:['src/**']}).filter(file=>file.path.startsWith('.github/workflows/'));
 expect(workflows.map(file=>file.path)).toEqual([deployment.producerPath,deployment.publisherPath]);
 for(const {content} of workflows){
  expect(content).toContain('repository: kanoi-y/BehavProof');
  expect(content).toContain("github.repository == 'acme/shop'");
  expect(content).not.toMatch(credentialPattern);
 }
});
test('untracked private files and dependency trees never enter the consumer fixture payload',async()=>{
 const {writeFile,mkdir}=await import('node:fs/promises'),{randomUUID}=await import('node:crypto');const id=randomUUID(),fixture='examples/enforcement-probe',privateFile=join(fixture,'.env.behavproof-'+id),modules=join(fixture,'node_modules'),dependency=join(modules,'private-fixture-'+id);let createdModules=false;
 try{try{await mkdir(modules);createdModules=true;}catch(error:any){if(error.code!=='EEXIST')throw error;}await mkdir(dependency);await writeFile(join(dependency,'index.js'),'controlled private fixture');await writeFile(privateFile,'CONTROLLED_PRIVATE_FIXTURE=value');
  const {tracked}=await payloadFiles();expect(JSON.stringify(tracked)).not.toContain('controlled private fixture');expect(JSON.stringify(tracked)).not.toContain('CONTROLLED_PRIVATE_FIXTURE');expect(tracked.some(path=>path.startsWith('examples/enforcement-probe/node_modules/')||path.includes('.env.behavproof-'))).toBe(false);
 }finally{await rm(privateFile,{force:true});await rm(dependency,{recursive:true,force:true});if(createdModules)await (await import('node:fs/promises')).rmdir(modules).catch(()=>{});}
});
