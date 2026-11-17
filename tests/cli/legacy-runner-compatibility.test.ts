import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {collect} from '../../packages/adapter-reports/src/index.js';
import {hash,parseConfig} from '../../packages/core/src/index.js';
import {discoverSources,snapshot} from '../../packages/contract-registry/src/index.js';
const sdk=resolve('.'),binary=join(sdk,'packages/cli/dist/index.js');

it('keeps implicit legacy Vitest separate authenticated manifests and rejects ambiguous contract reports',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'legacy-runner-')),root=join(scratch,'project'),trustPath=join(scratch,'trust.json');await mkdir(root);
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Legacy compatibility fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 try{
  const fixture=join(sdk,'examples/enforcement-probe');for(const path of ['src','tests','package.json'])await cp(join(fixture,path),join(root,path),{recursive:true});
  await symlink(join(sdk,'node_modules'),join(root,'node_modules'),'dir');await mkdir(join(root,'.behavproof/collected'),{recursive:true});await writeFile(join(root,'.gitignore'),'node_modules\n.behavproof\n');
  const cfg=parseConfig({schemaVersion:1,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/input/vitest.json'},contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]},rules:{contractExecution:{severity:'error'},intentApproval:{severity:'error'}}});
  expect(cfg).not.toHaveProperty('testRunner');await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));
  await writeFile(join(root,'producer.mjs'),`import{spawnSync}from'node:child_process';import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';const result=spawnSync(process.execPath,[${JSON.stringify(binary)},'test'],{encoding:'utf8'});if(result.status!==0)throw Error(result.stdout+result.stderr);for(const name of ['vitest.json','contracts.json'])await writeFile(join(process.env.BEHAVPROOF_OUTPUT_DIR,name),await readFile('.behavproof/input/'+name));`);
  git('init','-q','-b','main');git('add','.');git('commit','-qm','unchanged legacy reference fixture');
  const head=git('rev-parse','HEAD'),inputs=git('ls-files','-z').split('\0').filter(Boolean),sourceRef='tests/status.test.ts',source=await readFile(join(root,sourceRef),'utf8'),baseline=snapshot(discoverSources([{kind:'vitest-inline',ref:sourceRef,content:source}]),head,[sourceRef]),producer={tool:'legacy-reference-fixture',version:'1',collectorVersion:'1'},command=process.execPath,args=['producer.mjs'];
  async function capture(id:string,kind:'test'|'contract_report'){
   const artifacts=[{ref:kind==='test'?'vitest.json':'contracts.json',kind,scope:['ENFORCEMENT-PROBE']}],manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});expect(manifest.exitCode).toBe(0);
   const ref=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,ref),JSON.stringify(manifest));return {ref,manifestHash:hash(manifest),expected:{executionId:id,subject:manifest.subject,commandHash:manifest.commandHash,configHashes:manifest.configHashes,artifacts:artifacts.map(row=>({...row,ref:`.behavproof/collected/${id}/${row.ref}`}))},authority:{kind:'local',producer,executionId:id,commandHash:manifest.commandHash}};
  }
  const native=await capture('native','test'),contract=await capture('contract','contract_report');
  const trust={schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:cfg.rules},config:parseConfig({...cfg,reports:{vitest:'.behavproof/collected/native/vitest.json'}}),baseline,inputs,configPaths:['behavproof.config.json'],manifests:[native,contract]};
  const cli=async(selected:unknown)=>{await writeFile(trustPath,JSON.stringify(selected));return spawnSync(process.execPath,[binary,'check','--mode','gate','--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8',timeout:30000});};
  const legacy=await cli(trust);expect.soft(legacy.status,legacy.stderr+legacy.stdout).toBe(0);const report=JSON.parse(legacy.stdout);expect.soft(report.evaluations.find((row:any)=>row.ruleId==='testResult')?.status).toBe('pass');expect.soft(report.assurance).toMatchObject({binding_verified:'pass',cases_executed:'pass'});expect.soft(report.evaluations.some((row:any)=>row.ruleId==='testRunnerProtection')).toBe(false);
  const explicitMissing=await cli({...trust,config:{...trust.config,testRunner:'vitest'}});expect.soft(explicitMissing.status,'explicit protected Vitest requires a pinned runner').toBe(1);expect.soft(JSON.parse(explicitMissing.stdout).evaluations.find((row:any)=>row.ruleId==='testRunnerProtection')).toMatchObject({severity:'error',status:expect.stringMatching(/unknown|fail/)});
  const explicitSeparate=await cli({...trust,runner:{kind:'vitest',version:'5.1.0',manifestRef:native.ref}});expect.soft(explicitSeparate.status,'explicit selected invocation cannot borrow a contract report').toBe(1);expect.soft(JSON.parse(explicitSeparate.stdout).assurance.cases_executed).not.toBe('pass');
  const duplicate=await capture('duplicate-contract','contract_report'),ambiguous=await cli({...trust,manifests:[native,contract,duplicate]});expect(ambiguous.status).toBe(2);expect(ambiguous.stderr).toContain('Multiple contract reports are ambiguous');
 }finally{await rm(scratch,{recursive:true,force:true});}
},60000);
