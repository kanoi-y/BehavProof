import {canonicalJson,type CheckReport,type Evaluation,type EvidenceSubject} from '@behavproof/core';

const actions:Record<string,string>={
 testResult:'Inspect failed, skipped or missing tests; rerun the trusted Collector and authenticate its current reports.',
 changedLineCoverage:'Collect complete LCOV for the changed source scope and meet the protected coverage threshold.',
 mutationScore:'Collect current scoped mutants, inspect survivors and uncovered/error cases, and meet the protected score and minimum count.',
 pipelineIntegrity:'Inspect required upstream jobs, current run/attempt artifacts, protected workflow and issuer-bound required checks.',
 intentApproval:'Obtain an authorized human review of this exact Intent/Contract change and register it through the protected host.',
 contractExecution:'Execute every retained required case without skip using the matching contract/binding, and authenticate both test reports.',
 negativeCases:'Declare and execute the required negative cases against their retained contract revision.',
 policyProtection:'Restore the protected policy and source scope, or obtain a separately reviewed host registration for the proposed change.',
 productionTargetObserved:'Collect case-scoped calls of the registered real production target; passing comparisons do not establish reach.',
 mutationSensitivityObserved:'Run the registered case-scoped fault probe and retain actual failing comparisons separately from ordinary successful evidence.',
 evidenceIntegrity:'Discard stale or modified reports; collect fresh bytes through the independently selected producer and retain the host capture.',
 evaluationEnvironment:'Use a supported single-package project with clean, completely inventoried source inputs.',
 evaluationSnapshot:'Keep source, HEAD and configuration stable for the full evaluation, then rerun against freshly authenticated evidence.',
 testedCommitRelationship:'Fetch the pinned PR head/base and actual tested Git parents; do not relabel an unrelated commit.',
};
export function remediationFor(e:Evaluation){return e.remediation??actions[e.ruleId]??'Inspect this rule and its JSON evidence; configure its authenticated evaluator or restore the protected policy, then rerun check.';}
export type PolicyDiff={rules:{ruleId:string;protected:unknown;project:unknown;effective:unknown}[];configuration:{field:string;protected:unknown;project:unknown;effective:unknown}[];weakened:boolean};
export function formatReport(report:CheckReport&{policyDiff?:PolicyDiff|null;subject?:EvidenceSubject;effectivePolicyHash?:string},format:string){
 if(format==='json')return canonicalJson(report)+'\n';
 const scope=(e:Evaluation)=>e.scope.length?JSON.stringify(e.scope):'project';
 const conditions=[...(report.subject?[`Tested: ${report.subject.testedCommitSha}; PR head: ${report.subject.prHeadSha??'unknown'}; base: ${report.subject.baseSha??'unknown'}; dirty: ${report.subject.dirty}`]:[]),...(report.effectivePolicyHash?[`Effective policy: ${report.effectivePolicyHash}`]:[])];
 const rows=report.policyDiff?[...report.policyDiff.rules.map(r=>({name:r.ruleId,...r})),...report.policyDiff.configuration.map(r=>({name:r.field,...r}))]:[];
 if(format==='markdown'){
  const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('|','&#124;').replaceAll('\n',' ');
  const table=`# BehavProof ${report.status}\n\n${conditions.length?conditions.map(escape).join('\n\n')+'\n\n':''}| Rule | Scope | Evidence | Severity | Status | Reason | Action |\n| --- | --- | --- | --- | --- | --- | --- |\n${report.evaluations.map(e=>`| ${escape(e.ruleId)} | ${escape(scope(e))} | ${escape(e.evidenceIds.join(', '))} | ${e.severity} | ${e.status} | ${escape(e.message)} | ${escape(e.remediation??'')} |`).join('\n')}\n`;
  return table+(rows.length?`\n## Policy comparison\n\n| Rule / configuration | Protected | Project | Effective |\n| --- | --- | --- | --- |\n${rows.map(r=>`| ${escape(r.name)} | ${escape(canonicalJson(r.protected))} | ${escape(canonicalJson(r.project))} | ${escape(canonicalJson(r.effective))} |`).join('\n')}\n`:'');
 }
 if(format!=='console')throw Error('Unsupported report format');
 return `BehavProof: ${report.status} (${report.mandatoryCount} mandatory rules)\n${conditions.length?conditions.join('\n')+'\n':''}${report.evaluations.map(e=>`${e.status.padEnd(14)} ${e.severity.padEnd(5)} ${e.ruleId} [${scope(e)}]: ${e.message}${e.evidenceIds.length?`\n  Evidence: ${JSON.stringify(e.evidenceIds)}`:''}${e.remediation?`\n  Action: ${e.remediation}`:''}`).join('\n')}\n`+(rows.length?`\nPolicy comparison:\n${rows.map(r=>`${r.name}: protected=${canonicalJson(r.protected)} project=${canonicalJson(r.project)} effective=${canonicalJson(r.effective)}`).join('\n')}\n`:'');
}
