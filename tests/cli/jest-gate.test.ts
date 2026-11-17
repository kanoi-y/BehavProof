import{it,expect}from'vitest';
import{mkdtemp,mkdir,writeFile,readFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{execFileSync,spawnSync}from'node:child_process';
import{collect,gitSubject}from'../../packages/adapter-reports/src/index.js';
import{hash,parseConfig}from'../../packages/core/src/index.js';
import{discoverSources,snapshot}from'../../packages/contract-registry/src/index.js';
const sdk=resolve('.'),binary=join(sdk,'packages/cli/dist/index.js');
it.each([['jest','30.5.2'],['jest29','29.7.0']])('authenticates actual %s test/contract reports and blocks bad or missing evidence',async(alias,version)=>{
 const scratch=await mkdtemp(join(tmpdir(),'jest-gate-')),root=join(scratch,'project'),host=join(scratch,'host');
 await mkdir(root);await mkdir(host,{mode:0o700});
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Jest fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 const cli=(...args:string[])=>{const r=spawnSync(process.execPath,[binary,...args],{cwd:root,encoding:'utf8',timeout:30000});if(!r.stdout)throw Error(r.stderr);return{exit:r.status,report:JSON.parse(r.stdout)};};
 try{
  await mkdir(join(root,'node_modules'));await symlink(join(sdk,'node_modules',alias),join(root,'node_modules/jest'),process.platform==='win32'?'junction':'dir');await symlink(join(sdk,'node_modules/@behavproof'),join(root,'node_modules/@behavproof'),process.platform==='win32'?'junction':'dir');
  await mkdir(join(root,'tests'));await mkdir(join(root,'.behavproof/collected'),{recursive:true});
  await writeFile(join(root,'.gitignore'),'node_modules\n.behavproof\n');
  await writeFile(join(root,'package.json'),JSON.stringify({name:'jest-gate',type:'commonjs',engines:{node:'24.x'},devDependencies:{jest:version,'@behavproof/jest':'0.1.0'},scripts:{test:'jest'}}));
  await writeFile(join(root,'jest.config.cjs'),"module.exports={testEnvironment:'node',testMatch:['**/tests/*.test.cjs'],watchman:false};");
  await writeFile(join(root,'target.cjs'),'module.exports=input=>input*2;');
  const source="const{defineContract,contractTest}=require('@behavproof/jest');const double=require('../target.cjs');const c=defineContract({id:'DOUBLE',intent:'double numbers',risk:'basic',cases:[{id:'one',input:2,expected:4},{id:'zero',input:0,expected:0}]});describe('nested',()=>contractTest.each(c,({input})=>double(input)));";
  await writeFile(join(root,'tests/contracts.test.cjs'),source);
  const cfg=parseConfig({schemaVersion:1,testRunner:'jest',profile:'basic',git:{base:'HEAD'},reports:{jest:'.behavproof/input/jest.json'},contracts:{enabled:true,sources:[{type:'jest-inline',include:['tests/contracts.test.cjs']}]},rules:{contractExecution:{severity:'error'},intentApproval:{severity:'error'}}});
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));
  // Successful collection can capture a completed failing test run. Its native
  // assertion statuses remain failures; exit0 here means artifact capture only.
  await writeFile(join(root,'producer.mjs'),`import{spawnSync}from'node:child_process';import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';const r=spawnSync(process.execPath,[${JSON.stringify(binary)},'test','--runner','jest'],{encoding:'utf8'});if(![0,1].includes(r.status))throw Error(r.stderr);for(const name of ['jest.json','contracts.json'])await writeFile(join(process.env.BEHAVPROOF_OUTPUT_DIR,name),await readFile('.behavproof/input/'+name));`);
  git('init','-q','-b','main');git('add','.');git('commit','-qm','original Jest consumer');
  const baseline=snapshot(discoverSources([{kind:'jest-inline',ref:'tests/contracts.test.cjs',content:source}]),git('rev-parse','HEAD'),['tests/contracts.test.cjs']),inputs=git('ls-files','-z').split('\0').filter(Boolean),producer={tool:'jest-gate-fixture',version:'1',collectorVersion:'0.1.0'},command=process.execPath,args=['producer.mjs'],trustPath=join(host,'trust.json');
  async function capture(id:string,only?:string){
   const head=git('rev-parse','HEAD'),artifacts=[{ref:'jest.json',kind:'test',scope:['DOUBLE']},{ref:'contracts.json',kind:'contract_report',scope:['DOUBLE']}].filter(a=>!only||a.kind===only);
   const manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});expect(manifest.exitCode).toBe(0);
   const ref=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,ref),JSON.stringify(manifest));
   const trust={schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:cfg.rules},config:parseConfig({...cfg,reports:{jest:`.behavproof/collected/${id}/jest.json`}}),runner:{kind:'jest',version,manifestRef:ref},baseline,inputs,configPaths:['behavproof.config.json'],manifests:[{ref,manifestHash:hash(manifest),expected:{executionId:id,subject:await gitSubject(root,inputs,head,head),commandHash:hash({command,args}),configHashes:manifest.configHashes,artifacts:artifacts.map(a=>({...a,ref:`.behavproof/collected/${id}/${a.ref}`}))},authority:{kind:'local',producer,executionId:id,commandHash:hash({command,args})}}]};
   await writeFile(trustPath,JSON.stringify(trust));return trust;
  }
  await capture('normal');const correct=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');expect(correct.exit,JSON.stringify(correct.report)).toBe(0);expect(correct.report.evaluations.find((e:any)=>e.ruleId==='testResult')).toMatchObject({status:'pass',message:expect.stringMatching(/^Jest /)});expect(correct.report.assurance).toMatchObject({binding_verified:'pass',cases_executed:'pass'});
  const audit=cli('check','--mode','audit','--format','json');expect(audit.report.evaluations.find((e:any)=>e.ruleId==='testResult').status).toBe('unknown');
  // A real new run on changed implementation cannot retain its old success.
  await writeFile(join(root,'target.cjs'),'module.exports=input=>input*3;');git('add','.');git('commit','-qm','wrong result');await capture('broken');const broken=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');expect(broken.exit).toBe(1);expect(broken.report.evaluations.find((e:any)=>e.ruleId==='testResult').status).toBe('fail');
  await writeFile(join(root,'target.cjs'),'module.exports=input=>2*input;');git('add','.');git('commit','-qm','behavior preserving refactor');const trust=await capture('refactor');expect(cli('check','--mode','gate','--trust-root',trustPath,'--format','json').exit).toBe(0);
  const ref=trust.config.reports.jest!;const original=await readFile(join(root,ref));await writeFile(join(root,ref),JSON.stringify({...JSON.parse(original.toString()),success:false}));expect(cli('check','--mode','gate','--trust-root',trustPath,'--format','json').exit).toBe(1);await writeFile(join(root,ref),original);await rm(join(root,ref));expect(cli('check','--mode','gate','--trust-root',trustPath,'--format','json').exit).toBe(1);
  for(const selection of ['vitest',undefined]){
   await writeFile(join(root,'behavproof.config.json'),JSON.stringify({...cfg,testRunner:selection,rules:Object.fromEntries(Object.keys(cfg.rules).map(key=>[key,{severity:'off'}]))}));git('add','.');git('commit','-qm','candidate changes protected runner');await capture('selection-'+(selection??'removed'));
   const changed=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');expect(changed.exit).toBe(1);expect(changed.report.evaluations.find((e:any)=>e.ruleId==='testRunnerProtection')).toMatchObject({severity:'error',status:'fail'});
  }
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));git('add','.');git('commit','-qm','restore protected runner');
  const producerSource=await readFile(join(root,'producer.mjs'),'utf8');
  for(const marker of [{kind:'vitest',version},{kind:'jest',version:version==='29.7.0'?'30.5.2':'29.7.0'}]){
   await writeFile(join(root,'producer.mjs'),producerSource+`;const path=join(process.env.BEHAVPROOF_OUTPUT_DIR,'contracts.json');const report=JSON.parse(await readFile(path,'utf8'));report.runner=${JSON.stringify(marker)};await writeFile(path,JSON.stringify(report));`);git('add','.');git('commit','-qm','report incompatible runner marker');await capture('marker-'+marker.kind+'-'+marker.version);
   const mismatched=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');expect(mismatched.exit).toBe(1);expect(mismatched.report.evaluations.find((e:any)=>e.ruleId==='testResult').status).toBe('unknown');expect(mismatched.report.assurance.cases_executed).not.toBe('pass');
  }
  await writeFile(join(root,'producer.mjs'),producerSource);git('add','.');git('commit','-qm','restore producer');
  const nativeOnly=await capture('native-only','test'),separate=await capture('separate-contract','contract_report');await writeFile(trustPath,JSON.stringify({...nativeOnly,manifests:[...nativeOnly.manifests,...separate.manifests]}));
  const unrelated=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');expect(unrelated.exit).toBe(1);expect(unrelated.report.assurance.cases_executed).not.toBe('pass');
 }finally{await rm(scratch,{recursive:true,force:true});}
},90000);
