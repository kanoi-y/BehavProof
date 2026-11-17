import {mkdtemp,mkdir,readFile,writeFile,copyFile,symlink,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {collect,gitSubject} from '@behavproof/adapter-reports';
import {hash,hashBytes,parseConfig,getProfilePolicy} from '@behavproof/core';

// Existing Jest/native dependencies are supplied by the explicitly selected
// checkout. Nothing is downloaded, published or written to the source checkout.
const sdk=fileURLToPath(new URL('..',import.meta.url));
const source=resolve(process.argv[2]??join(sdk,'.behavproof/studies/suteco'));
const node20=resolve(process.argv[3]??'/Users/kanoi/.local/share/mise/installs/node/20.19.4/bin/node');
const pinned='79bbcaab65539a1f5d080a98710e52bf06764283';
const scratch=await mkdtemp(join(tmpdir(),'behavproof-jest-suteco-')),root=join(scratch,'candidate'),host=join(scratch,'host');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:16*1024*1024});
const git=(...args)=>run('git',['-c','user.name=BehavProof native Jest study','-c','user.email=study@example.invalid',...args]).trim();
const binary=join(sdk,'packages/cli/dist/index.js');
const sdkVersion=JSON.parse(await readFile(join(sdk,'package.json'),'utf8')).version;
try{
 if(run(node20,['--version'],sdk).trim()!=='v20.19.4')throw Error('Expected the suteco-pinned Node20.19.4 producer');
 await mkdir(host,{mode:0o700});
 run('git',['clone','--shared','--no-checkout',source,root],sdk);
 git('checkout','-q','-b','codex/jest-native-study',pinned);
 const originals=git('ls-files','-z').split('\0').filter(Boolean),originalHashes=Object.fromEntries(await Promise.all(originals.filter(p=>/^(src|app|datasets|drizzle|tests)\//.test(p)).map(async p=>[p,hashBytes(await readFile(join(root,p)))])));
 await symlink(join(source,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 await writeFile(join(root,'.gitignore'),(await readFile(join(root,'.gitignore'),'utf8'))+'\nnode_modules\n.behavproof/\n');
 await mkdir(join(root,'validation'),{recursive:true});await mkdir(join(root,'.behavproof/collected'),{recursive:true});
 const cfg=parseConfig({schemaVersion:1,testRunner:'jest',profile:'basic',git:{base:'HEAD'},reports:{jest:'.behavproof/input/jest.json'}});
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg,null,2));
 const producerSource=`
import{spawnSync}from'node:child_process';import{mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';
const out=process.env.BEHAVPROOF_OUTPUT_DIR,home=join(out,'.home');await mkdir(home,{mode:0o700});
const extra=JSON.parse(process.argv[2]??'[]');
const args=[join(process.cwd(),'node_modules/jest/bin/jest.js'),'--ci','--runInBand','--watchman=false','--json','--outputFile',join(out,'jest.json'),'--reporters','default','--reporters',${JSON.stringify(join(sdk,'packages/contract-jest/dist/reporter.cjs'))},'--testRunner',${JSON.stringify(join(sdk,'packages/contract-jest/dist/runner.cjs'))},...extra];
const env={CI:'1',PATH:process.env.PATH??'',HOME:home,USERPROFILE:home,BEHAVPROOF_REPORT:join(out,'contracts.json'),...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.TEMP?{TEMP:process.env.TEMP}:{}),...(process.env.TMP?{TMP:process.env.TMP}:{})};
const result=spawnSync(${JSON.stringify(node20)},args,{cwd:process.cwd(),env,encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024});
await writeFile(join(out,'native-output.txt'),result.stdout+result.stderr);await writeFile(join(out,'producer.json'),JSON.stringify({runner:'jest',node:'v20.19.4',testExit:result.status,notice:'A completed test failure remains fail in native JSON; collector completion is separate.'}));
if(result.error||![0,1].includes(result.status))throw Error(result.error??result.stderr);
`;
 await writeFile(join(root,'validation/producer.mjs'),producerSource);
 git('add','.');git('commit','-qm','Add standard Jest reporting for isolated suteco validation');
 const baseline={schemaVersion:1,commitSha:git('rev-parse','HEAD'),contracts:[],intents:[],extractorVersion:'1',discoveryDiagnostics:[],scope:[]};
 const executions=[];
 async function execute(id,extra=[]){
  const inputs=git('ls-files','-z').split('\0').filter(Boolean),head=git('rev-parse','HEAD'),command=process.execPath,args=['validation/producer.mjs',JSON.stringify(extra)],producer={tool:'suteco-standard-jest-controller',version:'1',collectorVersion:sdkVersion},artifacts=[{ref:'jest.json',kind:'test',scope:['suteco']},{ref:'contracts.json',kind:'contract_report',scope:['suteco']},{ref:'producer.json',kind:'diagnostic',scope:['suteco']},{ref:'native-output.txt',kind:'diagnostic',scope:['suteco']}];
  const started=performance.now(),manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],dependencyLockPath:'pnpm-lock.yaml',outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});
  const elapsedSeconds=(performance.now()-started)/1000;if(manifest.exitCode!==0)throw Error('Native producer did not complete');
  const ref=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,ref),JSON.stringify(manifest));
  const trust={schemaVersion:1,policy:getProfilePolicy('basic'),config:parseConfig({...cfg,reports:{jest:`.behavproof/collected/${id}/jest.json`}}),runner:{kind:'jest',version:'29.7.0',manifestRef:ref},baseline,inputs,configPaths:['behavproof.config.json'],dependencyLockPath:'pnpm-lock.yaml',manifests:[{ref,manifestHash:hash(manifest),expected:{executionId:id,subject:await gitSubject(root,inputs,head,head),commandHash:hash({command,args}),configHashes:manifest.configHashes,dependencyLockHash:manifest.dependencyLockHash,artifacts:artifacts.map(a=>({...a,ref:`.behavproof/collected/${id}/${a.ref}`}))},authority:{kind:'local',producer,executionId:id,commandHash:hash({command,args})}}]};
  const trustPath=join(host,id+'.json');await writeFile(trustPath,JSON.stringify(trust));
  const checked=spawnSync(process.execPath,[binary,'check','--mode','gate','--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024});
  if(!checked.stdout)throw Error(checked.stderr);const report=JSON.parse(checked.stdout),native=JSON.parse(await readFile(join(root,`.behavproof/collected/${id}/jest.json`),'utf8')),contracts=JSON.parse(await readFile(join(root,`.behavproof/collected/${id}/contracts.json`),'utf8'));
  const assertions=native.testResults.flatMap(file=>file.assertionResults);
  const row={id,...(id==='regressions'?{cases:assertions.map(a=>({name:a.title,status:a.status,failureMessages:a.failureMessages}))}:{}),producerExit:manifest.exitCode,gateExit:checked.status,status:report.status,testResult:report.evaluations.find(e=>e.ruleId==='testResult'),detection:report.detection,suiteCount:native.numTotalTestSuites,tests:{passed:native.numPassedTests,failed:native.numFailedTests,pending:native.numPendingTests,todo:native.numTodoTests},sdkRunner:contracts.runner,inventoryComplete:contracts.inventory.complete,elapsedSeconds,manifestHash:hash(manifest),nativeHash:hashBytes(await readFile(join(root,`.behavproof/collected/${id}/jest.json`))),provenance:report.provenance};
  executions.push(row);return row;
 }
 const original=await execute('baseline');
 if(original.gateExit!==0||original.testResult?.status!=='pass'||original.tests.passed!==181||!original.inventoryComplete)throw Error('Original suteco standard gate failed: '+JSON.stringify(original));
 await mkdir(join(root,'validation/repros'));
 for(const name of ['dataset','startup-state','links'])await copyFile(join(sdk,`docs/studies/suteco-2026-11-17/overlay/validation/repros/${name}.spec.ts.fixture`),join(root,`validation/repros/${name}.spec.ts`));
 git('add','validation/repros');git('commit','-qm','Add previously measured original-code regression scenarios');
 const regressions=await execute('regressions',['--testMatch','**/validation/repros/*.spec.ts','--runTestsByPath','validation/repros/dataset.spec.ts','validation/repros/startup-state.spec.ts','validation/repros/links.spec.ts','--testNamePattern','^(?!.*municipality-late-load:).*']);
 if(regressions.gateExit!==1||regressions.testResult?.status!=='fail'||regressions.tests.passed!==5||regressions.tests.failed!==3||!regressions.inventoryComplete)throw Error('Standard Jest did not retain measured regressions: '+JSON.stringify(regressions));
 const expectedFailures=['dataset-cross-municipality','startup-version-only','unsafe-official-link'];
 const failedNames=regressions.cases.filter(a=>a.status==='failed').map(a=>a.name.split(':')[0]).sort();
 if(JSON.stringify(failedNames)!==JSON.stringify(expectedFailures.sort()))throw Error('Unexpected regression failures: '+JSON.stringify(failedNames));
 for(const [p,digest] of Object.entries(originalHashes))if(hashBytes(await readFile(join(root,p)))!==digest)throw Error('Original product/test source changed: '+p);
 const evidence={schemaVersion:1,date:'2026-11-18',repository:'https://github.com/kanoi-y/suteco',sourceCommit:pinned,sdkSourceCommit:run('git',['rev-parse','HEAD'],sdk).trim(),sdkSourceDirty:Boolean(run('git',['status','--porcelain','--untracked-files=no'],sdk).trim()),sdkVersion,nodeForSDK:process.version,nodeForProducer:'v20.19.4',runner:'Jest29.7.0',integration:'Standard @behavproof/jest runner/reporter + native JSON + Collector + protected CLI gate; no case-by-case bridge',originalSourceChanged:false,executions,limits:['Local explicitly selected host authority, not new human approval or live merge protection.','Existing Expo/Jest native adapters with actual SQLite SQL; no physical device, camera, Gemini request or actual URL opening.','SDK host requires Node24. The existing native suteco producer is separately selected Node20.19.4.','Native ordinary tests verify test-result obligations; arbitrary production reach and complete domain requirements are not inferred.']};
 await writeFile(join(sdk,'docs/evidence/jest-suteco.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({baseline:{gate:original.status,passed:original.tests.passed,seconds:original.elapsedSeconds},regressions:{gate:regressions.status,passed:regressions.tests.passed,failed:regressions.tests.failed,seconds:regressions.elapsedSeconds}},null,2));
}finally{await rm(scratch,{recursive:true,force:true});}
