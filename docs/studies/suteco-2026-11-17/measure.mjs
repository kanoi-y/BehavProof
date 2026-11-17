import {cp, mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {execFileSync, spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {hash, hashBytes, parseConfig, validateManifest, evaluateAssuranceConditions} from '@behavproof/core';
import {collect, gitSubject, detectProject} from '@behavproof/adapter-reports';
import {discoverSources, snapshot, buildAssuranceMap, renderAssuranceMap} from '@behavproof/contract-registry';
import {assuranceIdentity} from '../../../packages/cli/dist/assurance-inputs.js';
import {fileList} from '../../../packages/cli/dist/project.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const sdk = resolve(directory, '../../..');
const root = resolve(process.argv[2] ?? join(sdk, '.behavproof/studies/suteco'));
const node20 = resolve(process.argv[3] ?? '/Users/kanoi/.local/share/mise/installs/node/20.19.4/bin/node');
const repetitions = Number(process.argv[4] ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw Error('Expected 1–5 measured executions');
const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {cwd:root, encoding:'utf8'}).trim();
const pinned = '79bbcaab65539a1f5d080a98710e52bf06764283';
git('merge-base', '--is-ancestor', pinned, 'HEAD');
git('diff', '--exit-code', pinned, '--', 'src', 'app', 'datasets', 'drizzle', 'tests', 'package.json', 'pnpm-lock.yaml');
if (execFileSync(node20, ['--version'], {encoding:'utf8'}).trim() !== 'v20.19.4') throw Error('suteco baseline requires Node20.19.4');
const scenarios = [
  {id:'dataset-cross-municipality', file:'dataset', defect:'S1', statement:'A municipality dataset rejects foreign rules and preserves the foreign municipality rule.', expected:{schemaAccepted:false, importRejected:true, foreignRule:{municipalityId:'city-b', itemId:'city-b-item', categoryName:'city-b category', instructions:'city-b instructions'}}},
  {id:'dataset-valid', file:'dataset', statement:'A valid dataset imports the declared municipality, item and rule.', expected:{schemaAccepted:true, importRejected:false, counts:{municipalities:1, items:1, rules:1}, storedItemId:'valid-city-item'}},
  {id:'dataset-dangling-item', file:'dataset', statement:'An unknown item reference is rejected without changing existing state.', expected:{schemaAccepted:false, importRejected:true, unchanged:true}},
  {id:'startup-version-only', file:'startup-state', defect:'S2', statement:'A version-only bundled update reaches the database, selected state, persistence and settings display.', expected:{database:'2025-09-01', store:'2025-09-01', persistence:'2025-09-01', display:'2025-09-01'}},
  {id:'startup-content-change-control', file:'startup-state', statement:'Changed content and version refresh correctly through the original startup flow.', expected:{database:'2025-09-01', store:'2025-09-01', persistence:'2025-09-01', display:'2025-09-01'}},
  {id:'unsafe-official-link', file:'links', defect:'S3', statement:'A local-file reference URI is not handed to the native link opener.', expected:{openedUris:[]}},
  {id:'safe-official-link', file:'links', statement:'An HTTPS reference survives validation/storage and is handed to the recorded opener.', expected:{schemaAccepted:true, importAccepted:true, renderedOfficialUrl:true, openedUris:['https://example.invalid/suteco-study-only']}},
  {id:'municipality-event-turn-control', file:'startup-state', statement:'A later event-turn municipality selection remains selected after a synchronous SQLite load.', expected:{events:['load-A-resolved','select-B-in-later-event-turn'], selectedMunicipalityId:'probe-city-b'}},
];
await mkdir(join(root, 'validation'), {recursive:true});
await cp(join(directory, 'overlay/validation/target.mjs'), join(root, 'validation/target.mjs'));
await cp(join(directory, 'overlay/validation/driver.mjs'), join(root, 'validation/driver.mjs'));
for (const name of ['dataset', 'startup-state', 'links']) {
  await mkdir(join(root, 'validation/repros'), {recursive:true});
  await copyFile(join(directory, `overlay/validation/repros/${name}.spec.ts.fixture`), join(root, `validation/repros/${name}.spec.ts`));
}
await writeFile(join(root, 'validation/toolchain.json'), JSON.stringify({node20, scenarios:scenarios.map(s => ({id:s.id,file:`validation/repros/${s.file}.spec.ts`}))}, null, 2));
const original = git('ls-tree', '-r', '--name-only', '-z', pinned).split('\0').filter(Boolean);
const implementation = original.filter(p => /^(?:src|app|drizzle|datasets)\//.test(p));
const criteria = original.filter(p => /^(?:tests|__mocks__)\//.test(p) || ['jest.config.js','babel.config.js','tsconfig.json'].includes(p));
const declaration = {id:'SUTECO-STUDY', intent:'Measure selected original-code municipality, startup and reference-link conditions.', risk:'basic', cases:[{id:'study-inventory',input:null,expected:null}], assurance:{
  feature:{id:'suteco-municipality-study', entrypoints:['dataset import','application startup and settings','item detail reference link']},
  checks:scenarios.map(s => ({id:s.id,method:'example',targetRef:'validation/target.mjs#observe',cases:[{id:s.id,input:{id:s.id},expected:s.expected}]})),
  conditions:scenarios.map(s => ({id:s.id,kind:'postcondition',statement:s.statement,checks:[s.id],requiredFaults:[]})),
}};
await writeFile(join(root, 'validation/contracts.json'), JSON.stringify(declaration, null, 2));
const cfg = parseConfig({schemaVersion:1,profile:'basic',git:{base:'HEAD'},contracts:{enabled:true,sources:[{type:'manifest',include:['validation/contracts.json']}]},assurance:{
  driver:'validation/driver.mjs',driverSources:[...criteria,'validation/driver.mjs','validation/target.mjs','validation/toolchain.json',...['dataset','startup-state','links'].map(n=>`validation/repros/${n}.spec.ts`)],
  implementationSources:[...implementation,'validation/target.mjs'],report:'.behavproof/study-assurance.json',timeoutMs:120000,
}});
await writeFile(join(root, 'behavproof.config.json'), JSON.stringify(cfg, null, 2));
const binary = join(sdk,'packages/cli/dist/index.js');
const producerSource = `import{spawnSync}from'node:child_process';import{copyFile,writeFile}from'node:fs/promises';import{join}from'node:path';const r=spawnSync(process.execPath,[${JSON.stringify(binary)},'assurance','run'],{cwd:process.cwd(),encoding:'utf8',timeout:150000});if(r.error||![0,1].includes(r.status))throw Error(r.error??r.stderr);await copyFile('.behavproof/study-assurance.json',join(process.env.BEHAVPROOF_OUTPUT_DIR,'assurance.json'));await writeFile(join(process.env.BEHAVPROOF_OUTPUT_DIR,'collector-result.json'),JSON.stringify({assuranceExit:r.status,notice:'Collection completed; condition failures remain failures in the report.'}));`;
await writeFile(join(root,'validation/producer.mjs'),producerSource);
// A separate local study commit binds the added observation harness. Original
// application source remains byte-identical to pinned; nothing is pushed.
if (git('branch', '--show-current') !== 'codex/behavproof-study') git('switch', '-c', 'codex/behavproof-study');
git('add', '--', 'behavproof.config.json', 'validation');
if (git('diff', '--cached', '--name-only')) git('-c','user.name=BehavProof study','-c','user.email=study@example.invalid','commit','-qm','Add opt-in BehavProof study observations');
const studyCommit=git('rev-parse','HEAD');
const registry = snapshot(discoverSources([{kind:'manifest',ref:'validation/contracts.json',content:JSON.stringify(declaration)}]), studyCommit, ['validation/contracts.json']);
const identity = await assuranceIdentity(root,cfg.assurance,registry.contracts,await fileList(root),'behavproof.config.json');
const inputs = [...new Set([...identity.paths,'validation/producer.mjs'])].sort();
const approvedCriterionHashes = Object.fromEntries(await Promise.all(inputs.map(async p=>[p,hashBytes(await readFile(join(root,p)))])));
await mkdir(join(root,'.behavproof/collected'),{recursive:true});
const output = join(directory,'results'); await mkdir(output,{recursive:true});
const trials=[];
for(let index=0;index<repetitions;index++) {
  const id=`suteco-study-${Date.now()}-${index}`;
  const command=process.execPath,args=['validation/producer.mjs'];
  const producer={tool:'suteco-study-local-collector',version:'1',collectorVersion:'0.1.0'};
  const artifacts=[{ref:'assurance.json',kind:'assurance_report',scope:['SUTECO-STUDY']},{ref:'collector-result.json',kind:'diagnostic',scope:['SUTECO-STUDY']},...scenarios.flatMap(s=>['observation.json','jest.json','execution.log'].map(suffix=>({ref:`${s.id}.${suffix}`,kind:'diagnostic',scope:[s.id]})))];
  const started=performance.now();
  const manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],dependencyLockPath:'pnpm-lock.yaml',outputRoot:'.behavproof/collected',artifacts,producer,prHead:studyCommit,base:studyCommit,timeoutMs:180000});
  const durationSeconds=(performance.now()-started)/1000;
  if(manifest.exitCode!==0)throw Error('Collection infrastructure failed; this is not a measured product defect');
  for(const [path,digest] of Object.entries(approvedCriterionHashes))if(hashBytes(await readFile(join(root,path)))!==digest)throw Error('Approved study input changed during measurement');
  const bytes=Object.fromEntries(await Promise.all(manifest.artifacts.map(async a=>[a.ref,await readFile(join(root,a.ref))])));
  const expected={executionId:id,subject:await gitSubject(root,inputs,studyCommit,studyCommit),commandHash:hash({command,args}),configHashes:manifest.configHashes,dependencyLockHash:manifest.dependencyLockHash,artifacts:artifacts.map(a=>({...a,ref:`.behavproof/collected/${id}/${a.ref}`}))};
  const validation=validateManifest(manifest,expected,bytes,{kind:'local',producer,executionId:id,commandHash:expected.commandHash});
  for(const key of ['artifactIntegrity','producerTrust','subjectMatch','executionStatus'])if(validation[key]!=='pass')throw Error('Local host artifact validation failed: '+JSON.stringify(validation));
  const bundle=JSON.parse(bytes[`.behavproof/collected/${id}/assurance.json`].toString());
  const current=await assuranceIdentity(root,cfg.assurance,registry.contracts,await fileList(root),'behavproof.config.json');
  if(hash(current)!==hash(identity))throw Error('Report input identity is not current');
  const results=registry.contracts.map(contract=>({contractId:contract.id,revisionHash:contract.revisionHash,evidenceRefs:[`.behavproof/collected/${id}/assurance.json`],evaluation:evaluateAssuranceConditions(contract.assurance,bundle.reports,{contractId:contract.id,revisionHash:contract.revisionHash,subject:identity.subject,inputHashes:identity.inputHashes,implementationSources:cfg.assurance.implementationSources,checkHashes:Object.fromEntries(contract.assurance.checks.map(c=>[c.id,hash(c)])),authenticatedReportHashes:bundle.reports.map(r=>hash(r))})}));
  const map=buildAssuranceMap(registry.contracts,results,result=>results.includes(result));
  const statuses=map.contracts.flatMap(c=>c.conditions.map(condition=>({id:condition.conditionId,status:condition.status})));
  // Counts are derived from precise comparisons, never child exit codes or titles.
  const wanted=new Map(scenarios.map(s=>[s.id,s.defect?'fail':'pass']));
  if(statuses.length!==8||statuses.some(s=>wanted.get(s.id)!==s.status))throw Error('Measured result differs from independently reproduced scenario expectations: '+JSON.stringify(statuses));
  trials.push({durationSeconds,conditions:statuses,manifestValidation:validation,manifestHash:hash(manifest),reportHash:hash(bundle)});
  if(index===0) {
    const artifactIndex=[];
    for(const artifact of manifest.artifacts){
      const saved=artifact.ref.split('/').at(-1).replace(/\.log$/,'.txt');
      await copyFile(join(root,artifact.ref),join(output,saved));
      artifactIndex.push({sourceRef:artifact.ref,saved,sha256:artifact.sha256});
    }
    await writeFile(join(output,'artifact-index.json'),JSON.stringify(artifactIndex,null,2)+'\n');
    await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await writeFile(join(output,'assurance-map.json'),JSON.stringify(map,null,2)+'\n');
    const rendered=renderAssuranceMap(map);await writeFile(join(output,'assurance-map.md'),rendered.markdown);await writeFile(join(output,'assurance-map.html'),rendered.html);
  }
}
const durations=trials.map(t=>t.durationSeconds).sort((a,b)=>a-b);
const summary={schemaVersion:1,date:'2026-11-17',repository:'https://github.com/kanoi-y/suteco',sutecoCommit:pinned,localStudyCommit:studyCommit,sdkCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:sdk,encoding:'utf8'}).trim(),productionSourceUnchanged:true,nodeForSuteco:'v20.19.4',nodeForBehavProof:process.version,scenarios:scenarios.map(({id,statement,defect})=>({id,statement,...(defect?{confirmedDefect:defect}:{positiveControl:true})})),conditionCounts:{total:8,pass:5,fail:3,unknown:0},confirmedIndependentDefects:3,excludedObservation:'Same-event-turn municipality API race reproduced, but application reachability not established; excluded from defect count.',timing:{repetitions,seconds:trials.map(t=>t.durationSeconds),medianSeconds:durations[Math.floor(durations.length/2)]},trials,cliProjectDetection:await detectProject(root),authority:'Explicitly selected local host validates Collector bytes, current input hashes and reviewed condition expectations through public APIs. Not live external approval or production gate certification.',limits:['Hand-authored requirements and code-reading hypotheses; not autonomous discovery or whole-repository recall.','Actual original modules/SQL/React through suteco Jest native-test adapters; no physical device/camera/Gemini or actual URI opening.','Jest remains unsupported by the standard CLI project gate. This study uses explicit assurance execution and the public evaluator/map APIs, without relabeling Jest as Vitest.','No injected fault is counted as an existing bug. No fix or configuration was pushed to suteco.']};
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({conditionCounts:summary.conditionCounts,confirmedIndependentDefects:3,timing:summary.timing,cliProjectDetection:summary.cliProjectDetection},null,2));
