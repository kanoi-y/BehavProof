import {expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createRequire} from 'node:module';
import {hash} from '../../packages/core/src/index.js';
import {normalizeJest} from '../../packages/adapter-reports/src/reports.js';
const require=createRequire(import.meta.url), root=process.cwd(), sdk=join(root,'packages/contract-jest/dist');
function run(version:string, files:Record<string,string>, options:{band?:boolean;config?:Record<string,unknown>;canary?:boolean;esm?:boolean;conflictingCircus?:boolean}={}) {
  const dir=mkdtempSync(join(tmpdir(),'behavproof-jest-'));
  const projectRequire=createRequire(require.resolve(`${version}/package.json`));
  mkdirSync(join(dir,'node_modules'));
  const circusRequire=options.conflictingCircus?createRequire(require.resolve(`${version==='jest'?'jest29':'jest'}/package.json`)):projectRequire;
  symlinkSync(dirname(circusRequire.resolve('jest-circus/package.json')),join(dir,'node_modules/jest-circus'),'dir');
  symlinkSync(dirname(require.resolve(`${version}/package.json`)),join(dir,'node_modules/jest'),'dir');
  symlinkSync(join(root,'node_modules/@behavproof'),join(dir,'node_modules/@behavproof'),'dir');
  const report=join(dir,'report.json'),nativeReport=join(dir,'native.json');
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'commonjs'}));
  writeFileSync(join(dir,'jest.config.cjs'),`module.exports=${JSON.stringify({rootDir:dir,watchman:false,transform:{},testMatch:['**/*.test.cjs'],testRunner:join(sdk,'runner.cjs'),testEnvironment:projectRequire.resolve('jest-environment-node'),reporters:[join(sdk,'reporter.cjs')],...options.config})}`);
  for(const [name,text] of Object.entries(files))writeFileSync(join(dir,name),text);
  const result=spawnSync(process.execPath,[require.resolve(`${version}/bin/jest`),'--config',join(dir,'jest.config.cjs'),'--json','--outputFile',nativeReport,...(options.band===false?['--maxWorkers=2']:['--runInBand'])],{cwd:dir,encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:report,...(options.esm?{NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --experimental-vm-modules`}:{})},timeout:30000});
  let native:any;try{native=JSON.parse(readFileSync(nativeReport,'utf8'))}catch{}
  let data:any;try{data=JSON.parse(readFileSync(report,'utf8'));}catch{data=null;}
  let canary:any;
  if(options.canary){
    const again=spawnSync(process.execPath,[require.resolve(`${version}/bin/jest`),'--config',join(dir,'jest.config.cjs'),'--runInBand'],{cwd:dir,encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:report,BEHAVPROOF_JEST_CANARY:'1'},timeout:30000});
    canary={status:again.status,stderr:again.stderr,data:JSON.parse(readFileSync(report,'utf8'))};
  }
  let workerPids:number[]=[];try{workerPids=readFileSync(join(dir,'workers.log'),'utf8').trim().split('\n').map(Number)}catch{}
  let lifecycle='';try{lifecycle=readFileSync(join(dir,'lifecycle.log'),'utf8')}catch{}
  rmSync(dir,{recursive:true,force:true});
  return {...result,data,native,lifecycle,canary,workerPids};
}
const setup=`const {defineContract,contractTest}=require('@behavproof/jest');const {observeTargetCall}=require('@behavproof/jest/probe');`;
for(const version of ['jest29','jest']) for(const band of [true,false]) it(`${version} native receipts and actual comparisons (${band?'in band':'workers'})`,()=>{
  const workerLog=`require('node:fs').appendFileSync('workers.log',String(process.pid)+'\\n');`;
  const result=run(version,{'one.test.cjs':`${workerLog}${setup}
const c=defineContract({id:'parity',kind:'examples',intent:'addition',risk:'standard',cases:[{id:'one',input:1,expected:2}]});
const cb=({input})=>{observeTargetCall('src/add.cjs#add');return input+1};
describe('nested',()=>{contractTest.each(c,cb);test('ordinary',()=>expect(2).toBe(2));});
describe.skip('skipped',()=>contractTest.each(c,cb));test.todo('later');`, 'two.test.cjs':`${workerLog}test('other',()=>expect(1).toBe(1))`},{band});
  expect(result.status,result.stderr).toBe(0);
  expect(result.workerPids).toHaveLength(2);
  expect(result.workerPids.every(pid=>band?pid===result.pid:pid!==result.pid)).toBe(true);
  expect(result.data?.runner,result.stdout+'\n'+result.stderr).toEqual({kind:'jest',version:version==='jest'?'30.5.2':'29.7.0'});
  expect(result.data.inventory.complete).toBe(true);
  expect(result.data.inventory.testCount).toBe(5);
  expect(result.data.inventory.suiteCount).toBe(2);
  expect(new Set(result.data.inventory.testIds).size).toBe(5);
  expect(result.data.registrations).toHaveLength(2);
  expect(result.data.registrations.every((r:any)=>r.comparisonCount===0&&r.status==='unknown')).toBe(true);
  const rows=result.data.contracts;
  expect(rows.map((r:any)=>[r.status,r.comparisonCount,r.testState])).toEqual([['pass',1,'passed'],['unknown',0,'skipped']]);
  expect(rows[0].targetCalls).toEqual([{targetRef:'src/add.cjs#add',count:1}]);
  expect(rows[0].revisionHash).toBe(hash({id:'parity',kind:'examples',intent:'addition',risk:'standard',cases:[{id:'one',input:1,expected:2}]}));
  expect(rows[0].testId).toBe(result.data.registrations[0].testId);
},45000);
for(const version of ['jest29','jest']) {
  it(`${version} reconciles nested SDK inventory with native file suites at the report gate`,()=>{
    const result=run(version,{'nested.test.cjs':`${setup}describe('outer',()=>describe('inner',()=>contractTest.each(defineContract({id:'nested',intent:'nested',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),({input})=>input+1)));`});
    expect(result.status,result.stderr).toBe(0);
    expect(normalizeJest(result.native,result.data.inventory)).toEqual({payload:{total:1,passed:1,failed:0,skipped:0},status:'pass'});
    expect(result.data.inventory.suiteCount).toBe(result.native.numTotalTestSuites);
    expect(result.data.inventory.suiteCount).toBe(result.data.inventory.suiteIds.length);
    expect(result.data.inventory.suiteCount).toBe(result.data.inventory.files.length);
  });
  it(`${version} selects Circus from the installed Jest dependency tree despite a conflicting peer`,()=>{
    const result=run(version,{'version.test.cjs':`${setup}contractTest.each(defineContract({id:'version',intent:'version',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),()=>2);`},{conflictingCircus:true});
    expect(result.status,result.stderr).toBe(0);
    expect(result.data.runner).toEqual({kind:'jest',version:version==='jest'?'30.5.2':'29.7.0'});
    expect(result.data.inventory.complete).toBe(true);
  });
  it(`${version} distinguishes mismatch, callback errors, fake returns and native hook failure`,()=>{
    const result=run(version,{'cases.test.cjs':`${setup}
const c=id=>defineContract({id,intent:'compare',risk:'basic',cases:[{id:'one',input:1,expected:2}]});
contractTest.each(c('wrong'),()=>3);
contractTest.each(c('error'),()=>{observeTargetCall('error-target');throw Error('offline')});
contractTest.each(c('fake'),({expected})=>expected);
describe('afterEach failure',()=>{afterEach(()=>{throw Error('hook crash')});contractTest.each(c('hook'),()=>2)});
contractTest.each(c('async'),async({input})=>{await Promise.resolve();observeTargetCall('async-target');observeTargetCall('async-target');return input+1});`});
    expect(result.status,result.stderr).toBe(1);
    expect(result.data.inventory.complete).toBe(true);
    const rows=Object.fromEntries(result.data.contracts.map((r:any)=>[r.contractId,r]));
    expect(rows.wrong).toMatchObject({status:'fail',comparisonCount:1,testState:'failed'});
    expect(rows.error).toMatchObject({status:'unknown',comparisonCount:0,testState:'failed',targetCalls:[{targetRef:'error-target',count:1}]});
    expect(rows.fake).toMatchObject({status:'pass',comparisonCount:1,testState:'passed',targetCalls:[]});
    expect(rows.hook).toMatchObject({status:'pass',comparisonCount:1,testState:'failed'});
    expect(rows.async).toMatchObject({status:'pass',comparisonCount:1,testState:'passed',targetCalls:[{targetRef:'async-target',count:2}]});
  });
  it(`${version} preserves metadata, callback binding and captured contract/case snapshots`,()=>{
    const metadata={id:'meta',intent:'snapshot',risk:'critical',kind:'state_machine',formal:{modelId:'counter',modelHash:'a'.repeat(64),propertyIds:['increases']},assurance:{feature:{id:'increment',entrypoints:['increment']},conditions:[{id:'increases',kind:'postcondition',statement:'Increments once',checks:['one'],requiredFaults:[]}],checks:[{id:'one',method:'example',targetRef:'increment.cjs#run',cases:[{id:'one',input:{n:1},expected:{n:2}}]}]},cases:[{id:'one',input:{n:1},expected:{n:2}}]};
    const fn=`({input,expected})=>{input.n++;expected.n=999;return input}`;
    const result=run(version,{'meta.test.cjs':`${setup}const c=defineContract(${JSON.stringify(metadata)});contractTest.each(c,${fn});c.cases[0].expected.n=999;c.cases[0].input.n=999;c.id='changed';`});
    expect(result.status,result.stderr).toBe(0);
    expect(result.data.contracts[0]).toMatchObject({contractId:'meta',revisionHash:hash(metadata),bindingHash:hash({scope:'runtime-function-string-v1',function:fn}),status:'pass',comparisonCount:1});
  });
  it(`${version} keeps empty, collection error, teardown error and missing adapter inventories incomplete`,()=>{
    for(const code of ['',`throw Error('collection failure')`,`test('ok',()=>{});afterAll(()=>{throw Error('teardown')})`]){
      const result=run(version,{'bad.test.cjs':code});
      expect(result.status,result.stderr).toBe(1);
      expect(result.data?.inventory.complete,result.stderr).toBe(false);
    }
    const projectRequire=createRequire(require.resolve(`${version}/package.json`));
    const result=run(version,{'ordinary.test.cjs':`test('ordinary',()=>{})`},{config:{testRunner:projectRequire.resolve('jest-circus/runner')}});
    expect(result.status,result.stderr).toBe(0);
    expect(result.data.inventory.complete).toBe(false);
  });
  it(`${version} counts native file suites across repeated describe labels and preserves environment setup/teardown failure`,()=>{
    const repeated=run(version,{'repeated.test.cjs':`describe('same',()=>test('first',()=>{}));describe('same',()=>test('second',()=>{}));`});
    expect(repeated.status,repeated.stderr).toBe(0);
    expect(repeated.data.inventory).toMatchObject({complete:true,suiteCount:1,testCount:2});
    const projectRequire=createRequire(require.resolve(`${version}/package.json`));
    for(const stage of ['setup','teardown']){
      const result=run(version,{'bad-env.cjs':`const Base=require(${JSON.stringify(projectRequire.resolve('jest-environment-node'))}).TestEnvironment;module.exports=class extends Base{async ${stage}(){await super.${stage}();throw Error('environment failure')}}`,'environment.test.cjs':`test('environment',()=>{})`},{config:{testEnvironment:'./bad-env.cjs'}});
      expect(result.status,result.stderr).toBe(1);
      expect(result.data.inventory.complete).toBe(false);
    }
  });
  it(`${version} conservatively degrades duplicate names and retries`,()=>{
    const result=run(version,{'duplicate.test.cjs':`${setup}const c=defineContract({id:'dup',intent:'duplicate',risk:'basic',cases:[{id:'one',input:1,expected:2}]});contractTest.each(c,()=>2);contractTest.each(c,()=>2);`});
    expect(result.status,result.stderr).toBe(0);
    expect(result.data.inventory.complete).toBe(false);
    expect(new Set(result.data.inventory.testIds).size).toBe(2);
    expect(result.data.contracts.every((r:any)=>r.status==='unknown'&&r.comparisonCount===0)).toBe(true);
    const retry=run(version,{'retry.test.cjs':`${setup}jest.retryTimes(1);let n=0;const c=defineContract({id:'retry',intent:'retry',risk:'basic',cases:[{id:'one',input:1,expected:2}]});contractTest.each(c,()=>++n===1?3:2);`});
    expect(retry.status,retry.stderr).toBe(0);
    expect(retry.data.inventory.complete).toBe(false);
    expect(retry.data.contracts[0]).toMatchObject({status:'unknown',comparisonCount:0,targetCalls:[]});
  });
  it(`${version} shares probe state through native ESM and configured TypeScript transforms`,()=>{
    const esm=run(version,{'native.test.mjs':`import {defineContract,contractTest} from '@behavproof/jest';import {add} from './target.mjs';contractTest.each(defineContract({id:'esm',intent:'esm',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),({input})=>add(input));`,'target.mjs':`import {observeTargetCall} from '@behavproof/jest/probe';export function add(input){observeTargetCall('target.mjs#add');return input+1;}`},{esm:true,config:{testMatch:['**/*.test.mjs']}});
    expect(esm.status,esm.stderr).toBe(0);
    expect(esm.data.inventory.complete).toBe(true);
    expect(esm.data.contracts[0]).toMatchObject({status:'pass',comparisonCount:1,targetCalls:[{targetRef:'target.mjs#add',count:1}]});
    const transformed=run(version,{'typed.test.ts':`${setup}const {add}=require('./target.ts');contractTest.each(defineContract({id:'ts',intent:'ts',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),({input})=>add(input));`,'target.ts':`import {observeTargetCall} from '@behavproof/jest/probe';export function add(input:number):number{observeTargetCall('target.ts#add');return input+1;}`,'transform.cjs':`const ts=require(${JSON.stringify(require.resolve('typescript-parser'))});module.exports={process(source,file){return {code:ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText}}};`},{config:{testMatch:['**/*.test.ts'],transform:{'^.+\\.ts$':'<rootDir>/transform.cjs'}}});
    expect(transformed.status,transformed.stderr).toBe(0);
    expect(transformed.data.inventory.complete).toBe(true);
    expect(transformed.data.contracts[0]).toMatchObject({status:'pass',comparisonCount:1,targetCalls:[{targetRef:'target.ts#add',count:1}]});
  });
  it(`${version} keeps normal/canary identities stable and performs exactly one selected comparison`,()=>{
    const result=run(version,{'stable.test.cjs':`${setup}const {test,expect}=require('@jest/globals');let calls=0;const c=defineContract({id:'stable',intent:'stable',risk:'basic',cases:[{id:'zero',input:-0,expected:-0}]});contractTest.each(c,({input})=>{calls++;return process.env.BEHAVPROOF_JEST_CANARY?1:input});test('one callback',()=>expect(calls).toBe(1));test.skip('skipped ordinary',()=>{});`},{canary:true,config:{injectGlobals:false}});
    expect(result.status,result.stderr).toBe(0);
    expect(result.canary.status,result.canary.stderr).toBe(1);
    expect(result.data.inventory.complete).toBe(true);
    expect(result.canary.data.inventory.complete).toBe(true);
    expect(result.data.inventory.testIds).toEqual(result.canary.data.inventory.testIds);
    expect(result.data.registrations).toEqual(result.canary.data.registrations);
    expect(result.data.contracts[0]).toMatchObject({status:'pass',comparisonCount:1});
    expect(result.canary.data.contracts[0]).toMatchObject({status:'fail',comparisonCount:1});
  });
  it(`${version} preserves custom environment lifecycle, options, preset and per-file override`,()=>{
    const projectRequire=createRequire(require.resolve(`${version}/package.json`));
    const environment=(label:string)=>`const Base=require(${JSON.stringify(projectRequire.resolve('jest-environment-node'))}).TestEnvironment;const fs=require('node:fs');module.exports=class extends Base{constructor(c,x){super(c,x);this.label='${label}';this.token=c.projectConfig.testEnvironmentOptions.token;this.log=c.projectConfig.rootDir+'/lifecycle.log'}async setup(){await super.setup();this.global.marker=this.label+':'+this.token;fs.appendFileSync(this.log,this.label+':setup\\n')}handleTestEvent(event){if(!this.label)throw Error('lost this');fs.appendFileSync(this.log,this.label+':'+event.name+'\\n');return Promise.resolve()}async teardown(){fs.appendFileSync(this.log,this.label+':teardown\\n');await super.teardown()}}`;
    const result=run(version,{'configured-env.cjs':environment('configured'),'override-env.cjs':environment('override'),'preset.cjs':`module.exports={testEnvironment:'./configured-env.cjs',testEnvironmentOptions:{token:'option'}}`, 'a.test.cjs':`${setup}test('environment',()=>expect(global.marker).toBe('configured:option'));contractTest.each(defineContract({id:'a',intent:'a',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),()=>2)`, 'b.test.cjs':`/** @jest-environment ./override-env.cjs */\n${setup}test('override',()=>expect(global.marker).toBe('override:option'));contractTest.each(defineContract({id:'b',intent:'b',risk:'basic',cases:[{id:'one',input:1,expected:2}]}),()=>2)`},{band:false,config:{preset:'./preset.cjs',testEnvironment:undefined}});
    expect(result.status,result.stderr).toBe(0);
    expect(result.data.inventory.complete).toBe(true);
    for(const label of ['configured','override'])for(const event of ['setup','add_test','run_finish','teardown'])expect(result.lifecycle).toContain(`${label}:${event}\n`);
  });
}
it('publishes official CommonJS entrypoints with native require declarations',()=>{
  const code=`const fs=require('node:fs');const {createRequire}=require('node:module');const req=createRequire(process.cwd()+'/package.json');const pkg=JSON.parse(fs.readFileSync('packages/contract-jest/package.json','utf8'));process.stdout.write(JSON.stringify(Object.keys(pkg.exports).map(k=>req.resolve('@behavproof/jest'+(k==='.'?'':k.slice(1))))));`;
  const result=spawnSync(process.execPath,['--input-type=commonjs','-e',code],{encoding:'utf8',cwd:root});
  expect(result.status,result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).every((p:string)=>p.endsWith('.cjs'))).toBe(true);
  const typecheck=spawnSync(process.execPath,[join(dirname(require.resolve('typescript/package.json')),'bin/tsc'),'--project','tests/jest/tsconfig.json'],{encoding:'utf8',cwd:root});
  expect(typecheck.status,typecheck.stdout+'\n'+typecheck.stderr).toBe(0);
});
