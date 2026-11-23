import{mkdtemp,mkdir,cp,symlink,readFile,writeFile,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';
import{collect,gitSubject}from'@behavproof/adapter-reports';import{hash,hashBytes,parseConfig,getProfilePolicy}from'@behavproof/core';
import{assuranceDefinitions}from'../packages/cli/dist/assurance-definitions.js';
import{assuranceCriterionPaths}from'../packages/cli/dist/assurance-inputs.js';
const project=fileURLToPath(new URL('..',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'behavproof-assurance-flow-')),root=join(scratch,'candidate'),host=join(scratch,'host'),binary=join(project,'packages/cli/dist/index.js');
const invoke=(command,args,cwd=root)=>execFileSync(command,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:8*1024*1024});
const git=(...args)=>invoke('git',['-c','user.name=Assurance fixture','-c','user.email=fixture@example.invalid',...args]).trim();
const cli=(...args)=>{try{return{exit:0,text:invoke(process.execPath,[binary,...args])};}catch(e){return{exit:e.status,text:e.stdout?.toString()??'',error:e.stderr?.toString()??''};}};
const commit=()=>{git('add','.');git('commit','-qm','assurance fixture inputs');};
try{
 await cp(join(project,'examples/assurance-refund'),root,{recursive:true});await mkdir(host,{mode:0o700});await mkdir(join(root,'.behavproof/collected'),{recursive:true});await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 const runner=`import{execFileSync}from'node:child_process';import{join}from'node:path';import{readFile,writeFile}from'node:fs/promises';const out=process.env.BEHAVPROOF_OUTPUT_DIR;execFileSync(process.execPath,[${JSON.stringify(binary)},'test'],{stdio:'pipe'});for(const name of ['vitest.json','vitest.json.receipt.json'])await writeFile(join(out,name),await readFile('.behavproof/input/'+name));execFileSync(process.execPath,[${JSON.stringify(binary)},'assurance','run'],{stdio:'pipe'});await writeFile(join(out,'assurance.json'),await readFile('.behavproof/assurance.json'));`;
 await writeFile(join(root,'runner.mjs'),runner);git('init','-q','-b','main');commit();
 const configRef='behavproof.config.json',cfg=parseConfig(JSON.parse(await readFile(join(root,configRef),'utf8'))),sourceCommit=git('rev-parse','HEAD');
 const inputs=git('ls-files','-z').split('\0').filter(Boolean),criteria=Object.fromEntries(await Promise.all(
   assuranceCriterionPaths(cfg.assurance,assuranceDefinitions(cfg.assurance,configRef),inputs).map(async path=>[path,hashBytes(await readFile(join(root,path)))])));
 const writeConfig=async edit=>{
  const changed=structuredClone(cfg);
  edit(changed.assurance.definitions[0].definition);
  await writeFile(join(root,configRef),JSON.stringify(changed));
  commit();
 };
 const producer={tool:'consumer-assurance-fixture',version:'1',collectorVersion:'0.1.0'},command=process.execPath,args=['runner.mjs'],commandHash=hash({command,args}),trustPath=join(host,'trust.json');
 const summarize=r=>({gateExit:r.exit,status:r.report.status,conditions:r.report.assuranceMap?.definitions.flatMap(c=>c.conditions).length??0,faults:r.report.assuranceMap?.definitions.flatMap(c=>c.conditions.flatMap(v=>v.faults)).length??0});
 async function execute(id){
  const head=git('rev-parse','HEAD'),artifacts=[{ref:'vitest.json',kind:'test',scope:[]},{ref:'vitest.json.receipt.json',kind:'test_receipt',scope:[]},{ref:'assurance.json',kind:'assurance_report',scope:['REFUND']}];
  const manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});
  if(manifest.exitCode!==0)throw Error(`Consumer producer failed: ${manifest.exitCode}`);
  const manifestRef=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,manifestRef),JSON.stringify(manifest));
  const expected={executionId:id,subject:await gitSubject(root,inputs,head,head),commandHash,configHashes:manifest.configHashes,artifacts:artifacts.map(a=>({...a,ref:`.behavproof/collected/${id}/${a.ref}`}))};
  const trust={schemaVersion:2,sourceCommit,specifications:[],runner:{kind:'vitest',version:'5.1.0',manifestRef},policy:getProfilePolicy('basic'),config:parseConfig({...cfg,reports:{vitest:`.behavproof/collected/${id}/vitest.json`}}),inputs,configPaths:['behavproof.config.json'],assuranceSources:criteria,manifests:[{ref:manifestRef,manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:id,commandHash}}]};
  await writeFile(trustPath,JSON.stringify(trust));return{manifest,manifestRef,trust,reportRef:`.behavproof/collected/${id}/assurance.json`};
 }
 const gate=()=>{const r=cli('check','--mode','gate','--trust-root',trustPath,'--format','json');if(!r.text)throw Error(r.error??'No gate report');return{...r,report:JSON.parse(r.text)};};
 const first=await execute('correct'),correct=gate();if(correct.exit!==0)throw Error('Correct gate did not pass: '+correct.text);
 const map=cli('assurance','map','--trust-root',trustPath,'--format','json');if(map.exit!==0)throw Error(map.error);const mapped=JSON.parse(map.text);
 const docs=cli('docs','generate','--trust-root',trustPath,'--output','.behavproof/generated/assurance.md');if(docs.exit!==0)throw Error(docs.error);const doc=await readFile(join(root,'.behavproof/generated/assurance.md'),'utf8');
 const jsonDoc=cli('docs','generate','--trust-root',trustPath,'--output','.behavproof/generated/assurance.json');if(jsonDoc.exit!==0)throw Error(jsonDoc.error);const documented=JSON.parse(await readFile(join(root,'.behavproof/generated/assurance.json'),'utf8'));
 const mapSummary={verifiedConditions:mapped.definitions.flatMap(c=>c.conditions).filter(c=>c.status==='pass').length,containsScopes:mapped.definitions.every(c=>c.checks.every(k=>k.scope&&k.limits.length)),documentsVerified:doc.includes('Repeating the refund action never refunds twice')&&documented.assurance?.definitions.flatMap(c=>c.conditions).filter(c=>c.status==='pass').length===6};
 const original=await readFile(join(root,first.reportRef),'utf8');
 async function reseal(selected,mutate){
  await writeFile(join(root,selected.reportRef),original);await mutate();
  const manifest=structuredClone(selected.manifest);manifest.artifacts.find(a=>a.ref===selected.reportRef).sha256=hashBytes(await readFile(join(root,selected.reportRef)));await writeFile(join(root,selected.manifestRef),JSON.stringify(manifest));
  const trust=structuredClone(selected.trust);trust.manifests[0].manifestHash=hash(manifest);await writeFile(trustPath,JSON.stringify(trust));return gate();
 }
 const duplicate=await reseal(first,async()=>{const b=JSON.parse(original);b.reports.push(structuredClone(b.reports[0]));await writeFile(join(root,first.reportRef),JSON.stringify(b));});
 await writeFile(join(root,first.reportRef),original);await writeFile(join(root,first.manifestRef),JSON.stringify(first.manifest));await writeFile(trustPath,JSON.stringify({...first.trust,assuranceSources:undefined}));const criteriaUnbound=gate();
 await rm(join(root,first.reportRef));await writeFile(trustPath,JSON.stringify(first.trust));const missing=gate();await writeFile(join(root,first.reportRef),original);
 const production=await readFile(join(root,'src/refund.mjs'),'utf8');await writeFile(join(root,'src/refund.mjs'),production+'\n// behavior-preserving refactor\n');commit();
 const ref=await execute('refactor'),refactor=gate();
 // A new outer manifest cannot revive the original source/commit observation.
 await writeFile(join(root,ref.reportRef),original);const remanifest=structuredClone(ref.manifest);remanifest.artifacts.find(a=>a.ref===ref.reportRef).sha256=hashBytes(Buffer.from(original));await writeFile(join(root,ref.manifestRef),JSON.stringify(remanifest));const retrust=structuredClone(ref.trust);retrust.manifests[0].manifestHash=hash(remanifest);await writeFile(trustPath,JSON.stringify(retrust));const stale=gate();
 const driver=await readFile(join(root,'driver.mjs'),'utf8');await writeFile(join(root,'driver.mjs'),driver+'\n// changed verifier semantics must be reviewed\n');commit();await execute('driver');const driverChanged=gate();
 await writeFile(join(root,'driver.mjs'),driver);
 await writeConfig(definition=>definition.conditions.pop());await execute('removed');const conditionRemoved=gate();
 await writeConfig(definition=>{
  const check=definition.checks.find(c=>c.id==='amount-property');
  check.runs=1;check.minValid=1;check.requiredClasses=['non-owner','zero'];
 });
 await execute('weakened');const scopeWeakened=gate();
 const evidence={schemaVersion:1,producer:'real Vitest + explicit assurance worker + Collector',authority:'Pinned independent local host; not live GitHub or new human approval evidence',correct:summarize(correct),refactor:summarize(refactor),missing:summarize(missing),stale:summarize(stale),driverChanged:summarize(driverChanged),conditionRemoved:summarize(conditionRemoved),scopeWeakened:summarize(scopeWeakened),duplicate:summarize(duplicate),criteriaUnbound:summarize(criteriaUnbound),map:mapSummary,limits:['Declared six condition methods, six fault variants and the local HTTP/file-store fixture only.','No universal/concurrent proof or external production protection is asserted.']};
 if(evidence.correct.gateExit!==0||evidence.refactor.gateExit!==0||['missing','stale','driverChanged','conditionRemoved','scopeWeakened','duplicate','criteriaUnbound'].some(k=>evidence[k].gateExit!==1)||mapSummary.verifiedConditions!==6||!mapSummary.documentsVerified)throw Error('Assurance acceptance failed: '+JSON.stringify(evidence));
 process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
}finally{await rm(scratch,{recursive:true,force:true});}
