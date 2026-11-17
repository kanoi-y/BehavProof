import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {collect} from '../../packages/adapter-reports/src/index.js';
import {hash,parseConfig} from '../../packages/core/src/index.js';
import {discoverSources,snapshot} from '../../packages/contract-registry/src/index.js';
const sdk=resolve('.'),binary=join(sdk,'packages/cli/dist/index.js');

it.each([['jest','30.5.2'],['jest29','29.7.0']])('requires authenticated selected runner authority for actual %s even with local rules off',async(alias,version)=>{
 const scratch=await mkdtemp(join(tmpdir(),'jest-authority-')),root=join(scratch,'project'),trustPath=join(scratch,'trust.json');
 await mkdir(root);
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Runner authority fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 try{
  await mkdir(join(root,'node_modules'));await symlink(join(sdk,'node_modules',alias),join(root,'node_modules/jest'),'dir');await symlink(join(sdk,'node_modules/@behavproof'),join(root,'node_modules/@behavproof'),'dir');
  await mkdir(join(root,'tests'));await mkdir(join(root,'.behavproof/collected'),{recursive:true});
  await writeFile(join(root,'.gitignore'),'node_modules\n.behavproof\n');
  const sdkVersion=JSON.parse(await readFile(join(sdk,'packages/contract-jest/package.json'),'utf8')).version;
  await writeFile(join(root,'package.json'),JSON.stringify({name:'jest-authority',type:'commonjs',scripts:{test:'jest'},devDependencies:{jest:version,'@behavproof/jest':sdkVersion}}));
  await writeFile(join(root,'jest.config.cjs'),"module.exports={testEnvironment:'node',testMatch:['**/tests/*.test.cjs'],watchman:false};");
  const source="const{defineContract,contractTest}=require('@behavproof/jest');const c=defineContract({id:'DOUBLE',intent:'double',risk:'basic',cases:[{id:'one',input:2,expected:4}]});contractTest.each(c,({input})=>input*(process.env.AUTHORITY_FAIL==='1'?3:2));";
  await writeFile(join(root,'tests/contracts.test.cjs'),source);
  const defaults=parseConfig({schemaVersion:1,profile:'basic'}),rules=Object.fromEntries(Object.keys(defaults.rules).map(id=>[id,{severity:'off'}]));
  const cfg=parseConfig({schemaVersion:1,testRunner:'jest',profile:'basic',git:{base:'HEAD'},reports:{jest:'.behavproof/input/jest.json'},contracts:{enabled:true,sources:[{type:'jest-inline',include:['tests/contracts.test.cjs']}]},rules});
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));
  await writeFile(join(root,'producer.mjs'),`import{spawnSync}from'node:child_process';import{readFile,writeFile}from'node:fs/promises';import{join}from'node:path';const option=JSON.parse(process.argv[2]??'{}');const result=spawnSync(process.execPath,[${JSON.stringify(binary)},'test','--runner','jest'],{encoding:'utf8',env:{...process.env,AUTHORITY_FAIL:option.fail?'1':'0'}});if(![0,1].includes(result.status))throw Error(result.stderr);for(const name of ['jest.json','contracts.json']){let bytes=await readFile('.behavproof/input/'+name);if(name==='contracts.json'&&option.marker){const report=JSON.parse(bytes);report.runner=option.marker;bytes=JSON.stringify(report);}await writeFile(join(process.env.BEHAVPROOF_OUTPUT_DIR,name),bytes);}`);
  git('init','-q','-b','main');git('add','.');git('commit','-qm','runner authority fixture');
  const head=git('rev-parse','HEAD'),inputs=git('ls-files','-z').split('\0').filter(Boolean),baseline=snapshot(discoverSources([{kind:'jest-inline',ref:'tests/contracts.test.cjs',content:source}]),head,['tests/contracts.test.cjs']),producer={tool:'runner-authority-fixture',version:'1',collectorVersion:sdkVersion};
  async function capture(id:string,option:{marker?:{kind:string;version:string};fail?:boolean}={},selectedInputs=inputs,only?:string){
   const command=process.execPath,args=['producer.mjs',JSON.stringify(option)],artifacts=[{ref:'jest.json',kind:'test',scope:['DOUBLE']},{ref:'contracts.json',kind:'contract_report',scope:['DOUBLE']}].filter(row=>!only||row.kind===only);
   const manifest=await collect({root,executionId:id,command,args,inputPaths:selectedInputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});expect(manifest.exitCode).toBe(0);
   const ref=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,ref),JSON.stringify(manifest));
   return {schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:cfg.rules},config:parseConfig({...cfg,reports:{jest:`.behavproof/collected/${id}/jest.json`}}),runner:{kind:'jest',version,manifestRef:ref},baseline,inputs:selectedInputs,configPaths:['behavproof.config.json'],manifests:[{ref,manifestHash:hash(manifest),expected:{executionId:id,subject:manifest.subject,commandHash:manifest.commandHash,configHashes:manifest.configHashes,artifacts:artifacts.map(row=>({...row,ref:`.behavproof/collected/${id}/${row.ref}`}))},authority:{kind:'local',producer,executionId:id,commandHash:manifest.commandHash}}]};
  }
  async function check(trust:unknown){await writeFile(trustPath,JSON.stringify(trust));const result=spawnSync(process.execPath,[binary,'check','--mode','gate','--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8',timeout:30000});expect(result.stderr).toBe('');return {exit:result.status,report:JSON.parse(result.stdout)};}
  async function blocked(label:string,trust:unknown,expectedNative='unknown'){
   const result=await check(trust);expect.soft(result.exit,label).toBe(1);
   expect.soft(result.report.evaluations.find((row:any)=>row.ruleId==='testRunnerProtection'),label).toMatchObject({severity:'error',status:expect.stringMatching(/unknown|fail/)});
   expect.soft(result.report.evaluations.find((row:any)=>row.ruleId==='testResult')?.status,label).toBe(expectedNative);
   expect.soft(result.report.assurance.cases_executed,label).not.toBe('pass');
  }
  const valid=await capture('valid');const accepted=await check(valid);expect(accepted.exit,JSON.stringify(accepted.report)).toBe(0);expect(accepted.report.assurance.cases_executed).toBe('pass');
  await blocked('missing protected runner',{...valid,runner:undefined});
  const nativeOnly=await capture('native-only',{},inputs,'test'),contractOnly=await capture('contract-only',{},inputs,'contract_report');
  await blocked('wrong selected invocation',{...valid,runner:{...valid.runner,manifestRef:contractOnly.runner.manifestRef},manifests:[...valid.manifests,...contractOnly.manifests]});
  const noPackage=await capture('package-omitted',{},inputs.filter(path=>path!=='package.json'));await blocked('package input omitted',noPackage);
  const wrongMarker=await capture('wrong-version',{marker:{kind:'jest',version:version==='29.7.0'?'30.5.2':'29.7.0'}});await blocked('wrong version marker',wrongMarker);await blocked('wrong version marker without runner',{...wrongMarker,runner:undefined});
  const unsupported=await capture('unsupported-version',{marker:{kind:'jest',version:'1.0.0'}});await blocked('unsupported protected Jest version',{...unsupported,runner:{...unsupported.runner,version:'1.0.0'}});
  await blocked('missing contract runner marker',nativeOnly);
  const failed=await capture('failed-native',{fail:true});await blocked('native failure without protected runner',{...failed,runner:undefined},'fail');
 }finally{await rm(scratch,{recursive:true,force:true});}
},90000);
