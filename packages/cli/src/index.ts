#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, extname } from 'node:path';
import { parseConfig, canonicalJson, safeRead, safeReadJson } from '@behavproof/core';
import { detectProject, gitDiff } from '@behavproof/adapter-reports';
import { check } from './check.js';
import { diagnoseQuality, formatQuality } from './quality.js';
import { applyCI, planCI } from './ci-plan.js';
import { enrollCI, readCIRegistration } from './ci-registration.js';
import {executeAssurance} from './assurance-command.js';
import {formatReport} from './report.js';
import {executeExceptions} from './exceptions.js';
import {executeFormal} from './formal.js';
import {currentImpact} from './impact.js';
import {renderSpecificationDocuments} from './specification-documents.js';
import {planGitignore} from './gitignore.js';
import {runTests,declaredTestRunners} from './test-command.js';
import { config, exists, fileList, git, writeScoped, ref } from './project.js';
const help=`BehavProof 0.3.1\nCommands: init, test, doctor, check, explain <rule>, impact, docs generate|check, formal discover|check|replay|adequacy, exceptions discover|check, assurance discover|run|map, ci plan|apply|enroll|verify|init-registry|advance\ncheck reads artifacts; it never runs tests. Gate requires --trust-root outside project.\nci enroll with formal models requires --quint-tool-root outside project.\nOptions: --runner jest|vitest --config --base --head --profile --mode audit|gate --format console|json|markdown --output --trust-root --dry-run --check --quality --help --version\n`;
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:{config:{type:'string'},base:{type:'string'},head:{type:'string'},profile:{type:'string'},mode:{type:'string'},format:{type:'string'},output:{type:'string'},'trust-root':{type:'string'},'dry-run':{type:'boolean'},check:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'},root:{type:'string'},model:{type:'string'},runner:{type:'string'},quality:{type:'boolean'},repository:{type:'string'},branch:{type:'string'},'workflow-branch':{type:'string'},'workflow-sha':{type:'string'},'sdk-sha':{type:'string'},'app-id':{type:'string'},plan:{type:'string'},'quality-policy':{type:'string'},registration:{type:'string'},digest:{type:'string'},reviewers:{type:'string'},pr:{type:'string'},'check-id':{type:'string'},'quint-tool-root':{type:'string'}}});
 const root=resolve(values.root??process.cwd()),[command,sub,...rest]=positionals;
 if(values.version){process.stdout.write('0.3.1\n');return 0;}if(values.help||!command){process.stdout.write(help);return 0;}
 if(rest.length)throw Error('Unexpected command arguments');
 if(values.runner&&!['test','init','doctor','ci'].includes(command!))throw Error('--runner applies only to test, init and doctor');
 if(values.runner&&!['vitest','jest'].includes(values.runner))throw Error('Expected --runner jest|vitest');
 const emit=async(text:string)=>{if(values.output)await writeScoped(root,values.output,text);else process.stdout.write(text);};
 if(values.quality&&command!=='doctor')throw Error('--quality applies only to doctor');
 if(command==='ci'){
  const args={
    plan:['repository','branch','workflow-branch','sdk-sha','app-id','config','runner','quality-policy','output'],
    apply:['plan','dry-run'],
    enroll:['workflow-sha','reviewers','registration','pr','quint-tool-root'],
    verify:['registration','digest'],
    'init-registry':['registration','digest'],
    advance:['registration','digest','pr','check-id'],
  };
  if(!sub || !Object.hasOwn(args,sub))throw Error('Expected ci plan|apply|enroll|verify|init-registry|advance');
  if(Object.keys(values).some(key=>key!=='root'&&!args[sub as keyof typeof args].includes(key)))throw Error('Unexpected option for ci '+sub);
  if(sub==='plan'){
   await emit(canonicalJson(await planCI(root,values))+'\n');
   return 0;
  }
  if(sub==='apply'){
   if(!values.plan)throw Error('ci apply requires --plan');
   const result=await applyCI(root,values.plan,values['dry-run']??false);
   await emit(canonicalJson(result)+'\n');
   return result.exitCode;
  }
  if(!values.registration)throw Error('An external --registration is required');
  const token=process.env.GITHUB_TOKEN;
  if(sub==='enroll'){
   const result=await enrollCI(root,{pr:Number(values.pr),workflowSha:values['workflow-sha']??'',reviewers:values.reviewers?.split(',')??[],registration:values.registration,...(values['quint-tool-root']?{quintToolRoot:values['quint-tool-root']}:{}),...(token?{token}:{})});
   await emit(canonicalJson(result)+'\n');
   return 0;
  }
  if(!values.digest)throw Error('ci '+sub+' requires --digest pinned by the independent host');
  const r=await readCIRegistration(root,values.registration,values.digest);
  if(sub==='init-registry'||sub==='advance'){
   if(!token)throw Error('A protected host GitHub token is required');
   const {initializeRegistryCI,promoteRegistryCI}=await import('./ci-registry-state.js');
   const options={repository:r.deployment.repository,token};
   const {GitHubTransport}=await import('@behavproof/adapter-github');
   const result=sub==='init-registry'?
    {status:'initialized',tip:await initializeRegistryCI(r,values.digest,new GitHubTransport(options))}:
    await promoteRegistryCI(root,r,values.digest,{...options,pr:Number(values.pr),check:Number(values['check-id'])});
   await emit(canonicalJson(result)+'\n');
   return 0;
  }
  const {verifyDeployment}=await import('./ci-verify.js');
  const result=await verifyDeployment({...r.deployment,repositoryId:r.repositoryId,workflowSha:r.workflowSha,files:r.files,registrationDigest:values.digest,reviewers:r.reviewers},{root,enrollment:r,...(token?{token}:{})});
  await emit(canonicalJson(result)+'\n');
  return result.status==='pass'?0:1;
 }
 if(command==='test'){
  if(sub)throw Error('Unexpected test argument');
  if(Object.keys(values).some(key=>!['root','config','runner'].includes(key)))throw Error('test supports only --root, --config and --runner; it runs tests and does not enforce gate policy');
  return runTests(root,values.config,values.runner);
 }
 if(command==='init'){
  if(sub)throw Error('Unexpected init argument');
  const path=values.config??'behavproof.config.json';
  if(path.toLowerCase()==='.gitignore'||path.toLowerCase().startsWith('.gitignore/'))throw Error('Config path conflicts with managed .gitignore');
  const choices=await declaredTestRunners(root).catch(()=>[]),selected=values.runner??(choices.length===1?choices[0]:undefined);
  const found=await exists(root,path),detection=await detectProject(root,selected?{runner:selected as 'vitest'|'jest'}:undefined),ignore=await planGitignore(root);
  const proposal={schemaVersion:2,...(selected==='jest'?{testRunner:'jest'}:{}),mode:'audit',profile:'standard',git:{base:'origin/main'},reports:{...(selected==='jest'?{jest:'.behavproof/input/jest.json'}:{vitest:'.behavproof/input/vitest.json'}),coverage:'coverage/lcov.info',mutation:'reports/mutation/mutation.json'},executionManifests:[]};
  if(!values['dry-run']&&!found)await writeScoped(root,path,JSON.stringify(proposal,null,2)+'\n',true);
  if(!values['dry-run']&&ignore.action!=='preserve')await writeScoped(root,'.gitignore',ignore.content,ignore.action==='create');
  const ignoreAction=ignore.action==='preserve'?'preserve':values['dry-run']?ignore.action==='create'?'would-create':'would-update':ignore.action==='create'?'created':'updated';
  process.stdout.write(JSON.stringify({path,action:found?'preserve':values['dry-run']?'would-create':'created',gitignore:{path:'.gitignore',action:ignoreAction},detection,notice:'init manages config and .gitignore; it does not install packages or edit workflows.'},null,2)+'\n');return 0;
 }
 if(command==='doctor'){
  if(sub)throw Error('Unexpected doctor argument');
  const cfg=await config(root,values.config,values.profile);
  const {QualityPolicy}=await import('./quality.js');
  const qualityPolicy=values['quality-policy']?QualityPolicy.parse(await safeReadJson(root,values['quality-policy'])):undefined;
  const requested=values.runner??cfg.testRunner;
  if(requested&&qualityPolicy&&requested!==qualityPolicy.runner)throw Error('Runner does not match the selected quality policy');
  const selected=(requested??qualityPolicy?.runner) as 'vitest'|'jest'|undefined;
  const detection=await detectProject(root,selected?{runner:selected}:undefined);
  const quality=detection.evidence.includes('package.json')?await diagnoseQuality(root,{...(selected?{runner:selected}:{}),...(qualityPolicy?{policy:qualityPolicy}:{})}):undefined;
  const unavailable={schemaVersion:1,status:'incomplete',findings:[],notice:detection.reasons.join('; ')};
  const format=values.format??'json';
  await emit(format==='json'?JSON.stringify({node:process.version,...detection,quality:quality??unavailable,trust:'External producer and protection authority must be configured separately.'},null,2)+'\n':quality?formatQuality(quality,format):format==='console'||format==='markdown'?unavailable.notice+'\n':(()=>{throw Error('Unsupported doctor format');})());
  return detection.support==='single-package'&&(!values.quality||quality?.status==='pass')?0:1;
 }
 if(command==='explain'){
  const explanations:Record<string,string>={testResult:'Jest or Vitest assertions must complete; skipped/zero tests or unverified producers remain unknown.',changedLineCoverage:'Changed-line coverage requires current authenticated LCOV, complete executable-line scope and source mapping. Missing data is unknown; collect coverage in the verified execution.',mutationScore:'Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage). Missing mapping or insufficient comparable mutants is unknown.',pipelineIntegrity:'A final always() gate checks all upstream results and artifacts. External issuer-bound branch protection requires independent verification; unavailable authority is unknown.',policyProtection:'Protected policy is supplied through a trusted external host and cannot be weakened by project configuration.'};
  Object.assign(explanations,{changeImpact:'Analyze Git changes and the static dependency graph; unresolved critical impact blocks, standard warns. This does not prove behavioral equivalence.'});
  Object.assign(explanations,{assuranceCondition:'Each adopted condition requires current authenticated method-specific observations and every declared relevant fault. Missing evidence remains unknown.',assuranceCriterionBinding:'Protected source hashes bind generators, predicates, models, drivers, adapters and fault variants. Fresh reports cannot approve changed verifier semantics.',assuranceBinding:'Condition meaning is independently approved through the host-pinned Assurance definitions.',assuranceConfiguration:'Protected driver/source/report selections cannot be replaced by candidate settings.',assuranceDeclarationProtection:'Baseline obligations and newly declared head conditions remain visible until exact transition approval.',assuranceSensitivityRequirements:'Critical condition checks each require a relevant declared fault and an observed same-input failing comparison.'});
  const key=(sub??'').replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase());if(!explanations[key])throw Error('Unknown rule');await emit(explanations[key]+'\n');return 0;
 }
 if(command==='assurance'){const result=await executeAssurance(root,sub??'',values);await emit(result.text);return result.exitCode;}
 if(command==='exceptions'){const result=await executeExceptions(root,sub??'',values.config);await emit(canonicalJson(result.report)+'\n');return result.exitCode;}
 if(command==='formal'){const result=await executeFormal(root,sub??'',values);await emit(canonicalJson(result.report)+'\n');return result.exitCode;}
 if(command==='check'){
  if(sub)throw Error('Unexpected check argument');const options=Object.fromEntries(Object.entries(values).filter(([key,value])=>typeof value==='string'&&['config','profile','mode','base','head','trust-root'].includes(key)));
  const report=await check(root,options);await emit(formatReport(report,values.format??'console'));return report.exitCode;
 }
 if(command!=='docs'&&command!=='impact')throw Error('Unknown command');
 const cfg=await config(root,values.config,values.profile),files=await fileList(root),sha=(await git(root,['rev-parse','--verify','HEAD^{commit}'])).trim();
 if(command==='docs'){
  const action=values.check?'check':sub??'generate';if(!['generate','check'].includes(action))throw Error('Expected docs generate|check');
  const checkOptions={...(values.config?{config:values.config}:{}),...(values.profile?{profile:values.profile}:{}),...(values.head?{head:values.head}:{}),base:values.base??'HEAD',mode:'audit',...(values['trust-root']?{'trust-root':values['trust-root']}:{})};
  const report=await check(root,checkOptions);
  const generated=renderSpecificationDocuments(cfg.formal?.models??[],report.evaluations,report.assuranceMap);
  const extension=values.output?extname(values.output):'',single=extension?extension==='.md'?'markdown':extension==='.html'?'html':extension==='.json'?'json':undefined:undefined;
  if(extension&&!single)throw Error('Unsupported document extension');
  const directory=values.output&&!extension?values.output:cfg.documents?.output??'.behavproof/generated';
  const paths:Record<string,string>=single?{[single]:values.output!}:{markdown:`${directory}/behavior.md`,html:`${directory}/behavior.html`,json:`${directory}/behavior.json`};
  let outdated=false;for(const [format,path] of Object.entries(paths)){
   const content=generated[format as keyof typeof generated];if(action==='generate')await writeScoped(root,path,content);
   else if(!await exists(root,path)||(await safeRead(root,path)).toString('utf8')!==content)outdated=true;
  }
  process.stdout.write(outdated?'DOCUMENT_OUTDATED: regenerate documents\n':`Documents ${action==='generate'?'generated':'current'}; declarations alone do not prove execution.\n`);return outdated?1:0;
 }
 if(sub)throw Error('Unexpected impact argument');
 const diff=await gitDiff(root,ref(values.base??cfg.git.base),ref(values.head??'HEAD'));if(diff.headSha!==sha)throw Error('The selected --head must be checked out for static analysis');
 const changed=diff.files.flatMap(file=>[file.path,...(file.previousPath?[file.previousPath]:[])]);
 const impact=await currentImpact(root,files,files,changed,diff.status==='known',cfg.formal?.models);
 await emit(canonicalJson({...impact,diff})+'\n');return 0;
}
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`BehavProof error: ${error instanceof Error?error.message:'Unknown error'}\n`);process.exitCode=2;});
